import { getTokenBalance } from '../src/paraclear';

import { configFactory } from './factories/paradex-config';

describe('getBalance', () => {
  test('should return the balance size', async () => {
    const mockProvider = { callContract: jest.fn() };
    mockProvider.callContract.mockResolvedValueOnce([9900000000]);

    const result = await getTokenBalance({
      config: configFactory(),
      provider: mockProvider,
      account: { address: '0x123456789' },
      token: 'USDC',
    });

    expect(result).toEqual({ size: '99' });
  });

  test('should throw an error if token is not supported', async () => {
    const mockProvider = { callContract: jest.fn() };
    mockProvider.callContract.mockResolvedValueOnce([9900000000]);

    const result = getTokenBalance({
      config: configFactory(),
      provider: mockProvider,
      account: { address: '0x123456789' },
      token: 'ASDF',
    });

    await expect(result).rejects.toThrow('Token ASDF is not supported');
  });

  test('should throw an error if calling the contract returns no value', async () => {
    const mockProvider = { callContract: jest.fn() };
    mockProvider.callContract.mockResolvedValueOnce([]);

    const result = getTokenBalance({
      config: configFactory(),
      provider: mockProvider,
      account: { address: '0x123456789' },
      token: 'USDC',
    });

    await expect(result).rejects.toThrow('Failed to get token balance');
  });

  test('should throw an error if balance parsing fails', async () => {
    const mockProvider = { callContract: jest.fn() };
    mockProvider.callContract.mockResolvedValueOnce(['not a number']);

    const result = getTokenBalance({
      config: configFactory(),
      provider: mockProvider,
      account: { address: '0x123456789' },
      token: 'USDC',
    });

    await expect(result).rejects.toThrow('Failed to parse token balance');
  });
});