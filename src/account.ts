import * as Starknet from 'starknet';

import type { ParadexConfig } from './config.js';
import * as ethereumSigner from './ethereum-signer.js';
import * as keyDerivation from './key-derivation.js';
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
   * Fetch the account address from the Paradex API (`GET /onboarding`).
   * The API returns the stored address of an existing account of either
   * account class, and the current-class address for a new one.
   * Defaults to true.
   *
   * Pass false to compute the address locally from the class hashes in the
   * config, with no request. That computes the legacy proxy-class address,
   * which is only right for accounts created with the legacy class.
   */
  readonly serverDeriveAddress?: boolean;
  /**
   * Paradex REST API base URL used to fetch the address.
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
 * Onboarding status of a Starknet public key, or of an EVM wallet's
 * EVM-owned account, as reported by the Paradex API.
 */
export interface OnboardingInfo {
  /** The Paradex account address for the public key or wallet. */
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

type FetchOnboardingParams = {
  /** Paradex REST API base URL, e.g. `https://api.testnet.paradex.trade/v1` */
  readonly apiUrl: string;
} & (
  | {
      /** Paradex (Stark) public key in hex format */
      readonly publicKey: Hex;
      readonly ethAddress?: undefined;
    }
  | {
      /**
       * The owner wallet of an EVM-owned (EIP-191) account. For a wallet with
       * no account yet, the address is the one its first session grant opens.
       */
      readonly ethAddress: string;
      readonly publicKey?: undefined;
    }
);

/**
 * Fetches the account address and onboarding status for a Starknet public key,
 * or for the wallet of an EVM-owned account, from the Paradex API. Public
 * endpoint, no authentication required.
 */
export async function fetchOnboarding(
  params: FetchOnboardingParams,
): Promise<OnboardingInfo> {
  const { apiUrl } = params;
  let query: URLSearchParams;
  if (params.ethAddress != null) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(params.ethAddress)) {
      throw new Error('ethAddress must be a 0x-prefixed 20-byte address');
    }
    query = new URLSearchParams({
      account_signer_type: 'eip191',
      eth_address: params.ethAddress,
    });
  } else {
    query = new URLSearchParams({
      account_signer_type: 'starknet',
      public_key: params.publicKey,
    });
  }
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
 * Resolves the account address from the Paradex API, or locally when
 * `serverDeriveAddress` is false. A failed request throws: it never falls
 * back to the local address, which can belong to a different account.
 */
async function resolveAccountAddress({
  config,
  publicKey,
  serverDeriveAddress = true,
  apiUrl,
}: ResolveAccountAddressParams): Promise<Hex> {
  if (!serverDeriveAddress) {
    return generateAccountAddress({
      publicKey,
      accountClassHash: config.paraclearAccountHash,
      accountProxyClassHash: config.paraclearAccountProxyHash,
    });
  }

  const resolvedApiUrl = apiUrl ?? config.paradexApiUrl;
  if (resolvedApiUrl == null || resolvedApiUrl === '') {
    throw new Error(
      'The account address comes from the Paradex API, which needs an API URL: ' +
        'pass apiUrl or use a config from Config.fetch(). ' +
        OPT_OUT_HINT,
    );
  }

  let info: OnboardingInfo;
  try {
    info = await fetchOnboarding({ apiUrl: resolvedApiUrl, publicKey });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw Object.assign(
      new Error(
        `Could not fetch the account address from GET /onboarding: ${reason}. ` +
          `Retry. ${OPT_OUT_HINT}`,
      ),
      { cause: error },
    );
  }
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(info.address)) {
    throw new Error(
      `GET /onboarding returned an invalid account address: ${info.address}`,
    );
  }
  return info.address;
}

const OPT_OUT_HINT =
  'Pass serverDeriveAddress: false only if local derivation is right for ' +
  'this account (only accounts created with the legacy proxy class).';

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
