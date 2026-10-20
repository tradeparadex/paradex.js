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

/**
 * Options controlling how the Paradex account address is resolved.
 */
export interface AddressDerivationOptions {
  /**
   * When true, fetch the account address from the Paradex API
   * (`GET /onboarding`) instead of computing it locally from the class hashes
   * in the config. Use this for accounts created with the current account
   * class, whose address local derivation does not reproduce.
   * Defaults to false.
   */
  readonly serverDeriveAddress?: boolean;
  /**
   * Paradex REST API base URL used when `serverDeriveAddress` is true.
   * Defaults to `config.paradexApiUrl`.
   */
  readonly apiUrl?: string;
}

interface DeriveFromEthSignerParams extends AddressDerivationOptions {
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
  serverDeriveAddress,
  apiUrl,
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
  const address = await resolveAccountAddress({
    config,
    publicKey: `0x${publicKey}`,
    serverDeriveAddress,
    apiUrl,
  });
  return {
    address,
    privateKey: `0x${privateKey}`,
  };
}

interface FromEthSignerParams extends AddressDerivationOptions {
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
  serverDeriveAddress,
  apiUrl,
}: FromEthSignerParams): Promise<Account> {
  const credentials = await deriveFromEthSigner({
    config,
    signer,
    serverDeriveAddress,
    apiUrl,
  });
  return new Starknet.Account({
    provider,
    address: credentials.address,
    signer: credentials.privateKey,
  });
}

interface DeriveFromStarknetAccountParams extends AddressDerivationOptions {
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
  serverDeriveAddress,
  apiUrl,
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
  const address = await resolveAccountAddress({
    config,
    publicKey: `0x${publicKey}`,
    serverDeriveAddress,
    apiUrl,
  });
  return {
    address,
    privateKey: `0x${privateKey}`,
  };
}

interface FromStarknetAccountParams extends AddressDerivationOptions {
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
  serverDeriveAddress,
  apiUrl,
}: FromStarknetAccountParams): Promise<Account> {
  const credentials = await deriveFromStarknetAccount({
    config,
    account,
    starknetProvider,
    rpcUrl,
    serverDeriveAddress,
    apiUrl,
  });
  return new Starknet.Account({
    provider,
    address: credentials.address,
    signer: credentials.privateKey,
  });
}

/**
 * Class hash(es) the Paradex API used to derive an account address.
 */
export interface OnboardingDerivationInfo {
  readonly classHash: Hex;
  /** Present only for accounts deployed behind the legacy proxy class. */
  readonly proxyClassHash?: Hex;
}

/**
 * Onboarding status of a Starknet public key, as reported by the Paradex API.
 */
export interface OnboardingInfo {
  /** The Paradex account address for the public key. */
  readonly address: Hex;
  /** Whether the account has already been onboarded. */
  readonly exists: boolean;
  readonly accountSignerType: string;
  readonly derivationInfo?: OnboardingDerivationInfo;
}

interface RawOnboardingInfo {
  readonly address: Hex;
  readonly exists: boolean;
  readonly account_signer_type: string;
  readonly derivation_info?: {
    readonly class_hash: Hex;
    readonly proxy_class_hash?: Hex;
  };
}

interface FetchOnboardingParams {
  /** Paradex REST API base URL, e.g. `https://api.testnet.paradex.trade/v1` */
  readonly apiUrl: string;
  /** Paradex (Stark) public key in hex format */
  readonly publicKey: Hex;
}

/**
 * Fetches the account address and onboarding status for a Starknet public key
 * from the Paradex API. Public endpoint, no authentication required.
 */
export async function fetchOnboarding({
  apiUrl,
  publicKey,
}: FetchOnboardingParams): Promise<OnboardingInfo> {
  const query = new URLSearchParams({
    account_signer_type: 'starknet',
    public_key: publicKey,
  });
  const resp = await fetch(
    `${apiUrl.replace(/\/+$/, '')}/onboarding?${query.toString()}`,
  );

  if (!resp.ok) {
    const detail = await readErrorMessage(resp);
    throw new Error(
      `Failed to fetch Paradex onboarding info: ${resp.statusText} ${resp.status}` +
        (detail != null ? ` (${detail})` : ''),
    );
  }

  const raw = (await resp.json()) as Partial<RawOnboardingInfo>;
  if (typeof raw.address !== 'string' || !raw.address.startsWith('0x')) {
    throw new Error('Paradex onboarding response is missing the address');
  }

  return {
    address: raw.address,
    exists: raw.exists === true,
    accountSignerType: raw.account_signer_type ?? 'starknet',
    ...(raw.derivation_info != null
      ? {
          derivationInfo: {
            classHash: raw.derivation_info.class_hash,
            ...(raw.derivation_info.proxy_class_hash != null
              ? { proxyClassHash: raw.derivation_info.proxy_class_hash }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * Returns the `message` field of a Paradex API error body, if there is one.
 */
async function readErrorMessage(resp: Response): Promise<string | undefined> {
  try {
    const body = (await resp.json()) as { message?: unknown };
    return typeof body.message === 'string' && body.message !== ''
      ? body.message
      : undefined;
  } catch {
    return undefined;
  }
}

interface ResolveAccountAddressParams extends AddressDerivationOptions {
  readonly config: ParadexConfig;
  readonly publicKey: Hex;
}

/**
 * Resolves the account address either from the Paradex API or locally.
 */
async function resolveAccountAddress({
  config,
  publicKey,
  serverDeriveAddress,
  apiUrl,
}: ResolveAccountAddressParams): Promise<Hex> {
  if (serverDeriveAddress !== true) {
    return generateAccountAddress({
      publicKey,
      accountClassHash: config.paraclearAccountHash,
      accountProxyClassHash: config.paraclearAccountProxyHash,
    });
  }

  const resolvedApiUrl = apiUrl ?? config.paradexApiUrl;
  if (resolvedApiUrl == null || resolvedApiUrl === '') {
    throw new Error(
      'serverDeriveAddress requires an API URL: pass apiUrl or use a config from Config.fetch()',
    );
  }

  const info = await fetchOnboarding({ apiUrl: resolvedApiUrl, publicKey });
  return info.address;
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
