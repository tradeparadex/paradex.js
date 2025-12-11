import { keyDerivation } from '@starkware-industries/starkware-crypto-utils';
import * as Starknet from 'starknet';

import type { ParadexConfig } from './config.js';
import * as ethereumSigner from './ethereum-signer.js';
import * as starknetSigner from './starknet-signer.js';
import type { Hex } from './types.js';

export interface Account extends Starknet.Account {}

/**
 * Account credentials (internal use only)
 * @internal
 */
export interface AccountCredentials {
  readonly address: Hex;
  readonly privateKey: Hex;
}

interface DeriveFromEthSignerParams {
  readonly config: ParadexConfig;
  readonly signer: ethereumSigner.EthereumSigner;
}

/**
 * Derives Paradex account credentials from an Ethereum wallet.
 * Internal use only - use ParadexClient.createFromEthSigner() instead.
 * @internal
 * @returns The account address and private key.
 */
export async function deriveFromEthSigner({
  config,
  signer,
}: DeriveFromEthSignerParams): Promise<AccountCredentials> {
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
  return {
    address,
    privateKey: `0x${privateKey}`,
  };
}

interface FromEthSignerParams {
  readonly provider: Starknet.ProviderOptions | Starknet.ProviderInterface;
  readonly config: ParadexConfig;
  readonly signer: ethereumSigner.EthereumSigner;
}

/**
 * Generates a Paradex account from an Ethereum wallet.
 * @deprecated Use deriveFromEthSigner() and pass credentials to DefaultProvider constructor
 * @returns The generated Paradex account.
 */
export async function fromEthSigner({
  provider,
  config,
  signer,
}: FromEthSignerParams): Promise<Account> {
  const credentials = await deriveFromEthSigner({ config, signer });
  return new Starknet.Account({
    provider,
    address: credentials.address,
    signer: credentials.privateKey,
  });
}

interface DeriveFromStarknetAccountParams {
  readonly config: ParadexConfig;
  readonly account: Starknet.AccountInterface;
  readonly starknetProvider?: Starknet.ProviderInterface;
  readonly rpcUrl?: string;
}

/**
 * Derives Paradex account credentials from a Starknet account.
 * Internal use only - use ParadexClient.createFromStarknetAccount() instead.
 * @internal
 * @returns The account address and private key.
 */
export async function deriveFromStarknetAccount({
  config,
  account,
  starknetProvider,
  rpcUrl,
}: DeriveFromStarknetAccountParams): Promise<AccountCredentials> {
  const starkKeyTypedData = starknetSigner.buildStarknetStarkKeyTypedData(
    config.starknetChainId,
  );

  const provider =
    starknetProvider ??
    (rpcUrl != null
      ? new Starknet.RpcProvider({ nodeUrl: rpcUrl })
      : starknetSigner.getPublicProvider(config.starknetChainId));

  const accountSupport = await starknetSigner.getAccountSupport(
    account,
    provider,
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
  return {
    address,
    privateKey: `0x${privateKey}`,
  };
}

interface FromStarknetAccountParams {
  /** Paradex chain provider */
  readonly provider: Starknet.ProviderOptions | Starknet.ProviderInterface;
  readonly config: ParadexConfig;
  readonly account: Starknet.AccountInterface;
  readonly starknetProvider?: Starknet.ProviderInterface;
  readonly rpcUrl?: string;
}

/**
 * Generates a Paradex account from a Starknet signer.
 * @deprecated Use deriveFromStarknetAccount() and pass credentials to DefaultProvider constructor
 * @returns The generated Paradex account.
 */
export async function fromStarknetAccount({
  provider,
  config,
  account,
  starknetProvider,
  rpcUrl,
}: FromStarknetAccountParams): Promise<Account> {
  const credentials = await deriveFromStarknetAccount({
    config,
    account,
    starknetProvider,
    rpcUrl,
  });
  return new Starknet.Account({
    provider,
    address: credentials.address,
    signer: credentials.privateKey,
  });
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
