import * as Starknet from 'starknet';

import { AccountSupport } from '../src/starknet-account-support';

jest.unmock('starknet');

function setup(classHash: string): {
  contract: Starknet.Contract;
  accountSupport: AccountSupport;
} {
  const contract = { call: jest.fn() } as unknown as Starknet.Contract;
  const accountSupport = new AccountSupport(
    contract as unknown as Starknet.Contract,
    classHash,
  );
  return { contract, accountSupport };
}

test('missing check', async () => {
  const { accountSupport } = setup(
    '0x1a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003',
  );

  expect(() => {
    accountSupport.getSeedFromSignature(['0x1', '0x2']);
  }).toThrow('Check account contract support first');
});

test('Argent v0.3.0', async () => {
  const { accountSupport } = setup(
    '0x1a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003',
  );

  const result = await accountSupport.check();
  expect(result.ok).toBe(true);

  const seed = accountSupport.getSeedFromSignature([
    '0x1', // R
    '0x2', // S
  ]);
  expect(seed).toBe('0x1');
});

test('Argent v0.3.1', async () => {
  const { accountSupport } = setup(
    '0x29927c8af6bccf3f6fda035981e765a7bdbf18a2dc0d630494f8758aa908e2b',
  );

  const result = await accountSupport.check();
  expect(result.ok).toBe(true);

  const seed = accountSupport.getSeedFromSignature([
    '0x1', // R
    '0x2', // S
  ]);
  expect(seed).toBe('0x1');
});

test('Argent v0.4.0 with Starknet signer, compact signature', async () => {
  const { accountSupport, contract } = setup(
    '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f',
  );

  jest
    .spyOn(contract, 'call')
    .mockResolvedValue(new Starknet.CairoCustomEnum({ Starknet: {} }));

  const result = await accountSupport.check();
  expect(result.ok).toBe(true);

  const seed = accountSupport.getSeedFromSignature([
    '0x1', // R
    '0x2', // S
  ]);
  expect(seed).toBe('0x1');
});

test('Argent v0.4.0 with Starknet signer, default signature', async () => {
  const { accountSupport, contract } = setup(
    '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f',
  );

  jest
    .spyOn(contract, 'call')
    .mockResolvedValue(new Starknet.CairoCustomEnum({ Starknet: {} }));

  const result = await accountSupport.check();
  expect(result.ok).toBe(true);

  const seed = accountSupport.getSeedFromSignature([
    '0x1', // Signatures count
    '0x2', // Signer type
    '0x3', // Public key
    '0x4', // R
    '0x5', // S
  ]);
  expect(seed).toBe('0x4');
});

test('Argent v0.4.0 with Starknet signer, guardian signature', async () => {
  const { accountSupport, contract } = setup(
    '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f',
  );

  jest
    .spyOn(contract, 'call')
    .mockResolvedValue(new Starknet.CairoCustomEnum({ Starknet: {} }));

  const result = await accountSupport.check();
  expect(result.ok).toBe(true);

  const seed = accountSupport.getSeedFromSignature([
    '0x2', // Signatures count
    '0x2', // Signer type
    '0x3', // Public key
    '0x4', // R
    '0x5', // S
    '0x6', // Signer type
    '0x7', // Public key
    '0x8', // R
    '0x9', // S
  ]);
  expect(seed).toBe('0x4');
});

test('Argent v0.4.0 with Starknet signer, unexpected signature', async () => {
  const { accountSupport, contract } = setup(
    '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f',
  );

  jest
    .spyOn(contract, 'call')
    .mockResolvedValue(new Starknet.CairoCustomEnum({ Starknet: {} }));

  const result = await accountSupport.check();
  expect(result.ok).toBe(true);

  expect(() => {
    accountSupport.getSeedFromSignature([
      '0x2', // Signatures count
      '0x2', // Signer type
      '0x3', // Public key
      '0x4', // R
      '0x5', // S
      '0x6', // Signer type
      '0x7', // Public key
      '0x8', // R
      '0x9', // S
      '0x10', // ???
    ]);
  }).toThrow('Unsupported Argent signature');
});

