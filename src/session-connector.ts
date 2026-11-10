import { hashTypedData } from './eip712.js';
import {
  assertRecordVersion,
  memorySessionStorage,
  SessionKey,
  type SessionStorage,
  type StoredSession,
} from './session-key.js';
import {
  assertEoaSignature,
  type SessionOwnerSigner,
} from './session-owner-signer.js';
import {
  defaultApiUrl,
  fetchTransport,
  SessionApiError,
  type HttpTransport,
} from './session-transport.js';
import {
  assertGrantActive,
  buildSessionGrantEip712,
  canonicalFelt,
  createSessionGrant,
  grantAccounts,
  nowSeconds,
  SessionGrantError,
  type CreateSessionGrantParams,
  type LimitCaps,
  type LimitName,
  type LimitOptions,
  type SessionEnvironment,
  type SessionGrant,
} from './session-typed-data.js';
import type { Hex } from './types.js';

export const SESSIONS_PATH = '/v2/sessions';
export const EVM_SUBACCOUNTS_PATH = '/v2/onboarding/subaccounts';

/** A registered session: the grant and the key that may act under it. */
export interface Session {
  /** The server's id for the grant (its hash). */
  readonly grantId: string;
  readonly grant: SessionGrant;
  readonly key: SessionKey;
  readonly ownerSignature: Hex;
  readonly signatureChainId: number;
}

export interface SessionConnectorParams {
  readonly environment: SessionEnvironment;
  /** Paradex chain id (`ParadexConfig.paradexChainId`). */
  readonly paradexChain: string;
  readonly owner: SessionOwnerSigner;
  /** Defaults to memory; use `indexedDbSessionStorage()` to survive reloads. */
  readonly storage?: SessionStorage;
  readonly transport?: HttpTransport;
  readonly apiUrl?: string;
  readonly now?: () => number;
  /**
   * Optional caps checked before the owner signs (none by default).
   * `open()` may override them per call.
   */
  readonly limitCaps?: LimitCaps;
  /**
   * Limits the server enforces (none by default, so every limit must be
   * `"none"`). `open()` may override them per call.
   */
  readonly enforcedLimits?: readonly LimitName[];
}

/** UTM tracking parameters, as `POST /v2/onboarding` takes them. */
export interface SessionUtm {
  readonly source: string;
  readonly campaign: string;
  readonly type?: string;
}

/**
 * Sent with the grant and read only when it opens a new account (a wallet
 * with no Paradex account yet). None of it is signed, so the server ignores
 * it for a grant that names a builder.
 */
export interface SessionOnboardingParams {
  readonly referralCode?: string;
  /** `campaign:code`. */
  readonly marketingCode?: string;
  readonly utm?: SessionUtm;
  /**
   * A Privy access token for the signing wallet, sent as
   * `PARADEX-PRIVY-ACCESS-TOKEN`. It lets a verified Privy user's wallet skip
   * the minimum-balance check when the grant opens a new account.
   */
  readonly privyAccessToken?: string;
}

export type OpenSessionParams = Omit<
  CreateSessionGrantParams,
  'paradexChain' | 'environment' | 'sessionKey'
> & {
  /** Used only when the grant opens a new account. */
  readonly onboarding?: SessionOnboardingParams;
};

/** An EVM-owned account's sub-account, as `GET /v2/onboarding/subaccounts` lists it. */
export interface EvmSubaccount {
  readonly address: string;
  /** Index under the owner the address derives from. */
  readonly index: number;
}

interface CreateSessionResponse {
  readonly grant_id?: unknown;
  readonly expires_at?: unknown;
  readonly accounts?: unknown;
}

/** Whether `open()` finished registering this record. */
function isRegistered(record: StoredSession): record is StoredSession & {
  grant: NonNullable<StoredSession['grant']>;
  grantId: NonNullable<StoredSession['grantId']>;
  ownerSignature: NonNullable<StoredSession['ownerSignature']>;
  signatureChainId: NonNullable<StoredSession['signatureChainId']>;
} {
  return (
    record.grant != null &&
    record.grantId != null &&
    record.ownerSignature != null &&
    record.signatureChainId != null
  );
}

function onboardingBody(
  onboarding: SessionOnboardingParams | undefined,
): Record<string, unknown> {
  if (onboarding == null) return {};
  const body: Record<string, unknown> = {};
  if (onboarding.referralCode != null && onboarding.referralCode !== '') {
    body.referral_code = onboarding.referralCode;
  }
  if (onboarding.marketingCode != null && onboarding.marketingCode !== '') {
    body.marketing_code = onboarding.marketingCode;
  }
  if (onboarding.utm != null) {
    body.utm = {
      source: onboarding.utm.source,
      campaign: onboarding.utm.campaign,
      ...(onboarding.utm.type != null ? { type: onboarding.utm.type } : {}),
    };
  }
  return body;
}

