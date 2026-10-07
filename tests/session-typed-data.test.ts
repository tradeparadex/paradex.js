import { ethers } from 'ethers';
import * as Starknet from 'starknet';

import type { Eip712TypedData } from '../src/eip712';
import {
  assertGrantActive,
  buildPasskeyGrantEip712,
  buildPasskeyGrantSnip12,
  buildSessionGrantEip712,
  buildSessionGrantSnip12,
  buildSessionMintEip712,
  buildSessionMintSnip12,
  canonicalFelt,
  createSessionGrant,
  generateSessionNonce,
  grantAccounts,
  hashEip712,
  hashSnip12,
  maxSessionTtl,
  SESSION_TTL,
  SessionGrantError,
  validatePasskeyGrant,
  validateSessionGrant,
  validateSessionMint,
  type CreateSessionGrantParams,
  type PasskeyGrant,
  type SessionGrant,
  type SessionMint,
} from '../src/session-typed-data';

import vectorFile from './fixtures/session-typed-data-vectors.json';

interface Vector {
  readonly name: string;
  readonly primaryType: 'SessionGrant' | 'PasskeyGrant' | 'SessionMint';
  readonly message: unknown;
  readonly eip712: ReadonlyArray<{
    readonly signatureChainId: number;
    readonly digest: string;
  }>;
  readonly snip12: {
    readonly account: string;
    readonly messageHash: string;
  } | null;
}

const vectors = vectorFile.vectors as unknown as Vector[];

function vectorOf(predicate: (v: Vector) => boolean): Vector {
  const found = vectors.find(predicate);
  if (found == null) throw new Error('vector not found');
  return found;
}

function buildEip712(v: Vector, chainId: number): Eip712TypedData {
  switch (v.primaryType) {
    case 'SessionGrant':
      return buildSessionGrantEip712(v.message as SessionGrant, chainId);
    case 'PasskeyGrant':
      return buildPasskeyGrantEip712(v.message as PasskeyGrant, chainId);
    case 'SessionMint':
      return buildSessionMintEip712(v.message as SessionMint, chainId);
  }
}

function buildSnip12(v: Vector): Starknet.TypedData {
  switch (v.primaryType) {
    case 'SessionGrant':
      return buildSessionGrantSnip12(v.message as SessionGrant);
    case 'PasskeyGrant':
      return buildPasskeyGrantSnip12(v.message as PasskeyGrant);
    case 'SessionMint':
      return buildSessionMintSnip12(v.message as SessionMint);
  }
}

const ACCOUNT =
  '0x5f8c4f0b9e6a1c7d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f';
const SESSION_KEY =
  '0x3a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8';
const BUILDER =
  '0x2b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cf';
const T0 = 1760000000;
const FULL_LIMITS = {
  maxOrderNotional: '25000',
  maxOpenNotional: '100000',
  dailyNotional: '500000',
  maxLoss: '5000',
  maxLeverage: '10',
  markets: ['BTC-USD-PERP'],
};

function params(
  overrides: Partial<CreateSessionGrantParams> = {},
): CreateSessionGrantParams {
  return {
    paradexChain: 'PRIVATE_SN_PARACLEAR_MAINNET',
    environment: 'mainnet',
    account: ACCOUNT,
    sessionKey: SESSION_KEY,
    nonce: '0x1',
    issuedAt: T0,
    ...overrides,
  };
}

function grant(overrides: Partial<SessionGrant> = {}): SessionGrant {
  return { ...createSessionGrant(params()), ...overrides };
}

function expectCode(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(SessionGrantError);
  expect((caught as SessionGrantError).code).toBe(code);
}

