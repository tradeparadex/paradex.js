import {
  getPrivateKeyFromEthSignature,
  grindKey,
  privateToStarkKey,
  STARK_EC_ORDER,
} from '../src/key-derivation';
import { getStarkKeypairFromStarknetSignature } from '../src/starknet-signer';

// Expected values were generated with @starkware-industries/starkware-crypto-utils@0.2.1,
// which this module replaces. They must never change: accounts are derived from them.

const ethSignatureCases = [
  {
    sig: '0xf99f5da7d1d689784e9f9a2ca4cc048a06e894b9231abe7a6f217bc3648601a75311504cf7e6d1497a82f12cc47f3976361010f6fb349a067c4972b1bb4427d61b',
    privateKey:
      '7812d0b6dc810f9cc1759f349bfe3be99532f2f2bf6f2a402f0fbd3b74b206f',
    publicKey:
      '26e8ae27fe4ed9864f7c10d904e879ab829f9230f93c6caf6d9d8f05472d4b3',
  },
  {
    sig: '0x7b27ca6a111493de0896d25101c08bbf0bce85c701d3764102a7121fdd34fa6309462d65f0655c5364b335d4b1f03d8a34c66c322b81d7a876a9c484cea1e6e11b',
    privateKey:
      '42cc3e08f66887352b6ff25f97e5f9855400abdc632a8da03c0ff52f643f2f0',
    publicKey:
      '57e8556bfe4ff76802962bff9c786b93931288f0aedea426cbc979a91a444bf',
  },
  {
    sig: '0xfcd981e49d8199a1b8a585e6a619a22905f5246b34dd2985d621b6c5cad9dce83d770277a98789c58fd4facc537295f52f11365c2929ce6c8de899cc355c96821b',
    privateKey:
      '57764fcd1689ec9bf5d27c8c81b67fb4aa474aaa56b6bd970e224bab71506c8',
    publicKey:
      '4dcecf45c4ce4532a6edd27dc6014ef430efeb8f7ea3463aea60a5b77a6a520',
  },
  {
    sig: '0xbd397ea5eb6c95089ee75859a78cf0730b65b1bed80a74427395cf03d4a624a2ab5654b27cbae1eaf8bd72f9462729e9e455b08dcbc3f030ace31c43ddcaacca1b',
    privateKey:
      '3d0029b401962f22b86e375d9fbc9f690c6de9a1d098d7b1ebea52a42ef3383',
    publicKey:
      '196f2bf2a0c9f9b0ef8c32ded79962cb1577564c817a7faf70430a228160e14',
  },
  {
    sig: '0x38df08f8a6cfd5d6f6f5fe56d11edb32aaff47291390330ce03990697c39d4a260c108e3de313ba772ac7cd31a6b12ec0a5c6ca0a692589b44eeefcec5e07ebd1b',
    privateKey:
      'f6c9541a1f1b0ae957fe6f6967f968eb98ec55855f210845b366545a1ec6c3',
    publicKey:
      '6d88e9934fcd06ba21ea9d0c73949db7af04318d57804b89ce09eda5aa11543',
  },
  {
    sig: '0x000eba335a104302cb62a72a9ff847e66bc57299f8315877661800e6df53f26bfaee89ba76b0e16a10e662cb694048cd5460a666ac41a375036c1680043b3f1c1c',
    privateKey:
      '783d8de1ac6e354b6f622163fa00cbdb602ca344381e7bf5d6865e8ce19d238',
    publicKey:
      '5f354084dcb753f0669387e19e31b39291c67f5a165de2b01725046acdafbb0',
  },
];

