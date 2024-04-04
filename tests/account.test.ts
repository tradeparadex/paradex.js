import { ethers } from 'ethers';

import * as Account from '../src/account';
import { ethersSignerAdapter } from '../src/ethereum-signer';

import PARADEX_CONFIG from './fixtures/paradex-config.json';

describe('create account from eth signer', () => {
  test('correct account address is generated', async () => {
    const testCases = [
      {
        seed: 'test test test test test test test test test test test ball',
        address:
          '0x72c394aaa3fae59ad7749c856dc18e2a289e83885b80c0da7731290a9163e17',
      },
      {
        seed: 'test test test test test test test test test test test junk',
        address:
          '0x37ff1c9d89a50b3dd3a4f90e020ea80251b09ba28049efbe4f7d3fec2995c4a',
      },
      {
        seed: 'test test test test test test test test test test test waste',
        address:
          '0x18610fa9cdb1dd19cc224f137754dc98fc4a2af9bb3a20dc6a15baa1fc1a1f8',
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
