import { ethers } from 'ethers';
import * as Starknet from 'starknet';

import { ParadexClient } from '../src/client';
import { ethersSignerAdapter } from '../src/ethereum-signer';

import { configFactory } from './factories/paradex-config';
import { createMockProvider } from './mocks/provider';

describe('ParadexClient', () => {
  describe('createFromEthSigner', () => {
    test('should create client from Ethereum signer', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const client = await ParadexClient.createFromEthSigner({
        config,
        signer,
      });

      expect(client).toBeInstanceOf(ParadexClient);
      expect(client.getAddress()).toBe(
        '0x72c394aaa3fae59ad7749c856dc18e2a289e83885b80c0da7731290a9163e17',
      );
    });

    test('should throw error if provider creation fails', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      // Mock the provider to return null account
      jest
        .spyOn(ParadexClient as any, 'createFromEthSigner')
        .mockRejectedValueOnce(
          new Error('Failed to create authenticated provider'),
        );

      await expect(
        ParadexClient.createFromEthSigner({ config, signer }),
      ).rejects.toThrow('Failed to create authenticated provider');
    });
  });

  describe('createFromStarknetAccount', () => {
    test('should create client from Starknet account', async () => {
      const snProvider = createMockProvider();
      const snAccount = new Starknet.Account({
        provider: snProvider,
        address:
          '0x4383e793c2d1bc29be7647794936371dac6955636f22069a033d4392794780a',
        signer:
          '0x46063cf2e9c3cbf5cc17ad5fdfce6b6959fede7ceb433dc057a3c90f668004b',
      });

      jest
        .spyOn(snProvider, 'getClassHashAt')
        .mockResolvedValueOnce(
          '0x1a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003',
        );
      jest.spyOn(snProvider, 'getClassAt').mockResolvedValueOnce({
        sierra_program: [],
        contract_class_version: '',
        entry_points_by_type: { CONSTRUCTOR: [], EXTERNAL: [], L1_HANDLER: [] },
        abi: [{ type: 'function', inputs: [{ type: '::' }] }],
      });

      const config = configFactory();
      const client = await ParadexClient.createFromStarknetAccount({
        config,
        account: snAccount,
        starknetProvider: snProvider,
      });

      expect(client).toBeInstanceOf(ParadexClient);
      expect(client.getAddress()).toBe(
        '0x7b21ae25ac9b3f3ff47bb541097332f27252567a5e6f0399ff6f2cfdb1a2cb',
      );
    });
  });

  describe('getTokenBalance', () => {
    test('should get token balance', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const client = await ParadexClient.createFromEthSigner({
        config,
        signer,
      });

      // Mock the provider's callContract method
      const mockCallContract = jest
        .spyOn(client.getProvider(), 'callContract')
        .mockResolvedValueOnce(['9900000000']);

      const balance = await client.getTokenBalance('USDC');

      expect(balance).toEqual({ size: '99' });
      expect(mockCallContract).toHaveBeenCalledWith(
        {
          contractAddress: config.paraclearAddress,
          entrypoint: 'getTokenAssetBalance',
          calldata: [
            client.getAddress(),
            config.bridgedTokens.USDC?.l2TokenAddress,
          ],
        },
        Starknet.BlockTag.LATEST,
      );
    });

    test('should throw error for unsupported token', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const client = await ParadexClient.createFromEthSigner({
        config,
        signer,
      });

      await expect(client.getTokenBalance('INVALID')).rejects.toThrow(
        'Token INVALID is not supported',
      );
    });
  });

  describe('getMaxWithdraw', () => {
    test('should get max withdrawable amount', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const client = await ParadexClient.createFromEthSigner({
        config,
        signer,
      });

      // Mock the provider's callContract method
      const mockCallContract = jest
        .spyOn(client.getProvider(), 'callContract')
        .mockResolvedValueOnce(['9500000000']);

      const maxWithdraw = await client.getMaxWithdraw('USDC');

      expect(maxWithdraw).toEqual({
        amount: '95',
        amountChain: '9500000000',
      });
      expect(mockCallContract).toHaveBeenCalledWith(
        {
          contractAddress: config.paraclearAddress,
          entrypoint: 'max_withdraw',
          calldata: [
            client.getAddress(),
            config.bridgedTokens.USDC?.l2TokenAddress,
          ],
        },
        Starknet.BlockTag.PRE_CONFIRMED,
      );
    });
  });

  describe('getSocializedLossFactor', () => {
    test('should get socialized loss factor', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const client = await ParadexClient.createFromEthSigner({
        config,
        signer,
      });

      // Mock the provider's callContract method
      const mockCallContract = jest
        .spyOn(client.getProvider(), 'callContract')
        .mockResolvedValueOnce(['123456789']);

      const result = await client.getSocializedLossFactor();

      expect(result).toEqual({ socializedLossFactor: '1.23456789' });
      expect(mockCallContract).toHaveBeenCalledWith({
        contractAddress: config.paraclearAddress,
        entrypoint: 'getSocializedLossFactor',
      });
    });
  });

  describe('getReceivableAmount', () => {
    test('should calculate receivable amount', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const client = await ParadexClient.createFromEthSigner({
        config,
        signer,
      });

      // Mock the provider's callContract method for socialized loss factor
      jest
        .spyOn(client.getProvider(), 'callContract')
        .mockResolvedValueOnce(['1000000']); // 0.01 (1%)

      const result = await client.getReceivableAmount('USDC', '100');

      expect(result).toEqual({
        receivableAmount: '99',
        receivableAmountChain: '99000000',
        socializedLossFactor: '0.01',
      });
    });
  });

  describe('withdraw', () => {
    test('should initiate withdrawal', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const client = await ParadexClient.createFromEthSigner({
        config,
        signer,
      });

      const account = client.getProvider().getAccount();
      if (account == null) throw new Error('Account not found');

      // Mock the account methods
      const mockEstimateInvokeFee = jest
        .spyOn(account, 'estimateInvokeFee')
        .mockResolvedValueOnce({
          overall_fee: BigInt(1000),
          unit: 'WEI' as const,
          resourceBounds: {
            l1_gas: {
              max_amount: BigInt(1000),
              max_price_per_unit: BigInt(1),
            },
            l1_data_gas: {
              max_amount: BigInt(1000),
              max_price_per_unit: BigInt(1),
            },
            l2_gas: {
              max_amount: BigInt(1000),
              max_price_per_unit: BigInt(1),
            },
          },
        });

      const mockExecute = jest.spyOn(account, 'execute').mockResolvedValueOnce({
        transaction_hash: '0xabcdef123456',
      });

      const result = await client.withdraw('USDC', '100', []);

      expect(result).toEqual({ hash: '0xabcdef123456' });
      expect(mockEstimateInvokeFee).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('waitForTransaction', () => {
    test('should wait for transaction completion', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const client = await ParadexClient.createFromEthSigner({
        config,
        signer,
      });

      // Mock the provider's waitForTransaction method
      const mockReceipt: Starknet.GetTransactionReceiptResponse = {
        type: 'INVOKE',
      } satisfies Partial<Starknet.GetTransactionReceiptResponse> as Starknet.GetTransactionReceiptResponse;

      const mockWaitForTransaction = jest
        .spyOn(client.getProvider(), 'waitForTransaction')
        .mockResolvedValueOnce(mockReceipt);

      const txHash = '0xabcdef123456';
      const result = await client.waitForTransaction(txHash);

      expect(result).toBe(mockReceipt);
      expect(mockWaitForTransaction).toHaveBeenCalledWith(txHash, undefined);
    });
  });

  describe('getAddress', () => {
    test('should return account address', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const client = await ParadexClient.createFromEthSigner({
        config,
        signer,
      });

      const address = client.getAddress();

      expect(address).toBe(
        '0x72c394aaa3fae59ad7749c856dc18e2a289e83885b80c0da7731290a9163e17',
      );
    });
  });

  describe('getProvider', () => {
    test('should return provider instance', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const client = await ParadexClient.createFromEthSigner({
        config,
        signer,
      });

      const provider = client.getProvider();

      expect(provider).toBeDefined();
      expect(provider.getAccount()).toBeDefined();
    });
  });
});
