import { ethers } from 'ethers';
import * as Starknet from 'starknet';

import { hashDomain, hashStruct, type Eip712TypedData } from '../src/eip712';
import {
  ALL_LIMITS,
  assertGrantActive,
  assertMintWithinCeiling,
  buildPasskeyGrantEip712,
  buildPasskeyGrantSnip12,
  buildSessionGrantEip712,
  buildSessionGrantSnip12,
  buildSessionMintEip712,
  buildSessionMintSnip12,
  canonicalFelt,
  createSessionGrant,
  DEFAULT_ENFORCED_LIMITS,
  DEFAULT_LIMIT_CAPS,
  generateSessionNonce,
  grantAccounts,
  hashEip712,
  hashSnip12,
  lossSummary,
  marketCovers,
  maxSessionTtl,
  SESSION_TTL,
  SessionGrantError,
  sessionMintChallenge,
  summarizeGrant,
  UNCAPPED_LIMITS,
  validatePasskeyGrant,
  validateSessionGrant,
  validateSessionMint,
  type CreateSessionGrantParams,
  type Limits,
  type PasskeyGrant,
  type SessionGrant,
  type SessionMint,
} from '../src/session-typed-data';

import vectorFile from './fixtures/session-typed-data-vectors.json';

const bytesToHex = (b: Uint8Array): string =>
  `0x${Buffer.from(b).toString('hex')}`;

interface Vector {
  readonly name: string;
  readonly primaryType: 'SessionGrant' | 'PasskeyGrant' | 'SessionMint';
  readonly signer: 'eip191' | 'stark' | 'passkey';
  readonly message: { readonly account: string };
  readonly eip712: {
    readonly signatureChainId: number;
    readonly typedData: {
      readonly types: Record<string, unknown>;
      readonly domain: unknown;
    };
    readonly domainSeparator: string;
    readonly structHash: string;
    readonly digest: string;
    readonly signature?: string;
  };
  readonly snip12: {
    readonly typedData: { readonly types: Record<string, unknown> };
    readonly messageHash: string;
    readonly signature?: readonly string[];
  };
  readonly mintChallenge?: string;
}

const vectors = vectorFile.vectors as unknown as Vector[];
const testKeys = vectorFile.keys;

function vectorOf(predicate: (v: Vector) => boolean): Vector {
  const found = vectors.find(predicate);
  if (found == null) throw new Error('vector not found');
  return found;
}

function buildEip712(v: Vector, chainId: number): Eip712TypedData {
  switch (v.primaryType) {
    case 'SessionGrant':
      return buildSessionGrantEip712(
        v.message as SessionGrant,
        chainId,
        ENFORCED,
      );
    case 'PasskeyGrant':
      return buildPasskeyGrantEip712(
        v.message as PasskeyGrant,
        chainId,
        ENFORCED,
      );
    case 'SessionMint':
      return buildSessionMintEip712(
        v.message as SessionMint,
        chainId,
        ENFORCED,
      );
  }
}

function buildSnip12(v: Vector): Starknet.TypedData {
  switch (v.primaryType) {
    case 'SessionGrant':
      return buildSessionGrantSnip12(v.message as SessionGrant, ENFORCED);
    case 'PasskeyGrant':
      return buildPasskeyGrantSnip12(v.message as PasskeyGrant, ENFORCED);
    case 'SessionMint':
      return buildSessionMintSnip12(v.message as SessionMint, ENFORCED);
  }
}

const ACCOUNT =
  '0x5f8c4f0b9e6a1c7d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f';
const SESSION_KEY =
  '0x3a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8';
const BUILDER =
  '0x2b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cf';