// Includes a seed whose first hash is rejected (needs a second grind round)
// and odd-length seeds, whose trailing nibble handling must be preserved.
const grindCases = [
  {
    seed: 'f21b0ef89d8ee5daf6ba6cd441652a647229941e85b1537b5c35ede6b4d519a8',
    privateKey:
      '255960512d3f538034f1bc7e0b1a2338b55c6b4e995e2f6d35d036daaa78f3a',
    publicKey:
      '44087fda013b5be52af588ca40cabb604da93f18cf8fb7629ad8ecb80eed214',
  },
  {
    seed: '711430f6164e93803d93428bc1fab80f41e213bb197689307de8606d437c3038',
    privateKey:
      '47a4bb45adbd02a001d3e950b542f0caba2adc72725c4a041a4e23fc093fc6f',
    publicKey:
      '2c280eec9fc0ff650050670772d60b7b3a100b8a9ea92024b06c5968889245e',
  },
  {
    seed: '4d2f4b668cfc48e6059d36e91326bf87de39ba819f35450477bc1ce614a63b',
    privateKey:
      '36ebf92cae6b7a51a8cae4230355a3f9f69dc00c191dcaecd730628fe6d89dd',
    publicKey: 'c34664b8c3d9e3d928d4f2a43dd50769f78d8f2a9d5e11572fdc04de3efdba',
  },
  {
    seed: 'f90c3e31641c55271c1d522add1294a20de83776ca7e0f8c0807032b3926e084',
    privateKey:
      '14d966d5a60be6cd6a424d960d151a776b2f0ccb40d11fb57396746d2ba508e',
    publicKey:
      '70c1c0b3cad67c2e7b1e0e5da1e58efd83c91ad8995a258d43ee768d036f11a',
  },
  {
    seed: '0x3921871aa0881e3e94830142ac90994452f670fe337eb50303ea9cc6d0f3ae37',
    privateKey:
      '37d1e928a2f4272c7a159cc9531220ae2b4e7f8c1d436f3487fc5ff35ebd6fa',
    publicKey:
      '54ebf8d0fab7c0ddf056cbb4e2e212798a953a5245101accb5da7378ad26491',
  },
  {
    seed: 'd71a3a18e633a5f196757663e54addd3921dfb3b0b17426cc6a03846c9cde25',
    privateKey:
      '4038eef926cf819ddf9ccb8a0b7fd19706f12fee60be1e49c5a54ba11b35bab',
    publicKey:
      '46911d7119a77e9d64e74e5e899b60a860e027369acaa3023d5767637042092',
  },
  {
    seed: '90e97eba84cce7000a547c0ffb530b5ca34a1c4d0c703fbde03ba56c474a3',
    privateKey:
      '7f685f366f09c4b7c8d21851c638b879c59513d978dddf231194162eca7ed34',
    publicKey:
      '661b8713d2172f987e3f942557f31b3401902c9fd355f09430297a439ed1d6d',
  },
  {
    seed: '2',
    privateKey:
      '6a9e7f1c95b8299b99743e0c5c4ce978b362bb0493e2ccb988bfe70a36e814e',
    publicKey:
      '5137a573a7029bb765a288ed9d156ac2623be9e624c33a181a29583dea7d5a4',
  },
  {
    seed: '9fb65b5',
    privateKey:
      '5dbfa25e1f743e038211631776ff88dcc743c7f02bad2b431660ad7ba0b218',
    publicKey:
      '15c07ae845357444e030d21a553f3a5212d6ef9fcc6cb7d4a2fb8b48a403540',
  },
];

const starkKeyCases = [
  {
    privateKey: '1',
    publicKey:
      '1ef15c18599971b7beced415a40f0c7deacfd9b0d1819e03d723d8bc943cfca',
  },
  {
    privateKey: '2',
    publicKey:
      '759ca09377679ecd535a81e83039658bf40959283187c654c5416f439403cf5',
  },
  {
    privateKey: 'a',
    publicKey:
      '320ceae3120e56f6006f7d626760f12fc276a3c7683e9b0b87c097d7be8dbde',
  },
  {
    privateKey: 'f00',
    publicKey:
      '5b92de9179339952381efe5f646a0876cc710bd535c97a1cb0743d36b55cf58',
  },
  {
    privateKey:
      'dd1d188490ed268e1911b492e51d30691f6520c7ae6816bb210cacd8594e1d1',
    publicKey:
      '630f6d9f41c2ebda4e5648d55a1a83757f3231b25d4063df1ee5310945c1883',
  },
  {
    privateKey:
      '06e73bff1d94b0a7500145be82722e7455dba1653e9b56eeaa043c5980aed37',
    publicKey:
      '3179c1f0031ec98df7066ae89096df4ea1a2bd1d0132477cf16ca243af3887b',
  },
  {
    privateKey:
      '0x11e85b7770ec43e8023b771be2b334b0e5543cd2f8d98aee3c8f09364bc1',
    publicKey:
      '7d81ba1baa783eb3aeabdccf7908f816f818879752c75889ef953a7de42b377',
  },
];

describe('key derivation matches starkware-crypto-utils', () => {
  test.each(ethSignatureCases)(
    'getPrivateKeyFromEthSignature($sig)',
    ({ sig, privateKey, publicKey }) => {
      expect(getPrivateKeyFromEthSignature(sig)).toBe(privateKey);
      expect(privateToStarkKey(privateKey)).toBe(publicKey);
    },
  );

  test.each(grindCases)(
    'grindKey($seed)',
    ({ seed, privateKey, publicKey }) => {
      expect(grindKey(seed, STARK_EC_ORDER)).toBe(privateKey);
      expect(privateToStarkKey(privateKey)).toBe(publicKey);
    },
  );

  test.each(grindCases)(
    'getStarkKeypairFromStarknetSignature($seed)',
    async ({ seed, privateKey, publicKey }) => {
      await expect(getStarkKeypairFromStarknetSignature(seed)).resolves.toEqual(
        [privateKey, publicKey],
      );
    },
  );

  test.each(starkKeyCases)(
    'privateToStarkKey($privateKey)',
    ({ privateKey, publicKey }) => {
      expect(privateToStarkKey(privateKey)).toBe(publicKey);
    },
  );
});

describe('key derivation input validation', () => {
  test('rejects malformed Ethereum signatures', () => {
    expect(() => getPrivateKeyFromEthSignature('0x1234')).toThrow();
    expect(() =>
      getPrivateKeyFromEthSignature('0x' + 'zz'.repeat(65)),
    ).toThrow();
  });

  test('rejects malformed private keys', () => {
    expect(() => privateToStarkKey('0')).toThrow();
    expect(() => privateToStarkKey('f'.repeat(64))).toThrow();
    expect(() => privateToStarkKey('xyz')).toThrow();
  });

  test('rejects non-hex seeds', () => {
    expect(() => grindKey('not hex')).toThrow();
  });
});
