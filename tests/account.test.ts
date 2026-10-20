import type { SignatureType } from '@noble/curves/abstract/weierstrass';
import { keyDerivation } from '@starkware-industries/starkware-crypto-utils';
import { ethers } from 'ethers';
import * as Starknet from 'starknet';

import * as Account from '../src/account';
import { isStarknetSignatureEqual } from '../src/account';
import {
  buildEthereumStarkKeyTypedData,
  ethersSignerAdapter,
} from '../src/ethereum-signer';

import { configFactory } from './factories/paradex-config';
import { createMockProvider } from './mocks/provider';

describe('derive credentials from eth signer', () => {
  test('correct account credentials are generated', async () => {
    const testCases = [
      {
        seed: 'test test test test test test test test test test test ball',
        address:
          '0x72c394aaa3fae59ad7749c856dc18e2a289e83885b80c0da7731290a9163e17',
      },
      {
        seed: 'test test test test test test test test test test test junk',
        address:
          '0x37ff1c9d89a50b3dd3a4f90e020ea80251b09ba28049efbe4f7d3fec2995c4a',
      },
      {
        seed: 'test test test test test test test test test test test waste',
        address:
          '0x18610fa9cdb1dd19cc224f137754dc98fc4a2af9bb3a20dc6a15baa1fc1a1f8',
      },
    ];

    for (const testCase of testCases) {
      const wallet = ethers.Wallet.fromPhrase(testCase.seed);
      const signer = ethersSignerAdapter(wallet);

      const credentials = await Account.deriveFromEthSigner({
        config: configFactory(),
        signer,
      });

      expect(credentials.address).toBe(testCase.address);
      expect(credentials.privateKey).toMatch(/^0x[0-9a-f]+$/);
    }
  });
});

describe('create account from eth signer', () => {
  test('correct account address is generated', async () => {
    const testCases = [
      {
        seed: 'test test test test test test test test test test test ball',
        address:
          '0x72c394aaa3fae59ad7749c856dc18e2a289e83885b80c0da7731290a9163e17',
      },
      {
        seed: 'test test test test test test test test test test test junk',
        address:
          '0x37ff1c9d89a50b3dd3a4f90e020ea80251b09ba28049efbe4f7d3fec2995c4a',
      },
      {
        seed: 'test test test test test test test test test test test waste',
        address:
          '0x18610fa9cdb1dd19cc224f137754dc98fc4a2af9bb3a20dc6a15baa1fc1a1f8',
      },
    ];

    for (const testCase of testCases) {
      const wallet = ethers.Wallet.fromPhrase(testCase.seed);
      const signer = ethersSignerAdapter(wallet);

      const account = await Account.fromEthSigner({
        provider: createMockProvider(),
        config: configFactory(),
        signer,
      });

      expect(account.address).toBe(testCase.address);
    }
  });
});

describe('derive credentials from starknet account', () => {
  test('correct account credentials are generated', async () => {
    const testCases = [
      {
        snPrivateKey:
          '0x46063cf2e9c3cbf5cc17ad5fdfce6b6959fede7ceb433dc057a3c90f668004b',
        snAddress:
          '0x4383e793c2d1bc29be7647794936371dac6955636f22069a033d4392794780a',
        paradexAddress:
          '0x7b21ae25ac9b3f3ff47bb541097332f27252567a5e6f0399ff6f2cfdb1a2cb',
      },
    ] as const;

    for (const testCase of testCases) {
      const snProvider = createMockProvider();
      const snAccount = new Starknet.Account({
        provider: snProvider,
        address: testCase.snAddress,
        signer: testCase.snPrivateKey,
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
        abi: [{ type: 'function', inputs: [{ type: '::' }] }], // mock cairo1 contract abi
      });

      const credentials = await Account.deriveFromStarknetAccount({
        config: configFactory(),
        account: snAccount,
        starknetProvider: snProvider,
      });

      expect(credentials.address).toBe(testCase.paradexAddress);
      expect(credentials.privateKey).toMatch(/^0x[0-9a-f]+$/);
    }
  });
});

