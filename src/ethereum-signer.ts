import type { ethers } from 'ethers';

interface TypedData {
  readonly domain: {
    readonly name: string;
    readonly version: string;
    readonly chainId: string;
  };
  readonly types: Record<
    string,
    Array<{
      readonly name: string;
      readonly type: string;
    }>
  >;
  readonly message: Record<string, unknown>;
}

export interface EthereumSigner {
  signTypedData(typedData: TypedData): Promise<string>;
}

export function ethersSignerAdapter(
  ethersSigner: ethers.Signer,
): EthereumSigner {
  return {
    async signTypedData(typedData) {
      return ethersSigner.signTypedData(
        typedData.domain,
        typedData.types,
        typedData.message,
      );
    },
  };
}
