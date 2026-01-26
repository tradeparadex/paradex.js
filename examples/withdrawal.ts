import { ethers } from 'ethers';

import * as Paradex from '../src/index.js';

declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider;
  }
}

const AMOUNT = '200'; // USDC amount to withdraw

// Flow summary:
//  1. Fetch config
//  2. Create client
//  3. Get balance
//  4. Withdraw

// 1. Fetch config
const config = await Paradex.Config.fetch('testnet'); // "testnet" | "prod"
console.log('RPC URL:', config.paradexFullNodeRpcUrl);

// 2. Create client from Ethereum wallet
if (window.ethereum == null) throw new Error('Ethereum provider not found');
const ethersProvider = new ethers.BrowserProvider(window.ethereum);
const ethersSigner = await ethersProvider.getSigner();
const signer = Paradex.Signer.fromEthers(ethersSigner);

const client = await Paradex.Client.fromEthSigner({ config, signer });

console.log(`Ethereum address: ${ethersSigner.address}`);
console.log(`Paradex address: ${client.getAddress()}`);

// 3. Get user's USDC balance
const balance = await client.getTokenBalance('USDC');
console.log(`Balance: ${balance.size}`);

// 3. Get max withdrawable amount
const withdrawInfo = await client.getMaxWithdraw('USDC');
console.log(`Max withdraw: ${withdrawInfo.amountChain} USDC`);

// 4. Withdrawal

//  4.1. Get receivable amount and socialized loss factor
const receivable = await client.getReceivableAmount('USDC', AMOUNT);

//  4.2. Check if socialized loss factor is not 0
if (Number(receivable.socializedLossFactor) !== 0) {
  // Display a warning to the user, suggesting to withdraw a smaller
  // amount or to wait for the socialized loss factor to decrease.
  console.log(
    `Socialized loss is active. You will receive ${receivable.receivableAmount} USDC.`,
  );
}

//  4.3. Request withdrawal (batches 1. withdraw from Paraclear contract
//  and 2. deposit to the bridge in `bridgeCall`) for atomic transaction.
//  Note that the requested withdraw amount can be different from the amount
//  that will be received if socialized loss is active. Use the receivable
//  amount to make the bridge call.
console.log(`Requesting withdrawal of ${AMOUNT} USDC...`);
const withdrawResult = await client.withdraw('USDC', AMOUNT, []);
console.log(`Transaction hash: ${withdrawResult.hash}`);

//  4.4. Monitor batch withdrawal transaction to completion
console.log('Waiting for transaction to complete...');
await client.waitForTransaction(withdrawResult.hash);
console.log('Transaction completed!');
