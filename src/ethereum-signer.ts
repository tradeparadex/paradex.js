import type { ethers } from 'ethers';

export interface TypedData {
  readonly domain: {
    readonly name: string;
    readonly version: string;
    readonly chainId: string | number;
  };
  readonly primaryType: string;
  readonly types: Record<
    string,
    ReadonlyArray<{
      readonly name: string;
      readonly type: string;
    }>
  >;
  readonly message: Record<string, unknown>;
}

export interface EthereumSigner {
  readonly signTypedData: (typedData: TypedData) => Promise<string>;
  /**
   * The signing wallet's address. Optional; the determinism guard needs it
   * unless it is passed as `walletAddress`.
   */
  readonly getAddress?: () => Promise<string>;
  /**
   * Reads an address's bytecode on the signer's chain. Optional; the
   * determinism guard uses it to refuse contract wallets when no
   * `codeProviders` are passed.
   */
  readonly getCode?: (address: string) => Promise<string>;
}

export function ethersSignerAdapter(
  ethersSigner: ethers.Signer,
): EthereumSigner {
  const provider = ethersSigner.provider;
  return {
    async getAddress() {
      return await ethersSigner.getAddress();
    },
    ...(provider != null
      ? {
          async getCode(address: string) {
            return await provider.getCode(address);
          },
        }
      : {}),
    async signTypedData(typedData) {
      return await ethersSigner.signTypedData(
        typedData.domain,
        // ethers takes mutable arrays but does not modify them.
        typedData.types as Record<string, ethers.TypedDataField[]>,
        typedData.message,
      );
    },
  };
}
/**
 * Returns the typed data that needs to be signed by an Ethereum
 * wallet in order to generate a Paradex account.
 * @returns The typed data object.
 */
export function buildEthereumStarkKeyTypedData(
  ethereumChainId: string,
): TypedData {
  return {
    domain: {
      name: 'Paradex',
      chainId: ethereumChainId,
      version: '1',
    },
    primaryType: 'Constant',
    types: {
      Constant: [{ name: 'action', type: 'string' }],
    },
    message: {
      action: 'STARK Key',
    },
  };
}
