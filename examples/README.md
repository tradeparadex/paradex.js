# Paradex SDK Examples

This directory contains example implementations demonstrating how to use the Paradex SDK in different environments.

## Available Examples

### 1. Account Creation Examples

#### `account-ethereum.ts` - Create Client from Ethereum Wallet

Demonstrates how to create a Paradex client using an Ethereum wallet.

```bash
tsx examples/account-ethereum.ts
```

**What it shows:**

- Fetching configuration
- Creating client from Ethereum signer
- Getting account address and balance

#### `account-starknet.ts` - Create Client from Starknet Account

Demonstrates how to create a Paradex client using an existing Starknet account.

```bash
tsx examples/account-starknet.ts
```

**What it shows:**

- Creating client from Starknet account
- Account derivation from Starknet signer
- Basic client operations

### 2. Withdrawal Examples

#### `withdrawal-node.ts` - Complete Withdrawal Flow (Node.js)

Full withdrawal example for Node.js environments using a private key.

```bash
# Set your Ethereum private key
export PRIVATE_KEY="0x..."

# Run the example
yarn run example:withdrawal
```

**What it demonstrates:**

1. ✅ Fetching configuration
2. ✅ Creating client from Ethereum wallet
3. ✅ Getting token balance
4. ✅ Checking maximum withdrawable amount
5. ✅ Calculating receivable amount (with socialized loss check)
6. ✅ Initiating withdrawal transaction
7. ✅ Waiting for transaction confirmation

**Environment Variables:**

- `PRIVATE_KEY` - Your Ethereum private key (hex format with 0x prefix)

#### `withdrawal.ts` - Complete Withdrawal Flow (Browser)

Full withdrawal example for browser environments using MetaMask or other Web3 wallets.

**What it shows:**

- Browser wallet integration (MetaMask)
- Same withdrawal flow as Node.js example
- Handling `window.ethereum` provider

## Running Examples

### Prerequisites

1. **Node.js** - Version 18 or higher
2. **Dependencies** - Run `yarn install` in the project root
3. **Test Account** - Account with testnet funds (for withdrawal examples)
4. **Private Key** - Your Ethereum wallet private key (for Node.js examples)

### Quick Start

```bash
# Install dependencies (from project root)
yarn install

# Run withdrawal example with your private key
PRIVATE_KEY="0x..." yarn run example:withdrawal

# Or export it first
export PRIVATE_KEY="0x..."
yarn run example:withdrawal
```

### Run Individual Examples

```bash
# Account examples
tsx examples/account-ethereum.ts
tsx examples/account-starknet.ts

# Withdrawal examples
tsx examples/withdrawal-node.ts  # Requires PRIVATE_KEY env var
# withdrawal.ts is for browser use only
```

## Key Features Demonstrated

### Authentication

All examples show how authenticated RPC requests work automatically:

- Client handles EIP-712 signature generation
- RPC calls are authenticated transparently
- No manual signature management needed

### Withdrawal Best Practices

The withdrawal examples demonstrate important patterns:

#### 1. Check Maximum Withdrawable Amount

```typescript
const maxWithdraw = await client.getMaxWithdraw('USDC');
console.log(`Max withdrawable: ${maxWithdraw.amount} USDC`);
```

#### 2. Check for Socialized Loss

```typescript
const receivable = await client.getReceivableAmount('USDC', amount);
if (Number(receivable.socializedLossFactor) !== 0) {
  console.warn(
    `Socialized loss active. Will receive: ${receivable.receivableAmount}`,
  );
}
```

#### 3. Handle Transaction Confirmation

```typescript
const result = await client.withdraw('USDC', amount, []);
console.log(`Transaction submitted: ${result.hash}`);

await client.waitForTransaction(result.hash);
console.log('Transaction confirmed!');
```

## Understanding the Code

### Client Creation

**From Ethereum Wallet:**

```typescript
const wallet = new ethers.Wallet(privateKey);
const signer = Paradex.Signer.fromEthers(wallet);
const client = await Paradex.Client.fromEthSigner({ config, signer });
```

**From Starknet Account:**

```typescript
const client = await Paradex.Client.fromStarknetAccount({
  config,
  account: starknetAccount,
});
```

### Common Operations

```typescript
// Get balance
const balance = await client.getTokenBalance('USDC');

// Get max withdrawable (accounts for socialized loss)
const maxWithdraw = await client.getMaxWithdraw('USDC');

// Calculate receivable amount
const receivable = await client.getReceivableAmount('USDC', '100');

// Withdraw tokens
const result = await client.withdraw('USDC', '100', []);
await client.waitForTransaction(result.hash);
```

## Troubleshooting

### "Failed to get token balance"

- ✓ Ensure your account has funds on the testnet
- ✓ Verify you're using the correct network (testnet/mainnet)
- ✓ Check that `PRIVATE_KEY` is set correctly

### "Wallet does not support deterministic signing"

- ✓ Some wallets don't support deterministic EIP-712 signatures
- ✓ Try a different wallet or use a private key directly

### Transaction Fails

- ✓ Check sufficient balance for both withdrawal and fees
- ✓ Ensure account is initialized on Paraclear
- ✓ Verify the withdrawal amount doesn't exceed max withdrawable

### "Token not supported"

- ✓ Currently only 'USDC' is supported in examples
- ✓ Check the config for available bridged tokens

## Bridge Calls

The examples use an empty bridge call array (`[]`) for simplicity. In production, you would provide actual bridge contract calls:

```typescript
// Calculate receivable amount first
const receivable = await client.getReceivableAmount('USDC', amount);

// Prepare bridge call
const bridgeCall = {
  contractAddress: '0x...', // Bridge contract address
  entrypoint: 'deposit',
  calldata: ['...', receivable.receivableAmountChain], // Use receivable amount
};

// Withdraw with bridge call
await client.withdraw('USDC', amount, bridgeCall);
```

## Environment Configuration

### Testnet (Default)

```typescript
const config = await Paradex.Config.fetch('testnet');
```

### Mainnet

```typescript
const config = await Paradex.Config.fetch('prod');
```

### Custom Environment

```typescript
const config = await Paradex.Config.fetch(
  'https://api.custom.paradex.trade/v1',
);
```

## Next Steps

- Review the code in each example file for detailed comments
- Check out the [main README](../README.md) for full API documentation
- See the [React example app](https://github.com/tradeparadex/paradex-react-example) for browser integration
- Join [Discord](https://discord.gg/paradex) for support

## Security Notes

⚠️ **Never commit private keys to version control**
⚠️ **Use environment variables for sensitive data**
⚠️ **Test on testnet before using mainnet**

---

**Need help?** Join our [Discord](https://discord.gg/paradex) community!
