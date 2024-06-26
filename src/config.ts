import * as Starknet from 'starknet';

import type { Hex } from './types.js';

interface RawBridgedTokenConfig {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly l1_token_address: Hex;
  readonly l1_bridge_address: Hex;
  readonly l2_token_address: Hex;
  readonly l2_bridge_address: Hex;
}

export interface RawParadexConfig {
  readonly starknet_gateway_url: string;
  readonly starknet_fullnode_rpc_url: string;

  readonly starknet_chain_id: string;
  readonly block_explorer_url: string;
  readonly paraclear_address: Hex;
  readonly paraclear_decimals: number;
  readonly paraclear_account_proxy_hash: Hex;
  readonly paraclear_account_hash: Hex;
  readonly bridged_tokens: readonly RawBridgedTokenConfig[];
  readonly l1_core_contract_address: Hex;
  readonly l1_operator_address: Hex;
  readonly l1_chain_id: string;
}

interface BridgedTokenConfig {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly l1TokenAddress: Hex;
  readonly l1BridgeAddress: Hex;
  readonly l2TokenAddress: Hex;
  readonly l2BridgeAddress: Hex;
}

export interface ParadexConfig {
  readonly starknetFullNodeRpcUrl: string;
  readonly starknetChainId: string;
  readonly l1ChainId: string;
  /** Derived from `l1ChainId` */
  readonly l2ChainId: string;
  readonly paraclearAccountHash: Hex;
  readonly paraclearAccountProxyHash: Hex;
  readonly paraclearAddress: Hex;
  readonly paraclearDecimals: number;
  readonly bridgedTokens: Record<string, BridgedTokenConfig>;
}

type ParadexEnvironment = 'testnet' | 'prod';

/**
 * Fetches the Paradex config for the given environment.
 * This is required for account derivation.
 */
export async function fetchConfig(
  environment: ParadexEnvironment,
): Promise<ParadexConfig> {
  assertParadexEnvironment(environment);
  const apiUrl = getParadexApiUrl(environment);
  const resp = await fetch(`${apiUrl}/system/config`);

  if (!resp.ok) {
    throw new Error(
      `Failed to fetch Paradex config: ${resp.statusText} ${resp.status}`,
    );
  }

  const jsonResp = await resp.json();
  const config = jsonResp as RawParadexConfig;

  return buildConfig(config);
}

function assertParadexEnvironment(
  environment: string,
): asserts environment is ParadexEnvironment {
  if (environment !== 'testnet' && environment !== 'prod') {
    throw new Error(`Invalid Paradex environment: ${environment}`);
  }
}

function getParadexApiUrl(environment: ParadexEnvironment): string {
  return `https://api.${environment}.paradex.trade/v1`;
}

export function buildConfig(rawConfig: RawParadexConfig): ParadexConfig {
  const bridgedTokens = Object.fromEntries(
    rawConfig.bridged_tokens.map((token) => [
      token.symbol,
      {
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        l1TokenAddress: token.l1_token_address,
        l1BridgeAddress: token.l1_bridge_address,
        l2TokenAddress: token.l2_token_address,
        l2BridgeAddress: token.l2_bridge_address,
      },
    ]),
  );

  return {
    starknetFullNodeRpcUrl: rawConfig.starknet_fullnode_rpc_url,
    starknetChainId: Starknet.shortString.encodeShortString(
      rawConfig.starknet_chain_id,
    ),
    l1ChainId: rawConfig.l1_chain_id,
    l2ChainId: getL2ChainId(rawConfig),
    paraclearAccountHash: rawConfig.paraclear_account_hash,
    paraclearAccountProxyHash: rawConfig.paraclear_account_proxy_hash,
    paraclearAddress: rawConfig.paraclear_address,
    paraclearDecimals: rawConfig.paraclear_decimals,
    bridgedTokens,
  };
}

function getL2ChainId(rawConfig: RawParadexConfig): string {
  switch (rawConfig.l1_chain_id) {
    case '1':
      return 'SN_MAIN';
    case '11155111':
    default:
      return 'SN_SEPOLIA';
  }
}
