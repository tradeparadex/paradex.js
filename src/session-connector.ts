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
  createSessionGrant,
  nowSeconds,
  SessionGrantError,
  type CreateSessionGrantParams,
  type SessionEnvironment,
  type SessionGrant,
} from './session-typed-data.js';
import type { Hex } from './types.js';

/**
 * Opens trading sessions for a wallet-owned account: generates the session
 * key in the page, asks the owner to sign one grant, and registers it.
 *
 * @experimental `POST /v2/sessions` is not released yet; the request and
 * response shapes follow the session-grant spec and may change.
 */

export const SESSIONS_PATH = '/v2/sessions';

/** A registered session: the grant and the key that may act under it. */
export interface Session {
  readonly sessionId: string;
  readonly grant: SessionGrant;
  readonly key: SessionKey;
  readonly ownerSignature: Hex;
  readonly signatureChainId: number;
}

export interface SessionConnectorParams {
  readonly environment: SessionEnvironment;
  /** Paradex chain id, e.g. `PRIVATE_SN_PARACLEAR_MAINNET` (`ParadexConfig.paradexChainId`). */
  readonly paradexChain: string;
  readonly owner: SessionOwnerSigner;
  /** Defaults to memory; use `indexedDbSessionStorage()` to survive reloads. */
  readonly storage?: SessionStorage;
  readonly transport?: HttpTransport;
  readonly apiUrl?: string;
  readonly now?: () => number;
}

export type OpenSessionParams = Omit<
  CreateSessionGrantParams,
  'paradexChain' | 'environment' | 'sessionKey'
>;

interface CreateSessionResponse {
  readonly session_id?: unknown;
}

export class SessionConnector {
  readonly environment: SessionEnvironment;
  readonly paradexChain: string;
  private readonly owner: SessionOwnerSigner;
  private readonly storage: SessionStorage;
  private readonly transport: HttpTransport;
  private readonly apiUrl: string;
  private readonly now: () => number;

  constructor(params: SessionConnectorParams) {
    this.environment = params.environment;
    this.paradexChain = params.paradexChain;
    this.owner = params.owner;
    this.storage = params.storage ?? memorySessionStorage();
    this.transport = params.transport ?? fetchTransport;
    this.apiUrl = params.apiUrl ?? defaultApiUrl(params.environment);
    this.now = params.now ?? nowSeconds;
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
      paradexChain: this.paradexChain,
      environment: this.environment,
      sessionKey: key.publicKey,
    });

    await this.storage.put(key.record);
    try {
      const signatureChainId = await this.owner.getChainId();
      const typedData = buildSessionGrantEip712(grant, signatureChainId);
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
      const sessionId = (response.body as CreateSessionResponse | null)
        ?.session_id;
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new SessionApiError(response.status, {
          error: 'INVALID_RESPONSE',
          message: 'POST /v2/sessions returned no session_id',
        });
      }

      key = key.withMetadata({
        grant,
        ownerSignature,
        signatureChainId,
        sessionId,
      });
      await this.storage.put(key.record);
      return { sessionId, grant, key, ownerSignature, signatureChainId };
    } catch (error) {
      await this.storage.delete(key.publicKey);
      throw error;
    }
  }

  /**
   * Restores registered sessions from storage for this environment. Expired
   * sessions and sessions that never registered are deleted.
   */
  async restore(): Promise<Session[]> {
    const sessions: Session[] = [];
    for (const record of await this.storage.list()) {
      const session = await this.fromRecord(record);
      if (session != null) sessions.push(session);
    }
    return sessions;
  }

  /** Restores one session by its public key. */
  async restoreByKey(publicKey: string): Promise<Session | undefined> {
    const record = await this.storage.get(publicKey);
    return record == null ? undefined : await this.fromRecord(record);
  }

  /**
   * Forgets a session locally. This does not revoke it on the server;
   * revocation is an owner action.
   */
  async forget(session: Pick<Session, 'key'>): Promise<void> {
    await this.storage.delete(session.key.publicKey);
  }

  private async fromRecord(
    record: StoredSession,
  ): Promise<Session | undefined> {
    const { grant, sessionId, ownerSignature, signatureChainId, publicKey } =
      record;
    if (
      grant == null ||
      sessionId == null ||
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
      sessionId,
      grant,
      key: SessionKey.fromRecord(record),
      ownerSignature,
      signatureChainId,
    };
  }
}
