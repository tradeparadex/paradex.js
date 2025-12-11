import { ethers } from 'ethers';
import * as Starknet from 'starknet';

import { deriveFromEthSigner } from '../src/account';
import { ethersSignerAdapter } from '../src/ethereum-signer';
import {
  AuthenticatedRpcProvider,
  DefaultProvider,
} from '../src/paraclear-provider';

import { configFactory } from './factories/paradex-config';

describe('AuthenticatedRpcProvider', () => {
  test('should create provider with correct chain ID', () => {
    const config = configFactory();
    const provider = new AuthenticatedRpcProvider(
      config.paradexFullNodeRpcUrl,
      config.paradexChainId,
    );

    expect(provider.getChainIdString()).toBe(config.paradexChainId);
  });

  test('should have correct node URL', () => {
    const config = configFactory();
    const provider = new AuthenticatedRpcProvider(
      config.paradexFullNodeRpcUrl,
      config.paradexChainId,
    );

    // Verify it's an RpcProvider with the correct URL
    expect(provider).toBeInstanceOf(Starknet.RpcProvider);
  });
});

describe('DefaultProvider', () => {
  describe('constructor', () => {
    test('should create provider without credentials', () => {
      const config = configFactory();
      const provider = new DefaultProvider(config);

      expect(provider).toBeInstanceOf(DefaultProvider);
      expect(provider.getAccount()).toBeUndefined();
    });

    test('should create provider with account credentials', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const credentials = await deriveFromEthSigner({ config, signer });
      const provider = new DefaultProvider(config, credentials);

      expect(provider).toBeInstanceOf(DefaultProvider);
      expect(provider.getAccount()).toBeDefined();
      expect(provider.getAccount()?.address).toBe(credentials.address);
    });

    test('should create provider with Account instance', () => {
      const config = configFactory();
      const mockAccount = new Starknet.Account({
        provider: new Starknet.RpcProvider(),
        address: '0x123',
        signer: '0x456',
      });

      const provider = new DefaultProvider(
        config,
        mockAccount as unknown as Starknet.Account,
      );

      expect(provider).toBeInstanceOf(DefaultProvider);
      expect(provider.getAccount()).toBeDefined();
      expect(provider.getAccount()?.address).toBe('0x123');
    });
  });

  describe('getAccount', () => {
    test('should return undefined when no credentials provided', () => {
      const config = configFactory();
      const provider = new DefaultProvider(config);

      expect(provider.getAccount()).toBeUndefined();
    });

    test('should return account when credentials provided', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const credentials = await deriveFromEthSigner({ config, signer });
      const provider = new DefaultProvider(config, credentials);

      const account = provider.getAccount();
      expect(account).toBeDefined();
      expect(account?.address).toBe(credentials.address);
    });
  });

  describe('callContract', () => {
    test('should call contract without authentication when no account', async () => {
      const config = configFactory();
      const provider = new DefaultProvider(config);

      // Mock the parent class method
      const mockSuperCallContract = jest
        .spyOn(Starknet.RpcProvider.prototype, 'callContract')
        .mockResolvedValueOnce(['0x100']);

      const call = {
        contractAddress: '0xabc',
        entrypoint: 'get_balance',
        calldata: ['0x123'],
      };

      const result = await provider.callContract(call);

      expect(result).toEqual(['0x100']);
      expect(mockSuperCallContract).toHaveBeenCalledWith(
        call,
        Starknet.BlockTag.PRE_CONFIRMED,
      );

      mockSuperCallContract.mockRestore();
    });

    test('should call contract with authentication when account exists', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const credentials = await deriveFromEthSigner({ config, signer });
      const provider = new DefaultProvider(config, credentials);

      // Mock fetch for the authenticated request
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: ['0x100'],
          id: 1,
        }),
      });

      const call = {
        contractAddress: config.paraclearAddress,
        entrypoint: 'getTokenAssetBalance',
        calldata: [credentials.address, '0x123'],
      };

      const result = await provider.callContract(call);

      expect(result).toEqual(['0x100']);
      expect(global.fetch).toHaveBeenCalled();

      // Verify authentication headers were included
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers['PARADEX-STARKNET-ACCOUNT']).toBeDefined();
      expect(headers['PARADEX-STARKNET-SIGNATURE']).toBeDefined();
      expect(headers['PARADEX-STARKNET-SIGNATURE-TIMESTAMP']).toBeDefined();
      expect(headers['PARADEX-STARKNET-SIGNATURE-VERSION']).toBe('1.0.0');

      // Clean up
      (global.fetch as jest.Mock).mockRestore();
    });

    test('should handle RPC errors in authenticated call', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const credentials = await deriveFromEthSigner({ config, signer });
      const provider = new DefaultProvider(config, credentials);

      // Mock fetch to return an error
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          error: {
            message: 'Contract not found',
            code: -32602,
          },
          id: 1,
        }),
      });

      const call = {
        contractAddress: '0xabc',
        entrypoint: 'get_balance',
        calldata: ['0x123'],
      };

      await expect(provider.callContract(call)).rejects.toThrow(
        'RPC error: Contract not found',
      );

      // Clean up
      (global.fetch as jest.Mock).mockRestore();
    });

    test('should handle HTTP errors in authenticated call', async () => {
      const wallet = ethers.Wallet.fromPhrase(
        'test test test test test test test test test test test ball',
      );
      const signer = ethersSignerAdapter(wallet);
      const config = configFactory();

      const credentials = await deriveFromEthSigner({ config, signer });
      const provider = new DefaultProvider(config, credentials);

      // Mock fetch to return HTTP error
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const call = {
        contractAddress: '0xabc',
        entrypoint: 'get_balance',
        calldata: ['0x123'],
      };

      await expect(provider.callContract(call)).rejects.toThrow(
        'HTTP error! status: 500',
      );

      // Clean up
      (global.fetch as jest.Mock).mockRestore();
    });

    test('should use custom block identifier', async () => {
      const config = configFactory();
      const provider = new DefaultProvider(config);

      // Mock the parent class method
      const mockSuperCallContract = jest
        .spyOn(Starknet.RpcProvider.prototype, 'callContract')
        .mockResolvedValueOnce(['0x100']);

      const call = {
        contractAddress: '0xabc',
        entrypoint: 'get_balance',
        calldata: ['0x123'],
      };

      await provider.callContract(call, Starknet.BlockTag.LATEST);

      expect(mockSuperCallContract).toHaveBeenCalledWith(
        call,
        Starknet.BlockTag.LATEST,
      );

      mockSuperCallContract.mockRestore();
    });
  });

  describe('inheritance', () => {
    test('should extend AuthenticatedRpcProvider', () => {
      const config = configFactory();
      const provider = new DefaultProvider(config);

      expect(provider).toBeInstanceOf(AuthenticatedRpcProvider);
      expect(provider).toBeInstanceOf(Starknet.RpcProvider);
    });

    test('should inherit getChainIdString method', () => {
      const config = configFactory();
      const provider = new DefaultProvider(config);

      expect(provider.getChainIdString()).toBe(config.paradexChainId);
    });
  });
});
