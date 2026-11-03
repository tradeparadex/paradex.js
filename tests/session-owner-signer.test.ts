import { ethers } from 'ethers';

import { hashTypedData } from '../src/eip712';
import {
  assertEoaSignature,
  eip1193OwnerSigner,
  externalOwnerSigner,
  type Eip1193Provider,
} from '../src/session-owner-signer';
import {
  buildSessionGrantEip712,
  createSessionGrant,
} from '../src/session-typed-data';

import { LIMITS } from './mocks/session';

const grant = createSessionGrant({
  limits: LIMITS,
  paradexChain: 'PRIVATE_SN_POTC_SEPOLIA',
  environment: 'testnet',
  account: '0x1',
  sessionKey: '0x2',
});

/** An EIP-1193 provider backed by an ethers wallet, as a browser wallet would be. */
function walletProvider(
  wallet: ethers.BaseWallet,
  chainId: string,
): Eip1193Provider & { calls: Array<{ method: string; params?: unknown }> } {
  const calls: Array<{ method: string; params?: unknown }> = [];
  return {
    calls,
    request: async ({ method, params }) => {
      calls.push({ method, params });
      switch (method) {
        case 'eth_chainId':
          return chainId;
        case 'eth_requestAccounts':
          return [wallet.address];
        case 'eth_signTypedData_v4': {
          const [from, json] = params as [string, string];
          expect(from).toBe(wallet.address);
          const parsed = JSON.parse(json) as {
            domain: ethers.TypedDataDomain;
            types: Record<string, ethers.TypedDataField[]>;
            message: Record<string, unknown>;
          };
          const { EIP712Domain: _domain, ...types } = parsed.types;
          return await wallet.signTypedData(
            parsed.domain,
            types,
            parsed.message,
          );
        }
        default:
          throw new Error(`unexpected ${method}`);
      }
    },
  };
}

describe('eip1193OwnerSigner', () => {
  test('reads the current chain and signs v4 typed data that recovers to the wallet', async () => {
    const wallet = ethers.Wallet.createRandom();
    const provider = walletProvider(wallet, '0xa4b1');
    const signer = eip1193OwnerSigner({ provider });
    const chainId = await signer.getChainId();
    expect(chainId).toBe(42161);

    const typedData = buildSessionGrantEip712(grant, chainId);
    const digest = hashTypedData(typedData);
    const signature = await signer.signTypedData({ typedData, digest });
    expect(ethers.recoverAddress(digest, signature)).toBe(wallet.address);

    const v4 = provider.calls.find((c) => c.method === 'eth_signTypedData_v4');
    const payload = JSON.parse((v4?.params as string[])[1] ?? '{}');
    expect(payload.types.EIP712Domain).toHaveLength(3);
    expect(payload.domain).toEqual({
      name: 'Paradex Session',
      version: '1',
      chainId: 42161,
    });
  });

  test('uses the given address without asking for accounts', async () => {
    const wallet = ethers.Wallet.createRandom();
    const provider = walletProvider(wallet, '1');
    const signer = eip1193OwnerSigner({ provider, address: wallet.address });
    const typedData = buildSessionGrantEip712(grant, 1);
    await signer.signTypedData({ typedData, digest: hashTypedData(typedData) });
    expect(provider.calls.map((c) => c.method)).toEqual([
      'eth_signTypedData_v4',
    ]);
  });

  test.each([['0x0'], ['abc'], [null], [-1]])(
    'refuses chain id %p',
    async (value) => {
      const signer = eip1193OwnerSigner({
        provider: { request: async () => value },
      });
      await expect(signer.getChainId()).rejects.toThrow(/invalid chain id/);
    },
  );

  test('fails when the wallet has no accounts or returns a non-string', async () => {
    const typedData = buildSessionGrantEip712(grant, 1);
    const digest = hashTypedData(typedData);
    const noAccounts = eip1193OwnerSigner({
      provider: { request: async () => [] },
    });
    await expect(
      noAccounts.signTypedData({ typedData, digest }),
    ).rejects.toThrow(/no accounts/);
    const badSig = eip1193OwnerSigner({
      provider: { request: async () => 42 },
      address: '0xabc',
    });
    await expect(badSig.signTypedData({ typedData, digest })).rejects.toThrow(
      /non-string/,
    );
  });

  test('passes wallet rejections through', async () => {
    const signer = eip1193OwnerSigner({
      provider: {
        request: async () => {
          throw Object.assign(new Error('User rejected'), { code: 4001 });
        },
      },
      address: '0xabc',
    });
    const typedData = buildSessionGrantEip712(grant, 1);
    await expect(
      signer.signTypedData({ typedData, digest: hashTypedData(typedData) }),
    ).rejects.toThrow('User rejected');
  });
});

describe('externalOwnerSigner', () => {
  test('hands the typed data and digest to the partner hook', async () => {
    const wallet = ethers.Wallet.createRandom();
    const sign = jest.fn(
      async ({ digest }: { digest: string }) =>
        wallet.signingKey.sign(digest).serialized,
    );
    const signer = externalOwnerSigner({ chainId: 8453, sign });
    expect(await signer.getChainId()).toBe(8453);
    const typedData = buildSessionGrantEip712(grant, 8453);
    const digest = hashTypedData(typedData);
    const signature = await signer.signTypedData({ typedData, digest });
    expect(sign).toHaveBeenCalledWith({ typedData, digest });
    expect(ethers.recoverAddress(digest, signature)).toBe(wallet.address);
  });

  test('accepts an async chain id', async () => {
    const signer = externalOwnerSigner({
      chainId: async () => 10,
      sign: async () => '0x',
    });
    expect(await signer.getChainId()).toBe(10);
  });
});

describe('assertEoaSignature', () => {
  test('accepts 65-byte signatures and lowercases them', () => {
    const sig = `0x${'AB'.repeat(65)}`;
    expect(assertEoaSignature(sig)).toBe(sig.toLowerCase());
  });

  test.each([
    ['ERC-1271 contract signature', `0x${'ab'.repeat(200)}`],
    ['64-byte compact signature', `0x${'ab'.repeat(64)}`],
    ['not hex', 'signature'],
  ])('refuses a %s', (_name, sig) => {
    expect(() => assertEoaSignature(sig)).toThrow(/65-byte EOA/);
  });
});
