import { ethers } from 'ethers';

import * as Paradex from '../src/index.js';

// 1. Fetch config
const config = await Paradex.Config.fetch('testnet'); // "testnet" | "mainnet"

// 2. Create client from Ethereum wallet
const ethersProvider = new ethers.JsonRpcProvider(
  'https://ethereum-sepolia.publicnode.com',
);
const wallet = new ethers.Wallet('0x...', ethersProvider);
const signer = Paradex.Signer.fromEthers(wallet);

const client = await Paradex.Client.fromEthSigner({ config, signer });

console.log(`Paradex address: ${client.getAddress()}`);

// 3. Get balance
const balance = await client.getTokenBalance('USDC');
console.log(balance); // { size: '100.45' }
