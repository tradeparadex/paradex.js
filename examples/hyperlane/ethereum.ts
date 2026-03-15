// @ts-nocheck
/**
 * Hyperlane transfers originating from Ethereum.
 *
 * Routes:
 *   - Ethereum → Solana
 *   - Ethereum → Paradex
 *
 * Usage:
 *   ETHEREUM_PRIVATE_KEY="0x..." tsx examples/hyperlane/ethereum.ts <route> [asset]
 *
 * Examples:
 *   tsx examples/hyperlane/ethereum.ts eth-to-paradex
 *   SOLANA_ADDRESS="..." tsx examples/hyperlane/ethereum.ts eth-to-sol DIME
 */

import { ethers } from 'ethers';

import {
  addressToBytes32,
  AMOUNT,
  ASSETS,
  confirm,
  DOMAINS,
  ENV,
  ERC20_ABI,
  getEthSigner,
  getParadexAddress,
  getSolanaRecipient,
  resolveAsset,
  WARP_ROUTE_ABI,
  type AssetConfig,
} from './config.js';

// ===========================================================================
// Ethereum → Solana
// ===========================================================================

async function ethereumToSolana(asset: AssetConfig) {
  console.log(`\n=== Ethereum → Solana (${asset.symbol}) ===`);
  if (!asset.ethereum)
    throw new Error(`${asset.symbol} not available on Ethereum`);
  if (!asset.solana)
    throw new Error(`${asset.symbol} not available on Solana for ${ENV}`);

  const wallet = getEthSigner();
  const solanaRecipient = await getSolanaRecipient();

  await confirm({
    route: 'Ethereum → Solana',
    asset: asset.symbol,
    amount: AMOUNT,
    from: wallet.address,
    to: solanaRecipient.address,
    env: ENV,
  });

  const warpRoute = new ethers.Contract(
    asset.ethereum.contractAddress,
    WARP_ROUTE_ABI,
    wallet,
  );
  const amount = ethers.parseUnits(AMOUNT, asset.ethereum.decimals);

  // 1. Quote gas
  const gasPayment: bigint = await warpRoute.quoteGasPayment(DOMAINS.solana);
  console.log(`Gas payment: ${ethers.formatEther(gasPayment)} ETH`);

  // 2. Approve ERC20
  const erc20 = new ethers.Contract(
    asset.ethereum.tokenAddress,
    ERC20_ABI,
    wallet,
  );
  console.log(`Approving ${asset.symbol}...`);
  const approveTx = await erc20.approve(asset.ethereum.contractAddress, amount);
  await approveTx.wait();
  console.log(`Approved: ${approveTx.hash}`);

  // 3. Transfer — recipient is Solana public key as bytes32
  console.log(
    `Transferring ${AMOUNT} ${asset.symbol} to Solana ${solanaRecipient.address}...`,
  );

  const tx = await warpRoute.transferRemote(
    DOMAINS.solana,
    solanaRecipient.hex,
    amount,
    { value: gasPayment },
  );
  const receipt = await tx.wait();
  console.log(`Transaction hash: ${receipt.hash}`);
}

// ===========================================================================
// Ethereum → Paradex
// ===========================================================================

async function ethereumToParadex(asset: AssetConfig) {
  console.log(`\n=== Ethereum → Paradex (${asset.symbol}) ===`);
  if (!asset.ethereum)
    throw new Error(`${asset.symbol} not available on Ethereum`);
  if (!asset.paradex)
    throw new Error(`${asset.symbol} not available on Paradex`);

  const wallet = getEthSigner();
  const paradexAddress = await getParadexAddress();

  await confirm({
    route: 'Ethereum → Paradex',
    asset: asset.symbol,
    amount: AMOUNT,
    from: wallet.address,
    to: paradexAddress,
    env: ENV,
  });

  const warpRoute = new ethers.Contract(
    asset.ethereum.contractAddress,
    WARP_ROUTE_ABI,
    wallet,
  );
  const amount = ethers.parseUnits(AMOUNT, asset.ethereum.decimals);

  // 1. Quote gas
  const gasPayment: bigint = await warpRoute.quoteGasPayment(DOMAINS.paradex);
  console.log(`Gas payment: ${ethers.formatEther(gasPayment)} ETH`);

  // 2. Approve ERC20
  const erc20 = new ethers.Contract(
    asset.ethereum.tokenAddress,
    ERC20_ABI,
    wallet,
  );
  console.log(`Approving ${asset.symbol}...`);
  const approveTx = await erc20.approve(asset.ethereum.contractAddress, amount);
  await approveTx.wait();
  console.log(`Approved: ${approveTx.hash}`);

  // 3. Transfer — recipient is Paradex (Starknet) address
  console.log(
    `Transferring ${AMOUNT} ${asset.symbol} to Paradex ${paradexAddress}...`,
  );

  const tx = await warpRoute.transferRemote(
    DOMAINS.paradex,
    addressToBytes32(paradexAddress),
    amount,
    { value: gasPayment },
  );
  const receipt = await tx.wait();
  console.log(`Transaction hash: ${receipt.hash}`);
}

// ===========================================================================
// Main
// ===========================================================================

const ROUTES: Record<string, (asset: AssetConfig) => Promise<void>> = {
  'eth-to-sol': ethereumToSolana,
  'eth-to-paradex': ethereumToParadex,
};

const route = process.argv[2];
const asset = resolveAsset(process.argv);

if (route && route in ROUTES) {
  await ROUTES[route]!(asset);
} else {
  console.log('Ethereum → Hyperlane Bridge Examples');
  console.log('');
  console.log('Usage: tsx examples/hyperlane/ethereum.ts <route> [asset]');
  console.log('');
  console.log('Routes:');
  for (const name of Object.keys(ROUTES)) console.log(`  ${name}`);
  console.log('');
  console.log(`Assets: ${Object.keys(ASSETS).join(', ')} (default: USDC)`);
}