describe('golden vectors', () => {
  test.each(vectors.map((v) => [v.name, v]))(
    '%s: EIP-712 digest is stable and matches ethers',
    (_name, v) => {
      for (const { signatureChainId, digest } of v.eip712) {
        const td = buildEip712(v, signatureChainId);
        expect(hashEip712(td)).toBe(digest);
        expect(
          ethers.TypedDataEncoder.hash(
            td.domain,
            td.types as Record<string, ethers.TypedDataField[]>,
            td.message,
          ),
        ).toBe(digest);
      }
    },
  );

  test.each(vectors.filter((v) => v.snip12 != null).map((v) => [v.name, v]))(
    '%s: SNIP-12 rev 1 hash is stable',
    (_name, v) => {
      const td = buildSnip12(v);
      expect(hashSnip12(td, v.snip12?.account ?? '')).toBe(
        v.snip12?.messageHash,
      );
    },
  );

  test('the domain separates the wallet chain: same grant, different digest', () => {
    const v = vectorOf((x) => x.eip712.length > 1);
    expect(new Set(v.eip712.map((e) => e.digest)).size).toBe(v.eip712.length);
  });

  test('SNIP-12 grant signed by a Stark key verifies', () => {
    const privateKey = '0x1234567890abcdef';
    const publicKey = Starknet.encode.addHexPrefix(
      Starknet.encode.buf2hex(
        Starknet.ec.starkCurve.getPublicKey(privateKey, false),
      ),
    );
    const td = buildSessionGrantSnip12(grant());
    const hash = hashSnip12(td, ACCOUNT);
    const signature = Starknet.ec.starkCurve.sign(hash, privateKey);
    expect(
      Starknet.typedData.verifyMessage(td, signature, publicKey, ACCOUNT),
    ).toBe(true);
  });

  test('EIP-712 grant signed by a wallet recovers to the wallet', async () => {
    const wallet = ethers.Wallet.createRandom();
    const td = buildSessionGrantEip712(grant(), 42161);
    const sig = await wallet.signTypedData(
      td.domain,
      td.types as Record<string, ethers.TypedDataField[]>,
      td.message,
    );
    expect(ethers.recoverAddress(hashEip712(td), sig)).toBe(wallet.address);
  });
});

describe('createSessionGrant', () => {
  test('defaults: trade only, 7-day browser session, no builder, random nonce', () => {
    const g = createSessionGrant(
      params({ nonce: undefined, issuedAt: undefined }),
    );
    expect(g.scopes).toEqual(['trade']);
    expect(g.expiresAt - g.issuedAt).toBe(SESSION_TTL.browserDefault);
    expect(g.builder).toEqual({
      account: '0x0',
      maxFeeRate: '0',
      expiresAt: 0,
    });
    expect(g.subaccounts).toEqual([]);
    expect(g.label).toBe('');
    expect(g.limits.markets).toEqual([]);
    expect(BigInt(g.nonce)).toBeGreaterThan(0n);
    expect(BigInt(g.nonce)).toBeLessThan(2n ** 128n);
    expect(Math.abs(g.issuedAt - Date.now() / 1000)).toBeLessThan(5);
  });

  test('normalizes addresses and keys to canonical hex', () => {
    const g = createSessionGrant(
      params({
        account: '0x000ABC',
        sessionKey: '0x00Def',
        subaccounts: ['0x0F'],
        nonce: '0x0001',
      }),
    );
    expect(g.account).toBe('0xabc');
    expect(g.sessionKey).toBe('0xdef');
    expect(g.subaccounts).toEqual(['0xf']);
    expect(g.nonce).toBe('0x1');
  });

  test('ttlSeconds and expiresAt set the lifetime', () => {
    expect(createSessionGrant(params({ ttlSeconds: 3600 })).expiresAt).toBe(
      T0 + 3600,
    );
    expect(createSessionGrant(params({ expiresAt: T0 + 60 })).expiresAt).toBe(
      T0 + 60,
    );
  });

  test('does not share arrays with the caller', () => {
    const scopes: Array<'trade'> = ['trade'];
    const markets = ['BTC-USD-PERP'];
    const g = createSessionGrant(params({ scopes, limits: { markets } }));
    scopes.push('trade');
    markets.push('ETH-USD-PERP');
    expect(g.scopes).toEqual(['trade']);
    expect(g.limits.markets).toEqual(['BTC-USD-PERP']);
  });

  test('typed data copies the grant', () => {
    const g = grant();
    const td = buildSessionGrantEip712(g, 1);
    expect(td.message).toEqual(g);
    expect(td.message).not.toBe(g);
  });
});

