import * as Starknet from 'starknet';

import type { Account } from './account.js';
import type { AuthSignature } from './paraclear-provider.js';

export const FULLNODE_SIGNATURE_VERSION = '1.0.0';

/**
 * Hashes JSON payload using Poseidon hashing algorithm
 * Uses official StarkNet.js ByteArray utilities for consistency
 */
function hashPayloadWithPoseidon(jsonPayload: string): string {
  // Parse and re-stringify to ensure consistent formatting
  const payloadString = JSON.stringify(JSON.parse(jsonPayload));

  // Convert string to Cairo ByteArray using official StarkNet.js utility
  const byteArray = Starknet.byteArray.byteArrayFromString(payloadString);

  // Prepare data for Poseidon hashing
  const felts: bigint[] = [];

  // Add the number of full chunks
  felts.push(BigInt(byteArray.data.length));

  // Add each data chunk
  for (const chunk of byteArray.data) {
    felts.push(BigInt(chunk));
  }

  // Add pending word if it exists
  if (byteArray.pending_word !== 0 && byteArray.pending_word_len !== 0) {
    felts.push(
      BigInt(byteArray.pending_word),
      BigInt(byteArray.pending_word_len),
    );
  }

  // Use official StarkNet.js Poseidon hash
  return Starknet.hash.computePoseidonHashOnElements(felts);
}

/**
 * Generate authentication signature for RPC calls
 * Adopted from the authentication approach in the Paradex frontend
 */
export async function generateAuthSignature(
  account: Account,
  chainId: string,
  method: string,
  params: unknown,
): Promise<AuthSignature> {
  // Generate timestamp and ID
  const timestamp = Math.floor(Date.now() / 1000);
  const id = Math.floor(Date.now() / 1000); // Use timestamp-based ID for uniqueness

  // Create the RPC payload
  const payload = {
    jsonrpc: '2.0',
    method,
    params,
    id,
  };

  const jsonPayload: string = JSON.stringify(payload, (_, value): unknown =>
    typeof value === 'bigint' ? value.toString() : value,
  );

  // Hash payload using Poseidon
  const payloadHash = hashPayloadWithPoseidon(jsonPayload);

  // Convert hex string to bigint for the payload field
  const payloadValue =
    typeof payloadHash === 'string' && payloadHash.startsWith('0x')
      ? BigInt(payloadHash)
      : BigInt(payloadHash);

  const accountHex = Starknet.num.toHex(account.address);
  const chainIdHex = Starknet.shortString.encodeShortString(chainId);

  const typedData: Starknet.TypedData = {
    message: {
      account: accountHex,
      payload: payloadValue.toString(), // Convert to decimal string
      timestamp: timestamp.toString(),
      version: FULLNODE_SIGNATURE_VERSION,
    },
    domain: {
      name: 'Paradex',
      chainId: chainIdHex,
      version: '1',
    },
    primaryType: 'Request',
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
  };

  // Sign the typed data
  const signature = await account.signMessage(typedData);

  // Format signature as decimal strings
  let signatureArray: [string, string];

  if (Array.isArray(signature)) {
    signatureArray = [
      signature[0]?.toString() ?? '',
      signature[1]?.toString() ?? '',
    ];
  } else {
    signatureArray = [
      signature.r?.toString() ?? '',
      signature.s?.toString() ?? '',
    ];
  }

  return {
    account: accountHex,
    signature: signatureArray,
    timestamp: timestamp.toString(),
    id,
  };
}
