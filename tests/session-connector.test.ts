import { ethers } from 'ethers';

import { hashTypedData } from '../src/eip712';
import { SessionConnector } from '../src/session-connector';
import { memorySessionStorage, type SessionStorage } from '../src/session-key';
import {
  externalOwnerSigner,
  type OwnerSignRequest,
} from '../src/session-owner-signer';
import {
  SessionApiError,
  type HttpRequest,
  type HttpResponse,
} from '../src/session-transport';
import {
  buildSessionGrantEip712,
  SessionGrantError,
  type SessionGrant,
} from '../src/session-typed-data';

import { MAIN, mockTransport, PARADEX_CHAIN, SUB } from './mocks/session';

const T0 = 1760000000;

interface Harness {
  readonly wallet: ethers.HDNodeWallet;
  readonly sign: jest.Mock<Promise<string>, [OwnerSignRequest]>;
  readonly transport: jest.Mock<Promise<HttpResponse>, [HttpRequest]>;
  readonly storage: SessionStorage;
  readonly connector: SessionConnector;
}

function setup(
  options: {
    readonly respond?: (req: HttpRequest) => { status: number; body: unknown };
    readonly storage?: SessionStorage;
    readonly environment?: 'testnet' | 'nightly' | 'mainnet';
    readonly now?: () => number;
  } = {},
): Harness {
  const wallet = ethers.Wallet.createRandom();
  const sign = jest.fn(
    async ({ digest }: OwnerSignRequest) =>
      wallet.signingKey.sign(digest).serialized,
  );
  const transport = mockTransport(
    options.respond ??
      (() => ({ status: 201, body: { session_id: 'sess-1' } })),
  );
  const storage = options.storage ?? memorySessionStorage();
  const connector = new SessionConnector({
    environment: options.environment ?? 'testnet',
    paradexChain: PARADEX_CHAIN,
    owner: externalOwnerSigner({ chainId: 42161, sign }),
    storage,
    transport,
    now: options.now ?? (() => T0),
  });
  return { wallet, sign, transport, storage, connector };
}

function expectCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(SessionGrantError);
  expect((error as SessionGrantError).code).toBe(code);
}

describe('SessionConnector.open', () => {
  test('generates a key, has the owner sign the grant once, and registers it', async () => {
    const { wallet, sign, transport, storage, connector } = setup();
    const session = await connector.open({
      account: MAIN,
      subaccounts: [SUB],
      scopes: ['trade'],
      label: 'Example bot',
    });

    expect(session.sessionId).toBe('sess-1');
    expect(session.signatureChainId).toBe(42161);
    expect(session.grant).toMatchObject({
      paradexChain: PARADEX_CHAIN,
      environment: 'testnet',
      account: MAIN,
      subaccounts: [SUB],
      sessionKey: session.key.publicKey,
      issuedAt: T0,
      expiresAt: T0 + 7 * 86400,
    });

    expect(sign).toHaveBeenCalledTimes(1);
    const typedData = buildSessionGrantEip712(session.grant, 42161);
    const digest = hashTypedData(typedData);
    expect(sign).toHaveBeenCalledWith({ typedData, digest });
    expect(ethers.recoverAddress(digest, session.ownerSignature)).toBe(
      wallet.address,
    );

    expect(transport).toHaveBeenCalledTimes(1);
    const req = transport.mock.calls[0]?.[0];
    expect(req?.method).toBe('POST');
    expect(req?.url).toBe('https://api.testnet.paradex.trade/v2/sessions');
    expect(JSON.parse(req?.body ?? '{}')).toEqual({
      grant: session.grant,
      signature: session.ownerSignature,
      signature_chain_id: 42161,
      signature_type: 'eip712',
    });
    // The private key never leaves the page.
    expect(req?.body).not.toMatch(/ciphertext|privateKey/);

    const stored = await storage.get(session.key.publicKey);
    expect(stored?.sessionId).toBe('sess-1');
    expect(stored?.grant).toEqual(session.grant);
    expect(stored?.wrappingKey.extractable).toBe(false);
  });

  test.each([
    ['mainnet', 'https://api.prod.paradex.trade/v2/sessions'],
    ['nightly', 'https://api.nightly.paradex.trade/v2/sessions'],
  ] as const)('%s posts to %s', async (environment, url) => {
    const { transport, connector } = setup({ environment });
    const session = await connector.open({ account: MAIN });
    expect(session.grant.environment).toBe(environment);
    expect(transport.mock.calls[0]?.[0].url).toBe(url);
  });

  test('honours an apiUrl override', async () => {
    const transport = mockTransport(() => ({
      status: 200,
      body: { session_id: 's' },
    }));
    const connector = new SessionConnector({
      environment: 'testnet',
      paradexChain: PARADEX_CHAIN,
      owner: externalOwnerSigner({
        chainId: 1,
        sign: async ({ digest }) =>
          ethers.Wallet.createRandom().signingKey.sign(digest).serialized,
      }),
      transport,
      apiUrl: 'http://localhost:8080',
    });
    await connector.open({ account: MAIN });
    expect(transport.mock.calls[0]?.[0].url).toBe(
      'http://localhost:8080/v2/sessions',
    );
  });

  test('refuses an invalid grant before prompting the owner', async () => {
    const { sign, transport, storage, connector } = setup();
    for (const scopes of [['withdraw:owner'], ['trade:isolated']]) {
      const error = await connector
        .open({ account: MAIN, scopes: scopes as ['trade'] })
        .catch((e: unknown) => e);
      expectCode(error, 'RESERVED_SCOPE');
    }
    const error = await connector
      .open({ account: MAIN, ttlSeconds: 31 * 86400 })
      .catch((e: unknown) => e);
    expectCode(error, 'TTL_EXCEEDED');
    expect(sign).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(await storage.list()).toEqual([]);
  });

  test('deletes the key when the owner declines', async () => {
    const { sign, transport, storage, connector } = setup();
    sign.mockRejectedValueOnce(new Error('User rejected'));
    await expect(connector.open({ account: MAIN })).rejects.toThrow(
      'User rejected',
    );
    expect(transport).not.toHaveBeenCalled();
    expect(await storage.list()).toEqual([]);
  });

  test('refuses contract-wallet signatures', async () => {
    const { sign, transport, storage, connector } = setup();
    sign.mockResolvedValueOnce(`0x${'ab'.repeat(300)}`);
    await expect(connector.open({ account: MAIN })).rejects.toThrow(
      /65-byte EOA/,
    );
    expect(transport).not.toHaveBeenCalled();
    expect(await storage.list()).toEqual([]);
  });

  test('surfaces server refusals and deletes the key', async () => {
    const { storage, connector } = setup({
      respond: () => ({
        status: 400,
        body: { error: 'INVALID_GRANT', message: 'nonce already used' },
      }),
    });
    const error = await connector
      .open({ account: MAIN })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SessionApiError);
    expect((error as SessionApiError).status).toBe(400);
    expect((error as SessionApiError).code).toBe('INVALID_GRANT');
    expect((error as SessionApiError).message).toBe(
      'INVALID_GRANT: nonce already used',
    );
    expect(await storage.list()).toEqual([]);
  });

  test('refuses a response without a session id', async () => {
    const { storage, connector } = setup({
      respond: () => ({ status: 200, body: {} }),
    });
    await expect(connector.open({ account: MAIN })).rejects.toThrow(
      /no session_id/,
    );
    expect(await storage.list()).toEqual([]);
  });

  test('non-JSON error bodies keep their text', async () => {
    const { connector } = setup({
      respond: () => ({ status: 502, body: 'Bad Gateway' }),
    });
    await expect(connector.open({ account: MAIN })).rejects.toThrow(
      'Bad Gateway',
    );
  });
});

