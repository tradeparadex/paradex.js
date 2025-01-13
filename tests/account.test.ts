import type { SignatureType } from '@noble/curves/abstract/weierstrass';
import { ethers } from 'ethers';
import * as Starknet from 'starknet';

import * as Account from '../src/account';
import { isStarknetSignatureEqual } from '../src/account';
import { ethersSignerAdapter } from '../src/ethereum-signer';

import { configFactory } from './factories/paradex-config';
import { createMockProvider } from './mocks/provider';

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
      const snAccount = new Starknet.Account(
        snProvider,
        testCase.snAddress,
        testCase.snPrivateKey,
      );

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
