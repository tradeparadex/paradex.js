# paradex-account

Generate Paradex account info from an Ethereum signature.

## Install

```sh
npm install --save paradex-account
```

```sh
yarn add paradex-account
```

## Usage

```ts
import * as ParadexAccount from 'paradex-account';

// 1. Fetch Paradex config for the relevant environment
const config = await ParadexAccount.fetchConfig('testnet'); // "testnet" | "mainnet"

// 2. Build the typed data that needs to be signed by the user in order to derive the account
const typedData = ParadexAccount.buildStarkKeyTypedData(config);

// 3. Use your library of choice to request the signature on the typed data
const signature = '0x...';

// 4. Derive the account based on the signature
const account = ParadexAccount.fromEthSignature(config, signature);
// => { address: "0x..." }
```
