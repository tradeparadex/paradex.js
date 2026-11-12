import type { Hex } from './types.js';

/**
 * Bytecode prefix of an EIP-7702 delegation. An EOA that delegated still
 * signs with its own key, so it derives a Stark key like any other EOA.
 */
const EIP_7702_DELEGATION_PREFIX = '0xef0100';

/** A code lookup that answers no faster than this counts as no code. */
export const DEFAULT_CONTRACT_CODE_TIMEOUT_MS = 3000;

/**
 * Anything that can read an address's bytecode, such as an ethers
 * `Provider`. Pass one per chain the wallet might be a contract on.
 */
export interface EthCodeProvider {
  readonly getCode: (address: string) => Promise<string>;
}

/**
 * Options for the determinism guard on `deriveFromEthSigner`.
 * @experimental
 */
export interface DeterminismGuardOptions {
  /**
   * The wallet address that signs. Defaults to `signer.getAddress()`.
   */
  readonly walletAddress?: string;
  /**
   * Providers to look the wallet's bytecode up on, one per chain. Defaults to
   * the signer's own provider (`signer.getCode`). The guard refuses a wallet
   * with contract code on any of them; an EIP-7702 delegation counts as an
   * EOA.
   */
  readonly codeProviders?: readonly EthCodeProvider[];
  /**
   * Set to false to skip the contract code check, for example for a local
   * private-key wallet with no provider. Defaults to true.
   */
  readonly contractCodeCheck?: boolean;
  /**
   * How long to wait for each code lookup. A lookup that fails or times out
   * counts as no code, so a provider outage never locks out an EOA. Defaults
   * to 3000 ms.
   */
  readonly contractCodeTimeoutMs?: number;
  /**
   * Called with the outcome once the key is accepted. A caller that keeps
   * its own record of wallets that passed the two-signature test can store
   * it from here; the SDK keeps no state between calls.
   */
  readonly onResult?: (result: DeterminismGuardResult) => void;
}

/**
 * How the guard accepted the derived key.
 * @experimental
 */
export interface DeterminismGuardResult {
  /**
   * `existing`: an account already holds the derived key, which proves the
   * wallet reproduced the signature the account was created from.
   * `new`: no account holds the key and none is known for the wallet; the
   * wallet signed twice and both signatures matched.
   */
  readonly kind: 'existing' | 'new';
  /** Number of signatures requested from the wallet. */
  readonly signatures: 1 | 2;
  /** The wallet that signed, lowercased. */
  readonly walletAddress: string;
  /** The Paradex account address, as reported by the Paradex API. */
  readonly address: Hex;
  /** The derived Stark public key. */
  readonly publicKey: Hex;
}

export type DeterminismGuardErrorCode =
  /** The wallet address has contract code, so it cannot derive a key. */
  | 'contract_wallet'
  /** The wallet already owns an account under a different key. */
  | 'key_mismatch'
  /** The wallet returned different signatures for the same message. */
  | 'non_deterministic'
  /** A Paradex API lookup failed; nothing was derived. */
  | 'lookup_failed'
  /** The guard is missing an input it needs (wallet address, API URL). */
  | 'invalid_options';

/**
 * Raised when the determinism guard refuses to derive a key. A refusal
 * means the caller must not onboard an account with this wallet.
 * @experimental
 */
export class DeterminismGuardError extends Error {
  readonly code: DeterminismGuardErrorCode;

  constructor(code: DeterminismGuardErrorCode, message: string) {
    super(message);
    this.name = 'DeterminismGuardError';
    this.code = code;
  }
}

/** Whether `code` is a contract's bytecode, not an EOA or an EIP-7702 one. */
export function isContractCode(code: string | null | undefined): boolean {
  if (code == null) return false;
  const normalized = code.toLowerCase();
  if (normalized === '' || normalized === '0x') return false;
  return !normalized.startsWith(EIP_7702_DELEGATION_PREFIX);
}

/**
 * Whether `address` holds contract code on any of `providers`. A provider
 * that errors or does not answer within `timeoutMs` counts as no code.
 */
export async function hasContractCode(
  address: string,
  providers: readonly EthCodeProvider[],
  timeoutMs: number = DEFAULT_CONTRACT_CODE_TIMEOUT_MS,
): Promise<boolean> {
  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          provider.getCode(address),
          new Promise<undefined>((resolve) => {
            timer = setTimeout(() => {
              resolve(undefined);
            }, timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return results.some(
    (result) => result.status === 'fulfilled' && isContractCode(result.value),
  );
}

/**
 * The key as most clients write it (unpadded), then zero-padded to 32 bytes
 * if different. The API matches keys case-insensitively but as written, so
 * an account stored with the padded form must not read as missing.
 */
export function publicKeyForms(publicKey: Hex): Hex[] {
  const hex = publicKey.replace(/^0x/iu, '').replace(/^0+(?=.)/u, '');
  const unpadded: Hex = `0x${hex}`;
  const padded: Hex = `0x${hex.padStart(64, '0')}`;
  return padded === unpadded ? [unpadded] : [unpadded, padded];
}
