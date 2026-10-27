import {
  AUTH_PATH,
  buildAuthTypedData,
  buildOrderTypedData,
  jwtExpiry,
  SESSION_AUTH_MAX_TTL,
  type SessionOrder,
} from './session-auth.js';
import { SESSIONS_PATH, type Session } from './session-connector.js';
import {
  defaultApiUrl,
  defaultWebSocketFactory,
  defaultWsUrl,
  fetchTransport,
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

/** setTimeout's delay is a signed 32-bit millisecond count. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
const WS_OPEN = 1;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const DEFAULT_RPC_TIMEOUT_MS = 10_000;

export type GrantState = 'active' | 'revoked' | 'expired';

export interface GrantStatus {
  readonly grant_id: string;
  readonly state: GrantState;
  readonly expires_at?: number;
  readonly revoked_at?: number | null;
  readonly accounts?: readonly string[];
  readonly scopes?: readonly string[];
  readonly label?: string;
}

export interface SessionAccountsParams {
  readonly session: Pick<Session, 'grant' | 'key' | 'grantId'>;
  readonly environment: SessionEnvironment;
  readonly paradexChain: string;
  readonly transport?: HttpTransport;
  readonly apiUrl?: string;
  readonly wsUrl?: string;
  readonly webSocketFactory?: WebSocketFactory;
  /** Refresh a JWT this many seconds before it expires. Defaults to 60. */
  readonly refreshMarginSeconds?: number;
  /** Websocket RPC timeout. Defaults to 10 s. */
  readonly rpcTimeoutMs?: number;
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
  readonly mintedAt: number;
  readonly expiresAt: number;
}

type Timer = ReturnType<typeof setTimeout>;

function hasOnBehalfOf(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasOnBehalfOf);
  if (value != null && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, v]) =>
        key.toLowerCase().startsWith('on_behalf_of') || hasOnBehalfOf(v),
    );
  }
  return false;
}

function pathMentionsOnBehalfOf(path: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return true;
  }
  return decoded.toLowerCase().includes('on_behalf_of');
}

/** `/auth` refusals that mean "this session key was not accepted". */
function isAuthRefusal(error: SessionApiError): boolean {
  return error.status === 401 || error.status === 403;
}

/** RFQ endpoints do not accept session tokens yet, even with `trade:rfq`. */
const RFQ_PATH = /^\/v\d+\/rfqs?(\/|\?|$)/;

export const NOT_AVAILABLE_TO_SESSIONS = 'NOT_AVAILABLE_TO_SESSIONS';