const T0 = 1760000000;
/** Tests below use numeric limits, valid once the server enforces them. */
const ENFORCED = { enforcedLimits: ALL_LIMITS };

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
    limits: FULL_LIMITS,
    ...ENFORCED,
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
    '%s: EIP-712 types, domain separator, struct hash and digest',
    (_name, v) => {
      const td = buildEip712(v, v.eip712.signatureChainId);
      const { EIP712Domain: _domain, ...types } = v.eip712.typedData.types;
      expect(td.types).toEqual(types);
      expect(td.domain).toEqual(v.eip712.typedData.domain);
      expect(bytesToHex(hashDomain(td.domain))).toBe(v.eip712.domainSeparator);
      expect(bytesToHex(hashStruct(td.primaryType, td.message, td.types))).toBe(
        v.eip712.structHash,
      );
      expect(hashEip712(td)).toBe(v.eip712.digest);
      expect(
        ethers.TypedDataEncoder.hash(
          td.domain,
          td.types as Record<string, ethers.TypedDataField[]>,
          td.message,
        ),
      ).toBe(v.eip712.digest);
      if (v.eip712.signature != null) {
        expect(ethers.recoverAddress(v.eip712.digest, v.eip712.signature)).toBe(
          testKeys.evmAddress,
        );
      }
    },
  );

  test.each(
    vectors
      .filter(
        (v) =>
          v.primaryType !== 'SessionGrant' ||
          (v.message as SessionGrant).builder.account === '0x0',
      )
      .map((v) => [v.name, v]),
  )('%s: SNIP-12 rev 1 types and message hash', (_name, v) => {
    const td = buildSnip12(v);
    expect(td.types).toEqual(v.snip12.typedData.types);
    const hash = hashSnip12(td, v.message.account);
    expect(BigInt(hash)).toBe(BigInt(v.snip12.messageHash));
    if (v.snip12.signature != null) {
      expect(
        Starknet.typedData.verifyMessage(
          td,
          v.snip12.signature as string[],
          Starknet.encode.addHexPrefix(
            Starknet.encode.buf2hex(
              Starknet.ec.starkCurve.getPublicKey(
                testKeys.starkPrivateKey,
                false,
              ),
            ),
          ),
          v.message.account,
        ),
      ).toBe(true);
    }
  });

  test.each(
    vectors.filter((v) => v.mintChallenge != null).map((v) => [v.name, v]),
  )('%s: WebAuthn challenge', (_name, v) => {
    expect(
      sessionMintChallenge(v.message as unknown as SessionMint, ENFORCED),
    ).toBe(v.mintChallenge);
  });

  test('builder grants have no SNIP-12 form', () => {
    const v = vectorOf(
      (x) =>
        x.primaryType === 'SessionGrant' &&
        (x.message as SessionGrant).builder.account !== '0x0',
    );
    expectCode(
      () =>
        buildSessionGrantSnip12(v.message as unknown as SessionGrant, ENFORCED),
      'BUILDER_REQUIRES_EIP712',
    );
  });

  test('the wallet chain is part of the digest', () => {
    const g = grant();
    expect(hashEip712(buildSessionGrantEip712(g, 1, ENFORCED))).not.toBe(
      hashEip712(buildSessionGrantEip712(g, 42161, ENFORCED)),
    );
  });

  test('EIP-712 grant signed by a wallet recovers to the wallet', async () => {
    const wallet = ethers.Wallet.createRandom();
    const td = buildSessionGrantEip712(grant(), 42161, ENFORCED);
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
    expect(g.limits).toEqual(FULL_LIMITS);
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
    const g = createSessionGrant(
      params({ scopes, limits: { ...FULL_LIMITS, markets } }),
    );
    scopes.push('trade');
    markets.push('ETH-USD-PERP');
    expect(g.scopes).toEqual(['trade']);
    expect(g.limits.markets).toEqual(['BTC-USD-PERP']);
  });

  test('typed data copies the grant', () => {
    const g = grant();
    const td = buildSessionGrantEip712(g, 1, ENFORCED);
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

  test('builder grants must state every amount; empty markets mean the default', () => {
    const builder = { account: BUILDER, maxFeeRate: '0.0005' };
    expect(() =>
      createSessionGrant(params({ builder, limits: FULL_LIMITS })),
    ).not.toThrow();
    expectCode(
      () =>
        createSessionGrant(
          params({ builder, limits: { ...FULL_LIMITS, maxLoss: 'none' } }),
        ),
      'BUILDER_LIMITS_REQUIRED',
    );
    expect(() =>
      createSessionGrant(
        params({ builder, limits: { ...FULL_LIMITS, maxLeverage: 'none' } }),
      ),
    ).not.toThrow();
  });

  test.each(['trade:block', 'account:settings'] as const)(
    'builder grants cannot include %s',
    (scope) => {
      const builder = { account: BUILDER, maxFeeRate: '0.0005' };
      expectCode(
        () =>
          createSessionGrant(
            params({ builder, limits: FULL_LIMITS, scopes: ['trade', scope] }),
          ),
        'SCOPE_NOT_ALLOWED',
      );
      expect(() =>
        createSessionGrant(params({ scopes: ['trade', scope] })),
      ).not.toThrow();
    },
  );

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
        ENFORCED,
      );
    }, 'INVALID_FIELD');
    expectCode(() => {
      validateSessionGrant(
        { ...grant(), builder: undefined as never },
        ENFORCED,
      );
    }, 'INVALID_FIELD');
  });

  test('SNIP-12 refuses builder grants (EIP-191 accounts only)', () => {
    const g = createSessionGrant(
      params({
        limits: FULL_LIMITS,
        builder: { account: BUILDER, maxFeeRate: '0.0005' },
      }),
    );
    expect(() => buildSessionGrantEip712(g, 1, ENFORCED)).not.toThrow();
    expectCode(
      () => buildSessionGrantSnip12(g, ENFORCED),
      'BUILDER_REQUIRES_EIP712',
    );
  });

  test('SNIP-12 strings must be ASCII', () => {
    const g = grant({ label: 'café' });
    expect(() => buildSessionGrantEip712(g, 1, ENFORCED)).not.toThrow();
    expectCode(() => buildSessionGrantSnip12(g, ENFORCED), 'INVALID_FIELD');
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
    ['bad environment', { environment: 'Main Net' }],
    ['environment with a host', { environment: 'evil.example/x' }],
    ['the config name "prod"', { environment: 'prod' }],
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
      validateSessionGrant(grant(overrides), ENFORCED);
    }, 'INVALID_FIELD');
  });

  test.each(['01', '1.50', '1.', '.5', '-1', '1e3', ' 1', 'NaN'])(
    'limit %p is not a canonical decimal',
    (value) => {
      expectCode(() => {
        validateSessionGrant(
          grant({ limits: { ...FULL_LIMITS, maxOrderNotional: value } }),
          ENFORCED,
        );
      }, 'INVALID_FIELD');
    },
  );

  test.each([['BTC USD'], ['BTC.USD'], [''], ['A'.repeat(32)], [7]])(
    'market %p is refused',
    (market) => {
      expectCode(() => {
        validateSessionGrant(
          grant({ limits: { ...FULL_LIMITS, markets: [market as string] } }),
          ENFORCED,
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
        ENFORCED,
      );
    }, 'INVALID_FIELD');
    expectCode(() => {
      validateSessionGrant(grant({ limits: undefined as never }), ENFORCED);
    }, 'INVALID_FIELD');
    expectCode(() => {
      validateSessionGrant(
        grant({ limits: { ...FULL_LIMITS, markets: 'BTC' as never } }),
        ENFORCED,
      );
    }, 'INVALID_FIELD');
  });

  test.each([0, -1, 'abc', 1.5])('signature chain id %p is refused', (id) => {
    expectCode(
      () => buildSessionGrantEip712(grant(), id as number, ENFORCED),
      'INVALID_FIELD',
    );
  });

  test('chain id may be a decimal or hex string', () => {
    expect(
      buildSessionGrantEip712(grant(), '0xa4b1', ENFORCED).domain.chainId,
    ).toBe(42161);
    expect(buildSessionGrantEip712(grant(), 10n, ENFORCED).domain.chainId).toBe(
      10,
    );
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
      validatePasskeyGrant(passkeyGrant(), ENFORCED);
    }).not.toThrow();
  });

  test('future sub-accounts only for first-party passkeys', () => {
    const base = passkeyGrant();
    const g = {
      ...base,
      builderAccount: BUILDER,
      ceiling: {
        ...base.ceiling,
        // Builder passkeys need a numeric loss cap.
        limits: { ...base.ceiling.limits, maxLoss: '1000' },
        includeFutureSubaccounts: true,
      },
    };
    expectCode(() => {
      validatePasskeyGrant(g, ENFORCED);
    }, 'INVALID_FIELD');
    expect(() => {
      validatePasskeyGrant(
        {
          ...g,
          ceiling: { ...g.ceiling, includeFutureSubaccounts: false },
        },
        ENFORCED,
      );
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
      validatePasskeyGrant(mutate(passkeyGrant()), ENFORCED);
    }, code);
  });
});

