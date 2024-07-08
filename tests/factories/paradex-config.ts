import type { ParadexConfig } from '../../src/config';

export function configFactory(): ParadexConfig {
  return {
    paradexFullNodeRpcUrl: 'https://example-fullnode-rpc-url.com',
    paradexChainId: '0x505249564154455f534e5f504f54435f5345504f4c4941',
    ethereumChainId: '11155111',
    starknetChainId: 'SN_SEPOLIA',
    paraclearAccountHash:
      '0x41cb0280ebadaa75f996d8d92c6f265f6d040bb3ba442e5f86a554f1765244e',
    paraclearAccountProxyHash:
      '0x3530cc4759d78042f1b543bf797f5f3d647cde0388c33734cf91b7f7b9314a9',
    paraclearAddress:
      '0x286003f7c7bfc3f94e8f0af48b48302e7aee2fb13c23b141479ba00832ef2c6',
    paraclearDecimals: 8,
    bridgedTokens: {
      USDC: {
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        l1TokenAddress: '0x29A873159D5e14AcBd63913D4A7E2df04570c666',
        l1BridgeAddress: '0x8586e05adc0C35aa11609023d4Ae6075Cb813b4C',
        l2TokenAddress:
          '0x6f373b346561036d98ea10fb3e60d2f459c872b1933b50b21fe6ef4fda3b75e',
        l2BridgeAddress:
          '0x46e9237f5408b5f899e72125dd69bd55485a287aaf24663d3ebe00d237fc7ef',
      },
    },
  };
}
