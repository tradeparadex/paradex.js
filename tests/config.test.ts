import { buildConfig, fetchConfig, type RawParadexConfig } from '../src/config';

describe('buildConfig', () => {
  test('returns the correct config object', () => {
    const rawConfig: RawParadexConfig = {
      starknet_gateway_url: 'https://potc-testnet-sepolia.starknet.io',
      starknet_fullnode_rpc_url:
        'https://pathfinder.api.testnet.paradex.trade/rpc/v0_7',
      starknet_chain_id: 'PRIVATE_SN_POTC_SEPOLIA',
      block_explorer_url: 'https://voyager.testnet.paradex.trade/',
      paraclear_address:
        '0x286003f7c7bfc3f94e8f0af48b48302e7aee2fb13c23b141479ba00832ef2c6',
      paraclear_decimals: 8,
      paraclear_account_proxy_hash:
        '0x3530cc4759d78042f1b543bf797f5f3d647cde0388c33734cf91b7f7b9314a9',
      paraclear_account_hash:
        '0x41cb0280ebadaa75f996d8d92c6f265f6d040bb3ba442e5f86a554f1765244e',
      bridged_tokens: [
        {
          name: 'TEST USDC',
          symbol: 'USDC',
          decimals: 6,
          l1_token_address: '0x29A873159D5e14AcBd63913D4A7E2df04570c666',
          l1_bridge_address: '0x8586e05adc0C35aa11609023d4Ae6075Cb813b4C',
          l2_token_address:
            '0x6f373b346561036d98ea10fb3e60d2f459c872b1933b50b21fe6ef4fda3b75e',
          l2_bridge_address:
            '0x46e9237f5408b5f899e72125dd69bd55485a287aaf24663d3ebe00d237fc7ef',
        },
      ],
      l1_core_contract_address: '0x582CC5d9b509391232cd544cDF9da036e55833Af',
      l1_operator_address: '0x11bACdFbBcd3Febe5e8CEAa75E0Ef6444d9B45FB',
      l1_chain_id: '11155111',
    };

    const expectedConfig = {
      bridgedTokens: {
        USDC: {
          decimals: 6,
          l1BridgeAddress: '0x8586e05adc0C35aa11609023d4Ae6075Cb813b4C',
          l1TokenAddress: '0x29A873159D5e14AcBd63913D4A7E2df04570c666',
          l2BridgeAddress:
            '0x46e9237f5408b5f899e72125dd69bd55485a287aaf24663d3ebe00d237fc7ef',
          l2TokenAddress:
            '0x6f373b346561036d98ea10fb3e60d2f459c872b1933b50b21fe6ef4fda3b75e',
          name: 'TEST USDC',
          symbol: 'USDC',
        },
      },
      ethereumChainId: '11155111',
      starknetChainId: 'SN_SEPOLIA',
      paraclearAccountHash:
        '0x41cb0280ebadaa75f996d8d92c6f265f6d040bb3ba442e5f86a554f1765244e',
      paraclearAccountProxyHash:
        '0x3530cc4759d78042f1b543bf797f5f3d647cde0388c33734cf91b7f7b9314a9',
      paraclearAddress:
        '0x286003f7c7bfc3f94e8f0af48b48302e7aee2fb13c23b141479ba00832ef2c6',
      paraclearDecimals: 8,
      paradexChainId: 'PRIVATE_SN_POTC_SEPOLIA',
      paradexFullNodeRpcUrl:
        'https://pathfinder.api.testnet.paradex.trade/rpc/v0_7',
    };

    const config = buildConfig(rawConfig);

    expect(config).toEqual(expectedConfig);
    expect(config).not.toHaveProperty('paradexApiUrl');
    expect(buildConfig(rawConfig, 'https://api.example/v1')).toEqual({
      ...expectedConfig,
      paradexApiUrl: 'https://api.example/v1',
    });
  });
});

describe('fetchConfig', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('records the API URL in the config', async () => {
    const rawConfig: RawParadexConfig = {
      starknet_gateway_url: '',
      starknet_fullnode_rpc_url: '',
      starknet_chain_id: 'PRIVATE_SN_POTC_SEPOLIA',
      block_explorer_url: '',
      paraclear_address: '0x1',
      paraclear_decimals: 8,
      paraclear_account_proxy_hash: '0x2',
      paraclear_account_hash: '0x3',
      bridged_tokens: [],
      l1_core_contract_address: '0x4',
      l1_operator_address: '0x5',
      l1_chain_id: '11155111',
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => rawConfig,
    });

    const config = await fetchConfig('testnet');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.testnet.paradex.trade/v1/system/config',
    );
    expect(config.paradexApiUrl).toBe('https://api.testnet.paradex.trade/v1');
  });

  test('throws when the request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    await expect(fetchConfig('prod')).rejects.toThrow(
      'Failed to fetch Paradex config: Service Unavailable 503',
    );
  });

  test('rejects an unknown environment', async () => {
    global.fetch = jest.fn();

    await expect(fetchConfig('nightly' as 'prod')).rejects.toThrow(
      'Invalid Paradex environment: nightly',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