describe('SessionMint', () => {
  test('the vector validates', () => {
    expect(() => {
      validateSessionMint(mint(), ENFORCED);
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
    ['anchor in subaccounts', { subaccounts: ['ANCHOR'] }, 'INVALID_FIELD'],
  ])('%s is refused', (_name, overrides, code) => {
    const m = mint();
    const subaccounts = overrides.subaccounts?.map((a) =>
      a === 'ANCHOR' ? m.account : a,
    );
    expectCode(() => {
      validateSessionMint(
        {
          ...m,
          ...overrides,
          ...(subaccounts != null ? { subaccounts } : {}),
        },
        ENFORCED,
      );
    }, code);
  });
});

describe('assertMintWithinCeiling', () => {
  const byName = <T>(name: string): T =>
    structuredClone(vectorOf((v) => v.name === name).message) as unknown as T;
  const pair = (): { mint: SessionMint; grant: PasskeyGrant; now: number } => {
    const mint = byName<SessionMint>('session-mint-builder-limits');
    return {
      mint,
      grant: byName<PasskeyGrant>('passkey-grant-builder'),
      now: mint.expiresAt - 60,
    };
  };
  const check =
    (mint: SessionMint, grant: PasskeyGrant, now: number) => (): void => {
      assertMintWithinCeiling(mint, grant, now, ENFORCED);
    };
  const withLimits = (
    mint: SessionMint,
    limits: Partial<Limits>,
  ): SessionMint => ({
    ...mint,
    limits: { ...mint.limits, ...limits },
  });

  test.each([
    ['session-mint-first-party', 'passkey-grant-first-party'],
    ['session-mint-builder-limits', 'passkey-grant-builder'],
    ['session-mint-subaccount', 'passkey-grant-stark-owner-subaccounts'],
  ])('vector %s fits %s', (mintName, grantName) => {
    const mint = byName<SessionMint>(mintName);
    const grant = byName<PasskeyGrant>(grantName);
    expect(check(mint, grant, mint.expiresAt - 60)).not.toThrow();
  });

  test('under a numeric ceiling a limit must be numeric and at or below it', () => {
    const { mint, grant, now } = pair();
    expect(
      check(
        withLimits(mint, { maxLoss: grant.ceiling.limits.maxLoss }),
        grant,
        now,
      ),
    ).not.toThrow();
    expectCode(
      check(withLimits(mint, { maxLoss: '5000.01' }), grant, now),
      'EXCEEDS_CEILING',
    );
    expectCode(
      check(withLimits(mint, { maxLoss: 'none' }), grant, now),
      'EXCEEDS_CEILING',
    );
  });

  test('under a "none" ceiling anything goes', () => {
    const { mint, grant, now } = pair();
    // The builder ceiling leaves maxLeverage uncapped.
    expect(grant.ceiling.limits.maxLeverage).toBe('none');
    for (const maxLeverage of ['1', '100', 'none']) {
      expect(
        check(withLimits(mint, { maxLeverage }), grant, now),
      ).not.toThrow();
    }
  });

  test('markets: within a listed ceiling, anything under ["*"]', () => {
    const { mint, grant, now } = pair();
    expect(
      check(withLimits(mint, { markets: ['ETH-USD-PERP'] }), grant, now),
    ).not.toThrow();
    expectCode(
      check(withLimits(mint, { markets: ['SOL-USD-PERP'] }), grant, now),
      'EXCEEDS_CEILING',
    );
    expectCode(
      check(withLimits(mint, { markets: ['*'] }), grant, now),
      'EXCEEDS_CEILING',
    );
    const open = {
      ...grant,
      ceiling: {
        ...grant.ceiling,
        limits: { ...grant.ceiling.limits, markets: ['*'] },
      },
    };
    for (const markets of [['SOL-USD-PERP'], ['*']]) {
      expect(check(withLimits(mint, { markets }), open, now)).not.toThrow();
    }
  });

  test('a mint must state every limit', () => {
    const { mint, grant, now } = pair();
    expectCode(
      check(withLimits(mint, { dailyNotional: '' }), grant, now),
      'INVALID_FIELD',
    );
    expectCode(
      check(withLimits(mint, { markets: [] }), grant, now),
      'INVALID_FIELD',
    );
  });

  test('scopes, sub-accounts, binding and expiry', () => {
    const { mint, grant, now } = pair();
    expectCode(
      check({ ...mint, scopes: ['trade', 'trade:rfq'] }, grant, now),
      'EXCEEDS_CEILING',
    );
    expectCode(
      check({ ...mint, subaccounts: ['0x99'] }, grant, now),
      'EXCEEDS_CEILING',
    );
    expect(
      check(
        { ...mint, subaccounts: ['0x99'] },
        {
          ...grant,
          builderAccount: '0x0',
          ceiling: { ...grant.ceiling, includeFutureSubaccounts: true },
        },
        now,
      ),
    ).not.toThrow();
    expectCode(
      check({ ...mint, account: '0x99' }, grant, now),
      'EXCEEDS_CEILING',
    );
    expectCode(
      check({ ...mint, credentialId: 'other' }, grant, now),
      'EXCEEDS_CEILING',
    );
    expectCode(
      check({ ...mint, environment: 'testnet' }, grant, now),
      'ENVIRONMENT_MISMATCH',
    );
    expectCode(
      check(mint, grant, mint.expiresAt - grant.ceiling.maxSessionTtl - 1),
      'EXCEEDS_CEILING',
    );
  });
});

describe('market names', () => {
  test.each(['0X1-USD-PERP', '0B101', '0O17', '0x1'])(
    '%p could hash like a number and is refused',
    (market) => {
      expectCode(() => {
        validateSessionGrant(
          grant({ limits: { ...FULL_LIMITS, markets: [market] } }),
          ENFORCED,
        );
      }, 'INVALID_FIELD');
    },
  );

  test('other leading digits are fine', () => {
    expect(() => {
      validateSessionGrant(
        grant({
          limits: {
            ...FULL_LIMITS,
            markets: ['0G-USD-PERP', '1INCH-USD-PERP'],
          },
        }),
        ENFORCED,
      );
    }).not.toThrow();
  });
});

describe('stated limits', () => {
  test.each([
    ['empty', ''],
    ['zero', '0'],
    ['negative', '-1'],
    ['a word other than none', 'unlimited'],
    ['upper-case NONE', 'NONE'],
  ])('a limit that is %s is refused', (_name, value) => {
    expectCode(
      () =>
        createSessionGrant(
          params({ limits: { ...FULL_LIMITS, maxOpenNotional: value } }),
        ),
      'INVALID_FIELD',
    );
  });

  test('a missing limit is refused', () => {
    const { dailyNotional: _drop, ...rest } = FULL_LIMITS;
    expectCode(
      () => createSessionGrant(params({ limits: rest as unknown as Limits })),
      'INVALID_FIELD',
    );
  });

  test('"none" means no cap for any limit', () => {
    const g = createSessionGrant(
      params({
        limits: {
          maxOrderNotional: 'none',
          maxOpenNotional: 'none',
          dailyNotional: 'none',
          maxLoss: 'none',
          maxLeverage: 'none',
          markets: ['*'],
        },
      }),
    );
    expect(g.limits.maxLoss).toBe('none');
  });

  test('markets: a list or ["*"], never empty, "*" alone', () => {
    for (const markets of [[], ['*', 'BTC-USD-PERP']]) {
      expectCode(
        () =>
          createSessionGrant(params({ limits: { ...FULL_LIMITS, markets } })),
        'INVALID_FIELD',
      );
    }
    for (const markets of [['*'], ['*-USD-PERP'], ['BTC-USD-PERP']]) {
      expect(() =>
        createSessionGrant(params({ limits: { ...FULL_LIMITS, markets } })),
      ).not.toThrow();
    }
  });

  test('passkey ceilings and mints follow the same rules', () => {
    const grant = passkeyGrant();
    expectCode(() => {
      validatePasskeyGrant(
        {
          ...grant,
          ceiling: {
            ...grant.ceiling,
            limits: { ...grant.ceiling.limits, maxLoss: '' },
          },
        },
        ENFORCED,
      );
    }, 'INVALID_FIELD');
    expectCode(() => {
      validateSessionMint(
        {
          ...mint(),
          limits: { ...mint().limits, markets: [] },
        },
        ENFORCED,
      );
    }, 'INVALID_FIELD');
  });
});

describe('limit caps', () => {
  test('there are no caps by default', () => {
    expect(DEFAULT_LIMIT_CAPS).toEqual({});
    expect(() =>
      createSessionGrant(
        params({ limits: { ...FULL_LIMITS, maxOrderNotional: '9000000' } }),
      ),
    ).not.toThrow();
  });

  test('a configured cap refuses higher values and "none", naming the limit', () => {
    const limitCaps = { maxOrderNotional: '250000' };
    expect(() =>
      createSessionGrant(
        params({
          limits: { ...FULL_LIMITS, maxOrderNotional: '250000' },
          limitCaps,
        }),
      ),
    ).not.toThrow();
    for (const value of ['250000.01', 'none']) {
      let error: unknown;
      try {
        createSessionGrant(
          params({
            limits: { ...FULL_LIMITS, maxOrderNotional: value },
            limitCaps,
          }),
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(SessionGrantError);
      expect((error as SessionGrantError).code).toBe('LIMIT_INVALID');
      expect((error as Error).message).toMatch(/maxOrderNotional/);
    }
    // Limits without a cap stay uncapped.
    expect(() =>
      createSessionGrant(
        params({
          limits: { ...FULL_LIMITS, dailyNotional: '1000000000' },
          limitCaps,
        }),
      ),
    ).not.toThrow();
  });

  test('typed-data builders apply the caps they are given', () => {
    const g = createSessionGrant(
      params({ limits: { ...FULL_LIMITS, maxOrderNotional: '400000' } }),
    );
    const limitCaps = { maxOrderNotional: '250000' };
    expect(() => buildSessionGrantEip712(g, 1, ENFORCED)).not.toThrow();
    expectCode(
      () => buildSessionGrantEip712(g, 1, { ...ENFORCED, limitCaps }),
      'LIMIT_INVALID',
    );
    expectCode(
      () => buildSessionGrantSnip12(g, { ...ENFORCED, limitCaps }),
      'LIMIT_INVALID',
    );
  });

  test('passkey ceilings and mints are capped too', () => {
    const limitCaps = { maxLoss: '1000' };
    expectCode(() => {
      validatePasskeyGrant(passkeyGrant(), { ...ENFORCED, limitCaps });
    }, 'LIMIT_INVALID');
    expectCode(
      () =>
        buildPasskeyGrantEip712(passkeyGrant(), 1, { ...ENFORCED, limitCaps }),
      'LIMIT_INVALID',
    );
    const overMint = {
      ...mint(),
      limits: { ...mint().limits, maxLoss: '1000.5' },
    };
    expectCode(() => {
      validateSessionMint(overMint, { ...ENFORCED, limitCaps });
    }, 'LIMIT_INVALID');
    expectCode(
      () => buildSessionMintSnip12(overMint, { ...ENFORCED, limitCaps }),
      'LIMIT_INVALID',
    );
  });
});

describe('grant summary', () => {
  test('leads with the loss wording', () => {
    expect(lossSummary({ maxLoss: '5000' })).toBe(
      'Cannot withdraw; can lose up to 5000 USD by trading',
    );
    expect(lossSummary({ maxLoss: 'none' })).toBe(
      'Cannot withdraw; trading losses are not capped by this session',
    );
  });

  test('lists scopes, accounts, expiry, limits and the builder fee', () => {
    const g = createSessionGrant(
      params({
        scopes: ['trade', 'trade:rfq'],
        subaccounts: ['0x11'],
        limits: { ...FULL_LIMITS, maxLeverage: 'none' },
        builder: { account: BUILDER, maxFeeRate: '0.0005' },
      }),
    );
    expect(summarizeGrant(g)).toEqual([
      'Cannot withdraw; can lose up to 5000 USD by trading',
      'Scopes: trade, trade:rfq',
      `Accounts: ${ACCOUNT}, 0x11`,
      `Expires: ${new Date((T0 + 7 * 86400) * 1000).toISOString()}`,
      'Max order: 25000 USD',
      'Max open: 100000 USD',
      'Daily volume: 500000 USD',
      'Max leverage: no cap',
      'Markets: BTC-USD-PERP',
      `Builder ${BUILDER} may charge up to 0.0005 per trade`,
    ]);
    const all = createSessionGrant(
      params({ limits: { ...FULL_LIMITS, markets: ['*'] } }),
    );
    expect(summarizeGrant(all)).toContain('Markets: all permitted');
    expect(summarizeGrant(all)).toHaveLength(9);
  });
});

describe('server shape rules', () => {
  test.each([
    '-BTC-USD-PERP',
    '-',
    '123',
    '0xBEEF',
    '0Bfoo',
    '0o7-USD',
    '**',
    '*-*',
    'BTC**-USD',
    '*_*',
  ])('market %p is refused', (market) => {
    expectCode(() => {
      validateSessionGrant(
        grant({ limits: { ...FULL_LIMITS, markets: [market] } }),
        ENFORCED,
      );
    }, 'INVALID_FIELD');
  });

  test.each([
    ['padded zero', { account: '0x00', maxFeeRate: '0', expiresAt: 0 }],
    ['upper-case prefix', { account: '0X0', maxFeeRate: '0', expiresAt: 0 }],
    ['empty account', { account: '', maxFeeRate: '0', expiresAt: 0 }],
    ['a fee rate', { account: '0x0', maxFeeRate: '0.0001', expiresAt: 0 }],
    [
      'a non-canonical zero fee',
      { account: '0x0', maxFeeRate: '0.0', expiresAt: 0 },
    ],
    ['an expiry', { account: '0x0', maxFeeRate: '0', expiresAt: T0 + 60 }],
  ])('no builder with %s is refused', (_name, builder) => {
    expectCode(() => {
      validateSessionGrant(grant({ builder }), ENFORCED);
    }, 'INVALID_FIELD');
  });

  test('no builder is exactly {account: "0x0", maxFeeRate: "0", expiresAt: 0}', () => {
    expect(grant().builder).toEqual({
      account: '0x0',
      maxFeeRate: '0',
      expiresAt: 0,
    });
    expect(() => {
      validateSessionGrant(grant(), ENFORCED);
    }).not.toThrow();
  });
});

describe('market symbols and patterns', () => {
  test.each([
    'kPEPE-USD-PERP',
    'NEAR-USD-27NOV26-5_4-C',
    'btc-usd-perp',
    'BTC--USD-PERP',
    'BTC-USD-',
    '1INCH-USD-PERP',
    '*-USD-PERP',
    'BTC-*',
    'ETH-USD-*-C',
  ])('%p is accepted', (market) => {
    expect(() => {
      validateSessionGrant(
        grant({ limits: { ...FULL_LIMITS, markets: [market] } }),
        ENFORCED,
      );
    }).not.toThrow();
  });

  test.each([
    ['*', 'BTC-USD-PERP', true],
    ['*-USD-PERP', 'BTC-USD-PERP', true],
    ['*-USD-PERP', 'BTC-USD-27NOV26-C', false],
    ['*-USD-PERP', 'B*-USD-PERP', false],
    ['*-USD-PERP', '*-USD-PERP', true],
    ['*', '*-USD-PERP', true],
    ['B*-USD-PERP', '*-USD-PERP', false],
    ['BTC-*', 'BTC-USD-PERP', true],
    ['BTC-*', 'ETH-USD-PERP', false],
    ['BTC-USD-PERP', 'BTC-USD-PERP', true],
    ['BTC-USD-PERP', 'btc-usd-perp', false],
    ['NEAR-USD-*-C', 'NEAR-USD-27NOV26-5_4-C', true],
  ])('ceiling %p covers %p: %p', (pattern, market, covered) => {
    expect(marketCovers(pattern, market)).toBe(covered);
  });

  test('a ceiling pattern lets a mint name the symbols it matches', () => {
    const grantVector = vectorOf((v) => v.name === 'passkey-grant-builder')
      .message as unknown as PasskeyGrant;
    const patterned = {
      ...grantVector,
      ceiling: {
        ...grantVector.ceiling,
        limits: { ...grantVector.ceiling.limits, markets: ['*-USD-PERP'] },
      },
    };
    const builderMint = vectorOf(
      (v) => v.name === 'session-mint-builder-limits',
    ).message as unknown as SessionMint;
    const now = builderMint.expiresAt - 60;
    const withMarkets = (markets: string[]): SessionMint => ({
      ...builderMint,
      limits: { ...builderMint.limits, markets },
    });
    expect(() => {
      assertMintWithinCeiling(
        withMarkets(['SOL-USD-PERP']),
        patterned,
        now,
        ENFORCED,
      );
    }).not.toThrow();
    expect(() => {
      assertMintWithinCeiling(
        withMarkets(['SOL-USD-27NOV26-C']),
        patterned,
        now,
        ENFORCED,
      );
    }).toThrow(SessionGrantError);
  });

  test('a builder approval cannot outlive its grant', () => {
    const builder = { account: BUILDER, maxFeeRate: '0.0005' };
    const g = createSessionGrant(params({ builder }));
    expect(() => {
      validateSessionGrant(
        {
          ...g,
          builder: { ...g.builder, expiresAt: g.expiresAt },
        },
        ENFORCED,
      );
    }).not.toThrow();
    expectCode(() => {
      validateSessionGrant(
        {
          ...g,
          builder: { ...g.builder, expiresAt: g.expiresAt + 1 },
        },
        ENFORCED,
      );
    }, 'INVALID_FIELD');
  });
});

describe('limits the server does not enforce', () => {
  const launch = (
    overrides: Partial<CreateSessionGrantParams> = {},
  ): CreateSessionGrantParams =>
    params({ limits: undefined, enforcedLimits: undefined, ...overrides });

  test('by default every limit is uncapped and nothing else is accepted', () => {
    expect(DEFAULT_ENFORCED_LIMITS).toEqual([]);
    const g = createSessionGrant(launch());
    expect(g.limits).toEqual(UNCAPPED_LIMITS);
    expect(() => {
      validateSessionGrant(g);
    }).not.toThrow();
    expect(() => buildSessionGrantEip712(g, 1)).not.toThrow();
  });

  test.each([
    ['maxOrderNotional', { ...UNCAPPED_LIMITS, maxOrderNotional: '25000' }],
    ['maxLeverage', { ...UNCAPPED_LIMITS, maxLeverage: '10' }],
    ['markets', { ...UNCAPPED_LIMITS, markets: ['BTC-USD-PERP'] }],
  ])('a numeric %s is refused, naming it', (name, limits) => {
    let error: unknown;
    try {
      createSessionGrant(launch({ limits }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SessionGrantError);
    expect((error as SessionGrantError).code).toBe('LIMIT_INVALID');
    expect((error as Error).message).toContain(`limits.${name}`);
  });

  test('only the listed limits may be set', () => {
    const enforcedLimits = ['maxOrderNotional', 'markets'] as const;
    expect(() =>
      createSessionGrant(
        launch({
          enforcedLimits,
          limits: {
            ...UNCAPPED_LIMITS,
            maxOrderNotional: '25000',
            markets: ['BTC-USD-PERP'],
          },
        }),
      ),
    ).not.toThrow();
    expectCode(
      () =>
        createSessionGrant(
          launch({
            enforcedLimits,
            limits: { ...UNCAPPED_LIMITS, maxOpenNotional: '1000' },
          }),
        ),
      'LIMIT_INVALID',
    );
  });

  test('builder grants are refused until maxLoss is enforced', () => {
    const builder = { account: BUILDER, maxFeeRate: '0.0005' };
    for (const maxLoss of ['none', '5000']) {
      expectCode(
        () =>
          createSessionGrant(
            launch({ builder, limits: { ...UNCAPPED_LIMITS, maxLoss } }),
          ),
        'BUILDER_LIMITS_REQUIRED',
      );
    }
    expect(() =>
      createSessionGrant(
        launch({
          builder,
          enforcedLimits: ['maxLoss'],
          limits: { ...UNCAPPED_LIMITS, maxLoss: '5000' },
        }),
      ),
    ).not.toThrow();
  });

  test('builder passkeys are refused; first-party ones may be uncapped', () => {
    const firstParty = {
      ...passkeyGrant(),
      ceiling: { ...passkeyGrant().ceiling, limits: UNCAPPED_LIMITS },
    };
    expect(() => {
      validatePasskeyGrant(firstParty);
    }).not.toThrow();
    expectCode(() => {
      validatePasskeyGrant({
        ...firstParty,
        builderAccount: BUILDER,
        ceiling: { ...firstParty.ceiling, includeFutureSubaccounts: false },
      });
    }, 'BUILDER_LIMITS_REQUIRED');
  });

  test('a mint skips unlisted limits against its ceiling', () => {
    // A passkey registered with numeric caps keeps working: its mints are
    // uncapped while the server enforces nothing.
    const grant = vectorOf((v) => v.name === 'passkey-grant-first-party')
      .message as unknown as PasskeyGrant;
    const numericCeiling = {
      ...grant,
      ceiling: {
        ...grant.ceiling,
        limits: { ...FULL_LIMITS, markets: ['BTC-USD-PERP'] },
      },
    };
    const m = {
      ...(vectorOf((v) => v.name === 'session-mint-first-party')
        .message as unknown as SessionMint),
      limits: UNCAPPED_LIMITS,
    };
    expect(() => {
      assertMintWithinCeiling(m, numericCeiling, m.expiresAt - 60);
    }).not.toThrow();
    expectCode(() => {
      assertMintWithinCeiling(
        { ...m, limits: { ...UNCAPPED_LIMITS, maxLoss: '10' } },
        numericCeiling,
        m.expiresAt - 60,
      );
    }, 'LIMIT_INVALID');
  });
});

describe('builder passkeys and caps while limits are unenforced', () => {
  test('a mint under a builder passkey is refused until maxLoss is enforced', () => {
    const grant = vectorOf((v) => v.name === 'passkey-grant-builder')
      .message as unknown as PasskeyGrant;
    const builderMint = vectorOf(
      (v) => v.name === 'session-mint-builder-limits',
    ).message as unknown as SessionMint;
    const uncapped = { ...builderMint, limits: UNCAPPED_LIMITS };
    const now = builderMint.expiresAt - 60;
    expectCode(() => {
      assertMintWithinCeiling(uncapped, grant, now);
    }, 'BUILDER_LIMITS_REQUIRED');
    expect(() => {
      assertMintWithinCeiling(builderMint, grant, now, ENFORCED);
    }).not.toThrow();
  });

  test('a cap on an unenforced limit says why no grant can meet it', () => {
    let error: unknown;
    try {
      createSessionGrant(
        params({
          limits: undefined,
          enforcedLimits: undefined,
          limitCaps: { maxLoss: '5000' },
        }),
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SessionGrantError);
    expect((error as SessionGrantError).code).toBe('LIMIT_INVALID');
    expect((error as Error).message).toContain(
      'the server does not enforce this limit',
    );
  });
});
