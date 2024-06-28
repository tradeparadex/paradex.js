import * as Starknet from 'starknet';

import * as Paradex from '../src/index.js';

// Flow summary:
//  1. Fetch Paradex config
//  2. Create Paraclear provider
//  3. Derive Paradex account from Starknet signer

// 1. Fetch Paradex config for the relevant environment
const config = await Paradex.Config.fetchConfig('testnet'); // "testnet" | "mainnet"

// 2. Create Paraclear provider
const paraclearProvider = new Paradex.ParaclearProvider.DefaultProvider(config);

// 3. Derive Paradex account from Starknet signer

// 3.1 Get hold of user's Starknet account
const snProvider = new Starknet.RpcProvider();
const snAccount = new Starknet.Account(snProvider, '0x1234', '0x5678');

// 3.2 Initialize Paradex account with config and Starknet account
const paradexAccount = await Paradex.Account.fromStarknetAccount({
  provider: paraclearProvider,
  config,
  account: snAccount,
});