/**
 * Trades every account a grant lists with one session key: a JWT per account
 * (`/auth` with `PARADEX-STARKNET-ACCOUNT`, signed by the session key), one
 * websocket per account, and requests routed by account. Sessions never use
 * `on_behalf_of`; each account authenticates as itself.
 *
 * When the grant expires or is revoked, every account is dropped: tokens are
 * discarded, sockets closed, and later calls throw. Whenever the server
 * refuses a session token or the session key, the grant's state is re-checked
 * with `GET /v2/sessions/{grant_id}/status`; any other answer is transient.
 *
 * @experimental
 */
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
  private statusCheck: Promise<GrantState | undefined> | undefined;
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
    if (cached != null && !this.needsRefresh(cached)) return cached.token;
    return await this.mint(id);
  }

  /** Authenticated REST call as `account`. */
  async request(account: string, req: SessionRequest): Promise<unknown> {
    // The path is appended to the API root; anything but an absolute path
    // could point the bearer token at another host.
    if (!/^\/[A-Za-z0-9]/.test(req.path) || req.path.includes('//')) {
      throw new Error('request path must be an absolute API path like /v1/x');
    }
    if (hasOnBehalfOf(req.body) || pathMentionsOnBehalfOf(req.path)) {
      throw new Error('Sessions never use on_behalf_of; route by account');
    }
    const id = this.resolveAccount(account);
    let result = await this.send(req, await this.getJwt(id));
    // Only a 401 means the token was refused; a 403 is about the request.
    if (result instanceof SessionApiError && result.status === 401) {
      await this.confirmActive();
      // The token may have expired in flight: mint once and retry.
      this.tokens.delete(id);
      result = await this.send(req, await this.getJwt(id));
      if (result instanceof SessionApiError && result.status === 401) {
        await this.confirmActive();
      }
    }
    if (
      result instanceof SessionApiError &&
      result.status === 403 &&
      RFQ_PATH.test(req.path)
    ) {
      throw new SessionApiError(403, {
        error: NOT_AVAILABLE_TO_SESSIONS,
        message: 'RFQ is not available to sessions yet',
      });
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

  /** The grant's details (`GET /v2/sessions/{grant_id}`). */
  async status(): Promise<GrantStatus> {
    return (await this.request(this.accounts[0] ?? '', {
      method: 'GET',
      path: this.grantPath(),
    })) as GrantStatus;
  }

  /**
   * Revokes the grant on the server (every account under it) and drops
   * every account locally.
   */
  async revoke(): Promise<void> {
    await this.request(this.accounts[0] ?? '', {
      method: 'DELETE',
      path: this.grantPath(),
    });
    this.drop(new SessionGrantError('GRANT_REVOKED', 'session revoked'));
  }

  /**
   * Subscribes to a channel on `account`'s socket, opening and authenticating
   * it if needed. Returns an unsubscribe function; the socket closes once its
   * last subscription is gone.
   */
  async subscribe(
    account: string,
    channel: string,
    handler: SubscriptionHandler,
  ): Promise<() => void> {
    const id = this.resolveAccount(account);
    let socket = this.sockets.get(id);
    if (socket == null) {
      socket = new AccountSocket(this, id, this.params.rpcTimeoutMs);
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

  /** @internal The socket for `account` has no subscriptions left. */
  socketIdle(account: string, socket: AccountSocket): void {
    if (this.sockets.get(account) !== socket) return;
    this.sockets.delete(account);
    this.clearRefresh(account);
    socket.close();
  }

  /**
   * @internal Called when the server refused a session token or the session
   * key. Asks the server whether the grant is still active; drops every
   * account and throws if it is not.
   */
  async confirmActive(): Promise<void> {
    this.statusCheck ??= this.checkGrantState().finally(() => {
      this.statusCheck = undefined;
    });
    await this.statusCheck;
    if (this.dropped != null) throw this.dropped;
  }

  /**
   * `GET /v2/sessions/{grant_id}/status` needs no token, so it still answers
   * once the session's tokens are refused. 404 means the grant is gone.
   */
  private async checkGrantState(): Promise<GrantState | undefined> {
    let response;
    try {
      response = await this.transport({
        method: 'GET',
        url: `${this.apiUrl}${this.grantPath()}/status`,
        headers: {},
      });
    } catch {
      return undefined;
    }
    let state: unknown;
    if (response.status === 404) {
      state = 'revoked';
    } else if (response.status >= 200 && response.status < 300) {
      state = (response.body as Partial<GrantStatus> | null)?.state;
    }
    if (state === 'revoked') {
      this.drop(new SessionGrantError('GRANT_REVOKED', 'session revoked'));
    } else if (state === 'expired') {
      this.drop(new SessionGrantError('GRANT_EXPIRED', 'session expired'));
    }
    // Anything else is transient: callers fail this attempt, and sockets
    // retry with backoff.
    return state === 'active' || state === 'revoked' || state === 'expired'
      ? state
      : undefined;
  }

  private grantPath(): string {
    return `${SESSIONS_PATH}/${encodeURIComponent(this.params.session.grantId)}`;
  }

  private async send(
    req: SessionRequest,
    token: string,
  ): Promise<SessionApiError | unknown> {
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
    if (response.status >= 200 && response.status < 300) return response.body;
    return new SessionApiError(response.status, response.body);
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
      // Only expiry ends the session; a skewed local clock does not.
      if (
        error instanceof SessionGrantError &&
        error.code === 'GRANT_EXPIRED'
      ) {
        this.drop(error);
        throw error;
      }
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

  /**
   * A token needs refreshing within the margin before it expires. Tokens cut
   * short by the grant's own expiry are kept to the end: re-minting cannot
   * extend them, and the expiry timer drops everything at that point.
   */
  private needsRefresh(token: CachedToken): boolean {
    const now = this.now();
    if (token.expiresAt >= this.params.session.grant.expiresAt) {
      return now >= token.expiresAt;
    }
    const margin = Math.min(
      this.refreshMargin,
      Math.floor((token.expiresAt - token.mintedAt) / 2),
    );
    return now >= token.expiresAt - margin;
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
    // No `token_usage` parameter: the server derives it from the grant.
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
      if (isAuthRefusal(error)) await this.confirmActive();
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
    const cached = { token, mintedAt: now, expiresAt };
    this.tokens.set(account, cached);
    if (this.sockets.has(account)) this.scheduleRefresh(account);
    return token;
  }

  private clearRefresh(account: string): void {
    const existing = this.refreshTimers.get(account);
    if (existing != null) clearTimeout(existing);
    this.refreshTimers.delete(account);
  }

  /** @internal Keeps an account's socket authenticated across JWT expiry. */
  scheduleRefresh(account: string): void {
    this.clearRefresh(account);
    const token = this.tokens.get(account);
    // A token that runs to the grant's expiry is never refreshed.
    if (
      token == null ||
      token.expiresAt >= this.params.session.grant.expiresAt
    ) {
      return;
    }
    const margin = Math.min(
      this.refreshMargin,
      Math.floor((token.expiresAt - token.mintedAt) / 2),
    );
    const delayMs = Math.max(
      1000,
      (token.expiresAt - margin - this.now()) * 1000,
    );
    this.refreshTimers.set(
      account,
      setTimeout(
        () => {
          this.refreshTimers.delete(account);
          if (!this.isLive) return;
          this.tokens.delete(account);
          void this.getJwt(account)
            .then(async (fresh) => {
              await this.sockets.get(account)?.reauthenticate(fresh);
            })
            .catch(() => {
              // Restart the socket; its reconnect path retries /auth with
              // backoff. Drops have already torn everything down.
              this.sockets.get(account)?.restart();
            });
        },
        Math.min(delayMs, MAX_TIMER_DELAY_MS),
      ),
    );
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
  readonly timer: Timer;
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
  /** Subscriptions sent on the current connection, settled or pending. */
  private readonly subscribed = new Map<string, Promise<void>>();
  private readonly pending = new Map<number, PendingCall>();
  private nextId = 1;
  private reconnectAttempts = 0;
  private reconnectTimer: Timer | undefined;
  private closed = false;

  constructor(
    private readonly owner: SessionAccounts,
    private readonly account: string,
    private readonly rpcTimeoutMs = DEFAULT_RPC_TIMEOUT_MS,
  ) {}

  async subscribe(
    channel: string,
    handler: SubscriptionHandler,
  ): Promise<() => void> {
    let set = this.handlers.get(channel);
    if (set == null) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);
    try {
      await this.connect();
      await this.ensureSubscribed(channel);
    } catch (error) {
      this.removeHandler(channel, handler, false);
      throw error;
    }
    return () => {
      this.removeHandler(channel, handler, true);
    };
  }

  async reauthenticate(token: string): Promise<void> {
    if (this.ws?.readyState !== WS_OPEN) return;
    try {
      await this.call('auth', { bearer: token });
    } catch {
      void this.owner.confirmActive().catch(() => {});
      this.restart();
    }
  }

  /** Drops the connection; the reconnect path takes over. */
  restart(): void {
    this.ws?.close();
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer != null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.rejectPending(new Error('socket closed'));
    const ws = this.ws;
    this.ws = undefined;
    this.ready = undefined;
    ws?.close(1000, 'closed');
  }

  private removeHandler(
    channel: string,
    handler: SubscriptionHandler,
    unsubscribe: boolean,
  ): void {
    const current = this.handlers.get(channel);
    if (current?.delete(handler) !== true || current.size > 0) return;
    this.handlers.delete(channel);
    const wasSubscribed = this.subscribed.delete(channel);
    if (this.handlers.size === 0) {
      this.owner.socketIdle(this.account, this);
    } else if (
      unsubscribe &&
      wasSubscribed &&
      this.ws?.readyState === WS_OPEN
    ) {
      this.call('unsubscribe', { channel }).catch(() => {});
    }
  }

  private async ensureSubscribed(channel: string): Promise<void> {
    let pending = this.subscribed.get(channel);
    if (pending == null) {
      pending = this.call('subscribe', { channel }).then(() => undefined);
      this.subscribed.set(channel, pending);
      pending.catch(() => {
        if (this.subscribed.get(channel) === pending) {
          this.subscribed.delete(channel);
        }
      });
    }
    await pending;
  }

  private async connect(): Promise<void> {
    if (this.closed) throw new Error('socket closed');
    this.ready ??= this.open();
    await this.ready;
  }

  private async open(): Promise<void> {
    const ws = this.owner.createWebSocket();
    this.ws = ws;
    this.subscribed.clear();
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
      this.ready = undefined;
      ws.close();
      void this.owner.confirmActive().catch(() => {});
      throw error;
    }
    this.owner.scheduleRefresh(this.account);
    this.reconnectAttempts = 0;
    if (this.reconnectTimer != null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    // Every connection carries every channel, including ones a pending
    // reconnect would have restored.
    for (const channel of this.handlers.keys()) {
      this.ensureSubscribed(channel).catch(() => {});
    }
  }

  private async call(method: string, params: unknown): Promise<unknown> {
    const ws = this.ws;
    if (ws == null || ws.readyState !== WS_OPEN) {
      throw new Error('websocket is not open');
    }
    const id = this.nextId++;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`websocket ${method} timed out`));
        // A silent connection is not trustworthy; start over.
        this.restart();
      }, this.rpcTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
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
      if (call != null) clearTimeout(call.timer);
      if (message.error != null) call?.reject(message.error);
      else call?.resolve(message.result);
      return;
    }
    if (message.error != null) {
      // An unsolicited error may mean the session was revoked.
      void this.owner.confirmActive().catch(() => {});
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
    this.subscribed.clear();
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
      await Promise.all(
        [...this.handlers.keys()].map(async (channel) => {
          await this.ensureSubscribed(channel);
        }),
      );
    } catch {
      this.scheduleReconnect();
    }
  }

  private rejectPending(error: Error): void {
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    this.pending.clear();
  }
}