describe('refusals', () => {
  test.each(['withdraw:owner', 'trade:isolated'])(
    'reserved scope %s is refused',
    (scope) => {
      expectCode(
        () => createSessionGrant(params({ scopes: [scope as 'trade'] })),
        'RESERVED_SCOPE',
      );
    },
  );

  test.each([['read'], ['deposit'], ['TRADE'], [5]])(
    'unknown scope %s is refused',
    (scope) => {
      expectCode(
        () => createSessionGrant(params({ scopes: [scope as 'trade'] })),
        scope === 5 ? 'INVALID_FIELD' : 'UNKNOWN_SCOPE',
      );
    },
  );

  test('empty and duplicate scopes are refused', () => {
    expectCode(
      () => createSessionGrant(params({ scopes: [] })),
      'INVALID_FIELD',
    );
    expectCode(
      () => createSessionGrant(params({ scopes: ['trade', 'trade'] })),
      'INVALID_FIELD',
    );
  });

  test('browser sessions last at most 30 days, API sessions 180', () => {
    expectCode(
      () => createSessionGrant(params({ ttlSeconds: 31 * 86400 })),
      'TTL_EXCEEDED',
    );
    expect(() =>
      createSessionGrant(params({ ttlSeconds: 30 * 86400 })),
    ).not.toThrow();
    expect(() =>
      createSessionGrant(
        params({ ttlSeconds: 180 * 86400, sessionType: 'api' }),
      ),
    ).not.toThrow();
    expectCode(
      () =>
        createSessionGrant(
          params({ ttlSeconds: 181 * 86400, sessionType: 'api' }),
        ),
      'TTL_EXCEEDED',
    );
  });

  test.each(['trade:block', 'account:settings'] as const)(
    '%s caps the lifetime at 7 days',
    (scope) => {
      expect(maxSessionTtl(['trade', scope], 'api')).toBe(7 * 86400);
      expectCode(
        () =>
          createSessionGrant(
            params({
              scopes: ['trade', scope],
              ttlSeconds: 7 * 86400 + 1,
              sessionType: 'api',
            }),
          ),
        'TTL_EXCEEDED',
      );
    },
  );

  test('builder grants must state every limit and list markets', () => {
    const builder = { account: BUILDER, maxFeeRate: '0.0005' };
    expect(() =>
      createSessionGrant(params({ builder, limits: FULL_LIMITS })),
    ).not.toThrow();
    expectCode(
      () =>
        createSessionGrant(
          params({ builder, limits: { ...FULL_LIMITS, maxLoss: undefined } }),
        ),
      'BUILDER_LIMITS_REQUIRED',
    );
    expectCode(
      () =>
        createSessionGrant(
          params({ builder, limits: { ...FULL_LIMITS, markets: [] } }),
        ),
      'BUILDER_LIMITS_REQUIRED',
    );
  });

  test('builder fields are checked', () => {
    const limits = FULL_LIMITS;
    expectCode(
      () =>
        createSessionGrant(
          params({
            limits,
            builder: { account: ACCOUNT, maxFeeRate: '0.001' },
          }),
        ),
      'INVALID_FIELD',
    );
    expectCode(
      () =>
        createSessionGrant(
          params({
            limits,
            builder: {
              account: BUILDER,
              maxFeeRate: '0.001',
              expiresAt: T0 + 30 * 86400,
            },
          }),
        ),
      'INVALID_FIELD',
    );
    expectCode(
      () =>
        createSessionGrant(
          params({ limits, builder: { account: BUILDER, maxFeeRate: '5bps' } }),
        ),
      'INVALID_FIELD',
    );
    expectCode(() => {
      validateSessionGrant(
        grant({
          builder: { account: '0x0', maxFeeRate: '0.1', expiresAt: 0 },
        }),
      );
    }, 'INVALID_FIELD');
    expectCode(() => {
      validateSessionGrant({ ...grant(), builder: undefined as never });
    }, 'INVALID_FIELD');
  });

  test('SNIP-12 refuses builder grants (EIP-191 accounts only)', () => {
    const g = createSessionGrant(
      params({
        limits: FULL_LIMITS,
        builder: { account: BUILDER, maxFeeRate: '0.0005' },
      }),
    );
    expect(() => buildSessionGrantEip712(g, 1)).not.toThrow();
    expectCode(() => buildSessionGrantSnip12(g), 'BUILDER_REQUIRES_EIP712');
  });

  test('SNIP-12 strings must be ASCII', () => {
    const g = grant({ label: 'café' });
    expect(() => buildSessionGrantEip712(g, 1)).not.toThrow();
    expectCode(() => buildSessionGrantSnip12(g), 'INVALID_FIELD');
  });

  test.each<[string, Partial<SessionGrant>]>([
    ['uppercase hex', { account: '0xABC' }],
    ['leading zeros', { account: '0x0abc' }],
    ['non-hex account', { account: 'abc' }],
    ['zero account', { account: '0x0' }],
    ['address out of range', { account: `0x${'f'.repeat(63)}` }],
    ['zero session key', { sessionKey: '0x0' }],
    [
      'session key above the field prime',
      { sessionKey: `0x${'f'.repeat(64)}` },
    ],
    ['nonce above 128 bits', { nonce: `0x1${'0'.repeat(32)}` }],
    ['zero nonce', { nonce: '0x0' }],
    ['bad environment', { environment: 'prod' as 'mainnet' }],
    ['long paradexChain', { paradexChain: 'X'.repeat(32) }],
    ['empty paradexChain', { paradexChain: '' }],
    ['subaccount equals account', { subaccounts: [ACCOUNT] }],
    ['duplicate subaccounts', { subaccounts: ['0x11', '0x11'] }],
    ['subaccounts not an array', { subaccounts: '0x11' as never }],
    ['expiresAt before issuedAt', { expiresAt: T0 }],
    ['fractional timestamp', { issuedAt: T0 + 0.5 }],
    ['negative timestamp', { issuedAt: -1 }],
    ['label missing', { label: undefined as never }],
  ])('%s is refused', (_name, overrides) => {
    expectCode(() => {
      validateSessionGrant(grant(overrides));
    }, 'INVALID_FIELD');
  });

  test.each(['01', '1.50', '1.', '.5', '-1', '1e3', ' 1', 'NaN'])(
    'limit %p is not a canonical decimal',
    (value) => {
      expectCode(() => {
        validateSessionGrant(
          grant({ limits: { ...FULL_LIMITS, maxOrderNotional: value } }),
        );
      }, 'INVALID_FIELD');
    },
  );

  test.each([['btc-usd-perp'], ['BTC USD'], [''], ['A'.repeat(32)], [7]])(
    'market %p is refused',
    (market) => {
      expectCode(() => {
        validateSessionGrant(
          grant({ limits: { ...FULL_LIMITS, markets: [market as string] } }),
        );
      }, 'INVALID_FIELD');
    },
  );

  test('duplicate markets and missing limits are refused', () => {
    expectCode(() => {
      validateSessionGrant(
        grant({
          limits: {
            ...FULL_LIMITS,
            markets: ['BTC-USD-PERP', 'BTC-USD-PERP'],
          },
        }),
      );
    }, 'INVALID_FIELD');
    expectCode(() => {
      validateSessionGrant(grant({ limits: undefined as never }));
    }, 'INVALID_FIELD');
    expectCode(() => {
      validateSessionGrant(
        grant({ limits: { ...FULL_LIMITS, markets: 'BTC' as never } }),
      );
    }, 'INVALID_FIELD');
  });

  test.each([0, -1, 'abc', 1.5])('signature chain id %p is refused', (id) => {
    expectCode(
      () => buildSessionGrantEip712(grant(), id as number),
      'INVALID_FIELD',
    );
  });

  test('chain id may be a decimal or hex string', () => {
    expect(buildSessionGrantEip712(grant(), '0xa4b1').domain.chainId).toBe(
      42161,
    );
    expect(buildSessionGrantEip712(grant(), 10n).domain.chainId).toBe(10);
  });
});

