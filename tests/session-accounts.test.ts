import * as Starknet from 'starknet';

import { SessionAccounts } from '../src/session-accounts';
import { buildOrderTypedData } from '../src/session-auth';
import { SessionKey } from '../src/session-key';
import type { HttpRequest, HttpResponse } from '../src/session-transport';
import {
  createSessionGrant,
  SessionGrantError,
  type SessionGrant,
} from '../src/session-typed-data';

import {
  authResponder,
  MAIN,
  MockSocket,
  mockTransport,
  PARADEX_CHAIN,
  SUB,
  verifyStark,
} from './mocks/session';

const T0 = 1760000000;
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** Lets real async work (WebCrypto) settle while timers are faked. */
async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 2000 && !condition(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(condition()).toBe(true);
}

let key: SessionKey;
beforeAll(async () => {
  key = await SessionKey.generate();
});

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'],
  });
  jest.setSystemTime(T0 * 1000);
  MockSocket.reset();
});

afterEach(() => {
  jest.useRealTimers();
});

function grantFor(overrides: Partial<SessionGrant> = {}): SessionGrant {
  return {
    ...createSessionGrant({
      paradexChain: PARADEX_CHAIN,
      environment: 'testnet',
      account: MAIN,
      sessionKey: key.publicKey,
      subaccounts: [SUB],
      issuedAt: T0,
    }),
    ...overrides,
  };
}

type Route = (
  req: HttpRequest,
) => HttpResponse | undefined | Promise<HttpResponse | undefined>;

interface Harness {
  readonly accounts: SessionAccounts;
  readonly transport: jest.Mock<Promise<HttpResponse>, [HttpRequest]>;
  readonly onDropped: jest.Mock;
  readonly authCalls: (account?: string) => HttpRequest[];
}

function setup(
  options: {
    readonly grant?: SessionGrant;
    readonly route?: Route;
    readonly jwtTtl?: number;
  } = {},
): Harness {
  const auth = authResponder(key, options.jwtTtl);
  const transport = mockTransport(async (req) => {
    const routed = await options.route?.(req);
    if (routed != null) return routed;
    if (req.url.endsWith('/v1/auth')) return auth(req);
    return { status: 200, body: { ok: true } };
  });
  const onDropped = jest.fn();
  const accounts = new SessionAccounts({
    session: { grant: options.grant ?? grantFor(), key },
    environment: 'testnet',
    paradexChain: PARADEX_CHAIN,
    transport,
    webSocketFactory: (url) => new MockSocket(url),
    now: nowSeconds,
    onDropped,
  });
  const authCalls = (account?: string): HttpRequest[] =>
    transport.mock.calls
      .map(([req]) => req)
      .filter(
        (req) =>
          req.url.endsWith('/v1/auth') &&
          (account == null ||
            req.headers['PARADEX-STARKNET-ACCOUNT'] === account),
      );
  return { accounts, transport, onDropped, authCalls };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
}

function expectCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(SessionGrantError);
  expect((error as SessionGrantError).code).toBe(code);
}

describe('construction refusals', () => {
  test('wrong environment', () => {
    for (const grant of [
      grantFor({ environment: 'nightly' }),
      grantFor({ paradexChain: 'PRIVATE_SN_PARACLEAR_MAINNET' }),
    ]) {
      let error: unknown;
      try {
        setup({ grant });
      } catch (e) {
        error = e;
      }
      expectCode(error, 'ENVIRONMENT_MISMATCH');
    }
  });

  test('expired grant', () => {
    let error: unknown;
    try {
      setup({ grant: grantFor({ expiresAt: T0 }) });
    } catch (e) {
      error = e;
    }
    expectCode(error, 'GRANT_EXPIRED');
  });

  test('grant for another key', () => {
    expect(() => setup({ grant: grantFor({ sessionKey: '0x5' }) })).toThrow(
      /different session key/,
    );
  });
});