function sameAccounts(listed: unknown, grant: SessionGrant): boolean {
  if (!Array.isArray(listed)) return false;
  const expected = new Set(grantAccounts(grant));
  const got = new Set<string>();
  for (const account of listed as unknown[]) {
    if (typeof account !== 'string') return false;
    try {
      got.add(canonicalFelt(account));
    } catch {
      return false;
    }
  }
  return got.size === expected.size && [...got].every((a) => expected.has(a));
}

/**
 * Opens trading sessions for a wallet-owned account: generates the session
 * key in the page, asks the owner to sign one grant, and registers it.
 *
 * @experimental The request and response shapes of `/v2/sessions` may
 * change.
 */
export class SessionConnector {
  readonly environment: SessionEnvironment;
  readonly paradexChain: string;
  private readonly owner: SessionOwnerSigner;
  private readonly storage: SessionStorage;
  private readonly transport: HttpTransport;
  private readonly apiUrl: string;
  private readonly now: () => number;
  private readonly limitCaps: LimitCaps | undefined;
  private readonly enforcedLimits: readonly LimitName[] | undefined;

  constructor(params: SessionConnectorParams) {
    this.environment = params.environment;
    this.paradexChain = params.paradexChain;
    this.owner = params.owner;
    this.storage = params.storage ?? memorySessionStorage();
    this.transport = params.transport ?? fetchTransport;
    this.apiUrl = params.apiUrl ?? defaultApiUrl(params.environment);
    this.now = params.now ?? nowSeconds;
    this.limitCaps = params.limitCaps;
    this.enforcedLimits = params.enforcedLimits;
  }

