import {
  getReceivableAmount,
  getSocializedLossFactor,
  getTokenBalance,
} from '../src/paraclear';

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

describe('getSocializedLossFactor', () => {
  test('should return the socialized loss factor', async () => {
    const mockProvider = { callContract: jest.fn() };
    mockProvider.callContract.mockResolvedValueOnce(['123456789']);

    const result = await getSocializedLossFactor({
      config: configFactory(),
      provider: mockProvider,
    });

    expect(result).toEqual({ socializedLossFactor: '1.23456789' });
  });

  test('should throw an error if the result is null', async () => {
    const mockProvider = { callContract: jest.fn() };
    mockProvider.callContract.mockResolvedValueOnce([null]);

    const result = getSocializedLossFactor({
      config: configFactory(),
      provider: mockProvider,
    });

    await expect(result).rejects.toThrow(
      'Failed to get socialized loss factor',
    );
  });

  test('should throw an error if the result is not a number', async () => {
    const mockProvider = { callContract: jest.fn() };
    mockProvider.callContract.mockResolvedValueOnce(['not a number']);

    const result = getSocializedLossFactor({
      config: configFactory(),
      provider: mockProvider,
    });

    await expect(result).rejects.toThrow(
      'Failed to parse socialized loss factor',
    );
  });
});

describe('getReceivableAmount', () => {
  test('should calculate the receivable amount correctly', async () => {
    const socializedLossFactor = '0.01';
    const socializedLossFactorChain = '1000000';

    const mockProvider = { callContract: jest.fn() };
    mockProvider.callContract.mockResolvedValueOnce([
      socializedLossFactorChain,
    ]);

    const result = await getReceivableAmount({
      config: configFactory(),
      provider: mockProvider,
      amount: '100',
    });

    expect(result).toStrictEqual({
      receivableAmount: '99',
      receivableAmountChain: '9900000000',
      socializedLossFactor,
    });
  });

  test('should throw an error for invalid amount', async () => {
    const result = getReceivableAmount({
      config: configFactory(),
      provider: { callContract: jest.fn() },
      amount: 'not a number',
    });

    await expect(result).rejects.toThrow('Invalid amount');
  });

  test('should throw an error if socialized loss factor is not a number', async () => {
    const mockProvider = { callContract: jest.fn() };
    mockProvider.callContract.mockResolvedValueOnce(['not a number']);

    const result = getReceivableAmount({
      config: configFactory(),
      provider: mockProvider,
      amount: '100',
    });

    await expect(result).rejects.toThrow(
      'Failed to parse socialized loss factor',
    );
  });

  test('should throw an error if socialized loss factor is null', async () => {
    const mockProvider = { callContract: jest.fn() };
    mockProvider.callContract.mockResolvedValueOnce([null]);

    const result = getReceivableAmount({
      config: configFactory(),
      provider: mockProvider,
      amount: '100',
    });

    await expect(result).rejects.toThrow(
      'Failed to get socialized loss factor',
    );
  });
});
