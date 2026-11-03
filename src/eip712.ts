import { keccak_256 as keccak256 } from '@noble/hashes/sha3';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils';

import type { Hex } from './types.js';

/**
 * Minimal EIP-712 encoder covering the types the session typed data uses:
 * `string`, `bool`, `uintN`, `address`, `bytes32`, structs, and arrays of any
 * of these. It exists so hashing does not depend on a wallet library.
 */

export interface Eip712TypeField {
  readonly name: string;
  readonly type: string;
}

export type Eip712Types = Record<string, readonly Eip712TypeField[]>;

export interface Eip712Domain {
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
}

/**
 * Typed data in the shape `ethers` and most signers take: `types` excludes
 * `EIP712Domain`, which is implied by the domain fields.
 */
export interface Eip712TypedData<
  M extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly domain: Eip712Domain;
  readonly primaryType: string;
  readonly types: Eip712Types;
  readonly message: M;
}

export const EIP712_DOMAIN_TYPE: readonly Eip712TypeField[] = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
];

const textEncoder = new TextEncoder();

function keccak(data: Uint8Array): Uint8Array {
  return keccak256(data);
}

function findDependencies(
  primaryType: string,
  types: Eip712Types,
  found = new Set<string>(),
): Set<string> {
  if (found.has(primaryType) || types[primaryType] == null) return found;
  found.add(primaryType);
  for (const field of types[primaryType] ?? []) {
    findDependencies(baseType(field.type), types, found);
  }
  return found;
}

function baseType(type: string): string {
  const bracket = type.indexOf('[');
  return bracket === -1 ? type : type.slice(0, bracket);
}

export function encodeType(primaryType: string, types: Eip712Types): string {
  const deps = findDependencies(primaryType, types);
  deps.delete(primaryType);
  const ordered = [primaryType, ...[...deps].sort()];
  return ordered
    .map((name) => {
      const fields = types[name];
      if (fields == null) throw new Error(`EIP-712: unknown type ${name}`);
      return `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(',')})`;
    })
    .join('');
}

export function typeHash(primaryType: string, types: Eip712Types): Uint8Array {
  return keccak(textEncoder.encode(encodeType(primaryType, types)));
}

function uintToWord(value: bigint, bits: number): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(bits)) {
    throw new Error(`EIP-712: value out of range for uint${bits}`);
  }
  return hexToBytes(value.toString(16).padStart(64, '0'));
}

function toBigInt(value: unknown, type: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`EIP-712: ${type} must be a safe integer`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(`EIP-712: invalid ${type} value`);
}

function encodeValue(
  type: string,
  value: unknown,
  types: Eip712Types,
): Uint8Array {
  if (types[type] != null) {
    if (value == null || typeof value !== 'object') {
      throw new Error(`EIP-712: ${type} must be an object`);
    }
    return hashStruct(type, value as Record<string, unknown>, types);
  }

  if (type.endsWith(']')) {
    if (!Array.isArray(value)) {
      throw new Error(`EIP-712: ${type} must be an array`);
    }
    const open = type.lastIndexOf('[');
    const itemType = type.slice(0, open);
    const fixedLength = type.slice(open + 1, -1);
    if (fixedLength !== '' && Number(fixedLength) !== value.length) {
      throw new Error(`EIP-712: ${type} has the wrong length`);
    }
    const items = value.map((item) => encodeValue(itemType, item, types));
    return keccak(concatBytes(...items));
  }

  if (type === 'string') {
    if (typeof value !== 'string') {
      throw new Error('EIP-712: string must be a string');
    }
    return keccak(textEncoder.encode(value));
  }

  if (type === 'bytes') {
    if (typeof value !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(value)) {
      throw new Error('EIP-712: bytes must be 0x-prefixed hex');
    }
    return keccak(hexToBytes(value.slice(2)));
  }

  if (type === 'bool') {
    if (typeof value !== 'boolean') {
      throw new Error('EIP-712: bool must be a boolean');
    }
    return uintToWord(value ? 1n : 0n, 256);
  }

  if (type === 'address') {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new Error('EIP-712: invalid address');
    }
    return uintToWord(BigInt(value), 160);
  }

  if (type === 'bytes32') {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
      throw new Error('EIP-712: invalid bytes32');
    }
    return hexToBytes(value.slice(2));
  }

  const uintMatch = /^uint(\d+)$/.exec(type);
  if (uintMatch?.[1] != null) {
    const bits = Number(uintMatch[1]);
    if (bits < 8 || bits > 256 || bits % 8 !== 0) {
      throw new Error(`EIP-712: unsupported type ${type}`);
    }
    return uintToWord(toBigInt(value, type), bits);
  }

  throw new Error(`EIP-712: unsupported type ${type}`);
}

export function hashStruct(
  primaryType: string,
  data: Record<string, unknown>,
  types: Eip712Types,
): Uint8Array {
  const fields = types[primaryType];
  if (fields == null) throw new Error(`EIP-712: unknown type ${primaryType}`);
  const known = new Set(fields.map((f) => f.name));
  for (const key of Object.keys(data)) {
    if (!known.has(key)) {
      throw new Error(`EIP-712: unexpected field ${primaryType}.${key}`);
    }
  }
  const encoded = fields.map((field) => {
    if (!(field.name in data)) {
      throw new Error(`EIP-712: missing field ${primaryType}.${field.name}`);
    }
    return encodeValue(field.type, data[field.name], types);
  });
  return keccak(concatBytes(typeHash(primaryType, types), ...encoded));
}

export function hashDomain(domain: Eip712Domain): Uint8Array {
  return hashStruct(
    'EIP712Domain',
    { ...domain },
    {
      EIP712Domain: EIP712_DOMAIN_TYPE,
    },
  );
}

/**
 * The EIP-712 digest: `keccak256(0x1901 ‖ domainSeparator ‖ hashStruct(message))`.
 */
export function hashTypedData(typedData: Eip712TypedData): Hex {
  const digest = keccak(
    concatBytes(
      new Uint8Array([0x19, 0x01]),
      hashDomain(typedData.domain),
      hashStruct(typedData.primaryType, typedData.message, typedData.types),
    ),
  );
  return `0x${bytesToHex(digest)}`;
}

/**
 * Serializes typed data for `eth_signTypedData_v4`, which needs the
 * `EIP712Domain` type listed explicitly.
 */
export function toEthSignTypedDataV4(typedData: Eip712TypedData): string {
  return JSON.stringify({
    domain: typedData.domain,
    primaryType: typedData.primaryType,
    types: { EIP712Domain: EIP712_DOMAIN_TYPE, ...typedData.types },
    message: typedData.message,
  });
}