describe('JWTs', () => {
  test('mints one JWT per listed account, each signed by the session key for that account', async () => {
    const { accounts, authCalls } = setup();
    expect(accounts.accounts).toEqual([MAIN, SUB]);
    await accounts.start();
    expect(authCalls()).toHaveLength(2);
    for (const account of [MAIN, SUB]) {
      const [req] = authCalls(account);
      expect(req?.method).toBe('POST');
      expect(req?.url).toBe('https://api.testnet.paradex.trade/v1/auth');
      expect(req?.headers['PARADEX-TIMESTAMP']).toBe(String(T0));
      // ≤ 15 minutes.
      expect(req?.headers['PARADEX-SIGNATURE-EXPIRATION']).toBe(
        String(T0 + 900),
      );
      // token_usage is never self-declared.
      expect(req?.url).not.toMatch(/token_usage/);
      expect(Object.keys(req?.headers ?? {})).not.toContain(
        'PARADEX-AUTHORIZE-ISOLATED-MARKETS',
      );
    }
  });

  test('the /auth expiry never passes the grant expiry', async () => {
    const { accounts, authCalls } = setup({
      grant: grantFor({ expiresAt: T0 + 120 }),
    });
    await accounts.getJwt(MAIN);
    expect(authCalls(MAIN)[0]?.headers['PARADEX-SIGNATURE-EXPIRATION']).toBe(
      String(T0 + 120),
    );
  });

  test('caches, refreshes near expiry, and dedupes concurrent mints', async () => {
    const { accounts, authCalls } = setup({ jwtTtl: 300 });
    const [a, b] = await Promise.all([
      accounts.getJwt(MAIN),
      accounts.getJwt(MAIN),
    ]);
    expect(a).toBe(b);
    expect(authCalls(MAIN)).toHaveLength(1);
    expect(await accounts.getJwt(MAIN)).toBe(a);

    jest.setSystemTime((T0 + 241) * 1000); // inside the 60 s margin
    const refreshed = await accounts.getJwt(MAIN);
    expect(refreshed).not.toBe(a);
    expect(authCalls(MAIN)).toHaveLength(2);
  });

  test('accepts non-canonical forms of a listed account and refuses others', async () => {
    const { accounts } = setup();
    await accounts.getJwt('0x0011');
    expectCode(await caught(accounts.getJwt('0x12')), 'ACCOUNT_NOT_IN_GRANT');
    expectCode(
      await caught(accounts.getJwt('not-an-address')),
      'ACCOUNT_NOT_IN_GRANT',
    );
  });

  test('a bad /auth response is an error, not a drop', async () => {
    const { accounts, onDropped } = setup({
      route: (req) =>
        req.url.endsWith('/v1/auth') ? { status: 200, body: {} } : undefined,
    });
    await expect(accounts.getJwt(MAIN)).rejects.toThrow(/no jwt_token/);
    const failing = setup({
      route: (req) =>
        req.url.endsWith('/v1/auth')
          ? { status: 500, body: { error: 'INTERNAL' } }
          : undefined,
    });
    await expect(failing.accounts.getJwt(MAIN)).rejects.toThrow('INTERNAL');
    expect(onDropped).not.toHaveBeenCalled();
    expect(failing.onDropped).not.toHaveBeenCalled();
  });
});

