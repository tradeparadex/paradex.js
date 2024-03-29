# Paradex SDK

## Install

```sh
npm install --save @paradex/sdk
```

```sh
yarn add @paradex/sdk
```

## Use cases

### Get Paradex account address from Ethereum signer

This example uses `ethers` as a dependency to provide an Ethereum signer. If you need support for other libraries, [get in touch].

```ts
import { ethers } from 'ethers';
import * as Paradex from '@paradex/sdk';

// 1. Fetch Paradex config for the relevant environment
// Supported environments:
//  - 'testnet' (Sepolia Testnet)
//  - 'mainnet' (Ethereum Mainnet)
const config = await Paradex.Config.fetchConfig('testnet');

// 2. Get ethers signer (example with injected provider)
const ethersProvider = new ethers.BrowserProvider(window.ethereum);
const ethersSigner = await ethersProvider.getSigner();

// 3. Create Ethereum signer based on ethers signer
const signer = Paradex.Signer.ethersSignerAdapter(ethersSigner);

// 4. Initialize the account with config and Ethereum signer
const account = await Paradex.Account.fromEthSigner({ config, signer });

console.log(`Account address: ${account.address}`);
// => Account address: 0x...
```

## Notes on browser usage

To use the Paradex SDK in the browser you will need to polyfill `Buffer` from node and define `process.env.NODE_DEBUG` to satisfy `@starkware-industries/starkware-crypto-utils`.

## Get in touch

Have a feature to request or a bug to report?

Drop us a message on [Discord].

[Discord]: https://discord.gg/paradex
[get in touch]: #get-in-touch

## Warning

⚠️ `@paradex/sdk` is experimental and APIs are subject to change