describe('SessionConnector.restore', () => {
  test('restores registered sessions and drops expired ones', async () => {
    let clock = T0;
    const storage = memorySessionStorage();
    const { connector } = setup({ storage, now: () => clock });
    const short = await connector.open({ account: MAIN, ttlSeconds: 3600 });
    const long = await connector.open({ account: MAIN });

    clock = T0 + 7200;
    const restored = await connector.restore();
    expect(restored.map((s) => s.sessionId)).toEqual([long.sessionId]);
    expect(restored[0]?.key.publicKey).toBe(long.key.publicKey);
    expect(await storage.get(short.key.publicKey)).toBeUndefined();

    expect((await connector.restoreByKey(long.key.publicKey))?.grant).toEqual(
      long.grant,
    );
    expect(await connector.restoreByKey('0x123')).toBeUndefined();

    await connector.forget(long);
    expect(await connector.restore()).toEqual([]);
  });

  test("leaves another environment's sessions alone", async () => {
    const storage = memorySessionStorage();
    const testnet = setup({ storage });
    const session = await testnet.connector.open({ account: MAIN });
    const nightly = setup({ storage, environment: 'nightly' });
    expect(await nightly.connector.restore()).toEqual([]);
    expect(await storage.get(session.key.publicKey)).toBeDefined();
  });

  test('deletes records that never registered or do not match their key', async () => {
    const storage = memorySessionStorage();
    const { connector } = setup({ storage });
    const session = await connector.open({ account: MAIN });
    const other = await connector.open({ account: MAIN });
    await storage.put({
      ...other.key.record,
      sessionId: undefined,
    });
    const wrongKey: SessionGrant = { ...session.grant, sessionKey: '0x999' };
    await storage.put({ ...session.key.record, grant: wrongKey });
    expect(await connector.restore()).toEqual([]);
    expect(await storage.list()).toEqual([]);
  });

  test('rethrows unexpected grant errors', async () => {
    const storage = memorySessionStorage();
    const { connector } = setup({ storage });
    const session = await connector.open({ account: MAIN });
    await storage.put({
      ...session.key.record,
      grant: { ...session.grant, issuedAt: T0 + 3600 },
    });
    const error = await connector.restore().catch((e: unknown) => e);
    expectCode(error, 'INVALID_FIELD');
  });
});
