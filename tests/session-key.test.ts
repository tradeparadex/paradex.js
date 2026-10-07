import { IDBFactory } from 'fake-indexeddb';
import * as Starknet from 'starknet';

import {
  indexedDbSessionStorage,
  memorySessionStorage,
  SessionKey,
  type SessionStorage,
} from '../src/session-key';

import { verifyStark } from './mocks/session';

describe('SessionKey', () => {
  test('generates a Stark key encrypted under a non-extractable AES key', async () => {
    const key = await SessionKey.generate();
    expect(key.publicKey).toMatch(/^0x[1-9a-f][0-9a-f]*$/);
    const { wrappingKey, iv, ciphertext } = key.record;
    expect(wrappingKey.extractable).toBe(false);
    expect(wrappingKey.algorithm).toMatchObject({
      name: 'AES-GCM',
      length: 256,
    });
    expect(wrappingKey.usages.sort()).toEqual(['decrypt', 'encrypt']);
    expect(iv).toHaveLength(12);
    // 32-byte key + 16-byte GCM tag.
    expect(ciphertext).toHaveLength(48);
    await expect(
      globalThis.crypto.subtle.exportKey('raw', wrappingKey),
    ).rejects.toThrow();
  });

  test('every key is fresh', async () => {
    const [a, b] = await Promise.all([
      SessionKey.generate(),
      SessionKey.generate(),
    ]);
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  test('signs hashes and typed data verifiable under its public key', async () => {
    const key = await SessionKey.generate();
    const hash = '0x1234abcd';
    expect(verifyStark(key.publicKey, hash, await key.signHash(hash))).toBe(
      true,
    );

    const typedData: Starknet.TypedData = {
      domain: { name: 'Paradex', chainId: '0x1', version: '1' },
      primaryType: 'M',
      types: {
        StarkNetDomain: [
          { name: 'name', type: 'felt' },
          { name: 'chainId', type: 'felt' },
          { name: 'version', type: 'felt' },
        ],
        M: [{ name: 'x', type: 'felt' }],
      },
      message: { x: '7' },
    };
    const signature = await key.signTypedData(typedData, '0x99');
    const messageHash = Starknet.typedData.getMessageHash(typedData, '0x99');
    expect(verifyStark(key.publicKey, messageHash, signature)).toBe(true);
    expect(verifyStark(key.publicKey, '0x1', signature)).toBe(false);
  });

  test('ciphertext is bound to the public key and tamper-evident', async () => {
    const key = await SessionKey.generate();
    const other = await SessionKey.generate();
    const swapped = SessionKey.fromRecord({
      ...key.record,
      publicKey: other.publicKey,
    });
    await expect(swapped.signHash('0x1')).rejects.toThrow();

    const ciphertext = new Uint8Array(key.record.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    const tampered = SessionKey.fromRecord({ ...key.record, ciphertext });
    await expect(tampered.signHash('0x1')).rejects.toThrow();
  });

  test('fromRecord refuses unknown versions and extractable keys', async () => {
    const key = await SessionKey.generate();
    expect(() =>
      SessionKey.fromRecord({ ...key.record, version: 2 as 1 }),
    ).toThrow(/version 2/);
    const extractable = await globalThis.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    expect(() =>
      SessionKey.fromRecord({ ...key.record, wrappingKey: extractable }),
    ).toThrow(/non-extractable/);
  });

  test('withMetadata keeps the key material', async () => {
    const key = await SessionKey.generate();
    const updated = key.withMetadata({ grantId: 's-1' });
    expect(updated.record.grantId).toBe('s-1');
    expect(updated.publicKey).toBe(key.publicKey);
    expect(updated.record.ciphertext).toBe(key.record.ciphertext);
    expect(key.record.grantId).toBeUndefined();
  });

  test('fails clearly without WebCrypto', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      value: {},
      configurable: true,
    });
    try {
      await expect(SessionKey.generate()).rejects.toThrow(/WebCrypto/);
    } finally {
      if (descriptor != null) {
        Object.defineProperty(globalThis, 'crypto', descriptor);
      }
    }
  });
});

async function exerciseStorage(storage: SessionStorage): Promise<void> {
  const a = (await SessionKey.generate()).record;
  const b = (await SessionKey.generate()).record;
  expect(await storage.get(a.publicKey)).toBeUndefined();
  await storage.put(a);
  await storage.put(b);
  await storage.put({ ...a, grantId: 'x' });
  const loaded = await storage.get(a.publicKey);
  if (loaded == null) throw new Error('not stored');
  expect(loaded.grantId).toBe('x');
  expect(loaded.wrappingKey.extractable).toBe(false);
  expect((await storage.list()).map((r) => r.publicKey).sort()).toEqual(
    [a.publicKey, b.publicKey].sort(),
  );
  // A key loaded back from storage still decrypts.
  const restored = SessionKey.fromRecord(loaded);
  expect(
    verifyStark(restored.publicKey, '0x5', await restored.signHash('0x5')),
  ).toBe(true);
  await storage.delete(a.publicKey);
  expect(await storage.get(a.publicKey)).toBeUndefined();
  expect(await storage.list()).toHaveLength(1);
}

describe('storage', () => {
  test('memory storage', async () => {
    await exerciseStorage(memorySessionStorage());
  });

  test('IndexedDB storage keeps CryptoKey handles', async () => {
    await exerciseStorage(
      indexedDbSessionStorage({ indexedDB: new IDBFactory() }),
    );
  });

  test('IndexedDB storage uses the global factory and custom names', async () => {
    const factory = new IDBFactory();
    const original = globalThis.indexedDB;
    globalThis.indexedDB = factory;
    try {
      const storage = indexedDbSessionStorage({
        dbName: 'custom',
        storeName: 'keys',
      });
      const record = (await SessionKey.generate()).record;
      await storage.put(record);
      expect((await factory.databases()).map((d) => d.name)).toEqual([
        'custom',
      ]);
    } finally {
      globalThis.indexedDB = original;
    }
  });

  test('IndexedDB storage drops its connection when another tab upgrades', async () => {
    const factory = new IDBFactory();
    const open = jest.spyOn(factory, 'open');
    const storage = indexedDbSessionStorage({ indexedDB: factory });
    await storage.put((await SessionKey.generate()).record);
    expect(open).toHaveBeenCalledTimes(1);
    // A newer version elsewhere can only open once this connection closes.
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('paradex-sessions', 2);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => {
        reject(request.error ?? new Error('upgrade failed'));
      };
    });
    // The next call reopens instead of reusing the closed connection.
    await expect(storage.list()).rejects.toMatchObject({
      name: 'VersionError',
    });
    expect(open).toHaveBeenCalledTimes(3);
  });

  test('IndexedDB storage requires IndexedDB', () => {
    expect(() =>
      indexedDbSessionStorage({ indexedDB: undefined as never }),
    ).toThrow(/IndexedDB is not available/);
  });

  test('IndexedDB open failures reject and can be retried', async () => {
    const factory = new IDBFactory();
    const open = jest.spyOn(factory, 'open');
    open.mockImplementationOnce(() => {
      const request: { error?: Error; onerror?: () => void } = {};
      queueMicrotask(() => {
        request.error = new Error('blocked');
        request.onerror?.();
      });
      return request as unknown as IDBOpenDBRequest;
    });
    const storage = indexedDbSessionStorage({ indexedDB: factory });
    await expect(storage.list()).rejects.toThrow('blocked');
    expect(await storage.list()).toEqual([]);
  });
});
