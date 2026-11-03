import { toEthSignTypedDataV4, type Eip712TypedData } from './eip712.js';
import type { Hex } from './types.js';

/**
 * Who signs the session grant: the account owner's EVM wallet.
 *
 * Two implementations ship: {@link eip1193OwnerSigner} for browser wallets,
 * and {@link externalOwnerSigner} for signers that live elsewhere, such as an
 * MPC provider signing with its own infrastructure.
 *
 * @experimental
 */
export interface SessionOwnerSigner {
  /**
   * The EVM chain the signature is bound to: the wallet's *current* chain.
   * It becomes the EIP-712 domain `chainId` and is sent to the server as
   * `signature_chain_id`, so the user never has to switch networks.
   */
  getChainId: () => Promise<number>;
  /**
   * Signs the grant. `digest` is the EIP-712 hash of `typedData`, for
   * signers that sign raw hashes. Must return a 65-byte `r‖s‖v` signature.
   */
  signTypedData: (request: OwnerSignRequest) => Promise<string>;
}

export interface OwnerSignRequest {
  readonly typedData: Eip712TypedData;
  readonly digest: Hex;
}

/** The subset of an EIP-1193 provider used here. */
export interface Eip1193Provider {
  request: (args: {
    readonly method: string;
    readonly params?: readonly unknown[];
  }) => Promise<unknown>;
}

function parseChainId(value: unknown): number {
  let n = Number.NaN;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value))
    n = Number(BigInt(value));
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`Wallet returned an invalid chain id: ${String(value)}`);
  }
  return n;
}

export interface Eip1193OwnerSignerParams {
  readonly provider: Eip1193Provider;
  /** The owner wallet address. Defaults to the wallet's first account. */
  readonly address?: string;
}

/**
 * Default owner signer: an injected wallet (`window.ethereum`) or any
 * EIP-1193 provider, signing with `eth_signTypedData_v4`.
 */
export function eip1193OwnerSigner({
  provider,
  address,
}: Eip1193OwnerSignerParams): SessionOwnerSigner {
  const resolveAddress = async (): Promise<string> => {
    if (address != null) return address;
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const first = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof first !== 'string') {
      throw new Error('Wallet returned no accounts');
    }
    return first;
  };
  return {
    getChainId: async () =>
      parseChainId(await provider.request({ method: 'eth_chainId' })),
    signTypedData: async ({ typedData }) => {
      const from = await resolveAddress();
      const signature = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [from, toEthSignTypedDataV4(typedData)],
      });
      if (typeof signature !== 'string') {
        throw new Error('Wallet returned a non-string signature');
      }
      return signature;
    },
  };
}

export interface ExternalOwnerSignerParams {
  /** The EVM chain id the external signer binds signatures to. */
  readonly chainId: number | (() => Promise<number>);
  /** Signs the typed data (or its digest) with the partner's infrastructure. */
  readonly sign: (request: OwnerSignRequest) => Promise<string>;
}

/**
 * Hook for signers outside the page, e.g. an MPC partner. The SDK hands over
 * the EIP-712 typed data and its digest; the partner returns the signature.
 */
export function externalOwnerSigner({
  chainId,
  sign,
}: ExternalOwnerSignerParams): SessionOwnerSigner {
  return {
    getChainId: async () =>
      parseChainId(typeof chainId === 'function' ? await chainId() : chainId),
    signTypedData: sign,
  };
}

/**
 * Accepts only 65-byte EOA signatures. ERC-1271 and ERC-6492 contract
 * signatures are longer; the server refuses them, so fail before submitting.
 */
export function assertEoaSignature(signature: string): Hex {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new Error(
      'Owner signature must be a 65-byte EOA signature; contract wallets are not supported',
    );
  }
  return signature.toLowerCase() as Hex;
}
