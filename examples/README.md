# Running Examples

## Withdrawal Example (Node.js)

To test the withdrawal functionality with the latest SDK changes (RPC v0.9 support):

### Prerequisites

1. Ensure you have a test account with testnet funds
2. Know your Ethereum private key (hex format with 0x prefix)

### Running the Example

#### Basic Usage

```bash
# Using default test values (testnet, empty private key - will use default)
yarn run example:withdrawal
```

#### With Environment Variables

```bash
# Set your Ethereum private key
export PRIVATE_KEY="0x..."

# Set network (testnet or mainnet)
export NETWORK="testnet"

# Set token symbol
export TOKEN="USDC"

# Set withdrawal amount
export AMOUNT="0.01"

# Run the example
yarn run example:withdrawal
```

#### One-liner

```bash
PRIVATE_KEY="0x..." yarn run example:withdrawal
```

### What the Example Tests

The withdrawal example verifies:

1. ✅ Config fetching for testnet/mainnet
2. ✅ Paraclear provider creation (with RPC v0.9)
3. ✅ Account derivation from Ethereum private key
4. ✅ Token balance retrieval
5. ✅ Receivable amount calculation (with socialized loss factor)
6. ✅ **Withdrawal transaction execution with RPC v0.9 resource bounds** (main change)
7. ✅ Transaction confirmation

### Key Changes Being Tested

The example specifically tests the migration from `maxFee` to `resourceBounds`:

- Uses `estimateInvokeFee()` to get proper resource bounds based on actual transaction cost
- Resource bounds are automatically calculated to match account balance
- No hardcoded fee values - fees are estimated dynamically
- Bridge calls are optional (empty array `[]` in the example)

### Troubleshooting

**Error: "Failed to get token balance"**

- Ensure your account has funds on the testnet
- Verify the token symbol is correct (e.g., 'USDC')
- Check that `PRIVATE_KEY` is set correctly

**Transaction fails**

- Check that you have sufficient balance for fees
- Ensure the account has been initialized on Paraclear
- Verify the private key corresponds to an account with funds

**Note:** The example uses an empty bridge call array (`bridgeCall: []`). For production use, you would need to provide actual bridge contract calls to transfer funds from L2 to L1.

### Browser Example

For browser usage, see `withdrawal.ts` which uses `window.ethereum` (MetaMask, etc.)
