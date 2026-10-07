import {
  AUTH_PATH,
  buildAuthTypedData,
  buildOrderTypedData,
  jwtExpiry,
  SESSION_AUTH_MAX_TTL,
  type SessionOrder,
} from './session-auth.js';
import type { Session } from './session-connector.js';
import {
  defaultApiUrl,
  defaultWebSocketFactory,
  defaultWsUrl,
  fetchTransport,
  SESSION_REVOKED_ERRORS,
  SessionApiError,
  type HttpRequest,
  type HttpTransport,
  type WebSocketFactory,
  type WebSocketLike,
} from './session-transport.js';
import {
  assertGrantActive,
  canonicalFelt,
  grantAccounts,
  nowSeconds,
  SessionGrantError,
  type SessionEnvironment,
} from './session-typed-data.js';

/**
 * Trades every account a grant lists with one session key: a JWT per account
 * (`/auth` with `PARADEX-STARKNET-ACCOUNT`, signed by the session key), one
 * websocket per account, and requests routed by account. Sessions never use
 * `on_behalf_of`; each account authenticates as itself.
 *
 * When the grant expires or the server reports it revoked, every account is
 * dropped: tokens are discarded, sockets closed, and later calls throw.
 *
 * @experimental
 */

/** setTimeout's delay is a signed 32-bit millisecond count. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
const WS_OPEN = 1;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

export interface SessionAccountsParams {
  readonly session: Pick<Session, 'grant' | 'key'>;
  readonly environment: SessionEnvironment;
  readonly paradexChain: string;
  readonly transport?: HttpTransport;
  readonly apiUrl?: string;
  readonly wsUrl?: string;
  readonly webSocketFactory?: WebSocketFactory;
  /** Refresh a JWT this many seconds before it expires. Defaults to 60. */
  readonly refreshMarginSeconds?: number;
  /** Seconds since the epoch. */
  readonly now?: () => number;
  /** Called once when the grant is revoked or expires. */
  readonly onDropped?: (reason: SessionGrantError) => void;
}

export interface SessionRequest {
  readonly method: HttpRequest['method'];
  /** Path below the API root, e.g. `/v1/orders`. */
  readonly path: string;
  readonly body?: unknown;
}

export type SubscriptionHandler = (data: unknown) => void;

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
}

type Timer = ReturnType<typeof setTimeout>;

function hasOnBehalfOf(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasOnBehalfOf);
  if (value != null && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, v]) => key.startsWith('on_behalf_of') || hasOnBehalfOf(v),
    );
  }
  return false;
}

function isRevocation(text: unknown): boolean {
  const s = typeof text === 'string' ? text : JSON.stringify(text ?? '');
  return SESSION_REVOKED_ERRORS.some((code) => s.includes(code));
}

export class SessionAccounts {
  readonly accounts: readonly string[];
  private readonly params: SessionAccountsParams;
  private readonly transport: HttpTransport;
  private readonly apiUrl: string;
  private readonly wsUrl: string;
  private readonly webSocketFactory: WebSocketFactory;
  private readonly refreshMargin: number;
  private readonly now: () => number;
  private readonly tokens = new Map<string, CachedToken>();
  private readonly inflight = new Map<string, Promise<string>>();
  private readonly refreshTimers = new Map<string, Timer>();
  private readonly sockets = new Map<string, AccountSocket>();
  private expiryTimer: Timer | undefined;
  private dropped: SessionGrantError | undefined;
  private closed = false;

  constructor(params: SessionAccountsParams) {
    const { grant, key } = params.session;
    if (
      grant.environment !== params.environment ||
      grant.paradexChain !== params.paradexChain
    ) {
      throw new SessionGrantError(
        'ENVIRONMENT_MISMATCH',
        `grant is for ${grant.environment}/${grant.paradexChain}, not ${params.environment}/${params.paradexChain}`,
      );
    }
    if (grant.sessionKey !== key.publicKey) {
      throw new SessionGrantError(
        'INVALID_FIELD',
        'sessionKey: the grant names a different session key',
      );
    }
    this.params = params;
    this.now = params.now ?? nowSeconds;
    assertGrantActive(grant, this.now());
    this.accounts = grantAccounts(grant);
    this.transport = params.transport ?? fetchTransport;
    this.apiUrl = params.apiUrl ?? defaultApiUrl(params.environment);
    this.wsUrl = params.wsUrl ?? defaultWsUrl(params.environment);
    this.webSocketFactory = params.webSocketFactory ?? defaultWebSocketFactory;
    this.refreshMargin = params.refreshMarginSeconds ?? 60;
    this.scheduleExpiry();
  }