describe('expiry and accounts', () => {
  test('assertGrantActive refuses expired grants and future issuedAt', () => {
    const g = grant();
    expect(() => {
      assertGrantActive(g, T0 + 1);
    }).not.toThrow();
    expectCode(() => {
      assertGrantActive(g, g.expiresAt);
    }, 'GRANT_EXPIRED');
    expectCode(() => {
      assertGrantActive(g, T0 - 301);
    }, 'INVALID_FIELD');
  });

  test('grantAccounts lists the anchor first', () => {
    expect(grantAccounts(grant({ subaccounts: ['0x11', '0x12'] }))).toEqual([
      ACCOUNT,
      '0x11',
      '0x12',
    ]);
  });

  test('canonicalFelt and generateSessionNonce', () => {
    expect(canonicalFelt(0n)).toBe('0x0');
    expect(canonicalFelt('0x00A')).toBe('0xa');
    expectCode(() => canonicalFelt(-1n), 'INVALID_FIELD');
    const nonces = new Set(
      Array.from({ length: 20 }, () => generateSessionNonce()),
    );
    expect(nonces.size).toBe(20);
    for (const n of nonces) expect(n).toMatch(/^0x[1-9a-f][0-9a-f]{0,31}$/);
  });

  test('a zero random draw still yields a valid nonce', () => {
    const spy = jest
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation((a) => a);
    try {
      expect(generateSessionNonce()).toBe('0x1');
    } finally {
      spy.mockRestore();
    }
  });
});

const passkeyGrant = (): PasskeyGrant =>
  structuredClone(
    vectorOf((v) => v.primaryType === 'PasskeyGrant').message as PasskeyGrant,
  );
const mint = (): SessionMint =>
  structuredClone(
    vectorOf((v) => v.primaryType === 'SessionMint').message as SessionMint,
  );

