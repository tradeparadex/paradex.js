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

interface GetSocializedLossFactorParams {
  readonly config: ParadexConfig;
  readonly provider: Pick<ParaclearProvider, 'callContract'>;
}

interface GetSocializedLossFactorResult {
  readonly socializedLossFactor: string;
}

/**
 * Socialized losses happen when Paradex Insurance Fund is bankrupt
 * due to large amounts of unprofitable liquidations. When socialized
 * losses are active, (socialized loss factor > 0), the amount that
 * the user will receive when withdrawing will be smaller than the
 * requested amount.
 */
export async function getSocializedLossFactor(
  params: GetSocializedLossFactorParams,
): Promise<GetSocializedLossFactorResult> {
  const [result] = await params.provider.callContract({
    contractAddress: params.config.paraclearAddress,
    entrypoint: 'getSocializedLossFactor',
  });

  if (result == null) {
    throw new Error('Failed to get socialized loss factor');
  }

  const resultBn = new BigNumber(result);
  if (resultBn.isNaN()) {
    throw new Error('Failed to parse socialized loss factor');
  }

  const chainFactorBn = resultBn;

  const factorBn = fromChainSize(
    chainFactorBn,
    params.config.paraclearDecimals,
  );

  return { socializedLossFactor: factorBn.toString() };
}

interface GetReceivableAmountParams {
  readonly config: ParadexConfig;
  readonly provider: Pick<ParaclearProvider, 'callContract'>;
  /**
   * Amount of to withdraw from Paradex, as a decimal string.
   * The receivable amount will be calculated based on this amount and
   * can be less than the requested amount if socialized loss is active.
   */
  readonly amount: string;
}

interface GetReceivableAmountResult {
  /**
   * Amount that will be received from Paradex, after socialized loss,
   * if applicable, after a withdrawal of the given amount parameter.
   * Decimal string.
   * @example '99.45'
   */
  readonly receivableAmount: string;
  /**
   * The receivable amount, converted to be used in chain calls,
   * using the Paraclear decimals.
   * @example '9945000000'
   */
  readonly receivableAmountChain: string;
  /**
   * Socialized loss factor used to calculate the receivable amount.
   * Decimal string.
   * @example '0.05'
   */
  readonly socializedLossFactor: string;
}

/**
 * The receivable amount is calculated based on the current
 * socialized loss factor: amount * (1 - socializedLossFactor)
 *
 * If the socialized loss factor is 0, the receivable amount
 * will be equal to the requested amount.
 */
export async function getReceivableAmount(
  params: GetReceivableAmountParams,
): Promise<GetReceivableAmountResult> {
  const amountBn = new BigNumber(params.amount);

  if (amountBn.isNaN()) {
    throw new Error('Invalid amount');
  }

  const { socializedLossFactor } = await getSocializedLossFactor({
    config: params.config,
    provider: params.provider,
  });

  const receivableAmount = amountBn.times(
    BigNumber(1).minus(socializedLossFactor),
  );

  const receivableAmountChain = toChainSize(
    receivableAmount.toString(),
    params.config.paraclearDecimals,
  );

  return {
    receivableAmount: receivableAmount.toString(),
    receivableAmountChain: receivableAmountChain.toString(),
    socializedLossFactor,
  };
}

function fromChainSize(size: BigNumber, decimals: number): string {
  return new BigNumber(size).div(10 ** decimals).toString();
}

function toChainSize(size: string, decimals: number): BigNumber {
  return new BigNumber(size).times(10 ** decimals);
}
