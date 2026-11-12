import * as Starknet from 'starknet';

import {
  buildAuthTypedData,
  buildOrderTypedData,
  jwtExpiry,
  sessionAuthPath,
  toChainQuantums,
  type SessionOrder,
} from '../src/session-auth';
import {
  defaultApiUrl,
  defaultWebSocketFactory,
  defaultWsUrl,
  fetchTransport,
  SessionApiError,
} from '../src/session-transport';

import { jwtFor } from './mocks/session';

describe('sessionAuthPath', () => {
  test('names the session key, so the server checks it and not the main key', () => {
    expect(sessionAuthPath('0xabc')).toBe('/v1/auth/0xabc');
  });

  test.each(['abc', '0x', '0x' + 'f'.repeat(65), '0xabc/../x'])(
    'refuses %p',
    (key) => {
      expect(() => sessionAuthPath(key)).toThrow(/0x-prefixed hex/);
    },
  );
});

describe('session auth typed data', () => {
  test('auth request matches the server Request type', () => {
    const td = buildAuthTypedData('PRIVATE_SN_POTC_SEPOLIA', 100, 1000);
    expect(td.domain).toEqual({
      name: 'Paradex',
      chainId: Starknet.shortString.encodeShortString(
        'PRIVATE_SN_POTC_SEPOLIA',
      ),
      version: '1',
    });
    expect(td.message).toEqual({
      method: 'POST',
      path: '/v1/auth',
      body: '',
      timestamp: 100,
      expiration: 1000,
    });
  });

  // Hashes computed independently with the Python SDK (paradex-py).
  test('auth and order hashes match the Python SDK', () => {
    const chain = 'PRIVATE_SN_POTC_SEPOLIA';
    expect(
      Starknet.typedData.getMessageHash(
        buildAuthTypedData(chain, 1760000000, 1760000900),
        '0x11',
      ),
    ).toBe('0x54e825ca674d5335727cbb427251e352021fb162254d92609d482e164b378dc');
    expect(
      Starknet.typedData.getMessageHash(
        buildOrderTypedData(
          chain,
          {
            market: 'BTC-USD-PERP',
            side: 'BUY',
            type: 'LIMIT',
            size: '0.5',
            price: '65000.25',
          },
          1760000000123,
        ),
        '0x11',
      ),
    ).toBe('0x446ce16baec2dc1ec9836042812b46c7e7445a397ec50631e1b614272232118');
  });

  test('orders encode quantums, side and type like the server', () => {
    const td = buildOrderTypedData(
      'PRIVATE_SN_POTC_SEPOLIA',
      {
        market: 'BTC-USD-PERP',
        side: 'SELL',
        type: 'LIMIT',
        size: '0.00000001',
        price: '65000.5',
      },
      1760000000123,
    );
    expect(td.message).toEqual({
      timestamp: '1760000000123',
      market: Starknet.shortString.encodeShortString('BTC-USD-PERP'),
      side: '2',
      orderType: Starknet.shortString.encodeShortString('LIMIT'),
      size: '1',
      price: '6500050000000',
    });
  });

  test('limit orders need a price', () => {
    expect(() =>
      buildOrderTypedData(
        'X',
        { market: 'BTC-USD-PERP', side: 'BUY', type: 'LIMIT', size: '1' },
        1,
      ),
    ).toThrow(/need a price/);
  });

  test.each(['-1', '1e3', 'abc', '', '1.000000001'])(
    'toChainQuantums refuses %p',
    (value) => {
      expect(() => toChainQuantums(value, 'size')).toThrow(/size/);
    },
  );

  test('toChainQuantums scales by 1e8', () => {
    expect(toChainQuantums('0', 'size')).toBe('0');
    expect(toChainQuantums('12.5', 'size')).toBe('1250000000');
  });

  test('jwtExpiry reads exp without verifying', () => {
    expect(jwtExpiry(jwtFor('0x1', 1234))).toBe(1234);
    expect(jwtExpiry('nodots')).toBeUndefined();
    expect(jwtExpiry('a.%%%.c')).toBeUndefined();
    expect(jwtExpiry(`a.${btoa('{"exp":"soon"}')}.c`)).toBeUndefined();
  });
});

describe('session transport', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('fetchTransport parses JSON and keeps text bodies', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response('{"a":1}', { status: 201 }))
      .mockResolvedValueOnce(new Response('oops', { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock;
    const request = {
      method: 'POST' as const,
      url: 'https://x/y',
      headers: { A: 'b' },
      body: '{}',
    };
    expect(await fetchTransport(request)).toEqual({
      status: 201,
      body: { a: 1 },
    });
    expect(fetchMock).toHaveBeenCalledWith('https://x/y', {
      method: 'POST',
      headers: { A: 'b' },
      body: '{}',
    });
    expect(await fetchTransport(request)).toEqual({
      status: 502,
      body: 'oops',
    });
    expect(await fetchTransport(request)).toEqual({ status: 204, body: '' });
  });

  test('environment URLs', () => {
    expect(defaultApiUrl('mainnet')).toBe('https://api.prod.paradex.trade');
    expect(defaultApiUrl('testnet')).toBe('https://api.testnet.paradex.trade');
    expect(defaultWsUrl('testnet')).toBe(
      'wss://ws.api.testnet.paradex.trade/v1',
    );
  });

  test('default websocket factory', () => {
    const original = globalThis.WebSocket;
    const ctor = jest.fn();
    globalThis.WebSocket = ctor as unknown as typeof WebSocket;
    try {
      defaultWebSocketFactory('wss://x');
      expect(ctor).toHaveBeenCalledWith('wss://x');
      globalThis.WebSocket = undefined as unknown as typeof WebSocket;
      expect(() => defaultWebSocketFactory('wss://x')).toThrow(
        /WebSocket is not available/,
      );
    } finally {
      globalThis.WebSocket = original;
    }
  });

  test('SessionApiError reads the error code', () => {
    const refused = new SessionApiError(401, { error: 'INVALID_SIGNATURE' });
    expect(refused.code).toBe('INVALID_SIGNATURE');
    expect(refused.message).toBe('INVALID_SIGNATURE: HTTP 401');
    const other = new SessionApiError(500, null);
    expect(other.code).toBeUndefined();
    expect(other.message).toBe('HTTP 500');
  });

  test('environment names cannot redirect the API host', () => {
    expect(() => defaultApiUrl('evil.example/x' as 'testnet')).toThrow(
      /Invalid environment/,
    );
  });
});

