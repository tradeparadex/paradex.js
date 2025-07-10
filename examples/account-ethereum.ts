import { ethers } from 'ethers';

import * as Paradex from '../src/index.js';

// Flow summary:
//  1. Fetch Paradex config
//  2. Create Paraclear provider
//  3. Derive Paradex account from Ethereum signer
//  4. Enable authentication on provider
//  5. Get user's USDC balance

// 1. Fetch Paradex config for the relevant environment
const config = await Paradex.Config.fetchConfig('testnet'); // "testnet" | "mainnet"

// 2. Create Paraclear provider (without authentication initially)
const paraclearProvider = new Paradex.ParaclearProvider.DefaultProvider(config);

// 3. Derive Paradex account from Ethereum signer

//  3.1. Create Ethereum signer
const ethersProvider = new ethers.JsonRpcProvider(
  'https://ethereum-sepolia.publicnode.com',
);
const ethersSigner = new ethers.Wallet('0x...', ethersProvider);

//  3.2. Create Ethereum signer adapter
const signer = Paradex.Signer.ethersSignerAdapter(ethersSigner);

//  3.3. Initialize the account with config and Ethereum signer
const paradexAccount = await Paradex.Account.fromEthSigner({
  provider: paraclearProvider,
  config,
  signer,
});

// 4. Enable authentication on provider now that we have the account
paraclearProvider.enableAuthentication(paradexAccount);

// 5. Get user's USDC balance
const getBalanceResult = await Paradex.Paraclear.getTokenBalance({
  provider: paraclearProvider,
  config,
  account: paradexAccount,
  token: 'USDC',
});
console.log(getBalanceResult); // { size: '100.45' }
