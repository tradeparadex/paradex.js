import { keyDerivation } from '@starkware-industries/starkware-crypto-utils';
import { CallData, hash } from 'starknet';

import type { ParadexConfig } from './config.js';
import type { EthereumSigner, TypedData } from './ethereum-signer.js';

interface Account {
  readonly address: string;
}

interface FromEthSignerParams {
  readonly config: ParadexConfig;
  readonly signer: EthereumSigner;
}

/**
 * Generates a Paradex account from an Ethereum wallet.
 * @returns The generated Paradex account.
 */
export async function fromEthSigner({
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
  return { address };
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
  readonly accountClassHash: string;
  /** The hash of the account proxy contract in hex format */
  readonly accountProxyClassHash: string;
  /** The public key of the account in hex format */
  readonly publicKey: string;
}

/**
 * Generates an account address based on the account contract and public key.
 */
function generateAccountAddress({
  accountClassHash,
  accountProxyClassHash,
  publicKey,
}: GenerateAccountAddressParams): string {
  const callData = CallData.compile({
    implementation: accountClassHash,
    selector: hash.getSelectorFromName('initialize'),
    calldata: CallData.compile({
      signer: publicKey,
      guardian: '0',
    }),
  });

  const address = hash.calculateContractAddressFromHash(
    publicKey,
    accountProxyClassHash,
    callData,
    0,
  );

  return address;
}
