import * as Starknet from 'starknet';

import type { SessionKey } from '../../src/session-key';
import type {
  HttpRequest,
  HttpResponse,
  WebSocketLike,
} from '../../src/session-transport';

export const PARADEX_CHAIN = 'PRIVATE_SN_POTC_SEPOLIA';
export const MAIN =
  '0x5f8c4f0b9e6a1c7d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f';
export const SUB = '0x11';

/** Verifies a Stark signature against an x-only public key. */
export function verifyStark(
  publicKey: string,
  hash: string,
  [r, s]: readonly [string, string] | readonly string[],
): boolean {
  const x = BigInt(publicKey).toString(16).padStart(64, '0');
  const signature = new Starknet.ec.starkCurve.Signature(
    BigInt(r ?? '0'),
    BigInt(s ?? '0'),
  );
  return ['02', '03'].some((prefix) => {
    try {
      return Starknet.ec.starkCurve.verify(
        signature,
        Starknet.num.toHex(hash),
        prefix + x,
      );
    } catch {
      return false;
    }
  });
}

export function jwtFor(account: string, exp: number): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: account, exp })}.sig`;
}

export type Handler = (
  req: HttpRequest,
) => HttpResponse | Promise<HttpResponse>;

/** A transport that records requests and answers with `handler`. */
export function mockTransport(
  handler: Handler,
): jest.Mock<Promise<HttpResponse>, [HttpRequest]> {
  return jest.fn(async (req: HttpRequest) => await handler(req));
}

/** Mirrors the server's `/auth`: checks the session-key signature. */
export function authResponder(
  key: Pick<SessionKey, 'publicKey'>,
  jwtTtl = 300,
): (req: HttpRequest) => HttpResponse {
  return (req) => {
    const account = req.headers['PARADEX-STARKNET-ACCOUNT'] ?? '';
    const timestamp = Number(req.headers['PARADEX-TIMESTAMP']);
    const expiration = Number(req.headers['PARADEX-SIGNATURE-EXPIRATION']);
    const signature = JSON.parse(
      req.headers['PARADEX-STARKNET-SIGNATURE'] ?? '[]',
    ) as string[];
    const typedData: Starknet.TypedData = {
      domain: {
        name: 'Paradex',
        chainId: Starknet.shortString.encodeShortString(PARADEX_CHAIN),
        version: '1',
      },
      primaryType: 'Request',
      types: {
        StarkNetDomain: [
          { name: 'name', type: 'felt' },
          { name: 'chainId', type: 'felt' },
          { name: 'version', type: 'felt' },
        ],
        Request: [
          { name: 'method', type: 'felt' },
          { name: 'path', type: 'felt' },
          { name: 'body', type: 'felt' },
          { name: 'timestamp', type: 'felt' },
          { name: 'expiration', type: 'felt' },
        ],
      },
      message: {
        method: 'POST',
        path: '/v1/auth',
        body: '',
        timestamp,
        expiration,
      },
    };
    const hash = Starknet.typedData.getMessageHash(typedData, account);
    if (!verifyStark(key.publicKey, hash, signature)) {
      return { status: 401, body: { error: 'INVALID_SIGNATURE' } };
    }
    return {
      status: 200,
      body: { jwt_token: jwtFor(account, timestamp + jwtTtl) },
    };
  };
}

interface Sent {
  readonly jsonrpc: string;
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly id: number;
}

/** A scripted websocket. Replies to RPCs via `respond` (default: success). */
export class MockSocket implements WebSocketLike {
  static instances: MockSocket[] = [];
  readyState = 0;
  readonly sent: Sent[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  respond: (msg: Sent) => unknown = (msg) => ({
    jsonrpc: '2.0',
    id: msg.id,
    result: {},
  });

  constructor(readonly url: string) {
    MockSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState === 0) this.open();
    });
  }

  static reset(): void {
    MockSocket.instances = [];
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  send(data: string): void {
    const msg = JSON.parse(data) as Sent;
    this.sent.push(msg);
    const reply = this.respond(msg);
    if (reply != null) {
      queueMicrotask(() => {
        this.receive(reply);
      });
    }
  }

  receive(message: unknown): void {
    this.onmessage?.({
      data: typeof message === 'string' ? message : JSON.stringify(message),
    });
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({});
  }

  /** The server drops the connection. */
  drop(): void {
    this.close();
  }

  methods(): string[] {
    return this.sent.map((m) => m.method);
  }
}