  /** Why the accounts were dropped, if they were. */
  get dropReason(): SessionGrantError | undefined {
    return this.dropped;
  }

  /** Mints a JWT for every listed account. */
  async start(): Promise<void> {
    await Promise.all(this.accounts.map(async (a) => await this.getJwt(a)));
  }

  /** A valid JWT for `account`, minted or refreshed as needed. */
  async getJwt(account: string): Promise<string> {
    const id = this.resolveAccount(account);
    const cached = this.tokens.get(id);
    if (cached != null && cached.expiresAt - this.refreshMargin > this.now()) {
      return cached.token;
    }
    return await this.mint(id);
  }

  /** Authenticated REST call as `account`. */
  async request(account: string, req: SessionRequest): Promise<unknown> {
    // The path is appended to the API root; anything but an absolute path
    // could point the bearer token at another host.
    if (!/^\/[A-Za-z0-9]/.test(req.path) || req.path.includes('//')) {
      throw new Error('request path must be an absolute API path like /v1/x');
    }
    if (hasOnBehalfOf(req.body) || req.path.includes('on_behalf_of')) {
      throw new Error('Sessions never use on_behalf_of; route by account');
    }
    const id = this.resolveAccount(account);
    const send = async (token: string): Promise<SessionApiError | unknown> => {
      const response = await this.transport({
        method: req.method,
        url: `${this.apiUrl}${req.path}`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(req.body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      });
      if (response.status >= 200 && response.status < 300) {
        return response.body;
      }
      return new SessionApiError(response.status, response.body);
    };

    let result = await send(await this.getJwt(id));
    if (result instanceof SessionApiError && result.status === 401) {
      this.checkRevoked(result);
      // The token may have expired in flight: mint once and retry.
      this.tokens.delete(id);
      result = await send(await this.getJwt(id));
      if (result instanceof SessionApiError) this.checkRevoked(result);
    }
    if (result instanceof SessionApiError) throw result;
    return result;
  }

  /** Signs `order` with the session key for `account` and submits it. */
  async placeOrder(account: string, order: SessionOrder): Promise<unknown> {
    const id = this.resolveAccount(account);
    const timestamp = Date.now();
    const typedData = buildOrderTypedData(
      this.params.paradexChain,
      order,
      timestamp,
    );
    const signature = await this.params.session.key.signTypedData(
      typedData,
      id,
    );
    return await this.request(id, {
      method: 'POST',
      path: '/v1/orders',
      body: {
        market: order.market,
        side: order.side,
        type: order.type,
        size: order.size,
        price: order.type === 'MARKET' ? '0' : order.price,
        instruction: order.instruction ?? 'GTC',
        signature: JSON.stringify(signature),
        signature_timestamp: timestamp,
        ...(order.clientId != null ? { client_id: order.clientId } : {}),
        ...(order.reduceOnly === true ? { flags: ['REDUCE_ONLY'] } : {}),
      },
    });
  }

  async cancelOrder(account: string, orderId: string): Promise<unknown> {
    return await this.request(account, {
      method: 'DELETE',
      path: `/v1/orders/${encodeURIComponent(orderId)}`,
    });
  }

  /**
   * Subscribes to a private or public channel on `account`'s socket, opening
   * and authenticating it if needed. Returns an unsubscribe function.
   */
  async subscribe(
    account: string,
    channel: string,
    handler: SubscriptionHandler,
  ): Promise<() => void> {
    const id = this.resolveAccount(account);
    let socket = this.sockets.get(id);
    if (socket == null) {
      socket = new AccountSocket(this, id);
      this.sockets.set(id, socket);
    }
    return await socket.subscribe(channel, handler);
  }

  /** Closes sockets and timers. The session itself stays valid. */
  close(): void {
    this.closed = true;
    this.teardown();
  }

  /** @internal */
  get socketUrl(): string {
    return this.wsUrl;
  }

  /** @internal */
  createWebSocket(): WebSocketLike {
    return this.webSocketFactory(this.wsUrl);
  }

  /** @internal */
  get isLive(): boolean {
    return !this.closed && this.dropped == null;
  }

  /** @internal Drops every account. Idempotent. */
  drop(reason: SessionGrantError): void {
    if (this.dropped != null) return;
    this.dropped = reason;
    this.teardown();
    this.params.onDropped?.(reason);
  }

  /** @internal */
  checkRevoked(error: SessionApiError): void {
    if (error.isSessionRevoked) {
      const reason = new SessionGrantError(
        'GRANT_REVOKED',
        `session revoked: ${error.message}`,
      );
      this.drop(reason);
      throw reason;
    }
  }

  /** @internal */
  wsAuthFailed(error: unknown): void {
    if (isRevocation(error)) {
      this.drop(
        new SessionGrantError('GRANT_REVOKED', 'session revoked (websocket)'),
      );
    }
  }

  private teardown(): void {
    this.tokens.clear();
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    if (this.expiryTimer != null) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
  }

  private assertLive(): void {
    if (this.dropped != null) throw this.dropped;
    if (this.closed) throw new Error('SessionAccounts is closed');
    try {
      assertGrantActive(this.params.session.grant, this.now());
    } catch (error) {
      if (error instanceof SessionGrantError) this.drop(error);
      throw error;
    }
  }

  private resolveAccount(account: string): string {
    this.assertLive();
    let id: string;
    try {
      id = canonicalFelt(account);
    } catch {
      id = account;
    }
    if (!this.accounts.includes(id)) {
      throw new SessionGrantError(
        'ACCOUNT_NOT_IN_GRANT',
        `${account} is not listed in the grant`,
      );
    }
    return id;
  }

  private async mint(account: string): Promise<string> {
    const pending = this.inflight.get(account);
    if (pending != null) return await pending;
    const promise = this.doMint(account).finally(() => {
      this.inflight.delete(account);
    });
    this.inflight.set(account, promise);
    return await promise;
  }

  private async doMint(account: string): Promise<string> {
    const { grant, key } = this.params.session;
    const now = this.now();
    const expiration = Math.min(now + SESSION_AUTH_MAX_TTL, grant.expiresAt);
    const typedData = buildAuthTypedData(
      this.params.paradexChain,
      now,
      expiration,
    );
    const signature = await key.signTypedData(typedData, account);
    // `token_usage` is never self-declared by clients.
    const response = await this.transport({
      method: 'POST',
      url: `${this.apiUrl}${AUTH_PATH}`,
      headers: {
        'PARADEX-STARKNET-ACCOUNT': account,
        'PARADEX-STARKNET-SIGNATURE': JSON.stringify(signature),
        'PARADEX-TIMESTAMP': String(now),
        'PARADEX-SIGNATURE-EXPIRATION': String(expiration),
      },
    });
    if (response.status < 200 || response.status >= 300) {
      const error = new SessionApiError(response.status, response.body);
      this.checkRevoked(error);
      throw error;
    }
    const token = (response.body as { jwt_token?: unknown } | null)?.jwt_token;
    if (typeof token !== 'string' || token === '') {
      throw new SessionApiError(response.status, {
        error: 'INVALID_RESPONSE',
        message: '/auth returned no jwt_token',
      });
    }
    // The grant may have been dropped while /auth was in flight.
    this.assertLive();
    const expiresAt = Math.min(jwtExpiry(token) ?? expiration, expiration);
    this.tokens.set(account, { token, expiresAt });
    if (this.sockets.has(account)) this.scheduleRefresh(account, expiresAt);
    return token;
  }

  /** @internal Keeps an account's socket authenticated across JWT expiry. */
  scheduleRefresh(account: string, expiresAt: number): void {
    const existing = this.refreshTimers.get(account);
    if (existing != null) clearTimeout(existing);
    const delayMs = Math.max(
      0,
      (expiresAt - this.refreshMargin - this.now()) * 1000,
    );
    this.refreshTimers.set(
      account,
      setTimeout(
        () => {
          this.refreshTimers.delete(account);
          if (!this.isLive) return;
          this.tokens.delete(account);
          void this.getJwt(account)
            .then(async (token) => {
              await this.sockets.get(account)?.reauthenticate(token);
            })
            .catch(() => {
              // Drop paths already ran; a transient failure is retried
              // when the socket reconnects or the next call mints.
            });
        },
        Math.min(delayMs, MAX_TIMER_DELAY_MS),
      ),
    );
  }

  /** @internal */
  tokenExpiry(account: string): number | undefined {
    return this.tokens.get(account)?.expiresAt;
  }

  private scheduleExpiry(): void {
    const remainingMs =
      (this.params.session.grant.expiresAt - this.now()) * 1000;
    this.expiryTimer = setTimeout(
      () => {
        this.expiryTimer = undefined;
        if (!this.isLive) return;
        if (this.now() >= this.params.session.grant.expiresAt) {
          this.drop(
            new SessionGrantError('GRANT_EXPIRED', 'session grant expired'),
          );
        } else {
          this.scheduleExpiry();
        }
      },
      Math.max(0, Math.min(remainingMs, MAX_TIMER_DELAY_MS)),
    );
  }
}

interface PendingCall {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: unknown) => void;
}