describe('create account from starknet signer', () => {
  test('correct account address is generated', async () => {
    const testCases = [
      {
        snPrivateKey:
          '0x46063cf2e9c3cbf5cc17ad5fdfce6b6959fede7ceb433dc057a3c90f668004b',
        snAddress:
          '0x4383e793c2d1bc29be7647794936371dac6955636f22069a033d4392794780a',
        paradexAddress:
          '0x7b21ae25ac9b3f3ff47bb541097332f27252567a5e6f0399ff6f2cfdb1a2cb',
      },
    ] as const;

    for (const testCase of testCases) {
      const snProvider = createMockProvider();
      const snAccount = new Starknet.Account({
        provider: snProvider,
        address: testCase.snAddress,
        signer: testCase.snPrivateKey,
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
        abi: [{ type: 'function', inputs: [{ type: '::' }] }], // mock cairo1 contract abi
      });

      const account = await Account.fromStarknetAccount({
        provider: createMockProvider(),
        config: configFactory(),
        account: snAccount,
        starknetProvider: snProvider,
      });

      expect(account.address).toBe(testCase.paradexAddress);
    }
  });
});

describe('isStarknetSignatureEqual', () => {
  describe('array signatures', () => {
    test('should return true for identical array signatures', () => {
      const sig1 = ['0x1234', '0x5678'];
      const sig2 = ['0x1234', '0x5678'];

      const result = isStarknetSignatureEqual(sig1, sig2);

      expect(result).toBe(true);
    });

    test('should return false for array signatures with different values', () => {
      const sig1 = ['0x1234', '0x5678'];
      const sig2 = ['0x1234', '0x9abc'];

      const result = isStarknetSignatureEqual(sig1, sig2);

      expect(result).toBe(false);
    });

    test('should return false for array signatures with different lengths', () => {
      const sig1 = ['0x1234', '0x5678'];
      const sig2 = ['0x1234', '0x5678', '0x9abc'];

      const result = isStarknetSignatureEqual(sig1, sig2);

      expect(result).toBe(false);
    });

    test('should return true for empty array signatures', () => {
      const sig1: string[] = [];
      const sig2: string[] = [];

      const result = isStarknetSignatureEqual(sig1, sig2);

      expect(result).toBe(true);
    });
  });

  describe('Weierstrass signatures', () => {
    test('should return true for identical Weierstrass signatures', () => {
      const sig1 = createMockSignature(BigInt('0x1234'), BigInt('0x5678'));
      const sig2 = createMockSignature(BigInt('0x1234'), BigInt('0x5678'));

      const result = isStarknetSignatureEqual(sig1, sig2);

      expect(result).toBe(true);
    });

    test('should return false for Weierstrass signatures with different r values', () => {
      const sig1 = createMockSignature(BigInt('0x1234'), BigInt('0x5678'));
      const sig2 = createMockSignature(BigInt('0x9abc'), BigInt('0x5678'));

      const result = isStarknetSignatureEqual(sig1, sig2);

      expect(result).toBe(false);
    });

    test('should return false for Weierstrass signatures with different s values', () => {
      const sig1 = createMockSignature(BigInt('0x1234'), BigInt('0x5678'));
      const sig2 = createMockSignature(BigInt('0x1234'), BigInt('0x9abc'));

      const result = Account.isStarknetSignatureEqual(sig1, sig2);

      expect(result).toBe(false);
    });
  });

  describe('mixed signature types', () => {
    test('should handle comparing array signature with Weierstrass signature', () => {
      const sig1 = ['0x1234', '0x5678'];
      const sig2 = createMockSignature(BigInt('0x1234'), BigInt('0x5678'));

      const result = isStarknetSignatureEqual(sig1, sig2);

      expect(result).toBe(false);
    });
  });
});

export function createMockSignature(
  r: bigint,
  s: bigint,
  recovery?: number,
): SignatureType {
  return {
    r,
    s,
    recovery,
    assertValidity: jest.fn(),
    addRecoveryBit: jest.fn(),
    hasHighS: jest.fn(),
    normalizeS: jest.fn(),
    recoverPublicKey: jest.fn(),
    toCompactRawBytes: jest.fn(),
    toCompactHex: jest.fn(),
    toDERRawBytes: jest.fn(),
    toDERHex: jest.fn(),
  };
}

