import { BigNumber } from 'bignumber.js';
import * as Starknet from 'starknet';

import type { Account } from './account.js';
import type { ParadexConfig } from './config.js';
import type { ParaclearProvider } from './paraclear-provider.js';

interface GetBalanceParams {
  readonly config: ParadexConfig;
  readonly provider: Pick<ParaclearProvider, 'callContract'>;
  /**
   * Account to get the balance for.
   */
  readonly account: Pick<Account, 'address'>;
  /**
   * Token symbol.
   * @example 'USDC'
   */
  readonly token: string;
}

interface GetBalanceResult {
  /**
   * Token balance as a decimal string.
   * @example '100.45'
   * @example '45.2'
   */
  readonly size: string;
}

/**
 * Get the Paraclear balance of the given token for the given account.
 */
export async function getTokenBalance(
  params: GetBalanceParams,
): Promise<GetBalanceResult> {
  const token = params.config.bridgedTokens[params.token];

  if (token == null) {
    throw new Error(`Token ${params.token} is not supported`);
  }

  const [result] = await params.provider.callContract(
    {
      contractAddress: params.config.paraclearAddress,
      entrypoint: 'getTokenAssetBalance',
      calldata: Starknet.CallData.compile([
        params.account.address,
        token.l2TokenAddress,
      ]),
    },
    'latest',
  );

  if (result == null) {
    throw new Error('Failed to get token balance');
  }

  const resultBn = new BigNumber(result);
  if (resultBn.isNaN()) {
    throw new Error('Failed to parse token balance');
  }

  const chainSizeBn = resultBn;

  const sizeBn = fromChainSize(chainSizeBn, params.config.paraclearDecimals);

  return { size: sizeBn.toString() };
}

function fromChainSize(size: BigNumber, decimals: number): string {
  return new BigNumber(size).div(10 ** decimals).toString();
}
