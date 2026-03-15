// @ts-nocheck — Solana deps must be installed separately

/**
 * Shared configuration for Hyperlane bridge examples.
 *
 * Assets: USDC, DIME
 * Chains: Ethereum, Solana, Paradex
 */

import { BigNumber } from 'bignumber.js';
import { ethers } from 'ethers';
import * as Starknet from 'starknet';

import * as Paradex from '../../src/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChainAddresses {
  contractAddress: string;
  tokenAddress: string;
  gasTokenAddress: string;
  decimals: number;
  mailboxAddress?: string;
  isSynthetic?: boolean;
}

export interface AssetConfig {
  symbol: string;
  ethereum: ChainAddresses | null;
  solana: ChainAddresses | null;
  paradex: ChainAddresses | null;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export const ENV = (process.env.PARADEX_ENV ?? 'testnet') as 'testnet' | 'prod';
export const isProd = ENV === 'prod';
export const AMOUNT = process.env.AMOUNT ?? '10';

export const DOMAINS = {
  ethereum: isProd ? 1 : 11155111,
  solana: isProd ? 1399811149 : 1399811150,
  paradex: isProd ? 514051890 : 12263410,
} as const;

// ---------------------------------------------------------------------------
// Asset configs
// ---------------------------------------------------------------------------

export const USDC: AssetConfig = {
  symbol: 'USDC',
  ethereum: {
    contractAddress: isProd
      ? '0x6912088890254E69970baEdB03284fB3D8fBCDA0'
      : '0xFE5505d75890122A6624EEE2ce6C075c421e1849',
    tokenAddress: isProd
      ? '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
      : '0x29A873159D5e14AcBd63913D4A7E2df04570c666',
    gasTokenAddress: '0x0000000000000000000000000000000000000000',
    decimals: 6,
  },
  solana: {
    contractAddress: isProd
      ? 'CYiUT9WzmHebQQJ5bBQSsWY7hW2GSwRgQ8gYZLHN7V6D'
      : 'ETai5iFvKgAmLGSQrXgdMaMivQQ8Vn1xPRLBrRWtfmEo',
    tokenAddress: isProd
      ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      : 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
    gasTokenAddress: 'So11111111111111111111111111111111111111111',
    decimals: 6,
    mailboxAddress: isProd
      ? 'E588QtVUvresuXq2KoNEwAmoifCzYGpRBdHByN9KQMbi'
      : '75HBBLae3ddeneJVrZeyrDfv6vb7SMC3aCpBucSXS5aR',
    isSynthetic: false,
  },
  paradex: {
    contractAddress: isProd
      ? '0x274d8800b7f4f60a13c8cf17fda9e949b099562195ab185ce667f2e483457c5'
      : '0x05f971c4faecde2c2b8f2462ea9e5c72aa28ee64404c95e4b7b281e7b49142fb',
    tokenAddress: isProd
      ? '0x7348407ebad690fec0cc8597e87dc16ef7b269a655ff72587dafff83d462be2'
      : '0x6f373b346561036d98ea10fb3e60d2f459c872b1933b50b21fe6ef4fda3b75e',
    gasTokenAddress: isProd
      ? '0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7'
      : '0x47adc7dee88eec362d71a52c25d40559a921434b2d90e75b6a4a6e4e9fb9ab1',
    decimals: 6,
  },
};

export const DIME: AssetConfig = {
  symbol: 'DIME',
  ethereum: {
    contractAddress: isProd
      ? '0x7396b724a43C1d654a89B44996DA84d1E1a9B568'
      : '0xdE47E1355C236bF4AB8933f674A68579C5849848',
    tokenAddress: isProd
      ? '0xb32e10022ffbedfe10bc818a1c7e67d9d87e0fa7'
      : '0x7a04507df78e1b1d3d30a82f5681cb0c947a2888',
    gasTokenAddress: '0x0000000000000000000000000000000000000000',
    decimals: 18,
  },
  // DIME on Solana is prod-only (Token-2022, synthetic, 9 decimals)
  solana: isProd
    ? {
        contractAddress: '48UM41HxDEruBgXE4HG1Eb8kQCkuFuYTWRVLnYrM1rC9',
        tokenAddress: '3ywtR9qQH4BuA7LSfLvEuW1gh6ha7EK18XwLbHvhryPZ',
        gasTokenAddress: 'So11111111111111111111111111111111111111111',
        decimals: 9,
        mailboxAddress: 'E588QtVUvresuXq2KoNEwAmoifCzYGpRBdHByN9KQMbi',
        isSynthetic: true,
      }
    : null,
  paradex: {
    contractAddress: isProd
      ? '0x0796b6a63adcce73be0809d046b05c853c2e1de60f98fbb17836f7f01d2bc091'
      : '0x032242869cd6e959da8b519c34458ef99809f85abfd03277c178968409d951f1',
    tokenAddress: isProd
      ? '0x316cb56a8cc7c478ea7c9b22f33571330bc61ea0312f2222d182b4b6b3fa4b2'
      : '0x72fefa1481ee0911ab0e263e0781d1786105634d7ef89222449aba31161c696',
    gasTokenAddress: isProd
      ? '0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7'
      : '0x47adc7dee88eec362d71a52c25d40559a921434b2d90e75b6a4a6e4e9fb9ab1',
    decimals: 18,
  },
};

export const ASSETS: Record<string, AssetConfig> = { USDC, DIME };

// ---------------------------------------------------------------------------
// ABIs (minimal)
// ---------------------------------------------------------------------------

export const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

export const WARP_ROUTE_ABI = [
  'function transferRemote(uint32 _destination, bytes32 _recipient, uint256 _amountOrId) payable returns (bytes32)',
  'function quoteGasPayment(uint32 _destinationDomain) view returns (uint256)',
];

// ---------------------------------------------------------------------------
// Shared helpers: signers & connections
// ---------------------------------------------------------------------------

export function getEthSigner(): ethers.Wallet {
  const privateKey = process.env.ETHEREUM_PRIVATE_KEY ?? '';
  if (!privateKey) throw new Error('ETHEREUM_PRIVATE_KEY env var required');
  const rpcUrl =
    process.env.ETHEREUM_RPC_URL ??
    (isProd ? 'https://eth.llamarpc.com' : 'https://rpc.sepolia.org');
  return new ethers.Wallet(privateKey, new ethers.JsonRpcProvider(rpcUrl));
}

export async function getParadexClient() {
  const config = await Paradex.Config.fetch(isProd ? 'prod' : 'testnet');
  const privateKey = process.env.ETHEREUM_PRIVATE_KEY ?? '';
  if (!privateKey) throw new Error('ETHEREUM_PRIVATE_KEY env var required');
  const wallet = new ethers.Wallet(privateKey);
  const signer = Paradex.Signer.fromEthers(wallet);
  const client = await Paradex.Client.fromEthSigner({ config, signer });
  return { config, wallet, client };
}

/**
 * Resolve the Ethereum recipient address. Accepts either:
 *   - ETHEREUM_ADDRESS env var (hex address string)
 *   - ETHEREUM_PRIVATE_KEY env var (derives the address from the key)
 */
export function getEthereumAddress(): string {
  const address = process.env.ETHEREUM_ADDRESS ?? '';
  if (address) return address;
  const privateKey = process.env.ETHEREUM_PRIVATE_KEY ?? '';
  if (privateKey) return new ethers.Wallet(privateKey).address;
  throw new Error('ETHEREUM_ADDRESS or ETHEREUM_PRIVATE_KEY env var required');
}

/**
 * Resolve the Paradex recipient address. Accepts either:
 *   - PARADEX_ADDRESS env var (Starknet hex address)
 *   - ETHEREUM_PRIVATE_KEY env var (derives the Paradex address via paradex.js)
 */
export async function getParadexAddress(): Promise<string> {
  const address = process.env.PARADEX_ADDRESS ?? '';
  if (address) return address;
  const { client } = await getParadexClient();
  return client.getAddress();
}

/**
 * Resolve the Solana recipient address. Accepts either:
 *   - SOLANA_ADDRESS env var (base58 public key string)
 *   - SOLANA_PRIVATE_KEY env var (derives the public key from the keypair)
 *
 * Returns { address: base58 string, hex: 0x-prefixed 32-byte hex }
 */
export async function getSolanaRecipient(): Promise<{
  address: string;
  hex: string;
}> {
  // Prefer explicit address — no Solana deps needed
  const solanaAddress = process.env.SOLANA_ADDRESS ?? '';
  if (solanaAddress) {
    // Decode base58 address to 32-byte hex without @solana/web3.js
    const bs58Module = await import('bs58');
    const bs58 = bs58Module.default ?? bs58Module;
    const bytes = bs58.decode(solanaAddress);
    const hex = '0x' + Buffer.from(bytes).toString('hex');
    return { address: solanaAddress, hex };
  }

  // Fall back to deriving from private key
  const secretKey = process.env.SOLANA_PRIVATE_KEY ?? '';
  if (!secretKey)
    throw new Error('SOLANA_ADDRESS or SOLANA_PRIVATE_KEY env var required');
  const { Keypair } = await import('@solana/web3.js');
  const bs58Module = await import('bs58');
  const bs58 = bs58Module.default ?? bs58Module;
  const pubkey = Keypair.fromSecretKey(bs58.decode(secretKey)).publicKey;
  return { address: pubkey.toBase58(), hex: solanaPublicKeyToHex(pubkey) };
}

// ---------------------------------------------------------------------------
// Shared helpers: address encoding
// ---------------------------------------------------------------------------

export function addressToBytes32(address: string): string {
  const hex = address.replace(/^0x/i, '').toLowerCase();
  return '0x' + hex.padStart(64, '0');
}

export function solanaPublicKeyToHex(publicKey: any): string {
  return '0x' + publicKey.toBuffer().toString('hex');
}

export function padBytesToLength(
  bytes: Uint8Array,
  length: number,
): Uint8Array {
  const padded = new Uint8Array(length);
  if (bytes.length <= length) {
    padded.set(bytes, length - bytes.length);
  } else {
    padded.set(bytes.subarray(0, length), 0);
  }
  return padded;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Shared helpers: Paradex bridge calls
// ---------------------------------------------------------------------------

export function buildParadexBridgeCalls(
  asset: AssetConfig,
  destinationDomain: number,
  recipientHex: string,
  receivableAmountChain: string,
  gasPaymentAmount: bigint,
): Starknet.Call[] {
  const paradex = asset.paradex!;
  const noneOption = new Starknet.CairoOption(Starknet.CairoOptionVariant.None);

  const withdrawFeeInTokenDecimals = new BigNumber(gasPaymentAmount.toString())
    .dividedBy(new BigNumber(10).pow(18))
    .times(new BigNumber(10).pow(paradex.decimals))
    .integerValue(BigNumber.ROUND_CEIL);

  const amountOrId = new BigNumber(receivableAmountChain).minus(
    withdrawFeeInTokenDecimals,
  );

  return [
    {
      contractAddress: paradex.tokenAddress,
      entrypoint: 'approve',
      calldata: Starknet.CallData.compile({
        spender: paradex.contractAddress,
        amount: Starknet.cairo.uint256(receivableAmountChain),
      }),
    },
    {
      contractAddress: paradex.gasTokenAddress,
      entrypoint: 'approve',
      calldata: Starknet.CallData.compile({
        spender: paradex.contractAddress,
        amount: Starknet.cairo.uint256(gasPaymentAmount),
      }),
    },
    {
      contractAddress: paradex.contractAddress,
      entrypoint: 'transfer_remote',
      calldata: Starknet.CallData.compile({
        destination: destinationDomain,
        recipient: Starknet.cairo.uint256(recipientHex),
        amount_or_id: Starknet.cairo.uint256(amountOrId.toFixed(0)),
        value: Starknet.cairo.uint256(gasPaymentAmount),
        hook_metadata: noneOption,
        hook: noneOption,
      }),
    },
  ];
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

export function resolveAsset(argv: string[]): AssetConfig {
  const assetArg = (argv[3] ?? 'USDC').toUpperCase();
  const asset = ASSETS[assetArg];
  if (!asset) {
    console.error(
      `Unknown asset: ${assetArg}. Available: ${Object.keys(ASSETS).join(', ')}`,
    );
    process.exit(1);
  }
  return asset;
}

/**
 * Prompt user to confirm before proceeding. Aborts on anything other than 'y'.
 */
export async function confirm(summary: {
  route: string;
  asset: string;
  amount: string;
  from: string;
  to: string;
  env: string;
}): Promise<void> {
  console.log('');
  console.log('  Route:       ', summary.route);
  console.log('  Asset:       ', summary.asset);
  console.log('  Amount:      ', summary.amount);
  console.log('  From:        ', summary.from);
  console.log('  To:          ', summary.to);
  console.log('  Environment: ', summary.env);
  console.log('');

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question('Proceed? [N/y] ', resolve);
  });
  rl.close();

  if (answer.trim().toLowerCase() !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }
}
