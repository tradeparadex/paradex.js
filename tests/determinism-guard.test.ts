import { ethers } from 'ethers';

import * as Account from '../src/account';
import {
  DeterminismGuardError,
  hasContractCode,
  isContractCode,
  publicKeyForms,
  type DeterminismGuardResult,
  type EthCodeProvider,
} from '../src/determinism-guard';
import {
  buildEthereumStarkKeyTypedData,
  ethersSignerAdapter,
  type EthereumSigner,
} from '../src/ethereum-signer';
import * as keyDerivation from '../src/key-derivation';

import { configFactory } from './factories/paradex-config';
import { createMockProvider } from './mocks/provider';

const seed = 'test test test test test test test test test test test ball';
const wallet = ethers.Wallet.fromPhrase(seed);
const walletAddress = wallet.address.toLowerCase();
const apiUrl = 'https://api.example.test/v1';
const accountAddress = '0x5e1ec7ed';
const computedAddress = '0xc0ffee';
const EOA_CODE = '0x';
const CONTRACT_CODE = '0x6080604052';
const DELEGATED_CODE = `0xef0100${'ab'.repeat(20)}`;

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

const ok = (body: unknown): Reply => ({ status: 200, body });
const notFound = ok({
  address: computedAddress,
  exists: false,
  account_signer_type: 'starknet',
});
const found = ok({
  address: accountAddress,
  exists: true,
  account_signer_type: 'starknet',
  derivation_info: { class_hash: '0x123' },
});
const walletFree = ok({
  address: '0xe0a',
  exists: false,
  account_signer_type: 'eip191',
});