describe('REST routing', () => {
  test('sends each request with its own account JWT', async () => {
    const { accounts, transport } = setup();
    await accounts.request(MAIN, { method: 'GET', path: '/v1/balance' });
    await accounts.request(SUB, { method: 'GET', path: '/v1/balance' });
    const [main, sub] = transport.mock.calls
      .map(([req]) => req)
      .filter((req) => req.url.endsWith('/v1/balance'));
    const mainJwt = await accounts.getJwt(MAIN);
    const subJwt = await accounts.getJwt(SUB);
    expect(mainJwt).not.toBe(subJwt);
    expect(main?.headers.Authorization).toBe(`Bearer ${mainJwt}`);
    expect(sub?.headers.Authorization).toBe(`Bearer ${subJwt}`);
    expect(main?.body).toBeUndefined();
  });

  test.each([
    [
      'body',
      {
        method: 'POST',
        path: '/v1/orders',
        body: { on_behalf_of_account: SUB },
      },
    ],
    [
      'nested body',
      {
        method: 'POST',
        path: '/v1/orders/batch',
        body: [{ a: { on_behalf_of_account: SUB } }],
      },
    ],
    [
      'query',
      { method: 'GET', path: `/v1/orders?on_behalf_of_account=${SUB}` },
    ],
  ] as const)('refuses on_behalf_of in the %s', async (_name, req) => {
    const { accounts, transport } = setup();
    await expect(accounts.request(MAIN, req)).rejects.toThrow(
      /never use on_behalf_of/,
    );
    expect(transport).not.toHaveBeenCalled();
  });

  test.each(['@evil.example/v1/x', 'v1/x', '//evil.example/x', '/v1//x', ''])(
    'refuses path %p that could leave the API host',
    async (path) => {
      const { accounts, transport } = setup();
      await expect(
        accounts.request(MAIN, { method: 'GET', path }),
      ).rejects.toThrow(/absolute API path/);
      expect(transport).not.toHaveBeenCalled();
    },
  );

  test('retries once with a fresh JWT after a plain 401', async () => {
    let first = true;
    const { accounts, authCalls } = setup({
      route: (req) => {
        if (req.url.endsWith('/v1/positions') && first) {
          first = false;
          return { status: 401, body: { error: 'TOKEN_EXPIRED' } };
        }
        return undefined;
      },
    });
    expect(
      await accounts.request(MAIN, { method: 'GET', path: '/v1/positions' }),
    ).toEqual({ ok: true });
    expect(authCalls(MAIN)).toHaveLength(2);
  });

  test('surfaces non-401 errors', async () => {
    const { accounts } = setup({
      route: (req) =>
        req.url.endsWith('/v1/orders')
          ? { status: 400, body: { error: 'ORDER_REJECTED', message: 'no' } }
          : undefined,
    });
    await expect(
      accounts.request(MAIN, { method: 'POST', path: '/v1/orders', body: {} }),
    ).rejects.toThrow('ORDER_REJECTED: no');
  });

  test('places orders signed by the session key for the routed account', async () => {
    const { accounts, transport } = setup();
    await accounts.placeOrder(SUB, {
      market: 'BTC-USD-PERP',
      side: 'BUY',
      type: 'LIMIT',
      size: '0.5',
      price: '65000.25',
      clientId: 'c-1',
      reduceOnly: true,
    });
    const req = transport.mock.calls
      .map(([r]) => r)
      .find((r) => r.url.endsWith('/v1/orders'));
    const body = JSON.parse(req?.body ?? '{}') as Record<string, unknown>;
    const signature = JSON.parse(String(body.signature)) as string[];
    expect(body).toMatchObject({
      market: 'BTC-USD-PERP',
      side: 'BUY',
      type: 'LIMIT',
      size: '0.5',
      price: '65000.25',
      instruction: 'GTC',
      client_id: 'c-1',
      flags: ['REDUCE_ONLY'],
      signature_timestamp: T0 * 1000,
    });
    expect(Object.keys(body).some((k) => k.startsWith('on_behalf_of'))).toBe(
      false,
    );
    expect(req?.headers.Authorization).toBe(
      `Bearer ${await accounts.getJwt(SUB)}`,
    );
    const typedData = buildOrderTypedData(
      PARADEX_CHAIN,
      {
        market: 'BTC-USD-PERP',
        side: 'BUY',
        type: 'LIMIT',
        size: '0.5',
        price: '65000.25',
      },
      T0 * 1000,
    );
    const hash = Starknet.typedData.getMessageHash(typedData, SUB);
    expect(verifyStark(key.publicKey, hash, signature)).toBe(true);
    // Signed for SUB, so it does not verify for MAIN.
    const mainHash = Starknet.typedData.getMessageHash(typedData, MAIN);
    expect(verifyStark(key.publicKey, mainHash, signature)).toBe(false);
  });

  test('market orders sign price 0; cancel routes by account', async () => {
    const { accounts, transport } = setup();
    await accounts.placeOrder(MAIN, {
      market: 'ETH-USD-PERP',
      side: 'SELL',
      type: 'MARKET',
      size: '1',
      instruction: 'IOC',
    });
    await accounts.cancelOrder(SUB, 'order/1');
    const calls = transport.mock.calls.map(([r]) => r);
    const order = JSON.parse(
      calls.find((r) => r.url.endsWith('/v1/orders'))?.body ?? '{}',
    );
    expect(order.price).toBe('0');
    expect(order.instruction).toBe('IOC');
    expect(order.flags).toBeUndefined();
    const cancel = calls.find((r) => r.method === 'DELETE');
    expect(cancel?.url).toBe(
      'https://api.testnet.paradex.trade/v1/orders/order%2F1',
    );
    expect(cancel?.headers.Authorization).toBe(
      `Bearer ${await accounts.getJwt(SUB)}`,
    );
  });
});

