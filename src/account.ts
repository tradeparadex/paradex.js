import { keyDerivation } from '@starkware-industries/starkware-crypto-utils';
import * as Starknet from 'starknet';

import type { ParadexConfig } from './config.js';
import type { EthereumSigner, TypedData } from './ethereum-signer.js';
import type { Hex } from './types.js';

export interface Account extends Starknet.Account {}

interface FromEthSignerParams {
  readonly provider: Starknet.ProviderOptions | Starknet.ProviderInterface;
  readonly config: ParadexConfig;
  readonly signer: EthereumSigner;
}

/**
 * Generates a Paradex account from an Ethereum wallet.
 * @returns The generated Paradex account.
 */
export async function fromEthSigner({
  provider,
  config,
  signer,
}: FromEthSignerParams): Promise<Account> {
  const starkKeyTypedData = buildStarkKeyTypedData(config.l1ChainId);
  const signature = await signer.signTypedData(starkKeyTypedData);
  const privateKey = keyDerivation.getPrivateKeyFromEthSignature(signature);
  const publicKey = keyDerivation.privateToStarkKey(privateKey);
  const address = generateAccountAddress({
    publicKey: `0x${publicKey}`,
    accountClassHash: config.paraclearAccountHash,
    accountProxyClassHash: config.paraclearAccountProxyHash,
  });
  return new Starknet.Account(provider, address, `0x${privateKey}`);
}

/**
 * Returns the typed data that needs to be signed by an Ethereum
 * wallet in order to generate a Paradex account.
 * @returns The typed data object.
 */
function buildStarkKeyTypedData(l1ChainId: string): TypedData {
  return {
    domain: {
      name: 'Paradex',
      chainId: l1ChainId,
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

interface GenerateAccountAddressParams {
  /** The hash of the account contract in hex format */
  readonly accountClassHash: Hex;
  /** The hash of the account proxy contract in hex format */
  readonly accountProxyClassHash: Hex;
  /** The public key of the account in hex format */
  readonly publicKey: Hex;
}

/**
 * Generates an account address based on the account contract and public key.
 */
function generateAccountAddress({
  accountClassHash,
  accountProxyClassHash,
  publicKey,
}: GenerateAccountAddressParams): Hex {
  const callData = Starknet.CallData.compile({
    implementation: accountClassHash,
    selector: Starknet.hash.getSelectorFromName('initialize'),
    calldata: Starknet.CallData.compile({
      signer: publicKey,
      guardian: '0',
    }),
  });

  const address = Starknet.hash.calculateContractAddressFromHash(
    publicKey,
    accountProxyClassHash,
    callData,
    0,
  );

  return address as Hex;
}