describe('BuilderOrder', () => {
  // The server's reference vector: this order, signed for this account on
  // PRIVATE_SN_POTC_GOERLI, has this hash.
  const chain = 'PRIVATE_SN_POTC_GOERLI';
  const account =
    '0x4a09444a934577ebf338aa6473c7b0df084158ed03408c07057cc2ecbbb5938';
  const referenceHash =
    '0x4c5d000ffcedffd12468ad34f2c296e4daf028db5c4c7001ab93ee392664807';
  const order: SessionOrder = {
    market: 'BTC-USD-PERP',
    side: 'SELL',
    type: 'LIMIT',
    size: '0.4543',
    price: '28981',
    builder: '0x5b0b',
    builderFeeRate: '0.0005',
  };
  const timestamp = 1684815490129;
  const hash = (o: SessionOrder): string =>
    Starknet.typedData.getMessageHash(
      buildOrderTypedData(chain, o, timestamp),
      account,
    );

  test('matches the pinned reference hash', () => {
    expect(hash(order)).toBe(referenceHash);
  });

  test('matches a field-by-field SNIP-12 rev0 hash', () => {
    const { computePedersenHashOnElements: pedersen } = Starknet.hash;
    const short = (s: string): string =>
      Starknet.shortString.encodeShortString(s);
    const typeHash = Starknet.hash.getSelectorFromName(
      'BuilderOrder(timestamp:felt,market:felt,side:felt,orderType:felt,size:felt,price:felt,builder:felt,builderFeeRate:felt)',
    );
    const structHash = pedersen([
      typeHash,
      timestamp,
      short('BTC-USD-PERP'),
      2, // SELL
      short('LIMIT'),
      45430000, // 0.4543 at 8 decimals
      2898100000000, // 28981 at 8 decimals
      '0x5b0b',
      50000, // 0.0005 at 8 decimals
    ]);
    const domainHash = pedersen([
      Starknet.hash.getSelectorFromName(
        'StarkNetDomain(name:felt,chainId:felt,version:felt)',
      ),
      short('Paradex'),
      short(chain),
      1,
    ]);
    const expected = pedersen([
      short('StarkNet Message'),
      domainHash,
      account,
      structHash,
    ]);
    expect(BigInt(hash(order))).toBe(BigInt(expected));
  });

  test('signs the builder and the rate, not their spelling', () => {
    const base = hash(order);
    expect(
      hash({ ...order, builder: '0x0000005B0B', builderFeeRate: '0.00050' }),
    ).toBe(base);
    expect(hash({ ...order, builder: '0x5b0c' })).not.toBe(base);
    expect(hash({ ...order, builderFeeRate: '0.0006' })).not.toBe(base);
  });

  test('appends builder and builderFeeRate to the Order fields', () => {
    const td = buildOrderTypedData(chain, order, timestamp);
    expect(td.primaryType).toBe('BuilderOrder');
    expect(td.types.BuilderOrder?.map((t) => t.name)).toEqual([
      'timestamp',
      'market',
      'side',
      'orderType',
      'size',
      'price',
      'builder',
      'builderFeeRate',
    ]);
    expect(td.message).toMatchObject({
      builder: '0x5b0b',
      builderFeeRate: '50000',
    });
  });

  test('an order without a builder keeps the Order hash', () => {
    const { builder: _b, builderFeeRate: _r, ...plain } = order;
    const td = buildOrderTypedData(chain, plain, timestamp);
    expect(td.primaryType).toBe('Order');
    expect(td.message).not.toHaveProperty('builder');
    expect(hash(plain)).not.toBe(referenceHash);
  });

  test.each<[Partial<SessionOrder>, RegExp]>([
    [{ builderFeeRate: undefined }, /together/],
    [{ builder: undefined }, /together/],
    [{ builder: '0x0' }, /non-zero/],
    [{ builder: '5b0b' }, /non-zero/],
    [{ builderFeeRate: '0' }, /above 0/],
    [{ builderFeeRate: '-0.0005' }, /builderFeeRate/],
    [{ builderFeeRate: '0.000000001' }, /8 decimal places/],
  ])('refuses %p', (override, error) => {
    expect(() =>
      buildOrderTypedData(chain, { ...order, ...override }, timestamp),
    ).toThrow(error);
  });
});
