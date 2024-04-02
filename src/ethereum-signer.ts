import type { ethers } from 'ethers';

export interface TypedData {
  readonly domain: {
    readonly name: string;
    readonly version: string;
    readonly chainId: string;
  };
  readonly primaryType: string;
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
  readonly signTypedData: (typedData: TypedData) => Promise<string>;
}

export function ethersSignerAdapter(
  ethersSigner: ethers.Signer,
): EthereumSigner {
  return {
    async signTypedData(typedData) {
      return await ethersSigner.signTypedData(
        typedData.domain,
        typedData.types,
        typedData.message,
      );
    },
  };
}
