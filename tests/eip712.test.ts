import { ethers } from 'ethers';

import {
  encodeType,
  hashTypedData,
  toEthSignTypedDataV4,
  type Eip712TypedData,
} from '../src/eip712';

const mailTypes = {
  Mail: [
    { name: 'from', type: 'Person' },
    { name: 'to', type: 'Person[]' },
    { name: 'contents', type: 'string' },
    { name: 'urgent', type: 'bool' },
    { name: 'sentAt', type: 'uint64' },
    { name: 'tag', type: 'bytes32' },
    { name: 'attachment', type: 'bytes' },
    { name: 'pair', type: 'uint8[2]' },
  ],
  Person: [
    { name: 'name', type: 'string' },
    { name: 'wallet', type: 'address' },
  ],
};

function mail(overrides: Record<string, unknown> = {}): Eip712TypedData {
  return {
    domain: { name: 'Ether Mail', version: '1', chainId: 1 },
    primaryType: 'Mail',
    types: mailTypes,
    message: {
      from: {
        name: 'Cow',
        wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
      },
      to: [
        { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
        {
          name: 'Ünïcødé',
          wallet: '0x0000000000000000000000000000000000000001',
        },
      ],
      contents: 'Hello, Bob!',
      urgent: true,
      sentAt: 1760000000,
      tag: `0x${'ab'.repeat(32)}`,
      attachment: '0xdeadbeef',
      pair: [1, 255],
      ...overrides,
    },
  };
}

function ethersHash(td: Eip712TypedData): string {
  return ethers.TypedDataEncoder.hash(
    td.domain,
    td.types as Record<string, ethers.TypedDataField[]>,
    td.message,
  );
}

describe('eip712', () => {
  test('matches ethers for nested structs, arrays and every atomic type', () => {
    const td = mail();
    expect(hashTypedData(td)).toBe(ethersHash(td));
  });

  test('matches ethers for empty arrays and false/zero values', () => {
    const td = mail({ to: [], urgent: false, sentAt: 0, attachment: '0x' });
    expect(hashTypedData(td)).toBe(ethersHash(td));
  });

  test('accepts bigint and numeric-string uints', () => {
    const asNumber = hashTypedData(mail({ sentAt: 1760000000 }));
    expect(hashTypedData(mail({ sentAt: 1760000000n }))).toBe(asNumber);
    expect(hashTypedData(mail({ sentAt: '1760000000' }))).toBe(asNumber);
    expect(
      hashTypedData(mail({ sentAt: `0x${(1760000000).toString(16)}` })),
    ).toBe(asNumber);
  });

  test('encodeType lists dependencies sorted after the primary type', () => {
    expect(encodeType('Mail', mailTypes)).toBe(
      'Mail(Person from,Person[] to,string contents,bool urgent,uint64 sentAt,bytes32 tag,bytes attachment,uint8[2] pair)Person(string name,address wallet)',
    );
  });

  test('toEthSignTypedDataV4 adds the EIP712Domain type', () => {
    const json = JSON.parse(toEthSignTypedDataV4(mail()));
    expect(json.types.EIP712Domain).toEqual([
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
    ]);
    expect(json.types.Mail).toEqual(mailTypes.Mail);
    expect(json.primaryType).toBe('Mail');
  });

  test.each([
    ['uint64 overflow', { sentAt: 2n ** 64n }, /out of range/],
    ['negative uint', { sentAt: -1 }, /out of range/],
    ['unsafe number', { sentAt: 2 ** 60 }, /safe integer/],
    ['non-numeric uint', { sentAt: 'soon' }, /invalid uint64/],
    ['bad address', { from: { name: 'x', wallet: '0x12' } }, /address/],
    ['bad bytes32', { tag: '0x12' }, /bytes32/],
    ['bad bytes', { attachment: 'zz' }, /bytes/],
    ['bool as number', { urgent: 1 }, /bool/],
    ['string as number', { contents: 5 }, /string/],
    ['array expected', { to: 'Bob' }, /array/],
    ['fixed array length', { pair: [1] }, /wrong length/],
    ['struct expected', { from: 'Cow' }, /object/],
    ['extra field', { bcc: 'x' }, /unexpected field Mail.bcc/],
  ])('rejects %s', (_name, overrides, error) => {
    expect(() => hashTypedData(mail(overrides))).toThrow(error);
  });

  test('rejects missing fields and unknown types', () => {
    const td = mail();
    const { contents: _omit, ...rest } = td.message;
    expect(() => hashTypedData({ ...td, message: rest })).toThrow(
      /missing field Mail.contents/,
    );
    expect(() =>
      hashTypedData({
        ...td,
        message: { x: 1 },
        types: { Mail: [{ name: 'x', type: 'int8' }] },
      }),
    ).toThrow(/unsupported type int8/);
    expect(() =>
      hashTypedData({
        ...td,
        message: { x: 1 },
        types: { Mail: [{ name: 'x', type: 'uint7' }] },
      }),
    ).toThrow(/unsupported type uint7/);
    expect(() => hashTypedData({ ...td, primaryType: 'Nope' })).toThrow(
      /unknown type Nope/,
    );
  });
});
