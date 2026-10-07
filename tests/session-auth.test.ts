import * as Starknet from 'starknet';

import {
  buildAuthTypedData,
  buildOrderTypedData,
  jwtExpiry,
  toChainQuantums,
} from '../src/session-auth';
import {
  defaultApiUrl,
  defaultWebSocketFactory,
  defaultWsUrl,
  fetchTransport,
  SessionApiError,
} from '../src/session-transport';

import { jwtFor } from './mocks/session';

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
