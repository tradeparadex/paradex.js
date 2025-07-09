import type * as Starknet from 'starknet';

import {
  buildFullnodeAuthTypedData,
  FULLNODE_SIGNATURE_VERSION,
  generateFullnodeRequestHeaders,
} from '../src/fullnode-auth';

describe('buildFullnodeAuthTypedData', () => {
  test('builds correct typed data message structure with correct Poseidon hash', () => {
    const chainId = '0x2a'; // hex(42)
    const account = '0x1';
    const timestamp = 1750962555;
    const version = '1.0.0';
    const jsonPayload =
      '{"jsonrpc": "2.0", "method": "starknet_getTransactionStatus", "params": ["0x1"], "id": 1}';

    const result = buildFullnodeAuthTypedData(
      chainId,
      account,
      jsonPayload,
      timestamp,
      version,
    );

    const expectedPayloadHash =
      '0x' +
      BigInt(
        '2542254075546871898725420793330915700567851405709402681030792058741266708376',
      ).toString(16);

    expect(result).toEqual({
      types: {
        StarkNetDomain: [
          { name: 'name', type: 'felt' },
          { name: 'chainId', type: 'felt' },
          { name: 'version', type: 'felt' },
        ],
        Request: [
          { name: 'account', type: 'felt' },
          { name: 'payload', type: 'felt' },
          { name: 'timestamp', type: 'felt' },
          { name: 'version', type: 'felt' },
        ],
      },
      primaryType: 'Request',
      domain: {
        name: 'Paradex',
        chainId,
        version: '1',
      },
      message: {
        account,
        payload: expectedPayloadHash,
        timestamp: timestamp.toString(),
        version,
      },
    });
  });

  test('generates correct Poseidon hash for specific JSON payload', () => {
    const chainId = '0x2a'; // hex(42)
    const account = '0x1';
    const timestamp = 1750962555;
    const version = '1.0.0';
    const jsonPayload =
      '{"jsonrpc": "2.0", "method": "starknet_getTransactionStatus", "params": ["0x1"], "id": 1}';

    const result = buildFullnodeAuthTypedData(
      chainId,
      account,
      jsonPayload,
      timestamp,
      version,
    );

    expect((result.message as any).payload).toBe(
      '0x' +
        BigInt(
          '2542254075546871898725420793330915700567851405709402681030792058741266708376',
        ).toString(16),
    );
  });
});

describe('generateFullnodeRequestHeaders', () => {
  test('generates correct authentication headers', async () => {
    // Mock account that returns predictable signature
    const mockAccount = {
      address: '0x1',
      signMessage: jest.fn().mockResolvedValue(['0x1234', '0x5678']),
    } as unknown as Starknet.Account;

    const chainId = '0x2a'; // hex(42)
    const jsonPayload =
      '{"jsonrpc": "2.0", "method": "starknet_getTransactionStatus", "params": ["0x1"], "id": 1}';

    const result = await generateFullnodeRequestHeaders(
      mockAccount,
      chainId,
      jsonPayload,
    );

    expect(result).toEqual({
      'Content-Type': 'application/json',
      'PARADEX-STARKNET-ACCOUNT': '0x1',
      'PARADEX-STARKNET-SIGNATURE': '["0x1234","0x5678"]',
      'PARADEX-STARKNET-SIGNATURE-TIMESTAMP': expect.stringMatching(/^\d+$/),
      'PARADEX-STARKNET-SIGNATURE-VERSION': FULLNODE_SIGNATURE_VERSION,
    });
  });

  test('handles Weierstrass signature format', async () => {
    // Mock account that returns Weierstrass signature
    const mockAccount = {
      address: '0x1',
      signMessage: jest.fn().mockResolvedValue({
        r: BigInt('0x1234'),
        s: BigInt('0x5678'),
      }),
    } as unknown as Starknet.Account;

    const chainId = '0x2a';
    const jsonPayload =
      '{"jsonrpc": "2.0", "method": "starknet_getTransactionStatus", "params": ["0x1"], "id": 1}';

    const result = await generateFullnodeRequestHeaders(
      mockAccount,
      chainId,
      jsonPayload,
    );

    expect(result['PARADEX-STARKNET-SIGNATURE']).toBe('["4660","22136"]');
  });

  test('handles empty/undefined signature values', async () => {
    // Mock account that returns signature with undefined values
    const mockAccount = {
      address: '0x1',
      signMessage: jest.fn().mockResolvedValue({
        r: undefined,
        s: undefined,
      }),
    } as unknown as Starknet.Account;

    const chainId = '0x2a';
    const jsonPayload =
      '{"jsonrpc": "2.0", "method": "starknet_getTransactionStatus", "params": ["0x1"], "id": 1}';

    const result = await generateFullnodeRequestHeaders(
      mockAccount,
      chainId,
      jsonPayload,
    );

    expect(result['PARADEX-STARKNET-SIGNATURE']).toBe('["",""]');
  });
});
