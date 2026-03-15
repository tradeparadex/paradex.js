// @ts-nocheck
/**
 * Hyperlane transfers originating from Paradex.
 *
 * Uses paradex.js to sign transactions. Withdraws from Paraclear and bridges
 * atomically in a single batched transaction.
 *
 * Routes:
 *   - Paradex → Ethereum
 *   - Paradex → Solana
 *
 * Usage:
 *   ETHEREUM_PRIVATE_KEY="0x..." tsx examples/hyperlane/paradex.ts <route> [asset]
 *
 * Examples:
 *   tsx examples/hyperlane/paradex.ts paradex-to-eth
 *   SOLANA_ADDRESS="..." tsx examples/hyperlane/paradex.ts paradex-to-sol DIME
 */

import * as Starknet from 'starknet';

import {
  AMOUNT,
  ASSETS,
  buildParadexBridgeCalls,
  confirm,
  DOMAINS,
  ENV,
  getEthereumAddress,
  getParadexClient,
  getSolanaRecipient,
  resolveAsset,
  type AssetConfig,
} from './config.js';

// ---------------------------------------------------------------------------
// Common: withdraw from Paraclear + bridge via Hyperlane
// ---------------------------------------------------------------------------

async function withdrawViaBridge(
  asset: AssetConfig,
  destinationDomain: number,
  destinationName: string,
  recipientHex: string,
  recipientDisplay: string,
) {
  if (!asset.paradex)
    throw new Error(`${asset.symbol} not available on Paradex`);

  const { client } = await getParadexClient();
  const paradexAddress = client.getAddress();

  await confirm({
    route: `Paradex → ${destinationName}`,
    asset: asset.symbol,
    amount: AMOUNT,
    from: paradexAddress,
    to: recipientDisplay,
    env: ENV,
  });

  // 1. Check balance
  const balance = await client.getTokenBalance(asset.symbol);
  console.log(`Balance: ${balance.size} ${asset.symbol}`);

  // 2. Get receivable amount (accounts for socialized loss)
  const receivable = await client.getReceivableAmount(asset.symbol, AMOUNT);
  if (Number(receivable.socializedLossFactor) !== 0) {
    console.log(
      `Socialized loss active. Will receive: ${receivable.receivableAmount}`,
    );
  }

  // 3. Quote gas payment on the Hyperlane warp route
  const provider = client.getProvider();
  const gasPaymentResult = await provider.callContract({
    contractAddress: asset.paradex!.contractAddress,
    entrypoint: 'quote_gas_payment',
    calldata: Starknet.CallData.compile({
      destination_domain: destinationDomain,
    }),
  });
  const gasPaymentAmount = BigInt(gasPaymentResult[0] ?? '0');
  console.log(`Gas payment: ${gasPaymentAmount}`);

  // 4. Build bridge calls (approve token + approve gas + transfer_remote)
  const bridgeCalls = buildParadexBridgeCalls(
    asset,
    destinationDomain,
    recipientHex,
    receivable.receivableAmountChain,
    gasPaymentAmount,
  );

  // 5. Withdraw from Paraclear + bridge atomically
  console.log(
    `Withdrawing ${AMOUNT} ${asset.symbol} from Paradex to ${destinationName}...`,
  );
  const result = await client.withdraw(asset.symbol, AMOUNT, bridgeCalls);
  console.log(`Transaction hash: ${result.hash}`);

  await client.waitForTransaction(result.hash);
  console.log('Done!');
}

// ===========================================================================
// Paradex → Ethereum
// ===========================================================================

async function paradexToEthereum(asset: AssetConfig) {
  console.log(`\n=== Paradex → Ethereum (${asset.symbol}) ===`);
  if (!asset.ethereum)
    throw new Error(`${asset.symbol} not available on Ethereum`);

  const ethAddress = getEthereumAddress();
  await withdrawViaBridge(
    asset,
    DOMAINS.ethereum,
    'Ethereum',
    ethAddress,
    ethAddress,
  );
}

// ===========================================================================
// Paradex → Solana
// ===========================================================================

async function paradexToSolana(asset: AssetConfig) {
  console.log(`\n=== Paradex → Solana (${asset.symbol}) ===`);
  if (!asset.solana)
    throw new Error(`${asset.symbol} not available on Solana for ${ENV}`);

  const solanaRecipient = await getSolanaRecipient();

  await withdrawViaBridge(
    asset,
    DOMAINS.solana,
    'Solana',
    solanaRecipient.hex,
    solanaRecipient.address,
  );
}

// ===========================================================================
// Main
// ===========================================================================

const ROUTES: Record<string, (asset: AssetConfig) => Promise<void>> = {
  'paradex-to-eth': paradexToEthereum,
  'paradex-to-sol': paradexToSolana,
};

const route = process.argv[2];
const asset = resolveAsset(process.argv);

if (route && route in ROUTES) {
  await ROUTES[route]!(asset);
} else {
  console.log('Paradex → Hyperlane Bridge Examples');
  console.log('');
  console.log('Usage: tsx examples/hyperlane/paradex.ts <route> [asset]');
  console.log('');
  console.log('Routes:');
  for (const name of Object.keys(ROUTES)) console.log(`  ${name}`);
  console.log('');
  console.log(`Assets: ${Object.keys(ASSETS).join(', ')} (default: USDC)`);
}
