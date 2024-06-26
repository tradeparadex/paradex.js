import * as starknetSigner from '../src/starknet-signer';

describe('create STARK keys from Starknet signature', () => {
  const testCases = [
    // ArgentX format
    [
      '2231984868969048974562485890219247398275701629647443585775236999641425026575',
      '3466859603989374479029698457644986072084114081755866615133116155642354912863',
    ],
    // Braavos format
    [
      '1',
      '2231984868969048974562485890219247398275701629647443585775236999641425026575',
      '3466859603989374479029698457644986072084114081755866615133116155642354912863',
    ],
    // Weierstrass format
    {
      r: '2231984868969048974562485890219247398275701629647443585775236999641425026575',
      s: '3466859603989374479029698457644986072084114081755866615133116155642354912863',
    },
  ] as starknetSigner.Signature[];

  for (const starknetSignature of testCases) {
    it('should extract seed from starknet signature correctly', async () => {
      const seed =
        starknetSigner.getSeedFromStarknetSignature(starknetSignature);
      expect(seed).toBe(
        '0x4ef42380ace7106e489f211d6ff21bd819043ccf431bbb30aa8fa39bd649e0f',
      );
    });

    it('should derive private stark key from starknet signature correctly', async () => {
      const seed =
        starknetSigner.getSeedFromStarknetSignature(starknetSignature);
      const keyPair =
        await starknetSigner.getStarkKeypairFromStarknetSignature(seed);

      expect(keyPair).toStrictEqual([
        '46063cf2e9c3cbf5cc17ad5fdfce6b6959fede7ceb433dc057a3c90f668004b',
        '7a0e7def00d198ccea862678174b5afcc26378d31e1fcdeabb7d5f8d698dbb',
      ]);
    });
  }
});