interface RpcMessage {
  readonly id?: unknown;
  readonly method?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
  readonly params?: { readonly channel?: unknown; readonly data?: unknown };
}

/** One authenticated websocket for one account. */
class AccountSocket {
  private ws: WebSocketLike | undefined;
  private ready: Promise<void> | undefined;
  private readonly handlers = new Map<string, Set<SubscriptionHandler>>();
  private readonly pending = new Map<number, PendingCall>();
  private nextId = 1;
  private reconnectAttempts = 0;
  private reconnectTimer: Timer | undefined;
  private closed = false;

  constructor(
    private readonly owner: SessionAccounts,
    private readonly account: string,
  ) {}

  async subscribe(
    channel: string,
    handler: SubscriptionHandler,
  ): Promise<() => void> {
    let set = this.handlers.get(channel);
    const first = set == null;
    if (set == null) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);
    try {
      await this.connect();
      if (first) await this.call('subscribe', { channel });
    } catch (error) {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(channel);
      throw error;
    }
    return () => {
      const current = this.handlers.get(channel);
      if (current?.delete(handler) !== true || current.size > 0) return;
      this.handlers.delete(channel);
      if (this.ws?.readyState === WS_OPEN) {
        this.call('unsubscribe', { channel }).catch(() => {});
      }
    };
  }

  async reauthenticate(token: string): Promise<void> {
    if (this.ws?.readyState !== WS_OPEN) return;
    try {
      await this.call('auth', { bearer: token });
    } catch (error) {
      this.owner.wsAuthFailed(error);
      // Start over with a fresh connection.
      this.ws?.close();
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer != null) clearTimeout(this.reconnectTimer);
    this.rejectPending(new Error('socket closed'));
    const ws = this.ws;
    this.ws = undefined;
    this.ready = undefined;
    ws?.close(1000, 'closed');
  }

  private async connect(): Promise<void> {
    this.ready ??= this.open();
    await this.ready;
  }

  private async open(): Promise<void> {
    const ws = this.owner.createWebSocket();
    this.ws = ws;
    try {
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          resolve();
        };
        ws.onerror = () => {
          reject(new Error('websocket error'));
        };
        ws.onclose = () => {
          reject(new Error('websocket closed before opening'));
        };
      });
    } catch (error) {
      if (this.ws === ws) this.ws = undefined;
      this.ready = undefined;
      throw error;
    }
    ws.onmessage = (event) => {
      this.onMessage(event.data);
    };
    ws.onclose = () => {
      this.onClose(ws);
    };
    ws.onerror = null;

    try {
      const token = await this.owner.getJwt(this.account);
      await this.call('auth', { bearer: token });
    } catch (error) {
      this.owner.wsAuthFailed(error);
      this.ready = undefined;
      ws.close();
      throw error;
    }
    const expiresAt = this.owner.tokenExpiry(this.account);
    if (expiresAt != null) this.owner.scheduleRefresh(this.account, expiresAt);
    this.reconnectAttempts = 0;
  }

  private async call(method: string, params: unknown): Promise<unknown> {
    const ws = this.ws;
    if (ws == null || ws.readyState !== WS_OPEN) {
      throw new Error('websocket is not open');
    }
    const id = this.nextId++;
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
    });
  }

  private onMessage(data: unknown): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(String(data)) as RpcMessage;
    } catch {
      return;
    }
    if (typeof message.id === 'number' && this.pending.has(message.id)) {
      const call = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error != null) call?.reject(message.error);
      else call?.resolve(message.result);
      return;
    }
    if (message.error != null) {
      this.owner.wsAuthFailed(message.error);
      return;
    }
    const channel = message.params?.channel;
    if (message.method === 'subscription' && typeof channel === 'string') {
      for (const handler of this.handlers.get(channel) ?? []) {
        handler(message.params?.data);
      }
    }
  }

  private onClose(ws: WebSocketLike): void {
    if (this.ws !== ws) return;
    this.ws = undefined;
    this.ready = undefined;
    this.rejectPending(new Error('websocket closed'));
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (
      this.closed ||
      !this.owner.isLive ||
      this.handlers.size === 0 ||
      this.reconnectTimer != null
    ) {
      return;
    }
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.resubscribe();
    }, delay);
  }

  private async resubscribe(): Promise<void> {
    if (this.closed || !this.owner.isLive) return;
    try {
      await this.connect();
      for (const channel of this.handlers.keys()) {
        await this.call('subscribe', { channel });
      }
    } catch {
      this.scheduleReconnect();
    }
  }

  private rejectPending(error: Error): void {
    for (const call of this.pending.values()) call.reject(error);
    this.pending.clear();
  }
}
