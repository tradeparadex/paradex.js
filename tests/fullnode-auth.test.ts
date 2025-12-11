import type * as Starknet from 'starknet';

import {
  FULLNODE_SIGNATURE_VERSION,
  generateAuthSignature,
} from '../src/fullnode-auth';

describe('generateAuthSignature', () => {
  test('generates correct authentication signature', async () => {
    // Mock account that returns predictable signature
    const mockSignMessage = jest.fn().mockResolvedValue(['1234', '5678']);
    const mockAccount = {
      address: '0x1',
      signMessage: mockSignMessage,
    } as unknown as Starknet.Account;

    const chainId = 'PRIVATE_SN_POTC_MOCK_SEPOLIA';
    const method = 'starknet_getTransactionStatus';
    const params = ['0x1'];

    const result = await generateAuthSignature(
      mockAccount,
      chainId,
      method,
      params,
    );

    expect(result).toEqual({
      account: '0x1',
      signature: ['1234', '5678'],
      timestamp: expect.stringMatching(/^\d+$/),
      id: expect.any(Number),
    });

    // Verify signMessage was called with correct structure
    expect(mockSignMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryType: 'Request',
        domain: expect.objectContaining({
          name: 'Paradex',
          version: '1',
        }),
        message: expect.objectContaining({
          account: '0x1',
          version: FULLNODE_SIGNATURE_VERSION,
        }),
      }),
    );
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

    const chainId = 'PRIVATE_SN_POTC_MOCK_SEPOLIA';
    const method = 'starknet_call';
    const params = { request: {}, block_id: 'latest' };

    const result = await generateAuthSignature(
      mockAccount,
      chainId,
      method,
      params,
    );

    expect(result.signature).toEqual(['4660', '22136']);
  });

  test('handles array signature format', async () => {
    // Mock account that returns array signature
    const mockAccount = {
      address: '0x123',
      signMessage: jest.fn().mockResolvedValue(['9999', '8888']),
    } as unknown as Starknet.Account;

    const chainId = 'PRIVATE_SN_POTC_MOCK_SEPOLIA';
    const method = 'starknet_call';
    const params = {};

    const result = await generateAuthSignature(
      mockAccount,
      chainId,
      method,
      params,
    );

    expect(result.signature).toEqual(['9999', '8888']);
  });
});
