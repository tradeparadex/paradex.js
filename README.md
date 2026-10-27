# Paradex SDK

Official JavaScript/TypeScript SDK for [Paradex](https://paradex.trade) - a decentralized perpetuals exchange built on Starknet.

## Installation

```bash
npm install @paradex/sdk
```

```bash
yarn add @paradex/sdk
```

```bash
pnpm add @paradex/sdk
```

## Quick Start

### Browser (MetaMask/Web3 Wallet)

```typescript
import * as Paradex from '@paradex/sdk';
import { ethers } from 'ethers';

// 1. Fetch configuration for your environment
const config = await Paradex.Config.fetch('testnet'); // or 'mainnet'

// 2. Connect to user's wallet
const provider = new ethers.BrowserProvider(window.ethereum);
const ethersSigner = await provider.getSigner();
const signer = Paradex.Signer.fromEthers(ethersSigner);

// 3. Create Paradex client
const client = await Paradex.Client.fromEthSigner({ config, signer });

// 4. Use the client
console.log('Your Paradex address:', client.getAddress());
const balance = await client.getTokenBalance('USDC');
console.log('USDC Balance:', balance.size);
```

### Node.js (Private Key)

```typescript
import * as Paradex from '@paradex/sdk';
import { ethers } from 'ethers';

// 1. Fetch configuration
const config = await Paradex.Config.fetch('testnet');

// 2. Create wallet from private key
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
const signer = Paradex.Signer.fromEthers(wallet);

// 3. Create Paradex client
const client = await Paradex.Client.fromEthSigner({ config, signer });

// 4. Use the client
const balance = await client.getTokenBalance('USDC');
console.log('Balance:', balance.size);
```

## Core Concepts

### Client

The `ParadexClient` is the main interface for interacting with Paradex. It handles authentication and provides a clean API for common operations.

```typescript
// Create from Ethereum wallet
const client = await Paradex.Client.fromEthSigner({ config, signer });

// Create from Starknet account
const client = await Paradex.Client.fromStarknetAccount({
  config,
  account: starknetAccount,
  starknetProvider: optionalProvider,
});
```

### Configuration

Fetch environment-specific configuration:

```typescript
const config = await Paradex.Config.fetch('testnet'); // testnet, mainnet, or custom URL
```

## Common Operations

### Get Token Balance

```typescript
const balance = await client.getTokenBalance('USDC');
console.log(`Balance: ${balance.size} USDC`);
```

### Get Maximum Withdrawable Amount

```typescript
const maxWithdraw = await client.getMaxWithdraw('USDC');
console.log(`Max withdrawable: ${maxWithdraw.amount} USDC`);
console.log(`Chain amount: ${maxWithdraw.amountChain}`);
```

### Check Socialized Loss Factor

```typescript
const { socializedLossFactor } = await client.getSocializedLossFactor();
if (Number(socializedLossFactor) > 0) {
  console.warn('Socialized loss is active');
}
```

### Calculate Receivable Amount

```typescript
const receivable = await client.getReceivableAmount('USDC', '100');
console.log(`Requesting: 100 USDC`);
console.log(`Will receive: ${receivable.receivableAmount} USDC`);
console.log(`Loss factor: ${receivable.socializedLossFactor}`);
```

### Withdraw Tokens

```typescript
// Simple withdrawal (no bridge call)
const result = await client.withdraw('USDC', '50', []);
console.log('Transaction hash:', result.hash);

// Wait for confirmation
await client.waitForTransaction(result.hash);
console.log('Withdrawal complete!');
```

### Withdraw with Bridge Call

```typescript
// Calculate receivable amount first
const receivable = await client.getReceivableAmount('USDC', '100');

// Prepare bridge call with receivable amount
const bridgeCall = {
  contractAddress: '0x...',
  entrypoint: 'deposit',
  calldata: ['...', receivable.receivableAmountChain],
};

// Execute withdrawal with bridge call
const result = await client.withdraw('USDC', '100', bridgeCall);
await client.waitForTransaction(result.hash);
```

## TypeScript Support

The SDK is written in TypeScript and provides full type definitions out of the box.

```typescript
import type {
  MaxWithdraw,
  ParadexClient,
  ParadexConfig,
  ReceivableAmount,
  TokenBalance,
  WithdrawResult,
} from '@paradex/sdk';

// All types are fully typed and autocomplete-friendly
const balance: TokenBalance = await client.getTokenBalance('USDC');
```

## Error Handling

```typescript
try {
  const balance = await client.getTokenBalance('USDC');
  console.log('Balance:', balance.size);
} catch (error) {
  if (error instanceof Error) {
    console.error('Failed to get balance:', error.message);
  }
}
```

## Advanced Usage

### Access Underlying Provider

```typescript
const provider = client.getProvider();
// Access the authenticated RPC provider for advanced operations
```

### Get Account Address

```typescript
const address = client.getAddress();
console.log('Your Paradex address:', address);
```

### Custom RPC Calls

```typescript
const provider = client.getProvider();
const result = await provider.callContract({
  contractAddress: '0x...',
  entrypoint: 'get_balance',
  calldata: ['0x123'],
});
```

### Session Grant Typed Data (experimental)

A session grant lets a wallet authorize a short-lived Stark session key to trade, within scopes and limits, without withdrawing. The SDK builds the grant and its typed data in both encodings: EIP-712 for EVM wallets, with domain `{ name: "Paradex Session", version: "1", chainId: <the wallet's current chain> }`, and SNIP-12 revision 1 for Stark owners.

> The server side of sessions is not released yet. These APIs may change.

```typescript
const grant = Paradex.SessionTypedData.createGrant({
  paradexChain: 'PRIVATE_SN_PARACLEAR_MAINNET',
  environment: 'mainnet', // or 'testnet'
  account: '0x...', // the owner's Paradex account
  sessionKey: '0x...', // the session's Stark public key
  scopes: ['trade'], // 'trade' | 'trade:rfq' | 'trade:block' | 'account:settings'
  // limits defaults to every limit uncapped ('none', markets ['*']).
  subaccounts: [], // sub-account addresses the session may also trade
});

const chainId = await window.ethereum.request({ method: 'eth_chainId' });
const typedData = Paradex.SessionTypedData.buildGrantEip712(grant, chainId);
const digest = Paradex.SessionTypedData.hashEip712(typedData);
```

Every limit is stated: a positive decimal (USD; leverage as a multiple) or `"none"` for no cap, and `markets` is a list or `["*"]` for every market. A grant may only set a limit the server enforces. Until it enforces any, every limit must be `"none"` and `markets` `["*"]`, which is the default. When the server enforces some, list them in `enforcedLimits` (for example `['maxOrderNotional', 'markets']`), and only those may be set.

Grants are checked before signing. These throw a `SessionGrantError` with a `code`:

- reserved scopes (`withdraw:owner`, `trade:isolated`);
- lifetimes past the server caps;
- a limit that is empty, or set while the server doesn't enforce it (`LIMIT_INVALID`);
- builder grants asking for `trade:block` or `account:settings`;
- builder grants without a numeric `maxLoss`. Builder grants need a loss cap, so they're refused until the server enforces `maxLoss`.

Pass `limitCaps` to refuse limits above your own ceilings before the wallet is asked. Caps apply only to enforced limits; a cap on a limit the server doesn't enforce refuses every grant.

Show the owner what they are approving with `SessionTypedData.summarizeGrant(grant)`. Its first line states the risk plainly: _Cannot withdraw; can lose up to `maxLoss` USD by trading_, or, when `maxLoss` is `"none"`, _Cannot withdraw; trading losses are not capped by this session_.

## Best Practices

### 1. Environment Variables

Store sensitive data in environment variables:

```typescript
const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
  throw new Error('PRIVATE_KEY environment variable is required');
}
```

### 2. Error Handling

Always wrap SDK calls in try-catch blocks:

```typescript
try {
  const client = await Paradex.Client.fromEthSigner({ config, signer });
  const balance = await client.getTokenBalance('USDC');
} catch (error) {
  // Handle errors appropriately
  console.error('SDK Error:', error);
}
```

### 3. Socialized Loss Checks

Always check for socialized loss before withdrawals:

```typescript
const receivable = await client.getReceivableAmount('USDC', amount);
if (Number(receivable.socializedLossFactor) !== 0) {
  // Warn user they will receive less than requested
  console.warn(
    `Due to socialized loss, you will receive ${receivable.receivableAmount} instead of ${amount}`,
  );
}
```

### 4. Transaction Confirmations

Wait for transaction confirmations:

```typescript
const result = await client.withdraw('USDC', '100', []);
console.log('Transaction submitted:', result.hash);

// Wait for confirmation
await client.waitForTransaction(result.hash);
console.log('Transaction confirmed!');
```

### 5. Type Safety

Leverage TypeScript for type safety:

```typescript
import type { ParadexClient } from '@paradex/sdk';

function processBalance(client: ParadexClient, token: string): Promise<void> {
  // TypeScript will ensure correct usage
  return client.getTokenBalance(token).then((balance) => {
    console.log(`${token} Balance:`, balance.size);
  });
}
```

## Browser Usage Notes

To use the Paradex SDK in the browser, you'll need to configure your bundler to polyfill Node.js modules:

### Webpack 5

```javascript
// webpack.config.js
module.exports = {
  resolve: {
    fallback: {
      buffer: require.resolve('buffer/'),
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
    },
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser',
    }),
  ],
};
```

### Vite

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [nodePolyfills()],
  define: {
    'process.env.NODE_DEBUG': JSON.stringify(''),
  },
});
```

## Examples

See the [examples](./examples) directory for complete working examples:

- **[account-ethereum.ts](./examples/account-ethereum.ts)** - Create client from Ethereum wallet
- **[account-starknet.ts](./examples/account-starknet.ts)** - Create client from Starknet account
- **[withdrawal-node.ts](./examples/withdrawal-node.ts)** - Complete withdrawal flow (Node.js)
- **[withdrawal.ts](./examples/withdrawal.ts)** - Complete withdrawal flow (Browser)

For a full React application example, see: [paradex-react-example](https://github.com/tradeparadex/paradex-react-example)

## API Reference

### Client Methods

| Method                                | Description                            | Returns                |
| ------------------------------------- | -------------------------------------- | ---------------------- |
| `getTokenBalance(token)`              | Get token balance                      | `TokenBalance`         |
| `getMaxWithdraw(token)`               | Get maximum withdrawable amount        | `MaxWithdraw`          |
| `getSocializedLossFactor()`           | Get current socialized loss factor     | `SocializedLossFactor` |
| `getReceivableAmount(token, amount)`  | Calculate amount after socialized loss | `ReceivableAmount`     |
| `withdraw(token, amount, bridgeCall)` | Initiate withdrawal                    | `WithdrawResult`       |
| `waitForTransaction(hash, options?)`  | Wait for transaction confirmation      | `TransactionReceipt`   |
| `getAddress()`                        | Get account address                    | `string`               |
| `getProvider()`                       | Get underlying provider                | `DefaultProvider`      |

### Configuration

| Method              | Description                         | Returns         |
| ------------------- | ----------------------------------- | --------------- |
| `Config.fetch(env)` | Fetch configuration for environment | `ParadexConfig` |

### Signer

| Method                      | Description                  | Returns          |
| --------------------------- | ---------------------------- | ---------------- |
| `Signer.fromEthers(signer)` | Create signer from ethers.js | `EthereumSigner` |

### SessionTypedData (experimental)

| Method                                | Description                                      | Returns           |
| ------------------------------------- | ------------------------------------------------ | ----------------- |
| `createGrant(params)`                 | Build a canonical, validated `SessionGrant`      | `SessionGrant`    |
| `buildGrantEip712(grant, chainId)`    | EIP-712 typed data for an EVM wallet             | `Eip712TypedData` |
| `buildGrantSnip12(grant)`             | SNIP-12 rev 1 typed data for a Stark owner       | `TypedData`       |
| `buildPasskeyGrantEip712/Snip12(...)` | Typed data for `PasskeyGrant`                    | typed data        |
| `buildMintEip712/Snip12(...)`         | Typed data for `SessionMint`                     | typed data        |
| `hashEip712(typedData)`               | EIP-712 digest                                   | `Hex`             |
| `hashSnip12(typedData, account)`      | SNIP-12 message hash                             | `Hex`             |
| `validateGrant(grant)`                | Check format rules and lifetime caps             | `void` (throws)   |
| `assertGrantActive(grant, now?)`      | Throw `GRANT_EXPIRED` once the grant has expired | `void` (throws)   |

## Support

- **Discord:** [Join our Discord](https://discord.gg/paradex)
- **Documentation:** [docs.paradex.trade](https://docs.paradex.trade)
- **Issues:** [GitHub Issues](https://github.com/tradeparadex/paradex.js/issues)

## License

MIT

## Warning

⚠️ **This SDK is in active development.** APIs may change between versions. Please check the changelog before upgrading.

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.
