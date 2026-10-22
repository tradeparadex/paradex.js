import { sha256 } from '@noble/hashes/sha256';
import { ec } from 'starknet';

/**
 * Stark key derivation, ported from `@starkware-industries/starkware-crypto-utils`
 * (Apache-2.0) to drop its `elliptic`/`bn.js` dependency tree.
 *
 * Outputs must stay byte-for-byte identical to the original implementation,
 * including its quirks (unpadded hex output, odd-length seed handling),
 * because accounts are derived from them.
 * @internal
 */

const ETH_SIGNATURE_LENGTH = 130;
const STARK_PRIVATE_KEY_LENGTH = 63;
const MAX_GRIND_ITERATIONS = 100_000;

export const STARK_EC_ORDER: bigint = ec.starkCurve.CURVE.n;

function isHex(hex: string, length?: number): boolean {
  if (length != null && hex.length !== length) return false;
  return /^[0-9a-fA-F]*$/u.test(hex);
}

/**
 * Mirrors Node's `Buffer.from(hex, 'hex')`, which the original
 * implementation used: a trailing odd nibble is silently dropped.
 */
function hexToBytesDroppingOddNibble(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function hashKeyWithIndex(keySeed: string, index: number): bigint {
  let indexHex = index.toString(16);
  if (indexHex.length % 2 !== 0) indexHex = `0${indexHex}`;
  const digest = sha256(hexToBytesDroppingOddNibble(keySeed + indexHex));
  let value = 0n;
  for (const byte of digest) value = (value << 8n) | BigInt(byte);
  return value;
}

/**
 * Deterministically derives a key in `[0, keyValLimit)` from a hex seed,
 * grinding (re-hashing with an increasing index) to avoid modulo bias.
 * Returns unpadded lowercase hex without `0x`.
 */
export function grindKey(
  keySeed: string,
  keyValLimit: bigint = STARK_EC_ORDER,
): string {
  const seed = keySeed.replace(/^0x/u, '');
  if (!isHex(seed)) throw new Error('Invalid key seed: expected hex string');
  const sha256EcMaxDigest = 1n << 256n;
  const maxAllowedVal = sha256EcMaxDigest - (sha256EcMaxDigest % keyValLimit);
  for (let i = 0; i < MAX_GRIND_ITERATIONS; i++) {
    const key = hashKeyWithIndex(seed, i);
    if (key < maxAllowedVal) return (key % keyValLimit).toString(16);
  }
  throw new Error('Unable to grind key from seed');
}

/**
 * Returns a private Stark key from a 65-byte Ethereum signature,
 * grinding the signature's `r` value.
 */
export function getPrivateKeyFromEthSignature(ethSignature: string): string {
  const signature = ethSignature.replace(/^0x/u, '');
  if (!isHex(signature, ETH_SIGNATURE_LENGTH))
    throw new Error('Invalid Ethereum signature');
  return grindKey(signature.substring(0, 64), STARK_EC_ORDER);
}

/**
 * Returns the public Stark key (x coordinate) for a private key,
 * as unpadded lowercase hex without `0x`.
 */
export function privateToStarkKey(privateKey: string): string {
  const key = privateKey.replace(/^0x/u, '');
  if (key.length > STARK_PRIVATE_KEY_LENGTH || !isHex(key))
    throw new Error('Invalid private key');
  const scalar = BigInt(`0x${key === '' ? '0' : key}`) % STARK_EC_ORDER;
  if (scalar === 0n) throw new Error('Invalid private key');
  const publicKey = ec.starkCurve.getStarkKey(
    scalar.toString(16).padStart(64, '0'),
  );
  return BigInt(publicKey).toString(16);
}
