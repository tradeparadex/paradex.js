import { keyDerivation } from '@starkware-industries/starkware-crypto-utils';
import type {
  AccountInterface,
  Signature,
  SignerInterface,
  TypedData,
} from 'starknet';
import * as Starknet from 'starknet';

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
 * This function borrows from starkware-crypto-utils's implementation
 * of `getPrivateKeyFromEthSignature()` where a deterministic
 * signature R segment, is hex encoded as the `keySeed` for
 * `grindKey()` along the Stark curve.
 */
export async function getStarkKeypairFromStarknetSignature(
  signatureR: string,
): Promise<StarknetKeypair> {
  const curve = keyDerivation.StarkExEc;
  if (curve == null) {
    throw new Error('StarkExEc curve is not defined');
  }
  const r = signatureR.replace(/^0x/u, '');
  const privateKey = keyDerivation.grindKey(r, curve);
  const publicKey = keyDerivation.privateToStarkKey(privateKey);
  return [privateKey, publicKey];
}

export async function getAccountSupport(
  account: Starknet.AccountInterface,
): Promise<AccountSupport> {
  const classHash = await getAccountClassHash(account);

  const contract = await buildAccountContract(account);

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

async function getAccountClassHash(
  account: Starknet.AccountInterface,
): Promise<string> {
  try {
    const classHash = await account.getClassHashAt(account.address);
    return classHash;
  } catch (cause) {
    const message =
      'Cannot determine account type. Make sure your' +
      ' account contract is deployed and try again.';
    throw new Error(message);
  }
}

async function buildAccountContract(
  account: AccountInterface,
): Promise<Starknet.Contract> {
  const accountClass = await account.getClassAt(account.address);
  const contract = new Starknet.Contract(
    accountClass.abi,
    account.address,
    account,
  );
  return contract;
}
