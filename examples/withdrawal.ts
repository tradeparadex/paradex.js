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
//  4. Get user's USDC balance
//  5. Withdraw USDC

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

//  3.3. Initialize the account with config and Ethereum signer
const paradexAccount = await Paradex.Account.fromEthSigner({
  provider: paraclearProvider,
  config,
  signer,
});

// 4. Get user's USDC balance
const getBalanceResult = await Paradex.Paraclear.getTokenBalance({
  provider: paraclearProvider, // account can be passed as the provider
  config,
  account: paradexAccount,
  token: 'USDC',
});
console.log(getBalanceResult); // { size: '100.45' }

// 5. Withdrawal

//  5.1. Get receivable amount and socialized loss factor
const receivableAmountResult = await Paradex.Paraclear.getReceivableAmount({
  provider: paraclearProvider, // account can be passed as the provider
  config,
  token: 'USDC',
  amount: '50.4',
});

//  5.2. Check if socialized loss factor is not 0
if (Number(receivableAmountResult.socializedLossFactor) !== 0) {
  // Display a warning to the user, suggesting to withdraw a smaller
  // amount or to wait for the socialized loss factor to decrease.
  console.log(
    `Socialized loss is active. You will receive` +
      ` ${receivableAmountResult.receivableAmount} USDC.`,
  );
}

//  5.3. Request withdrawal (batches 1. withdraw from Paraclear contract
//  and 2. deposit to the bridge in `bridgeCall`) for atomic transaction.
//  Note that the requested withdraw amount can be different from the amount
//  that will be received if socialized loss is active. Use the receivable
//  amount to make the bridge call.
const withdrawResult = await Paradex.Paraclear.withdraw({
  config,
  account: paradexAccount,
  token: 'USDC',
  amount: '50.4',
  bridgeCall: {
    contractAddress: '0x...',
    entrypoint: 'deposit',
    calldata: ['...', receivableAmountResult.receivableAmountChain],
  },
});
console.log(withdrawResult); // { hash: '0x...' }

//  5.4. Monitor batch withdrawal transaction to completion
//  https://www.starknetjs.com/docs/api/classes/providerinterface/#waitfortransaction
await paraclearProvider.waitForTransaction(withdrawResult.hash);