describe('dropping every account', () => {
  test('a revoked 401 on any account drops all of them', async () => {
    const { accounts, onDropped, transport } = setup({
      route: (req) =>
        req.url.endsWith('/v1/orders')
          ? { status: 401, body: { error: 'SUBKEY_REVOKED' } }
          : undefined,
    });
    await accounts.subscribe(MAIN, 'orders.ALL', jest.fn());
    await accounts.subscribe(SUB, 'orders.ALL', jest.fn());
    const error = await caught(
      accounts.request(SUB, { method: 'POST', path: '/v1/orders', body: {} }),
    );
    expectCode(error, 'GRANT_REVOKED');
    expect(onDropped).toHaveBeenCalledTimes(1);
    expect(accounts.dropReason).toBe(error);
    expect(MockSocket.instances.every((s) => s.readyState === 3)).toBe(true);

    const before = transport.mock.calls.length;
    for (const account of [MAIN, SUB]) {
      expectCode(await caught(accounts.getJwt(account)), 'GRANT_REVOKED');
      expectCode(
        await caught(accounts.subscribe(account, 'x', jest.fn())),
        'GRANT_REVOKED',
      );
    }
    expect(transport.mock.calls.length).toBe(before);
    // Closed sockets do not reconnect after a drop.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(MockSocket.instances).toHaveLength(2);
  });

  test('a revoked 401 after the retry also drops', async () => {
    let calls = 0;
    const { accounts } = setup({
      route: (req) => {
        if (!req.url.endsWith('/v1/x')) return undefined;
        calls++;
        return calls === 1
          ? { status: 401, body: { error: 'TOKEN_EXPIRED' } }
          : { status: 401, body: { error: 'SESSION_REVOKED' } };
      },
    });
    expectCode(
      await caught(accounts.request(MAIN, { method: 'GET', path: '/v1/x' })),
      'GRANT_REVOKED',
    );
  });

  test('/auth reporting the session revoked drops all accounts', async () => {
    const { accounts, onDropped } = setup({
      route: (req) =>
        req.url.endsWith('/v1/auth') &&
        req.headers['PARADEX-STARKNET-ACCOUNT'] === SUB
          ? { status: 401, body: { error: 'SUBKEY_REVOKED' } }
          : undefined,
    });
    expectCode(await caught(accounts.start()), 'GRANT_REVOKED');
    expect(onDropped).toHaveBeenCalledTimes(1);
    expectCode(await caught(accounts.getJwt(MAIN)), 'GRANT_REVOKED');
  });

  test('a mint that finishes after a drop is discarded', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { accounts } = setup({
      route: async (req) => {
        if (req.url.endsWith('/v1/auth')) await gate;
        return undefined;
      },
    });
    const pending = accounts.getJwt(MAIN);
    accounts.drop(new SessionGrantError('GRANT_REVOKED', 'revoked'));
    release();
    expectCode(await caught(pending), 'GRANT_REVOKED');
  });

  test('grant expiry drops every account on a timer', async () => {
    const { accounts, onDropped } = setup({
      grant: grantFor({ expiresAt: T0 + 600 }),
    });
    await accounts.start();
    await accounts.subscribe(MAIN, 'account', jest.fn());
    await jest.advanceTimersByTimeAsync(600_000);
    expect(onDropped).toHaveBeenCalledTimes(1);
    expectCode(onDropped.mock.calls[0]?.[0], 'GRANT_EXPIRED');
    expect(MockSocket.instances[0]?.readyState).toBe(3);
    expectCode(await caught(accounts.getJwt(SUB)), 'GRANT_EXPIRED');
  });

  test('expiry is caught on use even before the timer fires', async () => {
    const { accounts, onDropped } = setup({
      grant: grantFor({ expiresAt: T0 + 600 }),
    });
    jest.setSystemTime((T0 + 600) * 1000);
    expectCode(await caught(accounts.getJwt(MAIN)), 'GRANT_EXPIRED');
    expect(onDropped).toHaveBeenCalledTimes(1);
  });

  test('long grants re-arm the expiry timer past the 24.8-day timer limit', async () => {
    const { accounts, onDropped } = setup({
      grant: grantFor({ expiresAt: T0 + 30 * 86400 }),
    });
    await jest.advanceTimersByTimeAsync(2 ** 31 - 1);
    expect(onDropped).not.toHaveBeenCalled();
    // Whole-second clock: the re-armed timer lands within a second of expiry.
    await jest.advanceTimersByTimeAsync(30 * 86400 * 1000 - (2 ** 31 - 1));
    await jest.advanceTimersByTimeAsync(1000);
    expect(onDropped).toHaveBeenCalledTimes(1);
    expect(accounts.dropReason?.code).toBe('GRANT_EXPIRED');
  });

  test('close stops sockets and timers without dropping', async () => {
    const { accounts, onDropped } = setup();
    await accounts.subscribe(MAIN, 'account', jest.fn());
    accounts.close();
    expect(MockSocket.instances[0]?.readyState).toBe(3);
    await expect(accounts.getJwt(MAIN)).rejects.toThrow(/closed/);
    await jest.advanceTimersByTimeAsync(31 * 86400 * 1000);
    expect(onDropped).not.toHaveBeenCalled();
  });
});