/** Routes `GET /onboarding` by lookup type and records each request. */
function mockOnboarding(byKey: Reply, byWallet: Reply = walletFree): jest.Mock {
  const mock = jest.fn(async (url: string) => {
    const params = new URL(url).searchParams;
    const reply = params.has('eth_address') ? byWallet : byKey;
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      statusText: reply.status === 200 ? 'OK' : 'Error',
      json: async () => reply.body,
    };
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function lookups(mock: jest.Mock): Array<Record<string, string>> {
  return mock.mock.calls.map(([url]: [string]) =>
    Object.fromEntries(new URL(url).searchParams),
  );
}

/** The ethers wallet as a signer that counts signatures and has a code. */
function countingSigner(code: string | Error = EOA_CODE): {
  signer: EthereumSigner;
  signatures: () => number;
} {
  const inner = ethersSignerAdapter(wallet);
  let count = 0;
  return {
    signer: {
      signTypedData: async (typedData) => {
        count += 1;
        return await inner.signTypedData(typedData);
      },
      getAddress: async () => wallet.address,
      getCode: async () => {
        if (code instanceof Error) throw code;
        return code;
      },
    },
    signatures: () => count,
  };
}

async function derivedPublicKey(): Promise<string> {
  const signature = await ethersSignerAdapter(wallet).signTypedData(
    buildEthereumStarkKeyTypedData(configFactory().ethereumChainId),
  );
  const privateKey = keyDerivation.getPrivateKeyFromEthSignature(signature);
  return `0x${keyDerivation.privateToStarkKey(privateKey)}`;
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe('deriveFromEthSigner with determinismGuard', () => {
  test('existing account: one signature, account address from the API', async () => {
    const fetchMock = mockOnboarding(found);
    const { signer, signatures } = countingSigner();
    const results: DeterminismGuardResult[] = [];

    const credentials = await Account.deriveFromEthSigner({
      config: configFactory(),
      signer,
      apiUrl,
      determinismGuard: { onResult: (r) => results.push(r) },
    });

    expect(signatures()).toBe(1);
    expect(credentials.address).toBe(accountAddress);
    expect(credentials.privateKey).toMatch(/^0x[0-9a-f]+$/);
    expect(lookups(fetchMock)).toEqual([
      { account_signer_type: 'starknet', public_key: await derivedPublicKey() },
    ]);
    expect(results).toEqual([
      {
        kind: 'existing',
        signatures: 1,
        walletAddress,
        address: accountAddress,
        publicKey: await derivedPublicKey(),
      },
    ]);
  });

  test('wallet owns an account under another key: key_mismatch, no second signature', async () => {
    mockOnboarding(
      notFound,
      ok({ address: '0xe0a', exists: true, account_signer_type: 'eip191' }),
    );
    const { signer, signatures } = countingSigner();
    const onResult = jest.fn();

    const error = await Account.deriveFromEthSigner({
      config: configFactory(),
      signer,
      apiUrl,
      determinismGuard: { onResult },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DeterminismGuardError);
    expect((error as DeterminismGuardError).code).toBe('key_mismatch');
    expect(signatures()).toBe(1);
    expect(onResult).not.toHaveBeenCalled();
  });

  test('wallet already linked to a Stark account (400): key_mismatch', async () => {
    mockOnboarding(notFound, {
      status: 400,
      body: { message: 'wallet already linked' },
    });
    const { signer, signatures } = countingSigner();

    await expect(
      Account.deriveFromEthSigner({
        config: configFactory(),
        signer,
        apiUrl,
        determinismGuard: true,
      }),
    ).rejects.toMatchObject({ code: 'key_mismatch' });
    expect(signatures()).toBe(1);
  });

  test('new account: two matching signatures, result exposed', async () => {
    const fetchMock = mockOnboarding(notFound);
    const { signer, signatures } = countingSigner();
    const results: DeterminismGuardResult[] = [];

    const credentials = await Account.deriveFromEthSigner({
      config: configFactory(),
      signer,
      apiUrl,
      determinismGuard: { onResult: (r) => results.push(r) },
    });

    expect(signatures()).toBe(2);
    expect(credentials.address).toBe(computedAddress);
    expect(lookups(fetchMock).at(-1)).toEqual({
      account_signer_type: 'eip191',
      eth_address: wallet.address,
    });
    expect(results).toMatchObject([
      { kind: 'new', signatures: 2, walletAddress },
    ]);
  });

  test('new account with a non-deterministic wallet: non_deterministic', async () => {
    mockOnboarding(notFound);
    let counter = 0;
    const signer: EthereumSigner = {
      signTypedData: async () =>
        `0x${(++counter).toString(16).padStart(130, '0')}`,
      getAddress: async () => wallet.address,
      getCode: async () => EOA_CODE,
    };

    await expect(
      Account.deriveFromEthSigner({
        config: configFactory(),
        signer,
        apiUrl,
        determinismGuard: true,
      }),
    ).rejects.toMatchObject({
      code: 'non_deterministic',
      message: expect.stringContaining('deterministic signing'),
    });
  });

  test.each([
    ['key lookup', { status: 500, body: {} }, walletFree],
    ['wallet lookup', notFound, { status: 503, body: {} }],
  ])('a failed %s fails closed', async (_name, byKey, byWallet) => {
    mockOnboarding(byKey, byWallet);
    const { signer } = countingSigner();

    await expect(
      Account.deriveFromEthSigner({
        config: configFactory(),
        signer,
        apiUrl,
        determinismGuard: true,
      }),
    ).rejects.toMatchObject({ code: 'lookup_failed' });
  });

  test('contract wallet: refused before any signature or lookup', async () => {
    const fetchMock = mockOnboarding(found);
    const { signer, signatures } = countingSigner(CONTRACT_CODE);

    await expect(
      Account.deriveFromEthSigner({
        config: configFactory(),
        signer,
        apiUrl,
        determinismGuard: true,
      }),
    ).rejects.toMatchObject({ code: 'contract_wallet' });
    expect(signatures()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('contract code on any caller-supplied provider refuses the wallet', async () => {
    mockOnboarding(found);
    const { signer } = countingSigner(EOA_CODE);
    const codeProviders: EthCodeProvider[] = [
      { getCode: async () => EOA_CODE },
      { getCode: async () => CONTRACT_CODE },
    ];

    await expect(
      Account.deriveFromEthSigner({
        config: configFactory(),
        signer,
        apiUrl,
        determinismGuard: { codeProviders },
      }),
    ).rejects.toMatchObject({ code: 'contract_wallet' });
  });

  test('EIP-7702 delegated EOA is allowed', async () => {
    mockOnboarding(found);
    const { signer, signatures } = countingSigner(DELEGATED_CODE);

    const credentials = await Account.deriveFromEthSigner({
      config: configFactory(),
      signer,
      apiUrl,
      determinismGuard: true,
    });

    expect(credentials.address).toBe(accountAddress);
    expect(signatures()).toBe(1);
  });

  test('a failing code lookup counts as no code', async () => {
    mockOnboarding(found);
    const { signer } = countingSigner(new Error('rpc down'));

    await expect(
      Account.deriveFromEthSigner({
        config: configFactory(),
        signer,
        apiUrl,
        determinismGuard: true,
      }),
    ).resolves.toMatchObject({ address: accountAddress });
  });

  test('no code provider: invalid_options unless the check is turned off', async () => {
    mockOnboarding(found);
    const signer: EthereumSigner = {
      signTypedData: ethersSignerAdapter(wallet).signTypedData,
      getAddress: async () => wallet.address,
    };

    await expect(
      Account.deriveFromEthSigner({
        config: configFactory(),
        signer,
        apiUrl,
        determinismGuard: true,
      }),
    ).rejects.toMatchObject({ code: 'invalid_options' });

    await expect(
      Account.deriveFromEthSigner({
        config: configFactory(),
        signer,
        apiUrl,
        determinismGuard: { contractCodeCheck: false },
      }),
    ).resolves.toMatchObject({ address: accountAddress });
  });

  test('no wallet address: invalid_options', async () => {
    const fetchMock = mockOnboarding(found);
    const signer: EthereumSigner = {
      signTypedData: ethersSignerAdapter(wallet).signTypedData,
    };

    await expect(
      Account.deriveFromEthSigner({
        config: configFactory(),
        signer,
        apiUrl,
        determinismGuard: { contractCodeCheck: false },
      }),
    ).rejects.toMatchObject({ code: 'invalid_options' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('no API URL: invalid_options', async () => {
    const { signer, signatures } = countingSigner();

    await expect(
      Account.deriveFromEthSigner({
        config: configFactory(),
        signer,
        determinismGuard: true,
      }),
    ).rejects.toMatchObject({ code: 'invalid_options' });
    expect(signatures()).toBe(0);
  });

  test('fromEthSigner passes the guard through', async () => {
    mockOnboarding(found);
    const { signer, signatures } = countingSigner();

    const account = await Account.fromEthSigner({
      provider: createMockProvider(),
      config: configFactory(),
      signer,
      apiUrl,
      determinismGuard: true,
    });

    expect(account.address).toBe(accountAddress);
    expect(signatures()).toBe(1);
  });
});

describe('deriveFromEthSigner without the guard (unchanged)', () => {
  test.each([undefined, false])(
    'determinismGuard %s: two signatures, local address, no API call',
    async (determinismGuard) => {
      const fetchMock = mockOnboarding(found);
      const { signer, signatures } = countingSigner(CONTRACT_CODE);

      const credentials = await Account.deriveFromEthSigner({
        config: configFactory(),
        signer,
        determinismGuard,
      });

      expect(signatures()).toBe(2);
      expect(credentials.address).toBe(
        '0x72c394aaa3fae59ad7749c856dc18e2a289e83885b80c0da7731290a9163e17',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe('isContractCode', () => {
  test.each([
    [undefined, false],
    ['', false],
    ['0x', false],
    [DELEGATED_CODE, false],
    [DELEGATED_CODE.toUpperCase().replace('0X', '0x'), false],
    [CONTRACT_CODE, true],
  ])('%s -> %s', (code, expected) => {
    expect(isContractCode(code)).toBe(expected);
  });
});

describe('hasContractCode', () => {
  test('a provider that never answers counts as no code', async () => {
    const hanging: EthCodeProvider = {
      getCode: async () => await new Promise<string>(() => {}),
    };
    await expect(hasContractCode(walletAddress, [hanging], 10)).resolves.toBe(
      false,
    );
  });
});

describe('publicKeyForms', () => {
  test('a short key is looked up unpadded, then padded to 32 bytes', () => {
    expect(publicKeyForms('0x00ABC')).toEqual([
      '0xABC',
      `0x${'ABC'.padStart(64, '0')}`,
    ]);
  });

  test('a full-length key is looked up once', () => {
    const key = `0x${'1'.repeat(64)}` as const;
    expect(publicKeyForms(key)).toEqual([key]);
  });
});

describe('ethersSignerAdapter', () => {
  test('exposes the address, and the code reader only with a provider', async () => {
    const bare = ethersSignerAdapter(wallet);
    expect(await bare.getAddress?.()).toBe(wallet.address);
    expect(bare.getCode).toBeUndefined();

    const provider = {
      getCode: jest.fn(async () => DELEGATED_CODE),
    } as unknown as ethers.Provider;
    const connected = ethersSignerAdapter(wallet.connect(provider));
    expect(await connected.getCode?.(walletAddress)).toBe(DELEGATED_CODE);
  });
});
