import * as Starknet from 'starknet';

import * as Paradex from '../src/index.js';

// Flow summary:
//  1. Fetch Paradex config
//  2. Create Paraclear provider
//  3. Derive Paradex account from Starknet account
//  4. Enable authentication on provider
//  5. Get user's USDC balance

// 1. Fetch Paradex config for the relevant environment
const config = await Paradex.Config.fetchConfig('testnet'); // "testnet" | "mainnet"

// 2. Create Paraclear provider (without authentication initially)
const paraclearProvider = new Paradex.ParaclearProvider.DefaultProvider(config);

// 3. Derive Paradex account from Starknet account

//  3.1. Get hold of user's Starknet account
const snProvider = new Starknet.RpcProvider();
const snAccount = new Starknet.Account(snProvider, '0x1234', '0x5678');

//  3.2. Initialize Paradex account with config and Starknet account
const paradexAccount = await Paradex.Account.fromStarknetAccount({
  provider: paraclearProvider,
  config,
  account: snAccount,
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
