import { ethers } from 'ethers';

import * as Account from '../src/account';
import { ethersSignerAdapter } from '../src/ethereum-signer';

import PARADEX_CONFIG from './fixtures/paradex-config.json';

describe('create account from eth signer', () => {
  test('correct account address is generated', async () => {
    const testCases = [
      {
        seed: 'candy maple cake sugar pudding cream honey rich smooth crumble sweet treat',
        address:
          '0x707886cbe8b442873740452716b2c38a217bb31f3637d6d66ae8f3f49f8510b',
      },
      {
        seed: 'guilt stove cube spoil grass buzz rib work inflict spatial satoshi vicious',
        address:
          '0x67b3d10d2ae737d60b3b273a42f7fee5bff9e32f4716d2767f529817eb9005e',
      },
      {
        seed: 'cabbage judge food egg dream typical broccoli wool expand dragon gasp trophy',
        address:
          '0x5b6e346f3cf1351b30271a4d7c4c1e91d198b878cf539b4f16d76d0db815a3c',
      },
    ];

    for (const testCase of testCases) {
      const wallet = ethers.Wallet.fromPhrase(testCase.seed);
      const signer = ethersSignerAdapter(wallet);

      const account = await Account.fromEthSigner({
        config: PARADEX_CONFIG,
        signer,
      });

      expect(account.address).toBe(testCase.address);
    }
  });
});
