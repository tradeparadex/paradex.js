import { ethers } from 'ethers';

import * as Paradex from '../src/index.js';

declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider;
  }
}

// Flow summary:
//  1. Fetch Paradex config
//  2. Create Paraclear provider
//  3. Derive Paradex account from Ethereum signer

// 1. Fetch Paradex config for the relevant environment
const config = await Paradex.Config.fetchConfig('testnet'); // "testnet" | "mainnet"

// 2. Create Paraclear provider
const paraclearProvider = new Paradex.ParaclearProvider.DefaultProvider(config);

// 3. Derive Paradex account from Ethereum signer

//  3.1. Get ethers signer (example with injected provider)
if (window.ethereum == null) throw new Error('Ethereum provider not found');
const ethersProvider = new ethers.BrowserProvider(window.ethereum);
const ethersSigner = await ethersProvider.getSigner();

//  3.2. Create Ethereum signer based on ethers signer
const signer = Paradex.Signer.ethersSignerAdapter(ethersSigner);

//  3.3. Initialize Paradex account with config and Ethereum signer
const paradexAccount = await Paradex.Account.fromEthSigner({
  provider: paraclearProvider,
  config,
  signer,
});
