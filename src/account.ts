import { keyDerivation } from '@starkware-industries/starkware-crypto-utils';
import * as Starknet from 'starknet';

import type { ParadexConfig } from './config.js';
import * as ethereumSigner from './ethereum-signer.js';
import * as starknetSigner from './starknet-signer.js';
import type { Hex } from './types.js';

export interface Account extends Starknet.Account {}

interface FromEthSignerParams {
  readonly provider: Starknet.ProviderOptions | Starknet.ProviderInterface;
  readonly config: ParadexConfig;
  readonly signer: ethereumSigner.EthereumSigner;
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
  const starkKeyTypedData = ethereumSigner.buildEthereumStarkKeyTypedData(
    config.ethereumChainId,
  );
  const seed = await signer.signTypedData(starkKeyTypedData);
  const additionalSeed = await signer.signTypedData(starkKeyTypedData);
  if (seed !== additionalSeed)
    throw new Error(
      'Wallet does not support deterministic signing. Please use different wallet.',
    );
  const privateKey = keyDerivation.getPrivateKeyFromEthSignature(seed);
  const publicKey = keyDerivation.privateToStarkKey(privateKey);
  const address = generateAccountAddress({
    publicKey: `0x${publicKey}`,
    accountClassHash: config.paraclearAccountHash,
    accountProxyClassHash: config.paraclearAccountProxyHash,
  });
  return new Starknet.Account(provider, address, `0x${privateKey}`);
}

interface FromStarknetAccountParams {
  /** Paradex chain provider */
  readonly provider: Starknet.ProviderOptions | Starknet.ProviderInterface;
  readonly config: ParadexConfig;
  readonly account: Starknet.AccountInterface;
  readonly starknetProvider?: Starknet.ProviderInterface;
}

/**
 * Generates a Paradex account from a Starknet signer.
 * @returns The generated Paradex account.
 */
export async function fromStarknetAccount({
  provider,
  config,
  account,
  starknetProvider,
}: FromStarknetAccountParams): Promise<Account> {
  const starkKeyTypedData = starknetSigner.buildStarknetStarkKeyTypedData(
    config.starknetChainId,
  );

  const accountSupport = await starknetSigner.getAccountSupport(
    account,
    starknetProvider ??
      starknetSigner.getPublicProvider(config.starknetChainId),
  );
  const signature = await account.signMessage(starkKeyTypedData);
  const additionalSignature = await account.signMessage(starkKeyTypedData);
  if (!isStarknetSignatureEqual(signature, additionalSignature))
    throw new Error(
      'Wallet does not support deterministic signing. Please use different wallet.',
    );
  const seed = accountSupport.getSeedFromSignature(signature);
  const [privateKey, publicKey] =
    await starknetSigner.getStarkKeypairFromStarknetSignature(seed);
  const address = generateAccountAddress({
    publicKey: `0x${publicKey}`,
    accountClassHash: config.paraclearAccountHash,
    accountProxyClassHash: config.paraclearAccountProxyHash,
  });
  return new Starknet.Account(provider, address, `0x${privateKey}`);
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

/**
 * Checks if starknet signatures are equal.
 */
export function isStarknetSignatureEqual(
  signature: Starknet.Signature,
  additionalSignature: Starknet.Signature,
): boolean {
  if (Array.isArray(signature) && Array.isArray(additionalSignature)) {
    return (
      signature.length === additionalSignature.length &&
      signature.every((value, index) => value === additionalSignature[index])
    );
  }
  // Cast Starknet.WeierstrassSignatureType
  const signatureWeierstrass = signature as Starknet.WeierstrassSignatureType;
  const additionalSignatureWeierstrass =
    additionalSignature as Starknet.WeierstrassSignatureType;
  return (
    signatureWeierstrass.r === additionalSignatureWeierstrass.r &&
    signatureWeierstrass.s === additionalSignatureWeierstrass.s
  );
}
