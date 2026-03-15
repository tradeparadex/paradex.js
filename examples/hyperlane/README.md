# Hyperlane Bridge Examples

Standalone examples for triggering cross-chain deposits and withdrawals via [Hyperlane](https://www.hyperlane.xyz/) warp routes between **Ethereum**, **Solana**, and **Paradex**.

## Supported Routes

| File          | Route            | Description        |
| ------------- | ---------------- | ------------------ |
| `ethereum.ts` | `eth-to-sol`     | Ethereum → Solana  |
| `ethereum.ts` | `eth-to-paradex` | Ethereum → Paradex |
| `solana.ts`   | `sol-to-eth`     | Solana → Ethereum  |
| `solana.ts`   | `sol-to-paradex` | Solana → Paradex   |
| `paradex.ts`  | `paradex-to-eth` | Paradex → Ethereum |
| `paradex.ts`  | `paradex-to-sol` | Paradex → Solana   |

## Supported Assets

| Asset    | Ethereum    | Solana                  | Paradex     | Notes                              |
| -------- | ----------- | ----------------------- | ----------- | ---------------------------------- |
| **USDC** | 6 decimals  | 6 decimals              | 6 decimals  | Available on testnet and mainnet   |
| **DIME** | 18 decimals | 9 decimals (Token-2022) | 18 decimals | Solana routes are **mainnet only** |

## Prerequisites

1. **Node.js** v18+
2. **Install dependencies** from the repo root:
   ```bash
   yarn install
   ```
3. **Install Solana dependencies** (only needed for Solana-originating routes):
   ```bash
   yarn add --dev @solana/web3.js @solana/spl-token bs58
   ```
4. **Funded accounts** on the relevant networks

## Environment Variables

### Signing keys

| Variable               | When required                                       | Description                                                                                   |
| ---------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ETHEREUM_PRIVATE_KEY` | Ethereum-originating and Paradex-originating routes | Ethereum private key (hex, `0x` prefix). Used for EVM signing and Paradex account derivation. |
| `SOLANA_PRIVATE_KEY`   | Solana-originating routes                           | Solana keypair (base58 encoded secret key). Required for signing Solana transactions.         |

### Destination addresses

For routes where the destination is a different chain, you can pass the recipient address directly instead of deriving it from a private key.

| Variable           | When to use             | Description                                                                                          |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `ETHEREUM_ADDRESS` | Destination is Ethereum | Ethereum address (hex, `0x` prefix). Falls back to deriving from `ETHEREUM_PRIVATE_KEY`.             |
| `SOLANA_ADDRESS`   | Destination is Solana   | Solana address (base58). Falls back to deriving from `SOLANA_PRIVATE_KEY`.                           |
| `PARADEX_ADDRESS`  | Destination is Paradex  | Paradex (Starknet) address (hex). Falls back to deriving from `ETHEREUM_PRIVATE_KEY` via paradex.js. |

### Configuration

| Variable           | Default                 | Description                             |
| ------------------ | ----------------------- | --------------------------------------- |
| `PARADEX_ENV`      | `testnet`               | `testnet` or `prod`                     |
| `AMOUNT`           | `10`                    | Transfer amount in human-readable units |
| `ETHEREUM_RPC_URL` | Auto (llamarpc/sepolia) | Custom Ethereum RPC URL                 |

## Usage

```bash
yarn tsx examples/hyperlane/<file>.ts <route> [asset]
```

The asset argument is optional and defaults to `USDC`. All commands show a confirmation prompt before executing.

### Ethereum → Solana

```bash
# USDC (testnet)
ETHEREUM_PRIVATE_KEY="0x..." SOLANA_ADDRESS="..." \
  yarn tsx examples/hyperlane/ethereum.ts eth-to-sol

# DIME (mainnet only)
PARADEX_ENV=prod ETHEREUM_PRIVATE_KEY="0x..." SOLANA_ADDRESS="..." \
  yarn tsx examples/hyperlane/ethereum.ts eth-to-sol DIME

# Custom amount
AMOUNT=50 ETHEREUM_PRIVATE_KEY="0x..." SOLANA_ADDRESS="..." \
  yarn tsx examples/hyperlane/ethereum.ts eth-to-sol
```

### Ethereum → Paradex

```bash
# USDC (testnet) — Paradex address derived from Ethereum key
ETHEREUM_PRIVATE_KEY="0x..." \
  yarn tsx examples/hyperlane/ethereum.ts eth-to-paradex

# USDC to a specific Paradex address
ETHEREUM_PRIVATE_KEY="0x..." PARADEX_ADDRESS="0x..." \
  yarn tsx examples/hyperlane/ethereum.ts eth-to-paradex

# DIME (mainnet)
PARADEX_ENV=prod ETHEREUM_PRIVATE_KEY="0x..." \
  yarn tsx examples/hyperlane/ethereum.ts eth-to-paradex DIME
```

### Solana → Ethereum

```bash
# USDC (testnet)
SOLANA_PRIVATE_KEY="..." ETHEREUM_ADDRESS="0x..." \
  yarn tsx examples/hyperlane/solana.ts sol-to-eth

# DIME (mainnet only)
PARADEX_ENV=prod SOLANA_PRIVATE_KEY="..." ETHEREUM_ADDRESS="0x..." \
  yarn tsx examples/hyperlane/solana.ts sol-to-eth DIME
```

### Solana → Paradex

```bash
# USDC (testnet) — pass Paradex address directly
SOLANA_PRIVATE_KEY="..." PARADEX_ADDRESS="0x..." \
  yarn tsx examples/hyperlane/solana.ts sol-to-paradex

# USDC (testnet) — derive Paradex address from Ethereum key
SOLANA_PRIVATE_KEY="..." ETHEREUM_PRIVATE_KEY="0x..." \
  yarn tsx examples/hyperlane/solana.ts sol-to-paradex

# DIME (mainnet only)
PARADEX_ENV=prod SOLANA_PRIVATE_KEY="..." PARADEX_ADDRESS="0x..." \
  yarn tsx examples/hyperlane/solana.ts sol-to-paradex DIME
```

### Paradex → Ethereum

```bash
# USDC (testnet) — destination defaults to own Ethereum address
ETHEREUM_PRIVATE_KEY="0x..." \
  yarn tsx examples/hyperlane/paradex.ts paradex-to-eth

# Send to a different Ethereum address
ETHEREUM_PRIVATE_KEY="0x..." ETHEREUM_ADDRESS="0x..." \
  yarn tsx examples/hyperlane/paradex.ts paradex-to-eth

# DIME (testnet)
ETHEREUM_PRIVATE_KEY="0x..." \
  yarn tsx examples/hyperlane/paradex.ts paradex-to-eth DIME
```

### Paradex → Solana

```bash
# USDC (testnet)
ETHEREUM_PRIVATE_KEY="0x..." SOLANA_ADDRESS="..." \
  yarn tsx examples/hyperlane/paradex.ts paradex-to-sol

# DIME (mainnet only)
PARADEX_ENV=prod ETHEREUM_PRIVATE_KEY="0x..." SOLANA_ADDRESS="..." \
  yarn tsx examples/hyperlane/paradex.ts paradex-to-sol DIME
```

## How It Works

### Ethereum-originating transfers

1. Quote gas payment from the warp route contract (`quoteGasPayment`)
2. Approve the ERC20 token to the warp route contract
3. Call `transferRemote(destinationDomain, recipient, amount)` with the gas quote as `msg.value`

### Solana-originating transfers

1. Detect the token program (SPL Token vs Token-2022)
2. Read IGP (Interchain Gas Paymaster) configuration from on-chain token account data
3. Derive all required PDAs (token account, mailbox outbox, dispatch authority, message storage, IGP accounts)
4. Build and serialize a `transfer_remote` instruction with manual binary encoding
5. Submit the transaction with compute budget and priority fee instructions

### Paradex-originating transfers

Uses [paradex.js](https://github.com/tradeparadex/paradex.js) to derive the Paradex account from an Ethereum private key.

1. Get the receivable amount (accounting for socialized loss)
2. Quote gas payment from the warp route contract on Paradex
3. Build an atomic batch of Starknet calls:
   - Approve token to warp route
   - Approve gas token to warp route
   - Call `transfer_remote` on the warp route
4. `client.withdraw()` batches the Paraclear withdrawal with the bridge calls into a single atomic transaction

## File Structure

```
examples/hyperlane/
├── README.md       ← This file
├── config.ts       ← Shared types, asset configs, ABIs, helpers
├── ethereum.ts     ← Transfers from Ethereum (uses ethers.js)
├── solana.ts       ← Transfers from Solana (uses @solana/web3.js)
└── paradex.ts      ← Transfers from Paradex (uses paradex.js)
```

## Testnet vs Mainnet

By default all examples run against **testnet**. Set `PARADEX_ENV=prod` to use mainnet.

Note that DIME on Solana is only deployed on mainnet — running Solana DIME routes on testnet will error.

## Security

- **Never commit private keys** to version control
- **Use environment variables** for all sensitive data
- **Test on testnet** before using mainnet
- All commands prompt for confirmation (`[N/y]`) before executing any transaction