describe('PasskeyGrant', () => {
  test('the vector validates', () => {
    expect(() => {
      validatePasskeyGrant(passkeyGrant());
    }).not.toThrow();
  });

  test('future sub-accounts only for first-party passkeys', () => {
    const g = { ...passkeyGrant(), builderAccount: BUILDER };
    expectCode(() => {
      validatePasskeyGrant(g);
    }, 'INVALID_FIELD');
    expect(() => {
      validatePasskeyGrant({
        ...g,
        ceiling: { ...g.ceiling, includeFutureSubaccounts: false },
      });
    }).not.toThrow();
  });

  test.each<[string, (g: PasskeyGrant) => PasskeyGrant, string]>([
    [
      'more than 5 concurrent sessions',
      (g) => ({ ...g, ceiling: { ...g.ceiling, maxConcurrentSessions: 6 } }),
      'INVALID_FIELD',
    ],
    [
      'zero concurrent sessions',
      (g) => ({ ...g, ceiling: { ...g.ceiling, maxConcurrentSessions: 0 } }),
      'INVALID_FIELD',
    ],
    [
      'session TTL above 7 days',
      (g) => ({
        ...g,
        ceiling: { ...g.ceiling, maxSessionTtl: 7 * 86400 + 1 },
      }),
      'TTL_EXCEEDED',
    ],
    [
      'zero session TTL',
      (g) => ({ ...g, ceiling: { ...g.ceiling, maxSessionTtl: 0 } }),
      'TTL_EXCEEDED',
    ],
    [
      'passkey expiry above 180 days',
      (g) => ({ ...g, expiresAt: g.issuedAt + 181 * 86400 }),
      'TTL_EXCEEDED',
    ],
    [
      'expiry before issue',
      (g) => ({ ...g, expiresAt: g.issuedAt }),
      'INVALID_FIELD',
    ],
    [
      'reserved ceiling scope',
      (g) => ({
        ...g,
        ceiling: { ...g.ceiling, scopes: ['withdraw:owner' as 'trade'] },
      }),
      'RESERVED_SCOPE',
    ],
    [
      'short pubkey',
      (g) => ({ ...g, passkey: { ...g.passkey, pubkeyX: '0x1234' } }),
      'INVALID_FIELD',
    ],
    [
      'uppercase pubkeyY',
      (g) => ({
        ...g,
        passkey: { ...g.passkey, pubkeyY: `0x${'A0'.repeat(32)}` },
      }),
      'INVALID_FIELD',
    ],
    [
      'non-base64url credential id',
      (g) => ({ ...g, passkey: { ...g.passkey, credentialId: 'a+b/c=' } }),
      'INVALID_FIELD',
    ],
    [
      'missing rpId',
      (g) => ({ ...g, passkey: { ...g.passkey, rpId: '' } }),
      'INVALID_FIELD',
    ],
    [
      'missing passkey label',
      (g) => ({ ...g, passkey: { ...g.passkey, label: undefined as never } }),
      'INVALID_FIELD',
    ],
    [
      'missing passkey',
      (g) => ({ ...g, passkey: undefined as never }),
      'INVALID_FIELD',
    ],
    [
      'missing ceiling',
      (g) => ({ ...g, ceiling: undefined as never }),
      'INVALID_FIELD',
    ],
    [
      'non-boolean includeFutureSubaccounts',
      (g) => ({
        ...g,
        ceiling: { ...g.ceiling, includeFutureSubaccounts: 1 as never },
      }),
      'INVALID_FIELD',
    ],
  ])('%s is refused', (_name, mutate, code) => {
    expectCode(() => {
      validatePasskeyGrant(mutate(passkeyGrant()));
    }, code);
  });
});

describe('SessionMint', () => {
  test('the vector validates', () => {
    expect(() => {
      validateSessionMint(mint());
    }).not.toThrow();
  });

  test.each<[string, Partial<SessionMint>, string]>([
    ['bad credential id', { credentialId: 'a b' }, 'INVALID_FIELD'],
    ['zero session key', { sessionKey: '0x0' }, 'INVALID_FIELD'],
    [
      'reserved scope',
      { scopes: ['trade:isolated' as 'trade'] },
      'RESERVED_SCOPE',
    ],
    ['bad expiry', { expiresAt: -5 }, 'INVALID_FIELD'],
    ['anchor in subaccounts', { subaccounts: [ACCOUNT] }, 'INVALID_FIELD'],
  ])('%s is refused', (_name, overrides, code) => {
    expectCode(() => {
      validateSessionMint({ ...mint(), ...overrides });
    }, code);
  });
});