  /**
   * Lists the sub-accounts of the EVM-owned account a wallet owns, lowest
   * index first, so a grant can list them before the wallet has signed in.
   * A wallet with no EVM-owned account has none.
   */
  async listSubaccounts(ethAddress: string): Promise<EvmSubaccount[]> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(ethAddress)) {
      throw new Error('ethAddress must be a 0x-prefixed 20-byte address');
    }
    const response = await this.transport({
      method: 'GET',
      url: `${this.apiUrl}${EVM_SUBACCOUNTS_PATH}?eth_address=${ethAddress}`,
      headers: {},
    });
    if (response.status < 200 || response.status >= 300) {
      throw new SessionApiError(response.status, response.body);
    }
    const results = (response.body as { results?: unknown } | null)?.results;
    if (!Array.isArray(results)) {
      throw new SessionApiError(response.status, {
        error: 'INVALID_RESPONSE',
        message: `GET ${EVM_SUBACCOUNTS_PATH} returned no results`,
      });
    }
    return results.map((entry: unknown) => {
      const { address, index } = (entry ?? {}) as Record<string, unknown>;
      if (
        typeof address !== 'string' ||
        typeof index !== 'number' ||
        !Number.isSafeInteger(index) ||
        index < 0
      ) {
        throw new SessionApiError(response.status, {
          error: 'INVALID_RESPONSE',
          message: `GET ${EVM_SUBACCOUNTS_PATH} returned a malformed entry`,
        });
      }
      return { address: canonicalFelt(address), index };
    });
  }

  /**
   * Generates a session key, has the owner sign the grant (one wallet
   * prompt), and registers the session. On any failure the new key is
   * deleted.
   *
   * A grant from a wallet with no Paradex account opens the account too; it
   * may list no subaccounts. Pass `onboarding` for that case.
   *
   * When the owner signer knows its address and the grant lists
   * subaccounts, each is checked against {@link listSubaccounts} before the
   * owner is asked to sign.
   */
  async open(params: OpenSessionParams): Promise<Session> {
    const { onboarding, ...grantParams } = params;
    const limitOptions: LimitOptions = {
      limitCaps: grantParams.limitCaps ?? this.limitCaps,
      enforcedLimits: grantParams.enforcedLimits ?? this.enforcedLimits,
    };
    let key = await SessionKey.generate();
    const grant = createSessionGrant({
      ...grantParams,
      ...limitOptions,
      // POST /v2/sessions caps every grant at the browser lifetime.
      sessionType: 'browser',
      issuedAt: grantParams.issuedAt ?? this.now(),
      paradexChain: this.paradexChain,
      environment: this.environment,
      sessionKey: key.publicKey,
    });
    await this.assertSubaccountsOwned(grant);

    await this.storage.put(key.record);
    try {
      const signatureChainId = await this.owner.getChainId();
      const typedData = buildSessionGrantEip712(
        grant,
        signatureChainId,
        limitOptions,
      );
      const ownerSignature = assertEoaSignature(
        await this.owner.signTypedData({
          typedData,
          digest: hashTypedData(typedData),
        }),
      );

      const response = await this.transport({
        method: 'POST',
        url: `${this.apiUrl}${SESSIONS_PATH}`,
        headers: {
          'Content-Type': 'application/json',
          ...(onboarding?.privyAccessToken != null &&
          onboarding.privyAccessToken !== ''
            ? { 'PARADEX-PRIVY-ACCESS-TOKEN': onboarding.privyAccessToken }
            : {}),
        },
        body: JSON.stringify({
          grant,
          signature: ownerSignature,
          signature_chain_id: signatureChainId,
          signature_type: 'eip712',
          ...onboardingBody(onboarding),
        }),
      });
      if (response.status < 200 || response.status >= 300) {
        throw new SessionApiError(response.status, response.body);
      }
      const body = response.body as CreateSessionResponse | null;
      const grantId = body?.grant_id;
      if (typeof grantId !== 'string' || grantId === '') {
        throw new SessionApiError(response.status, {
          error: 'INVALID_RESPONSE',
          message: 'POST /v2/sessions returned no grant_id',
        });
      }
      if (!sameAccounts(body?.accounts, grant)) {
        throw new SessionApiError(response.status, {
          error: 'INVALID_RESPONSE',
          message: 'POST /v2/sessions registered different accounts',
        });
      }
      // The API reports times in milliseconds; the signed grant uses seconds.
      // A different expiry means the server did not register this grant.
      if (body?.expires_at !== grant.expiresAt * 1000) {
        throw new SessionApiError(response.status, {
          error: 'INVALID_RESPONSE',
          message: 'POST /v2/sessions registered a different expiry',
        });
      }

      key = key.withMetadata({
        grant,
        ownerSignature,
        signatureChainId,
        grantId,
      });
      await this.storage.put(key.record);
      return { grantId, grant, key, ownerSignature, signatureChainId };
    } catch (error) {
      await this.storage.delete(key.publicKey);
      throw error;
    }
  }

  /**
   * Restores registered sessions from storage for this environment. Expired
   * sessions and sessions that never registered are deleted; records that
   * cannot be read are skipped.
   */
  async restore(): Promise<Session[]> {
    const sessions: Session[] = [];
    for (const record of await this.storage.list()) {
      try {
        const session = await this.fromRecord(record);
        if (session != null) sessions.push(session);
      } catch {
        // Unreadable record (e.g. from a newer SDK); leave it in place.
      }
    }
    return sessions;
  }

  /** Restores one session by its public key. */
  async restoreByKey(publicKey: string): Promise<Session | undefined> {
    const record = await this.storage.get(publicKey);
    return record == null ? undefined : await this.fromRecord(record);
  }

  /**
   * Forgets a session locally. This does not revoke it on the server; use
   * `SessionAccounts.revoke()` for that.
   */
  async forget(session: Pick<Session, 'key'>): Promise<void> {
    await this.storage.delete(session.key.publicKey);
  }

  /**
   * Refuses, before the owner signs, a grant listing an account that is not
   * one of the owner wallet's sub-accounts: the server would refuse it with
   * `ACCOUNT_NOT_ELIGIBLE`. Skipped when the signer cannot name its address,
   * or the server does not list sub-accounts.
   */
  private async assertSubaccountsOwned(grant: SessionGrant): Promise<void> {
    if (grant.subaccounts.length === 0 || this.owner.getAddress == null) {
      return;
    }
    let listed: EvmSubaccount[];
    try {
      listed = await this.listSubaccounts(await this.owner.getAddress());
    } catch (error) {
      // A server without the listing route answers an uncoded 404; leave the
      // check to POST /v2/sessions, which refuses with ACCOUNT_NOT_ELIGIBLE.
      if (
        error instanceof SessionApiError &&
        error.status === 404 &&
        error.code == null
      ) {
        return;
      }
      throw error;
    }
    const owned = new Set(listed.map((s) => s.address));
    const foreign = grant.subaccounts.find((a) => !owned.has(a));
    if (foreign != null) {
      throw new SessionGrantError(
        'ACCOUNT_NOT_ELIGIBLE',
        `subaccounts: ${foreign} is not a sub-account of the owner wallet`,
      );
    }
  }

  private async fromRecord(
    record: StoredSession,
  ): Promise<Session | undefined> {
    // A record from a newer SDK is unreadable here; leave it in place.
    assertRecordVersion(record);
    const publicKey = record.publicKey;
    if (!isRegistered(record)) {
      // `open()` in another tab may have registered it since it was listed.
      // Only a complete record is read again, so this cannot loop.
      const latest = await this.storage.get(publicKey);
      if (latest != null && isRegistered(latest)) {
        return await this.fromRecord(latest);
      }
      await this.storage.delete(publicKey);
      return undefined;
    }
    const { grant, grantId, ownerSignature, signatureChainId } = record;
    if (
      grant.environment !== this.environment ||
      grant.paradexChain !== this.paradexChain
    ) {
      // Another environment's session: leave it for that connector.
      return undefined;
    }
    try {
      assertGrantActive(grant, this.now());
    } catch (error) {
      if (
        error instanceof SessionGrantError &&
        error.code === 'GRANT_EXPIRED'
      ) {
        await this.storage.delete(publicKey);
        return undefined;
      }
      throw error;
    }
    if (grant.sessionKey !== publicKey) {
      await this.storage.delete(publicKey);
      return undefined;
    }
    return {
      grantId,
      grant,
      key: SessionKey.fromRecord(record),
      ownerSignature,
      signatureChainId,
    };
  }
}