describe('websockets', () => {
  test('one socket per account, each authenticated with its own JWT', async () => {
    const { accounts } = setup();
    const mainHandler = jest.fn();
    const subHandler = jest.fn();
    await accounts.subscribe(MAIN, 'fills.ALL', mainHandler);
    await accounts.subscribe(SUB, 'fills.ALL', subHandler);
    const [mainWs, subWs] = MockSocket.instances;
    expect(MockSocket.instances).toHaveLength(2);
    expect(mainWs?.url).toBe('wss://ws.api.testnet.paradex.trade/v1');
    expect(mainWs?.methods()).toEqual(['auth', 'subscribe']);
    expect(mainWs?.sent[0]?.params).toEqual({
      bearer: await accounts.getJwt(MAIN),
    });
    expect(subWs?.sent[0]?.params).toEqual({
      bearer: await accounts.getJwt(SUB),
    });
    expect(mainWs?.sent[1]?.params).toEqual({ channel: 'fills.ALL' });

    mainWs?.receive({
      jsonrpc: '2.0',
      method: 'subscription',
      params: { channel: 'fills.ALL', data: { id: 'm' } },
    });
    subWs?.receive({
      jsonrpc: '2.0',
      method: 'subscription',
      params: { channel: 'fills.ALL', data: { id: 's' } },
    });
    expect(mainHandler).toHaveBeenCalledWith({ id: 'm' });
    expect(mainHandler).toHaveBeenCalledTimes(1);
    expect(subHandler).toHaveBeenCalledWith({ id: 's' });
    expect(subHandler).toHaveBeenCalledTimes(1);
  });

  test('shares a channel subscription and unsubscribes after the last handler', async () => {
    const { accounts } = setup();
    const a = jest.fn();
    const b = jest.fn();
    const offA = await accounts.subscribe(MAIN, 'orders.ALL', a);
    const offB = await accounts.subscribe(MAIN, 'orders.ALL', b);
    const ws = MockSocket.instances[0];
    expect(ws?.methods()).toEqual(['auth', 'subscribe']);
    offA();
    offA();
    expect(ws?.methods()).toEqual(['auth', 'subscribe']);
    ws?.receive({
      method: 'subscription',
      params: { channel: 'orders.ALL', data: 1 },
    });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(1);
    offB();
    expect(ws?.methods()).toEqual(['auth', 'subscribe', 'unsubscribe']);
    // Garbage and unknown frames are ignored.
    ws?.receive('not json');
    ws?.receive({ method: 'subscription', params: { channel: 'other' } });
  });

  test('re-authenticates the socket before the JWT expires', async () => {
    const { accounts, authCalls } = setup({ jwtTtl: 300 });
    await accounts.subscribe(MAIN, 'account', jest.fn());
    const ws = MockSocket.instances[0];
    const firstToken = ws?.sent[0]?.params.bearer;
    await jest.advanceTimersByTimeAsync(240_000);
    await waitFor(() => ws?.sent.length === 3);
    expect(authCalls(MAIN)).toHaveLength(2);
    expect(ws?.methods()).toEqual(['auth', 'subscribe', 'auth']);
    expect(ws?.sent[2]?.params.bearer).not.toBe(firstToken);
    expect(MockSocket.instances).toHaveLength(1);
  });

  test('a websocket auth error naming revocation drops all accounts', async () => {
    const { accounts, onDropped } = setup();
    const factory = (url: string): MockSocket => {
      const ws = new MockSocket(url);
      ws.respond = (msg) =>
        msg.method === 'auth'
          ? {
              jsonrpc: '2.0',
              id: msg.id,
              error: { code: 40110, message: 'SUBKEY_REVOKED' },
            }
          : { jsonrpc: '2.0', id: msg.id, result: {} };
      return ws;
    };
    (accounts as unknown as { webSocketFactory: unknown }).webSocketFactory =
      factory;
    await expect(
      accounts.subscribe(SUB, 'account', jest.fn()),
    ).rejects.toMatchObject({ message: 'SUBKEY_REVOKED' });
    expect(onDropped).toHaveBeenCalledTimes(1);
    expectCode(onDropped.mock.calls[0]?.[0], 'GRANT_REVOKED');
  });

  test('an unsolicited revocation frame drops all accounts', async () => {
    const { accounts, onDropped } = setup();
    await accounts.subscribe(MAIN, 'account', jest.fn());
    MockSocket.instances[0]?.receive({
      jsonrpc: '2.0',
      error: {
        code: 40110,
        message: 'session revoked',
        data: 'SESSION_REVOKED',
      },
    });
    expect(onDropped).toHaveBeenCalledTimes(1);
    expect(MockSocket.instances[0]?.readyState).toBe(3);
  });

  test('reconnects with backoff, re-authenticates and resubscribes', async () => {
    const { accounts } = setup();
    const handler = jest.fn();
    await accounts.subscribe(MAIN, 'orders.ALL', handler);
    await accounts.subscribe(MAIN, 'fills.ALL', handler);
    MockSocket.instances[0]?.drop();
    expect(MockSocket.instances).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(MockSocket.instances).toHaveLength(2);
    const ws = MockSocket.instances[1];
    expect(ws?.methods()).toEqual(['auth', 'subscribe', 'subscribe']);
    expect(ws?.sent.slice(1).map((m) => m.params.channel)).toEqual([
      'orders.ALL',
      'fills.ALL',
    ]);
    ws?.receive({
      method: 'subscription',
      params: { channel: 'fills.ALL', data: 2 },
    });
    expect(handler).toHaveBeenCalledWith(2);
  });

  test('backs off when reconnects keep failing', async () => {
    const { accounts } = setup();
    await accounts.subscribe(MAIN, 'orders.ALL', jest.fn());
    let failing = true;
    (accounts as unknown as { webSocketFactory: unknown }).webSocketFactory = (
      url: string,
    ) => {
      const ws = new MockSocket(url);
      if (failing) {
        ws.readyState = 2;
        queueMicrotask(() => {
          ws.close();
        });
      }
      return ws;
    };
    MockSocket.instances[0]?.drop();
    await jest.advanceTimersByTimeAsync(1000);
    expect(MockSocket.instances).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1999);
    expect(MockSocket.instances).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(MockSocket.instances).toHaveLength(3);
    failing = false;
    await jest.advanceTimersByTimeAsync(4000);
    expect(MockSocket.instances).toHaveLength(4);
    expect(MockSocket.instances[3]?.methods()).toEqual(['auth', 'subscribe']);
  });

  test('a plain auth failure reconnects without dropping', async () => {
    const { accounts, onDropped } = setup();
    let reject = true;
    (accounts as unknown as { webSocketFactory: unknown }).webSocketFactory = (
      url: string,
    ) => {
      const ws = new MockSocket(url);
      ws.respond = (msg) =>
        reject && msg.method === 'auth'
          ? { id: msg.id, error: { code: 1, message: 'busy' } }
          : { id: msg.id, result: {} };
      return ws;
    };
    await expect(
      accounts.subscribe(MAIN, 'account', jest.fn()),
    ).rejects.toMatchObject({ message: 'busy' });
    expect(onDropped).not.toHaveBeenCalled();
    reject = false;
    await accounts.subscribe(MAIN, 'account', jest.fn());
    expect(MockSocket.instances.at(-1)?.methods()).toEqual([
      'auth',
      'subscribe',
    ]);
  });

  test('a socket that errors before opening rejects the subscribe', async () => {
    const { accounts } = setup();
    (accounts as unknown as { webSocketFactory: unknown }).webSocketFactory = (
      url: string,
    ) => {
      const ws = new MockSocket(url);
      ws.readyState = 2;
      queueMicrotask(() => {
        ws.onerror?.({});
      });
      return ws;
    };
    await expect(
      accounts.subscribe(MAIN, 'account', jest.fn()),
    ).rejects.toThrow('websocket error');
  });

  test('a failed re-auth reconnects', async () => {
    const { accounts } = setup({ jwtTtl: 300 });
    await accounts.subscribe(MAIN, 'account', jest.fn());
    const ws = MockSocket.instances[0];
    if (ws == null) throw new Error('no socket');
    ws.respond = (msg) =>
      msg.method === 'auth'
        ? { id: msg.id, error: { code: 1, message: 'nope' } }
        : { id: msg.id, result: {} };
    await jest.advanceTimersByTimeAsync(240_000);
    await waitFor(() => ws.readyState === 3);
    await jest.advanceTimersByTimeAsync(1000);
    await waitFor(() => MockSocket.instances.length === 2);
  });
});
