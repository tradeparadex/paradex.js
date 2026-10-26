import { hashTypedData } from './eip712.js';
import {
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
  type SessionEnvironment,
  type SessionGrant,
} from './session-typed-data.js';
import type { Hex } from './types.js';

export const SESSIONS_PATH = '/v2/sessions';

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

export type OpenSessionParams = Omit<
  CreateSessionGrantParams,
  'paradexChain' | 'environment' | 'sessionKey'
>;

interface CreateSessionResponse {
  readonly grant_id?: unknown;
  readonly expires_at?: unknown;
  readonly accounts?: unknown;
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
 * @experimental `POST /v2/sessions` is not released yet; the request and
 * response shapes may change.
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
   * Generates a session key, has the owner sign the grant (one wallet
   * prompt), and registers the session. On any failure the new key is
   * deleted.
   */
  async open(params: OpenSessionParams): Promise<Session> {
    let key = await SessionKey.generate();
    const grant = createSessionGrant({
      ...params,
      issuedAt: params.issuedAt ?? this.now(),
      limitCaps: params.limitCaps ?? this.limitCaps,
      enforcedLimits: params.enforcedLimits ?? this.enforcedLimits,
      paradexChain: this.paradexChain,
      environment: this.environment,
      sessionKey: key.publicKey,
    });

    await this.storage.put(key.record);
    try {
      const signatureChainId = await this.owner.getChainId();
      const typedData = buildSessionGrantEip712(grant, signatureChainId, {
        limitCaps: params.limitCaps ?? this.limitCaps,
        enforcedLimits: params.enforcedLimits ?? this.enforcedLimits,
      });
      const ownerSignature = assertEoaSignature(
        await this.owner.signTypedData({
          typedData,
          digest: hashTypedData(typedData),
        }),
      );

      const response = await this.transport({
        method: 'POST',
        url: `${this.apiUrl}${SESSIONS_PATH}`,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant,
          signature: ownerSignature,
          signature_chain_id: signatureChainId,
          signature_type: 'eip712',
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

  private async fromRecord(
    record: StoredSession,
  ): Promise<Session | undefined> {
    const { grant, grantId, ownerSignature, signatureChainId, publicKey } =
      record;
    if (
      grant == null ||
      grantId == null ||
      ownerSignature == null ||
      signatureChainId == null
    ) {
      await this.storage.delete(publicKey);
      return undefined;
    }
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
