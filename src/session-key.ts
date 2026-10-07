import * as Starknet from 'starknet';

import type { SessionGrant } from './session-typed-data.js';
import type { Hex } from './types.js';

/**
 * A session's Stark key, generated in the page and kept encrypted at rest.
 *
 * The private key is encrypted with AES-GCM under a non-extractable WebCrypto
 * key. Storage holds the `CryptoKey` handle and the ciphertext; script can use
 * the handle but cannot read the AES key out of it. The private key is
 * decrypted only for the duration of a signature and the plaintext buffer is
 * zeroed afterwards.
 *
 * @experimental
 */

export interface StoredSession {
  readonly version: 1;
  /** The session public key; also the storage id. */
  readonly publicKey: Hex;
  readonly wrappingKey: CryptoKey;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly createdAt: number;
  /** Set once the owner has signed the grant. */
  readonly grant?: SessionGrant;
  readonly ownerSignature?: Hex;
  readonly signatureChainId?: number;
  /** Set once the server has registered the session. */
  readonly sessionId?: string;
}

/**
 * Where encrypted sessions live. Records must be stored by structured clone
 * (IndexedDB does this) so the `CryptoKey` stays non-extractable.
 */
export interface SessionStorage {
  get: (publicKey: string) => Promise<StoredSession | undefined>;
  put: (record: StoredSession) => Promise<void>;
  delete: (publicKey: string) => Promise<void>;
  list: () => Promise<StoredSession[]>;
}

/** In-memory storage: nothing survives a reload. Useful for bots and tests. */
export function memorySessionStorage(): SessionStorage {
  const records = new Map<string, StoredSession>();
  return {
    get: async (publicKey) => records.get(publicKey),
    put: async (record) => {
      records.set(record.publicKey, record);
    },
    delete: async (publicKey) => {
      records.delete(publicKey);
    },
    list: async () => [...records.values()],
  };
}

export interface IndexedDbSessionStorageOptions {
  readonly dbName?: string;
  readonly storeName?: string;
  readonly indexedDB?: IDBFactory;
}

async function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return await new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/** Browser storage backed by IndexedDB. */
export function indexedDbSessionStorage(
  options: IndexedDbSessionStorageOptions = {},
): SessionStorage {
  const dbName = options.dbName ?? 'paradex-sessions';
  const storeName = options.storeName ?? 'sessions';
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (factory == null) {
    throw new Error('IndexedDB is not available; pass a SessionStorage');
  }
  let db: Promise<IDBDatabase> | undefined;
  const open = async (): Promise<IDBDatabase> => {
    db ??= new Promise((resolve, reject) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(storeName, { keyPath: 'publicKey' });
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        db = undefined;
        reject(request.error ?? new Error('Failed to open IndexedDB'));
      };
    });
    return await db;
  };
  const store = async (mode: IDBTransactionMode): Promise<IDBObjectStore> =>
    (await open()).transaction(storeName, mode).objectStore(storeName);

  return {
    get: async (publicKey) =>
      (await promisify((await store('readonly')).get(publicKey))) as
        | StoredSession
        | undefined,
    put: async (record) => {
      await promisify((await store('readwrite')).put(record));
    },
    delete: async (publicKey) => {
      await promisify((await store('readwrite')).delete(publicKey));
    },
    list: async () =>
      (await promisify((await store('readonly')).getAll())) as StoredSession[],
  };
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (s == null) {
    throw new Error('WebCrypto is not available (needs a secure context)');
  }
  return s;
}

const textEncoder = new TextEncoder();

function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

async function encrypt(
  key: CryptoKey,
  iv: Uint8Array,
  publicKey: string,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await subtle().encrypt(
      {
        name: 'AES-GCM',
        iv: toBufferSource(iv),
        additionalData: textEncoder.encode(publicKey),
      },
      key,
      toBufferSource(plaintext),
    ),
  );
}

export class SessionKey {
  readonly publicKey: Hex;
  readonly #record: StoredSession;

  private constructor(record: StoredSession) {
    this.publicKey = record.publicKey;
    this.#record = record;
  }

  /** The encrypted record, for storage. */
  get record(): StoredSession {
    return this.#record;
  }

  /** Generates a key pair and encrypts the private key. Nothing is stored. */
  static async generate(): Promise<SessionKey> {
    const privateKey = Starknet.ec.starkCurve.utils.randomPrivateKey();
    try {
      const publicKey = Starknet.num.toHex(
        Starknet.ec.starkCurve.getStarkKey(privateKey),
      ) as Hex;
      const wrappingKey = await subtle().generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await encrypt(wrappingKey, iv, publicKey, privateKey);
      return new SessionKey({
        version: 1,
        publicKey,
        wrappingKey,
        iv,
        ciphertext,
        createdAt: Date.now(),
      });
    } finally {
      privateKey.fill(0);
    }
  }

  /** Wraps a stored record. The key is checked on first use. */
  static fromRecord(record: StoredSession): SessionKey {
    if (record.version !== 1) {
      throw new Error(
        `Unsupported session record version ${String(record.version)}`,
      );
    }
    if (record.wrappingKey.extractable) {
      throw new Error('Session wrapping key must be non-extractable');
    }
    return new SessionKey(record);
  }

  /** Returns a copy of this key carrying updated metadata. */
  withMetadata(
    metadata: Pick<
      StoredSession,
      'grant' | 'ownerSignature' | 'signatureChainId' | 'sessionId'
    >,
  ): SessionKey {
    return new SessionKey({ ...this.#record, ...metadata });
  }

  private async withPrivateKey<T>(fn: (key: Uint8Array) => T): Promise<T> {
    const { wrappingKey, iv, ciphertext } = this.#record;
    const plaintext = new Uint8Array(
      await subtle().decrypt(
        {
          name: 'AES-GCM',
          iv: toBufferSource(iv),
          additionalData: textEncoder.encode(this.publicKey),
        },
        wrappingKey,
        toBufferSource(ciphertext),
      ),
    );
    try {
      return fn(plaintext);
    } finally {
      plaintext.fill(0);
    }
  }

  /** Signs a felt hash. Returns `[r, s]` as decimal strings. */
  async signHash(hash: string): Promise<[string, string]> {
    const signature = await this.withPrivateKey((key) =>
      Starknet.ec.starkCurve.sign(Starknet.num.toHex(hash), key),
    );
    return [signature.r.toString(), signature.s.toString()];
  }

  /** Signs SNIP-12 typed data on behalf of `account`. */
  async signTypedData(
    typedData: Starknet.TypedData,
    account: string,
  ): Promise<[string, string]> {
    return await this.signHash(
      Starknet.typedData.getMessageHash(typedData, account),
    );
  }
}
