import type { Signature, SignerInterface, TypedData } from 'starknet';
import * as Starknet from 'starknet';

import { STARKNET_MAINNET_CHAIN_ID } from './constants.js';
import * as keyDerivation from './key-derivation.js';
import { AccountSupport } from './starknet-account-support.js';

export type { SignerInterface as Signer, TypedData, Signature };

export function buildStarknetStarkKeyTypedData(
  starknetChainId: string,
): TypedData {
  return {
    domain: {
      name: 'Paradex',
      chainId: starknetChainId,
      version: '1',
    },
    primaryType: 'Constant',
    types: {
      StarkNetDomain: [
        { name: 'name', type: 'felt' },
        { name: 'version', type: 'felt' },
        { name: 'chainId', type: 'felt' },
      ],
      Constant: [{ name: 'action', type: 'felt' }],
    },
    message: {
      action: 'STARK Key',
    },
  };
}

type StarknetKeypair = [string, string];

/**
 * Mirrors `getPrivateKeyFromEthSignature()` in `./key-derivation.ts`:
 * the deterministic signature R segment, hex encoded, is the `keySeed`
 * for `grindKey()` along the Stark curve.
 */
export async function getStarkKeypairFromStarknetSignature(
  signatureR: string,
): Promise<StarknetKeypair> {
  const r = signatureR.replace(/^0x/u, '');
  const privateKey = keyDerivation.grindKey(r);
  const publicKey = keyDerivation.privateToStarkKey(privateKey);
  return [privateKey, publicKey];
}

export async function getAccountSupport(
  account: Starknet.AccountInterface,
  starknetProvider: Starknet.ProviderInterface,
): Promise<AccountSupport> {
  const classHash = await getAccountClassHash(
    starknetProvider,
    account.address,
  );

  const contract = await buildAccountContract(
    starknetProvider,
    account.address,
  );

  const accountSupport = new AccountSupport(contract, classHash);

  try {
    const supportCheckResult = await accountSupport.check();

    if (!supportCheckResult.ok) {
      const message =
        supportCheckResult.reason ??
        'Unspecified error checking account support';
      throw new Error(message);
    }
  } catch (cause) {
    const message = 'Error checking account support. Please try again.';
    throw new Error(message);
  }

  return accountSupport;
}

const RPC_NODES_MAINNET: readonly string[] = [
  'https://rpc.starknet.lava.build/rpc/v0_9',
  'https://api-starknet-mainnet.n.dwellir.com/79e509c1-b94b-4146-ac66-efdc56786415/rpc/v0_9',
];
const RPC_NODES_TESTNET: readonly string[] = [
  'https://rpc.starknet-testnet.lava.build/rpc/v0_9',
  'https://api-starknet-sepolia.n.dwellir.com/79e509c1-b94b-4146-ac66-efdc56786415/rpc/v0_9',
  'https://starknet.api.onfinality.io/public',
];

export function getPublicProvider(chainId: string): Starknet.ProviderInterface {
  const nodes =
    chainId === STARKNET_MAINNET_CHAIN_ID
      ? RPC_NODES_MAINNET
      : RPC_NODES_TESTNET;
  const randIdx = Math.floor(Math.random() * nodes.length);
  const node = nodes[randIdx];
  if (node == null) throw new Error('No public provider defined');
  const provider = new Starknet.RpcProvider({ nodeUrl: node });
  return provider;
}

async function getAccountClassHash(
  provider: Starknet.ProviderInterface,
  accountAddress: string,
): Promise<string> {
  try {
    const classHash = await provider.getClassHashAt(accountAddress);
    return classHash;
  } catch (cause) {
    const message =
      'Cannot determine account type. Make sure your' +
      ' account contract is deployed and try again.';
    throw new Error(message);
  }
}

async function buildAccountContract(
  provider: Starknet.ProviderInterface,
  accountAddress: string,
): Promise<Starknet.Contract> {
  const accountClass = await provider.getClassAt(accountAddress);
  const contract = new Starknet.Contract({
    abi: accountClass.abi,
    address: accountAddress,
    providerOrAccount: provider,
  });
  return contract;
}
