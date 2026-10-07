import * as Starknet from 'starknet';

import {
  NOT_AVAILABLE_TO_SESSIONS,
  SessionAccounts,
  type GrantState,
} from '../src/session-accounts';
import { buildOrderTypedData } from '../src/session-auth';
import { SessionKey } from '../src/session-key';
import {
  SessionApiError,
  type HttpRequest,
  type HttpResponse,
} from '../src/session-transport';
import {
  createSessionGrant,
  SessionGrantError,
  type SessionGrant,
} from '../src/session-typed-data';

import {
  authResponder,
  LIMITS,
  MAIN,
  MockSocket,
  mockTransport,
  PARADEX_CHAIN,
  SUB,
  verifyStark,
} from './mocks/session';

const T0 = 1760000000;
const GRANT_ID = '0xgrant';
const DETAILS_URL = `https://api.testnet.paradex.trade/v2/sessions/${GRANT_ID}`;
const STATUS_URL = `${DETAILS_URL}/status`;
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

let socketFactory: (url: string) => MockSocket;
beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'],
  });
  jest.setSystemTime(T0 * 1000);
  MockSocket.reset();
  socketFactory = (url) => new MockSocket(url);
});

afterEach(() => {
  jest.useRealTimers();
});

function grantFor(overrides: Partial<SessionGrant> = {}): SessionGrant {
  return {
    ...createSessionGrant({
      limits: LIMITS,
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
  readonly calls: (suffix: string) => HttpRequest[];
  /** What GET /v2/sessions/{grant_id}/status reports; 'gone' answers 404. */
  readonly server: { state: GrantState | 'gone' };
}

function setup(
  options: {
    readonly grant?: SessionGrant;
    readonly route?: Route;
    readonly jwtTtl?: number;
    readonly rpcTimeoutMs?: number;
  } = {},
): Harness {
  const auth = authResponder(key, options.jwtTtl);
  const server: { state: GrantState | 'gone' } = { state: 'active' };
  const transport = mockTransport(async (req) => {
    const routed = await options.route?.(req);
    if (routed != null) return routed;
    if (req.url.endsWith('/v1/auth')) {
      return server.state === 'active'
        ? auth(req)
        : { status: 401, body: { error: 'INVALID_SIGNATURE' } };
    }
    if (req.url === STATUS_URL && req.method === 'GET') {
      return server.state === 'gone'
        ? { status: 404, body: { error: 'NOT_FOUND' } }
        : { status: 200, body: { state: server.state } };
    }
    if (req.url === DETAILS_URL && req.method === 'GET') {
      return { status: 200, body: { grant_id: GRANT_ID, state: server.state } };
    }
    return { status: 200, body: { ok: true } };
  });
  const onDropped = jest.fn();
  const accounts = new SessionAccounts({
    session: { grant: options.grant ?? grantFor(), key, grantId: GRANT_ID },
    environment: 'testnet',
    paradexChain: PARADEX_CHAIN,
    transport,
    webSocketFactory: (url) => socketFactory(url),
    rpcTimeoutMs: options.rpcTimeoutMs,
    now: nowSeconds,
    onDropped,
  });
  const requests = (): HttpRequest[] =>
    transport.mock.calls.map(([req]) => req);
  const authCalls = (account?: string): HttpRequest[] =>
    requests().filter(
      (req) =>
        req.url.endsWith('/v1/auth') &&
        (account == null ||
          req.headers['PARADEX-STARKNET-ACCOUNT'] === account),
    );
  const calls = (suffix: string): HttpRequest[] =>
    requests().filter((req) => req.url.endsWith(suffix));
  return { accounts, transport, onDropped, authCalls, calls, server };
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
      grantFor({ environment: 'mainnet' }),
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
      // Exactly these headers and no query parameters.
      expect(Object.keys(req?.headers ?? {}).sort()).toEqual([
        'PARADEX-SIGNATURE-EXPIRATION',
        'PARADEX-STARKNET-ACCOUNT',
        'PARADEX-STARKNET-SIGNATURE',
        'PARADEX-TIMESTAMP',
      ]);
      expect(req?.body).toBeUndefined();
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
          ? { status: 500, body: { error: 'SERVER_ERROR' } }
          : undefined,
    });
    await expect(failing.accounts.getJwt(MAIN)).rejects.toThrow('SERVER_ERROR');
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
    [
      'percent-encoded query',
      { method: 'GET', path: `/v1/orders?ON%5Fbehalf%5Fof_account=${SUB}` },
    ],
    ['malformed escape', { method: 'GET', path: '/v1/orders?x=%E0%A4%A' }],
    [
      'upper-case key',
      { method: 'POST', path: '/v1/orders', body: { ON_BEHALF_OF_ACCOUNT: 1 } },
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

describe('revocation', () => {
  test.each(['/v1/rfqs', '/v1/rfq/123/execute', '/v1/rfqs?status=open'])(
    'a 403 from RFQ (%s) says sessions cannot use it yet, without a drop',
    async (path) => {
      const h = setup({
        route: (req) =>
          req.url.includes('/v1/rfq')
            ? { status: 403, body: { error: 'FORBIDDEN' } }
            : undefined,
      });
      const error = await caught(
        h.accounts.request(MAIN, { method: 'GET', path }),
      );
      expect(error).toBeInstanceOf(SessionApiError);
      expect(error).toMatchObject({
        status: 403,
        code: NOT_AVAILABLE_TO_SESSIONS,
        message:
          'NOT_AVAILABLE_TO_SESSIONS: RFQ is not available to sessions yet',
      });
      expect(h.calls('/status')).toHaveLength(0);
      expect(h.authCalls(MAIN)).toHaveLength(1);
      expect(h.onDropped).not.toHaveBeenCalled();
    },
  );

  test('a 403 elsewhere is passed through and does not trigger a status check', async () => {
    const h = setup({
      route: (req) =>
        req.url.endsWith('/v1/account/margin')
          ? { status: 403, body: { error: 'SCOPE_REQUIRED' } }
          : undefined,
    });
    const error = await caught(
      h.accounts.request(MAIN, {
        method: 'POST',
        path: '/v1/account/margin',
        body: {},
      }),
    );
    expect(error).toMatchObject({ status: 403, code: 'SCOPE_REQUIRED' });
    expect(h.calls('/status')).toHaveLength(0);
    expect(h.onDropped).not.toHaveBeenCalled();
  });

  test('a refused token is checked against the grant status; revoked drops every account', async () => {
    const h = setup({
      route: (req) =>
        req.url.endsWith('/v1/orders')
          ? { status: 401, body: { error: 'UNAUTHORIZED' } }
          : undefined,
    });
    await h.accounts.start();
    await h.accounts.subscribe(MAIN, 'orders.ALL', jest.fn());
    await h.accounts.subscribe(SUB, 'orders.ALL', jest.fn());
    h.server.state = 'revoked';
    const error = await caught(
      h.accounts.request(SUB, { method: 'POST', path: '/v1/orders', body: {} }),
    );
    expectCode(error, 'GRANT_REVOKED');
    // The status check carries no token.
    expect(h.calls('/status')[0]?.headers).toEqual({});
    expect(h.onDropped).toHaveBeenCalledTimes(1);
    expect(h.accounts.dropReason).toBe(error);
    expect(MockSocket.instances.every((ws) => ws.readyState === 3)).toBe(true);

    const before = h.transport.mock.calls.length;
    for (const account of [MAIN, SUB]) {
      expectCode(await caught(h.accounts.getJwt(account)), 'GRANT_REVOKED');
      expectCode(
        await caught(h.accounts.subscribe(account, 'x', jest.fn())),
        'GRANT_REVOKED',
      );
    }
    expect(h.transport.mock.calls.length).toBe(before);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(MockSocket.instances).toHaveLength(2);
  });

  test('an expired status drops with GRANT_EXPIRED', async () => {
    const h = setup({
      route: (req) =>
        req.url.endsWith('/v1/x') ? { status: 401, body: {} } : undefined,
    });
    await h.accounts.start();
    h.server.state = 'expired';
    expectCode(
      await caught(h.accounts.request(MAIN, { method: 'GET', path: '/v1/x' })),
      'GRANT_EXPIRED',
    );
    expect(h.onDropped).toHaveBeenCalledTimes(1);
  });

  test('an active status keeps the session: retry with a fresh JWT', async () => {
    let first = true;
    const h = setup({
      route: (req) => {
        if (req.url.endsWith('/v1/positions') && first) {
          first = false;
          return { status: 401, body: { error: 'TOKEN_EXPIRED' } };
        }
        return undefined;
      },
    });
    expect(
      await h.accounts.request(MAIN, { method: 'GET', path: '/v1/positions' }),
    ).toEqual({ ok: true });
    expect(h.authCalls(MAIN)).toHaveLength(2);
    expect(h.calls('/status')).toHaveLength(1);
    expect(h.onDropped).not.toHaveBeenCalled();
  });

  test('a refused /auth on one account drops every account when the grant is revoked', async () => {
    const h = setup();
    await h.accounts.getJwt(MAIN);
    h.server.state = 'revoked';
    expectCode(await caught(h.accounts.getJwt(SUB)), 'GRANT_REVOKED');
    expect(h.onDropped).toHaveBeenCalledTimes(1);
  });

  test('a refused /auth with no token yet still finds a revoked grant', async () => {
    const h = setup();
    h.server.state = 'revoked';
    expectCode(await caught(h.accounts.getJwt(MAIN)), 'GRANT_REVOKED');
    expect(h.onDropped).toHaveBeenCalledTimes(1);
  });

  test('an unknown grant (404) counts as revoked', async () => {
    const h = setup();
    h.server.state = 'gone';
    expectCode(await caught(h.accounts.getJwt(MAIN)), 'GRANT_REVOKED');
  });

  test('a refused /auth on an active grant is an error, not a drop', async () => {
    const h = setup({
      route: (req) =>
        req.url.endsWith('/v1/auth')
          ? { status: 401, body: { error: 'INVALID_SIGNATURE' } }
          : undefined,
    });
    expect(await caught(h.accounts.getJwt(MAIN))).toMatchObject({
      status: 401,
    });
    expect(h.calls('/status')).toHaveLength(1);
    expect(h.onDropped).not.toHaveBeenCalled();
  });

  test('status check failures are transient', async () => {
    for (const status of [
      { status: 500, body: {} },
      { status: 200, body: { state: 'unknown' } },
    ]) {
      const h = setup({
        route: (req) => {
          if (req.url === STATUS_URL) return status;
          if (req.url.endsWith('/v1/x')) return { status: 401, body: {} };
          return undefined;
        },
      });
      const error = await caught(
        h.accounts.request(MAIN, { method: 'GET', path: '/v1/x' }),
      );
      expect(error).toMatchObject({ status: 401 });
      expect(h.onDropped).not.toHaveBeenCalled();
    }
    const throwing = setup({
      route: (req) => {
        if (req.url === STATUS_URL) throw new Error('offline');
        if (req.url.endsWith('/v1/x')) return { status: 401, body: {} };
        return undefined;
      },
    });
    await expect(
      throwing.accounts.request(MAIN, { method: 'GET', path: '/v1/x' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(throwing.onDropped).not.toHaveBeenCalled();
    // Three setups with real signing; slow on a loaded machine.
  }, 20_000);

  test('concurrent refusals share one status check', async () => {
    const h = setup({
      route: (req) =>
        req.url.endsWith('/v1/x') ? { status: 401, body: {} } : undefined,
    });
    await h.accounts.start();
    h.server.state = 'revoked';
    const results = await Promise.all([
      caught(h.accounts.request(MAIN, { method: 'GET', path: '/v1/x' })),
      caught(h.accounts.request(SUB, { method: 'GET', path: '/v1/x' })),
    ]);
    for (const e of results) expectCode(e, 'GRANT_REVOKED');
    expect(h.calls('/status')).toHaveLength(1);
  });

  test('status() reads and revoke() deletes the grant, then drops', async () => {
    const h = setup();
    expect(await h.accounts.status()).toMatchObject({ state: 'active' });
    await h.accounts.revoke();
    const del = h.transport.mock.calls
      .map(([req]) => req)
      .find((req) => req.method === 'DELETE');
    expect(del?.url).toBe(DETAILS_URL);
    expect(del?.headers.Authorization).toMatch(/^Bearer /);
    expectCode(h.accounts.dropReason, 'GRANT_REVOKED');
    expect(h.onDropped).toHaveBeenCalledTimes(1);
  });

  test('a websocket auth refusal checks status and drops when revoked', async () => {
    const h = setup();
    await h.accounts.getJwt(SUB);
    h.server.state = 'revoked';
    socketFactory = (url) => {
      const ws = new MockSocket(url);
      ws.respond = (msg) =>
        msg.method === 'auth'
          ? { id: msg.id, error: { code: 40110, message: 'refused' } }
          : { id: msg.id, result: {} };
      return ws;
    };
    await expect(
      h.accounts.subscribe(SUB, 'account', jest.fn()),
    ).rejects.toMatchObject({ message: 'refused' });
    await waitFor(() => h.onDropped.mock.calls.length === 1);
    expectCode(h.onDropped.mock.calls[0]?.[0], 'GRANT_REVOKED');
  });

  test('an unsolicited error frame checks status', async () => {
    const h = setup();
    await h.accounts.subscribe(MAIN, 'account', jest.fn());
    h.server.state = 'revoked';
    MockSocket.instances[0]?.receive({ error: { code: 1, message: 'x' } });
    await waitFor(() => h.onDropped.mock.calls.length === 1);
    expect(MockSocket.instances[0]?.readyState).toBe(3);
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
});

describe('expiry', () => {
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

  test('a skewed local clock does not drop the session', async () => {
    const { accounts, onDropped } = setup();
    jest.setSystemTime((T0 - 3600) * 1000);
    await accounts.getJwt(MAIN);
    expect(onDropped).not.toHaveBeenCalled();
  });

  test('no /auth storm in the last minute of a grant', async () => {
    const h = setup({ grant: grantFor({ expiresAt: T0 + 30 }), jwtTtl: 300 });
    await h.accounts.subscribe(MAIN, 'account', jest.fn());
    for (let i = 0; i < 5; i++) await h.accounts.getJwt(MAIN);
    await jest.advanceTimersByTimeAsync(20_000);
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.authCalls(MAIN)).toHaveLength(1);
    expect(MockSocket.instances[0]?.methods()).toEqual(['auth', 'subscribe']);
  });

  test('a short JWT is refreshed at half its life, not continuously', async () => {
    const h = setup({ jwtTtl: 40 });
    await h.accounts.getJwt(MAIN);
    jest.setSystemTime((T0 + 10) * 1000);
    await h.accounts.getJwt(MAIN);
    expect(h.authCalls(MAIN)).toHaveLength(1);
    jest.setSystemTime((T0 + 20) * 1000);
    await h.accounts.getJwt(MAIN);
    expect(h.authCalls(MAIN)).toHaveLength(2);
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
      method: 'subscription',
      params: { channel: 'fills.ALL', data: { id: 'm' } },
    });
    subWs?.receive({
      method: 'subscription',
      params: { channel: 'fills.ALL', data: { id: 's' } },
    });
    expect(mainHandler).toHaveBeenCalledWith({ id: 'm' });
    expect(mainHandler).toHaveBeenCalledTimes(1);
    expect(subHandler).toHaveBeenCalledWith({ id: 's' });
    expect(subHandler).toHaveBeenCalledTimes(1);
  });

  test('shares a channel, unsubscribes after its last handler, closes when idle', async () => {
    const h = setup({ jwtTtl: 300 });
    const a = jest.fn();
    const b = jest.fn();
    const offA = await h.accounts.subscribe(MAIN, 'orders.ALL', a);
    const offB = await h.accounts.subscribe(MAIN, 'orders.ALL', b);
    const offC = await h.accounts.subscribe(MAIN, 'fills.ALL', jest.fn());
    const ws = MockSocket.instances[0];
    expect(ws?.methods()).toEqual(['auth', 'subscribe', 'subscribe']);
    offA();
    offA();
    ws?.receive({
      method: 'subscription',
      params: { channel: 'orders.ALL', data: 1 },
    });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(1);
    offB();
    expect(ws?.methods()).toEqual([
      'auth',
      'subscribe',
      'subscribe',
      'unsubscribe',
    ]);
    offC();
    expect(ws?.readyState).toBe(3);
    // No refresh timer is left behind for an idle account.
    await jest.advanceTimersByTimeAsync(600_000);
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.authCalls(MAIN)).toHaveLength(1);
    // Garbage frames are ignored.
    ws?.receive('not json');
  });

  test('concurrent subscribes share one subscribe RPC and its failure', async () => {
    const { accounts } = setup();
    await accounts.subscribe(MAIN, 'account', jest.fn());
    const ws = MockSocket.instances[0];
    if (ws == null) throw new Error('no socket');
    ws.respond = (msg) =>
      msg.method === 'subscribe'
        ? { id: msg.id, error: { code: 1, message: 'no such channel' } }
        : { id: msg.id, result: {} };
    const results = await Promise.all([
      caught(accounts.subscribe(MAIN, 'bogus', jest.fn())),
      caught(accounts.subscribe(MAIN, 'bogus', jest.fn())),
    ]);
    expect(results).toEqual([
      { code: 1, message: 'no such channel' },
      { code: 1, message: 'no such channel' },
    ]);
    expect(ws.methods().filter((m) => m === 'subscribe')).toHaveLength(2);
    // A later attempt subscribes afresh.
    ws.respond = (msg) => ({ id: msg.id, result: {} });
    await accounts.subscribe(MAIN, 'bogus', jest.fn());
    expect(ws.methods().filter((m) => m === 'subscribe')).toHaveLength(3);
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

  test('a failed refresh restarts the socket instead of going quiet', async () => {
    let failAuth = false;
    const h = setup({
      jwtTtl: 300,
      route: (req) =>
        failAuth && req.url.endsWith('/v1/auth')
          ? { status: 503, body: {} }
          : undefined,
    });
    await h.accounts.subscribe(MAIN, 'account', jest.fn());
    const ws = MockSocket.instances[0];
    failAuth = true;
    await jest.advanceTimersByTimeAsync(240_000);
    await waitFor(() => ws?.readyState === 3);
    failAuth = false;
    await jest.advanceTimersByTimeAsync(1000);
    await waitFor(() => MockSocket.instances[1]?.sent.length === 2);
    expect(MockSocket.instances[1]?.methods()).toEqual(['auth', 'subscribe']);
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

  test('reconnects with backoff, re-authenticates and resubscribes once per channel', async () => {
    const { accounts } = setup();
    const handler = jest.fn();
    await accounts.subscribe(MAIN, 'orders.ALL', handler);
    await accounts.subscribe(MAIN, 'fills.ALL', handler);
    MockSocket.instances[0]?.drop();
    // A user subscribe while the reconnect is pending opens the socket early.
    await accounts.subscribe(MAIN, 'orders.ALL', jest.fn());
    await jest.advanceTimersByTimeAsync(5000);
    expect(MockSocket.instances).toHaveLength(2);
    const ws = MockSocket.instances[1];
    expect(ws?.methods().filter((m) => m === 'auth')).toHaveLength(1);
    expect(
      ws?.sent
        .filter((m) => m.method === 'subscribe')
        .map((m) => m.params.channel)
        .sort(),
    ).toEqual(['fills.ALL', 'orders.ALL']);
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
    socketFactory = (url) => {
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

  test('a plain auth failure leaves the session alone', async () => {
    const { accounts, onDropped } = setup();
    let reject = true;
    socketFactory = (url) => {
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
    reject = false;
    await accounts.subscribe(MAIN, 'account', jest.fn());
    expect(MockSocket.instances.at(-1)?.methods()).toEqual([
      'auth',
      'subscribe',
    ]);
    expect(onDropped).not.toHaveBeenCalled();
  });

  test('a socket that errors before opening rejects the subscribe', async () => {
    const { accounts } = setup();
    socketFactory = (url) => {
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

  test('an unanswered RPC times out and restarts the socket', async () => {
    const { accounts } = setup({ rpcTimeoutMs: 5000 });
    await accounts.subscribe(MAIN, 'account', jest.fn());
    const ws = MockSocket.instances[0];
    if (ws == null) throw new Error('no socket');
    ws.respond = () => undefined;
    const pending = caught(accounts.subscribe(MAIN, 'fills.ALL', jest.fn()));
    await jest.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual(new Error('websocket subscribe timed out'));
    expect(ws.readyState).toBe(3);
    await jest.advanceTimersByTimeAsync(1000);
    expect(MockSocket.instances).toHaveLength(2);
  });
});
