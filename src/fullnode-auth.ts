import type * as Starknet from 'starknet';
import { byteArray, hash } from 'starknet';

import type { Account } from './account.js';
import type { Hex } from './types.js';

export const FULLNODE_SIGNATURE_VERSION = '1.0.0';

/**
 * Builds the typed data message for fullnode RPC authentication
 */
export function buildFullnodeAuthTypedData(
  chainId: string,
  account: Hex,
  jsonPayload: string,
  signatureTimestamp: number,
  signatureVersion: string,
): Starknet.TypedData {
  const payloadHash = poseidonHash(jsonPayload);

  return {
    types: {
      StarkNetDomain: [
        { name: 'name', type: 'felt' },
        { name: 'chainId', type: 'felt' },
        { name: 'version', type: 'felt' },
      ],
      Request: [
        { name: 'account', type: 'felt' },
        { name: 'payload', type: 'felt' },
        { name: 'timestamp', type: 'felt' },
        { name: 'version', type: 'felt' },
      ],
    },
    primaryType: 'Request',
    domain: {
      name: 'Paradex',
      chainId,
      version: '1',
    },
    message: {
      account,
      payload: payloadHash,
      timestamp: signatureTimestamp.toString(),
      version: signatureVersion,
    },
  };
}

/**
 * Generates authentication headers for fullnode RPC requests
 */
export async function generateFullnodeRequestHeaders(
  account: Account,
  chainId: string,
  jsonPayload: string,
): Promise<Record<string, string>> {
  const signatureTimestamp = Math.floor(Date.now() / 1000);
  const accountAddress = account.address as Hex;

  const message = buildFullnodeAuthTypedData(
    chainId,
    accountAddress,
    jsonPayload,
    signatureTimestamp,
    FULLNODE_SIGNATURE_VERSION,
  );

  const signature = await account.signMessage(message);

  let r: string;
  let s: string;

  if (Array.isArray(signature)) {
    r = signature[0]?.toString() ?? '';
    s = signature[1]?.toString() ?? '';
  } else {
    r = signature.r?.toString() ?? '';
    s = signature.s?.toString() ?? '';
  }

  return {
    'Content-Type': 'application/json',
    'PARADEX-STARKNET-ACCOUNT': accountAddress,
    'PARADEX-STARKNET-SIGNATURE': `["${r}","${s}"]`,
    'PARADEX-STARKNET-SIGNATURE-TIMESTAMP': signatureTimestamp.toString(),
    'PARADEX-STARKNET-SIGNATURE-VERSION': FULLNODE_SIGNATURE_VERSION,
  };
}

/**
 * Hashes a string using Poseidon hash function, following ByteArray serialization format
 */
function poseidonHash(input: string): string {
  // Use starknet.js byteArray utilities to properly serialize the string
  const byteArrayStruct = byteArray.byteArrayFromString(input);

  // Serialize the ByteArray struct into elements for hashing
  const elements: string[] = [];

  // Add data array length
  elements.push(String(byteArrayStruct.data.length));

  // Add data elements
  elements.push(
    ...(byteArrayStruct.data as string[]).map((felt) => String(felt)),
  );

  // Add pending word
  elements.push(String(byteArrayStruct.pending_word));

  // Add pending word length
  elements.push(String(byteArrayStruct.pending_word_len));

  // Compute Poseidon hash using starknet's computePoseidonHashOnElements function
  return hash.computePoseidonHashOnElements(elements);
}