test('Argent v0.4.0 with Secp256k1 signer', async () => {
  const { accountSupport, contract } = setup(
    '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f',
  );

  jest
    .spyOn(contract, 'call')
    .mockResolvedValue(new Starknet.CairoCustomEnum({ Secp256k1: {} }));

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Argent v0.4.0 with Secp256r1 signer', async () => {
  const { accountSupport, contract } = setup(
    '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f',
  );

  jest
    .spyOn(contract, 'call')
    .mockResolvedValue(new Starknet.CairoCustomEnum({ Secp256r1: {} }));

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Argent v0.4.0 with Eip191 signer', async () => {
  const { accountSupport, contract } = setup(
    '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f',
  );

  jest
    .spyOn(contract, 'call')
    .mockResolvedValue(new Starknet.CairoCustomEnum({ Eip191: {} }));

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Argent v0.4.0 with Webauthn signer', async () => {
  const { accountSupport, contract } = setup(
    '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f',
  );

  jest
    .spyOn(contract, 'call')
    .mockResolvedValue(new Starknet.CairoCustomEnum({ Webauthn: {} }));

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Argent multicall', async () => {
  const { accountSupport } = setup(
    '0x0381f14e5e0db5889c981bf050fb034c0fbe0c4f070ee79346a05dbe2bf2af90',
  );
  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Argent multisig v0.1.0', async () => {
  const { accountSupport } = setup(
    '0x737ee2f87ce571a58c6c8da558ec18a07ceb64a6172d5ec46171fbc80077a48',
  );
  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Argent multisig v0.1.1', async () => {
  const { accountSupport } = setup(
    '0x737ee2f87ce571a58c6c8da558ec18a07ceb64a6172d5ec46171fbc80077a48',
  );
  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Argent multisig v0.2.0', async () => {
  const { accountSupport } = setup(
    '0x737ee2f87ce571a58c6c8da558ec18a07ceb64a6172d5ec46171fbc80077a48',
  );
  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Braavos Multi Owner v1.0.0', async () => {
  const { accountSupport } = setup(
    '0x041bf1e71792aecb9df3e9d04e1540091c5e13122a731e02bec588f71dc1a5c3',
  );
  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Braavos v1.0.0 multisig', async () => {
  const { accountSupport, contract } = setup(
    '0x00816dd0297efc55dc1e7559020a3a825e81ef734b558f03c83325d4da7e6253',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(1n);

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Braavos v1.0.0 secp256r1 strong signer', async () => {
  const { accountSupport, contract } = setup(
    '0x00816dd0297efc55dc1e7559020a3a825e81ef734b558f03c83325d4da7e6253',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ secp256r1: 1n });

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Braavos v1.0.0 webauthn strong signer', async () => {
  const { accountSupport, contract } = setup(
    '0x00816dd0297efc55dc1e7559020a3a825e81ef734b558f03c83325d4da7e6253',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ webauthn: [1n] });

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Braavos v1.0.0 multiple stark signers', async () => {
  const { accountSupport, contract } = setup(
    '0x00816dd0297efc55dc1e7559020a3a825e81ef734b558f03c83325d4da7e6253',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ stark: [1n, 2n] });

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Braavos v1.0.0 single stark signer [r,s]', async () => {
  const { accountSupport, contract } = setup(
    '0x00816dd0297efc55dc1e7559020a3a825e81ef734b558f03c83325d4da7e6253',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ stark: [1n] });

  const result = await accountSupport.check();
  expect(result.ok).toBe(true);

  const seed = accountSupport.getSeedFromSignature([
    '0x1', // R
    '0x2', // S
  ]);
  expect(seed).toBe('0x1');
});

test('Braavos v1.0.0 single stark signer [signerType,r,s]', async () => {
  const { accountSupport, contract } = setup(
    '0x00816dd0297efc55dc1e7559020a3a825e81ef734b558f03c83325d4da7e6253',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ stark: [1n] });

  const result = await accountSupport.check();
  expect(result.ok).toBe(true);

  const seed = accountSupport.getSeedFromSignature([
    '0x1', // Signer type
    '0x2', // R
    '0x3', // S
  ]);
  expect(seed).toBe('0x2');
});

