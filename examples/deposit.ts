import { BigNumber } from 'bignumber.js';
import { ethers } from 'ethers';

import * as Paradex from '../src/index.js';

const AMOUNT = '100'; // USDC amount to deposit into Paraclear

// Flow summary:
//  1. Fetch config
//  2. Create client
//  3. Increase allowance for Paraclear to spend L2 tokens
//  4. Deposit tokens into Paraclear (increase_allowance + deposit batched atomically)

// 1. Fetch config
const config = await Paradex.Config.fetch('testnet');
console.log('RPC URL:', config.paradexFullNodeRpcUrl);

// 2. Create client from Ethereum wallet
const privateKey = process.env.PRIVATE_KEY || '';
const wallet = new ethers.Wallet(privateKey);
const signer = Paradex.Signer.fromEthers(wallet);

const client = await Paradex.Client.fromEthSigner({ config, signer });

console.log(`Ethereum address: ${wallet.address}`);
console.log(`Paradex address: ${client.getAddress()}`);

// Get the underlying account for direct contract calls
const provider = client.getProvider();
const account = provider.getAccount();
if (account == null) throw new Error('Account not available');

// 3. Get token config
const token = config.bridgedTokens['USDC'];
if (token == null) throw new Error('USDC token config not found');

// Convert amount to chain decimals (Paraclear decimals)
const chainAmount = new BigNumber(AMOUNT)
  .times(10 ** config.paraclearDecimals)
  .integerValue(BigNumber.ROUND_FLOOR)
  .toString();

console.log(`Depositing ${AMOUNT} USDC into Paraclear...`);

// 4. Deposit: batch increase_allowance + deposit atomically
//    - First call: increase allowance for Paraclear to spend tokens
//    - Second call: deposit tokens into Paraclear
const txnInvocation = [
  {
    contractAddress: token.l2TokenAddress,
    entrypoint: 'increase_allowance',
    calldata: [config.paraclearAddress, chainAmount, '0'], // amount as uint256 (low, high)
  },
  {
    contractAddress: config.paraclearAddress,
    entrypoint: 'deposit',
    calldata: [token.l2TokenAddress, chainAmount],
  },
];

// Estimate fees
const fees = await account.estimateInvokeFee(txnInvocation);

// Execute batch atomically
const result = await account.execute(txnInvocation, {
  resourceBounds: fees.resourceBounds,
});

console.log(`Transaction hash: ${result.transaction_hash}`);

// 5. Wait for transaction confirmation
console.log('Waiting for transaction to complete...');
await provider.waitForTransaction(result.transaction_hash);
console.log('Deposit completed!');

// 6. Verify new Paraclear balance
const balance = await client.getTokenBalance('USDC');
console.log(`Paraclear balance: ${balance.size} USDC`);
