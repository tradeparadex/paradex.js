interface RawBridgedTokenConfig {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly l1_token_address: `0x${string}`;
  readonly l1_bridge_address: `0x${string}`;
  readonly l2_token_address: string;
  readonly l2_bridge_address: string;
}

export interface RawParadexConfig {
  readonly starknet_gateway_url: string;
  readonly starknet_chain_id: string;
  readonly block_explorer_url: string;
  readonly paraclear_address: string;
  readonly paraclear_decimals: number;
  readonly paraclear_account_proxy_hash: string;
  readonly paraclear_account_hash: string;
  readonly bridged_tokens: readonly RawBridgedTokenConfig[];
  readonly l1_core_contract_address: `0x${string}`;
  readonly l1_operator_address: `0x${string}`;
  readonly l1_chain_id: string;
}

export interface ParadexConfig {
  readonly l1ChainId: string;
  readonly paraclearAccountHash: string;
  readonly paraclearAccountProxyHash: string;
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

  return {
    l1ChainId: config.l1_chain_id,
    paraclearAccountHash: config.paraclear_account_hash,
    paraclearAccountProxyHash: config.paraclear_account_proxy_hash,
  };
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
