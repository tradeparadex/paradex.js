import { ethers } from 'ethers';

import { fromEthSigner } from '../src/account';
import { ethersSignerAdapter } from '../src/ethereum-signer';
import {
  getReceivableAmount,
  getSocializedLossFactor,
  getTokenBalance,
  withdraw,
} from '../src/paraclear';

import { configFactory } from './factories/paradex-config';
import { createMockProvider } from './mocks/provider';

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
      token: 'USDC',
      amount: '100',
    });

    expect(result).toStrictEqual({
      receivableAmount: '99',
      receivableAmountChain: '99000000',
      socializedLossFactor,
    });
  });

  test('should throw an error if token is not supported', async () => {
    const result = getReceivableAmount({
      config: configFactory(),
      provider: { callContract: jest.fn() },
      token: 'ASDF',
      amount: '100',
    });

    await expect(result).rejects.toThrow('Token ASDF is not supported');
  });

  test('should throw an error for invalid amount', async () => {
    const result = getReceivableAmount({
      config: configFactory(),
      provider: { callContract: jest.fn() },
      token: 'USDC',
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
      token: 'USDC',
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
      token: 'USDC',
      amount: '100',
    });

    await expect(result).rejects.toThrow(
      'Failed to get socialized loss factor',
    );
  });
});

describe('withdraw', () => {
  test('should initiate withdrawal and return transaction hash', async () => {
    const wallet = ethers.Wallet.fromPhrase(
      'test test test test test test test test test test test waste',
    );
    const signer = ethersSignerAdapter(wallet);

    const config = configFactory();

    const mockAccount = await fromEthSigner({
      provider: createMockProvider(),
      config,
      signer,
    });

    const mockExecute = jest
      .spyOn(mockAccount, 'execute')
      .mockResolvedValueOnce({
        transaction_hash: '0xabcdef123456',
      });

    const bridgeCall = {
      contractAddress: '0xB',
      entrypoint: 'entrypoint',
      calldata: ['0x12', '100000000'],
    };

    const result = await withdraw({
      config,
      account: mockAccount,
      token: 'USDC',
      amount: '100',
      bridgeCall,
    });

    if (config.bridgedTokens.USDC == null) {
      throw new Error('Token USDC is not defined');
    }

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const mockExecuteArg1 = mockExecute.mock.calls[0]?.[0];
    expect(mockExecuteArg1).toStrictEqual([
      {
        contractAddress:
          '0x286003f7c7bfc3f94e8f0af48b48302e7aee2fb13c23b141479ba00832ef2c6',
        entrypoint: 'withdraw',
        calldata: [config.bridgedTokens.USDC.l2TokenAddress, '10000000000'],
      },
      bridgeCall,
    ]);

    expect(result).toEqual({ hash: '0xabcdef123456' });
  });

  test('should support multiple calls in bridgeCall', async () => {
    const wallet = ethers.Wallet.fromPhrase(
      'test test test test test test test test test test test waste',
    );
    const signer = ethersSignerAdapter(wallet);

    const config = configFactory();

    const mockAccount = await fromEthSigner({
      provider: createMockProvider(),
      config,
      signer,
    });

    const mockExecute = jest
      .spyOn(mockAccount, 'execute')
      .mockResolvedValueOnce({
        transaction_hash: '0xabcdef123456',
      });

    const bridgeCall = [
      {
        contractAddress: '0xB',
        entrypoint: 'entrypoint1',
        calldata: ['0x12', '100000000'],
      },
      {
        contractAddress: '0xC',
        entrypoint: 'entrypoint2',
        calldata: ['0x13', '100000000'],
      },
    ];

    const result = await withdraw({
      config,
      account: mockAccount,
      token: 'USDC',
      amount: '100',
      bridgeCall,
    });

    if (config.bridgedTokens.USDC == null) {
      throw new Error('Token USDC is not defined');
    }

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const mockExecuteArg1 = mockExecute.mock.calls[0]?.[0];
    expect(mockExecuteArg1).toStrictEqual([
      {
        contractAddress:
          '0x286003f7c7bfc3f94e8f0af48b48302e7aee2fb13c23b141479ba00832ef2c6',
        entrypoint: 'withdraw',
        calldata: [config.bridgedTokens.USDC.l2TokenAddress, '10000000000'],
      },
      ...bridgeCall,
    ]);

    expect(result).toEqual({ hash: '0xabcdef123456' });
  });

  test('should throw an error if token is not supported', async () => {
    const wallet = ethers.Wallet.fromPhrase(
      'test test test test test test test test test test test waste',
    );
    const signer = ethersSignerAdapter(wallet);
    const mockAccount = await fromEthSigner({
      provider: createMockProvider(),
      config: configFactory(),
      signer,
    });

    const withdrawParams = {
      config: configFactory(),
      account: mockAccount,
      token: 'ASDF',
      amount: '100',
      bridgeCall: { contractAddress: '', entrypoint: '', calldata: [] },
    };

    await expect(withdraw(withdrawParams)).rejects.toThrow(
      'Token ASDF is not supported',
    );
  });
});
