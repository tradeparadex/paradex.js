import * as Starknet from 'starknet';

import type { ParadexConfig } from './config.js';
import {
  DeterminismGuardError,
  hasContractCode,
  publicKeyForms,
  type DeterminismGuardOptions,
  type DeterminismGuardResult,
} from './determinism-guard.js';
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
  /**
   * Check the derived key against the wallet's existing account before
   * trusting it. See `DeterminismGuardOptions`.
   * @experimental
   */
  readonly determinismGuard?: boolean | DeterminismGuardOptions;
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
  determinismGuard,
}: DeriveFromEthSignerParams): Promise<AccountCredentials> {
  if (determinismGuard != null && determinismGuard !== false) {
    return await deriveFromEthSignerGuarded({
      config,
      signer,
      apiUrl,
      options: determinismGuard === true ? {} : determinismGuard,
    });
  }
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

const NON_DETERMINISTIC_MESSAGE =
  'Wallet does not support deterministic signing. Please use different wallet.';

interface DeriveFromEthSignerGuardedParams {
  readonly config: ParadexConfig;
  readonly signer: ethereumSigner.EthereumSigner;
  readonly apiUrl?: string;
  readonly options: DeterminismGuardOptions;
}

/**
 * Derives the key from one signature and accepts it when an account already
 * holds it. When none does, refuses a wallet that already owns an account
 * (its key would differ from the stored one), and otherwise asks for a
 * second signature to test determinism before a new account is created.
 *
 * Every lookup failure throws, so a guarded derivation never returns
 * credentials for an account it could not check.
 */
async function deriveFromEthSignerGuarded({
  config,
  signer,
  apiUrl,
  options,
}: DeriveFromEthSignerGuardedParams): Promise<AccountCredentials> {
  const resolvedApiUrl = apiUrl ?? config.paradexApiUrl;
  if (resolvedApiUrl == null || resolvedApiUrl === '') {
    throw new DeterminismGuardError(
      'invalid_options',
      'determinismGuard requires an API URL: pass apiUrl or use a config from Config.fetch()',
    );
  }

  const walletAddressAsGiven = await resolveWalletAddress(signer, options);
  const walletAddress = walletAddressAsGiven.toLowerCase();

  if (options.contractCodeCheck !== false) {
    const signerGetCode = signer.getCode;
    const providers =
      options.codeProviders ??
      (signerGetCode != null
        ? [
            {
              getCode: async (a: string) => await signerGetCode.call(signer, a),
            },
          ]
        : []);
    if (providers.length === 0) {
      throw new DeterminismGuardError(
        'invalid_options',
        'determinismGuard needs a provider to check the wallet for contract code: ' +
          'pass codeProviders, use a signer with a provider, or set contractCodeCheck: false',
      );
    }
    if (
      await hasContractCode(
        walletAddress,
        providers,
        options.contractCodeTimeoutMs,
      )
    ) {
      throw new DeterminismGuardError(
        'contract_wallet',
        'This wallet is a smart contract wallet, which cannot derive a Paradex key. ' +
          'Use a regular wallet (EOA).',
      );
    }
  }

  const starkKeyTypedData = ethereumSigner.buildEthereumStarkKeyTypedData(
    config.ethereumChainId,
  );
  const seed = await signer.signTypedData(starkKeyTypedData);
  const privateKey = keyDerivation.getPrivateKeyFromEthSignature(seed);
  const publicKey: Hex = `0x${keyDerivation.privateToStarkKey(privateKey)}`;

  let byKey: OnboardingInfo | undefined;
  for (const candidate of publicKeyForms(publicKey)) {
    const result = await guardedLookup({
      apiUrl: resolvedApiUrl,
      publicKey: candidate,
    });
    if (!result.ok) throw lookupFailed(result);
    if (result.info.exists) {
      return await accept({
        kind: 'existing',
        signatures: 1,
        walletAddress,
        address: result.info.address,
        publicKey,
        privateKey,
        options,
      });
    }
    byKey ??= result.info;
  }
  if (byKey == null) {
    throw new DeterminismGuardError(
      'lookup_failed',
      'No public key to look up',
    );
  }

  const byWallet = await guardedLookup({
    apiUrl: resolvedApiUrl,
    ethAddress: walletAddressAsGiven,
  });
  if (
    byWallet.ok &&
    byWallet.info.exists &&
    byWallet.info.accountSignerType === 'eip191'
  ) {
    throw new DeterminismGuardError(
      'evm_owned_account',
      'This wallet owns an EVM-owned Paradex account, which is used through ' +
        'a session (SessionConnector), not a derived key. Do not onboard a new account.',
    );
  }
  // 400: the wallet is already linked to an account of another signer type,
  // which for a wallet deriving a Stark key is its Stark account.
  if (
    (byWallet.ok && byWallet.info.exists) ||
    (!byWallet.ok && byWallet.status === 400)
  ) {
    throw new DeterminismGuardError(
      'key_mismatch',
      'This wallet already has a Paradex account, but the key it derived does not match ' +
        "the account's key. The wallet may not sign deterministically. Do not onboard a new account.",
    );
  }
  if (!byWallet.ok) throw lookupFailed(byWallet);

  const additionalSeed = await signer.signTypedData(starkKeyTypedData);
  if (seed !== additionalSeed) {
    throw new DeterminismGuardError(
      'non_deterministic',
      NON_DETERMINISTIC_MESSAGE,
    );
  }
  return await accept({
    kind: 'new',
    signatures: 2,
    walletAddress,
    address: byKey.address,
    publicKey,
    privateKey,
    options,
  });
}

async function resolveWalletAddress(
  signer: ethereumSigner.EthereumSigner,
  options: DeterminismGuardOptions,
): Promise<string> {
  const signerAddress =
    signer.getAddress != null ? await signer.getAddress() : undefined;
  if (
    options.walletAddress != null &&
    signerAddress != null &&
    options.walletAddress.toLowerCase() !== signerAddress.toLowerCase()
  ) {
    throw new DeterminismGuardError(
      'invalid_options',
      'walletAddress does not match the address the signer reports',
    );
  }
  const address = options.walletAddress ?? signerAddress;
  if (address == null) {
    throw new DeterminismGuardError(
      'invalid_options',
      'determinismGuard needs the wallet address: pass walletAddress or use a signer with getAddress',
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new DeterminismGuardError(
      'invalid_options',
      'walletAddress must be a 0x-prefixed 20-byte address',
    );
  }
  return address;
}

function lookupFailed(
  result: Extract<OnboardingResult, { ok: false }>,
): DeterminismGuardError {
  return new DeterminismGuardError(
    'lookup_failed',
    `Paradex onboarding lookup failed: ${result.statusText} ${result.status}` +
      (result.detail != null ? ` (${result.detail})` : ''),
  );
}

/**
 * `requestOnboarding` with network and response-parsing errors turned into
 * `lookup_failed`, so every failed lookup surfaces as a guard error.
 */
async function guardedLookup(
  params: FetchOnboardingParams,
): Promise<OnboardingResult> {
  try {
    return await requestOnboarding(params);
  } catch (error) {
    throw new DeterminismGuardError(
      'lookup_failed',
      `Paradex onboarding lookup failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function accept({
  privateKey,
  options,
  ...result
}: DeterminismGuardResult & {
  readonly privateKey: string;
  readonly options: DeterminismGuardOptions;
}): Promise<AccountCredentials> {
  await options.onResult?.(result);
  return { address: result.address, privateKey: `0x${privateKey}` };
}

interface FromEthSignerParams extends AddressDerivationOptions {
  readonly provider: Starknet.ProviderOptions | Starknet.ProviderInterface;
  readonly config: ParadexConfig;
  readonly signer: ethereumSigner.EthereumSigner;
  /** @experimental See `DeterminismGuardOptions`. */
  readonly determinismGuard?: boolean | DeterminismGuardOptions;
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
  determinismGuard,
}: FromEthSignerParams): Promise<Account> {
  const credentials = await deriveFromEthSigner({
    config,
    signer,
    serverDeriveAddress,
    apiUrl,
    determinismGuard,
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
  const result = await requestOnboarding(params);
  if (!result.ok) {
    throw new Error(
      `Failed to fetch Paradex onboarding info: ${result.statusText} ${result.status}` +
        (result.detail != null ? ` (${result.detail})` : ''),
    );
  }
  return result.info;
}

type OnboardingResult =
  | { readonly ok: true; readonly info: OnboardingInfo }
  | {
      readonly ok: false;
      readonly status: number;
      readonly statusText: string;
      readonly detail?: string;
    };

/**
 * `GET /onboarding`, returning the HTTP status of a failed lookup instead of
 * throwing, so a caller can act on a specific status.
 */
async function requestOnboarding(
  params: FetchOnboardingParams,
): Promise<OnboardingResult> {
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
    return {
      ok: false,
      status: resp.status,
      statusText: resp.statusText,
      ...(detail != null ? { detail } : {}),
    };
  }

  const raw = (await resp.json()) as Partial<RawOnboardingInfo>;
  if (typeof raw.address !== 'string' || !raw.address.startsWith('0x')) {
    throw new Error('Paradex onboarding response is missing the address');
  }

  return {
    ok: true,
    info: {
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
    },
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