describe('server-derived account address', () => {
  const apiUrl = 'https://api.example.paradex.trade/v1';
  const serverAddress =
    '0x5f2a1c9d2bb3e4f50617283940a1b2c3d4e5f60718293a4b5c6d7e8f9012345';
  const seed = 'test test test test test test test test test test test ball';
  const localAddress =
    '0x72c394aaa3fae59ad7749c856dc18e2a289e83885b80c0da7731290a9163e17';

  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        address: serverAddress,
        exists: true,
        account_signer_type: 'starknet',
        derivation_info: { class_hash: '0x123' },
      }),
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function expectedPublicKey(): Promise<string> {
    const wallet = ethers.Wallet.fromPhrase(seed);
    const typedData = buildEthereumStarkKeyTypedData(
      configFactory().ethereumChainId,
    );
    const signature =
      await ethersSignerAdapter(wallet).signTypedData(typedData);
    const privateKey = keyDerivation.getPrivateKeyFromEthSignature(signature);
    return `0x${keyDerivation.privateToStarkKey(privateKey)}`;
  }

  test('uses the address returned by the API', async () => {
    const signer = ethersSignerAdapter(ethers.Wallet.fromPhrase(seed));
    const local = await Account.deriveFromEthSigner({
      config: configFactory(),
      signer,
    });

    const credentials = await Account.deriveFromEthSigner({
      config: { ...configFactory(), paradexApiUrl: apiUrl },
      signer,
      serverDeriveAddress: true,
    });

    expect(credentials.address).toBe(serverAddress);
    expect(credentials.privateKey).toBe(local.privateKey);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(`${url.origin}${url.pathname}`).toBe(`${apiUrl}/onboarding`);
    expect(url.searchParams.get('account_signer_type')).toBe('starknet');
    expect(url.searchParams.get('public_key')).toBe(await expectedPublicKey());
  });

  test('apiUrl parameter overrides the config value', async () => {
    const signer = ethersSignerAdapter(ethers.Wallet.fromPhrase(seed));

    await Account.deriveFromEthSigner({
      config: { ...configFactory(), paradexApiUrl: 'https://ignored.test/v1' },
      signer,
      serverDeriveAddress: true,
      apiUrl: `${apiUrl}/`,
    });

    expect(fetchMock.mock.calls[0][0]).toMatch(
      new RegExp(`^${apiUrl}/onboarding\\?`),
    );
  });

  test('derives locally and skips the API by default', async () => {
    const signer = ethersSignerAdapter(ethers.Wallet.fromPhrase(seed));

    const credentials = await Account.deriveFromEthSigner({
      config: { ...configFactory(), paradexApiUrl: apiUrl },
      signer,
    });

    expect(credentials.address).toBe(localAddress);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('throws when no API URL is available', async () => {
    const signer = ethersSignerAdapter(ethers.Wallet.fromPhrase(seed));

    await expect(
      Account.deriveFromEthSigner({
        config: configFactory(),
        signer,
        serverDeriveAddress: true,
      }),
    ).rejects.toThrow('serverDeriveAddress requires an API URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('throws when the API request fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    });
    const signer = ethersSignerAdapter(ethers.Wallet.fromPhrase(seed));

    await expect(
      Account.deriveFromEthSigner({
        config: configFactory(),
        signer,
        serverDeriveAddress: true,
        apiUrl,
      }),
    ).rejects.toThrow(
      'Failed to fetch Paradex onboarding info: Bad Request 400',
    );
  });

  test('fromEthSigner passes the option through', async () => {
    const account = await Account.fromEthSigner({
      provider: createMockProvider(),
      config: configFactory(),
      signer: ethersSignerAdapter(ethers.Wallet.fromPhrase(seed)),
      serverDeriveAddress: true,
      apiUrl,
    });

    expect(account.address).toBe(serverAddress);
  });

  test('deriveFromStarknetAccount uses the address returned by the API', async () => {
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
      abi: [{ type: 'function', inputs: [{ type: '::' }] }], // mock cairo1 contract abi
    });

    const credentials = await Account.deriveFromStarknetAccount({
      config: { ...configFactory(), paradexApiUrl: apiUrl },
      account: snAccount,
      starknetProvider: snProvider,
      serverDeriveAddress: true,
    });

    expect(credentials.address).toBe(serverAddress);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchOnboarding', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('maps the API response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        address: '0xabc',
        exists: false,
        account_signer_type: 'starknet',
        derivation_info: { class_hash: '0x1', proxy_class_hash: '0x2' },
      }),
    });

    const info = await Account.fetchOnboarding({
      apiUrl: 'https://api.example.paradex.trade/v1',
      publicKey: '0x1234',
    });

    expect(info).toEqual({
      address: '0xabc',
      exists: false,
      accountSignerType: 'starknet',
      derivationInfo: { classHash: '0x1', proxyClassHash: '0x2' },
    });
  });

  test('throws when the response has no address', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ exists: false }),
    });

    await expect(
      Account.fetchOnboarding({
        apiUrl: 'https://api.example.paradex.trade/v1',
        publicKey: '0x1234',
      }),
    ).rejects.toThrow('Paradex onboarding response is missing the address');
  });
});
