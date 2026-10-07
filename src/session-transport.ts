import type { SessionEnvironment } from './session-typed-data.js';

/**
 * HTTP and WebSocket plumbing for sessions, injectable so tests (and
 * non-browser runtimes) can supply their own.
 *
 * @experimental
 */

export interface HttpRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

/** Default transport on top of global `fetch`. */
export const fetchTransport: HttpTransport = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  const text = await response.text();
  let body: unknown = text;
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      // Leave non-JSON bodies as text.
    }
  }
  return { status: response.status, body };
};

/** The subset of the WHATWG `WebSocket` used here. */
export interface WebSocketLike {
  readonly readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export const defaultWebSocketFactory: WebSocketFactory = (url) => {
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('WebSocket is not available; pass a webSocketFactory');
  }
  return new globalThis.WebSocket(url) as unknown as WebSocketLike;
};

const ENVIRONMENT_HOST: Record<SessionEnvironment, string> = {
  mainnet: 'prod',
  testnet: 'testnet',
  nightly: 'nightly',
};

export function defaultApiUrl(environment: SessionEnvironment): string {
  return `https://api.${ENVIRONMENT_HOST[environment]}.paradex.trade`;
}

export function defaultWsUrl(environment: SessionEnvironment): string {
  return `wss://ws.api.${ENVIRONMENT_HOST[environment]}.paradex.trade/v1`;
}

/** Error codes the server uses when a session no longer exists. */
export const SESSION_REVOKED_ERRORS: readonly string[] = [
  'SUBKEY_REVOKED',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'GRANT_REVOKED',
];

export class SessionApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const record =
      body != null && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
    const code = typeof record.error === 'string' ? record.error : undefined;
    const message =
      typeof record.message === 'string'
        ? record.message
        : typeof body === 'string' && body !== ''
          ? body
          : `HTTP ${status}`;
    super(code != null ? `${code}: ${message}` : message);
    this.name = 'SessionApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }

  /** True when the server says the session is gone (revoked or expired). */
  get isSessionRevoked(): boolean {
    return this.code != null && SESSION_REVOKED_ERRORS.includes(this.code);
  }
}