test('Braavos v1.1.0 multisig', async () => {
  const { accountSupport, contract } = setup(
    '0x02c8c7e6fbcfb3e8e15a46648e8914c6aa1fc506fc1e7fb3d1e19630716174bc',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(1n);

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Braavos v1.1.0 secp256r1 strong signer', async () => {
  const { accountSupport, contract } = setup(
    '0x02c8c7e6fbcfb3e8e15a46648e8914c6aa1fc506fc1e7fb3d1e19630716174bc',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ secp256r1: 1n });

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Braavos v1.1.0 webauthn strong signer', async () => {
  const { accountSupport, contract } = setup(
    '0x02c8c7e6fbcfb3e8e15a46648e8914c6aa1fc506fc1e7fb3d1e19630716174bc',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ webauthn: [1n] });

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Braavos v1.1.0 multiple stark signers', async () => {
  const { accountSupport, contract } = setup(
    '0x02c8c7e6fbcfb3e8e15a46648e8914c6aa1fc506fc1e7fb3d1e19630716174bc',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ stark: [1n, 2n] });

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Braavos v1.1.0 single stark signer [r,s]', async () => {
  const { accountSupport, contract } = setup(
    '0x02c8c7e6fbcfb3e8e15a46648e8914c6aa1fc506fc1e7fb3d1e19630716174bc',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ stark: [1n] });

  const result = await accountSupport.check();
  expect(result.ok).toBe(true);

  const seed = accountSupport.getSeedFromSignature([
    '0x1', // R
    '0x2', // S
  ]);
  expect(seed).toBe('0x1');
});

test('Braavos v1.1.0 single stark signer [signerType,r,s]', async () => {
  const { accountSupport, contract } = setup(
    '0x02c8c7e6fbcfb3e8e15a46648e8914c6aa1fc506fc1e7fb3d1e19630716174bc',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ stark: [1n] });

  const result = await accountSupport.check();
  expect(result.ok).toBe(true);

  const seed = accountSupport.getSeedFromSignature([
    '0x1', // Signer type
    '0x2', // R
    '0x3', // S
  ]);
  expect(seed).toBe('0x2');
});

test('Braavos v1.2.0 multisig', async () => {
  const { accountSupport, contract } = setup(
    '0x03957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(1n);

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Braavos v1.2.0 secp256r1 strong signer', async () => {
  const { accountSupport, contract } = setup(
    '0x03957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ secp256r1: 1n });

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Braavos v1.2.0 webauthn strong signer', async () => {
  const { accountSupport, contract } = setup(
    '0x03957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ webauthn: [1n] });

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Braavos v1.2.0 multiple stark signers', async () => {
  const { accountSupport, contract } = setup(
    '0x03957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ stark: [1n, 2n] });

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});

test('Braavos v1.2.0 single stark signer [r,s]', async () => {
  const { accountSupport, contract } = setup(
    '0x03957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ stark: [1n] });

  const result = await accountSupport.check();
  expect(result.ok).toBe(true);

  const seed = accountSupport.getSeedFromSignature([
    '0x1', // R
    '0x2', // S
  ]);
  expect(seed).toBe('0x1');
});

test('Braavos v1.2.0 single stark signer [signerType,r,s]', async () => {
  const { accountSupport, contract } = setup(
    '0x03957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a',
  );

  jest.spyOn(contract, 'call').mockResolvedValueOnce(0n);
  jest.spyOn(contract, 'call').mockResolvedValueOnce({ stark: [1n] });

  const result = await accountSupport.check();
  expect(result.ok).toBe(true);

  const seed = accountSupport.getSeedFromSignature([
    '0x1', // Signer type
    '0x2', // R
    '0x3', // S
  ]);
  expect(seed).toBe('0x2');
});

test('Unknown class hash', async () => {
  const { accountSupport } = setup('0x0000');

  const result = await accountSupport.check();
  expect(result.ok).toBe(false);
});
