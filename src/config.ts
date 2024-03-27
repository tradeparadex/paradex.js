export interface ParadexConfig {
  readonly l1_chain_id: string;
  readonly paraclear_account_hash: string;
  readonly paraclear_account_proxy_hash: string;
}

type ParadexEnvironment = "testnet" | "prod";

const API_URL_PROD = "https://api.prod.paradex.trade/v1";
const API_URL_TESTNET = "https://api.testnet.paradex.trade/v1";

/**
 * Fetches the Paradex config for the given environment.
 * This is required for account derivation.
 */
export async function fetchConfig(
  environment: ParadexEnvironment
): Promise<ParadexConfig> {
  const apiUrl = environment === "testnet" ? API_URL_TESTNET : API_URL_PROD;
  const resp = await fetch(`${apiUrl}/system/config`);
  const jsonResp = await resp.json();
  return jsonResp;
}
