// @ts-nocheck
/**
 * Hyperlane transfers originating from Solana.
 *
 * Routes:
 *   - Solana → Ethereum
 *   - Solana → Paradex
 *
 * Usage:
 *   SOLANA_PRIVATE_KEY="..." ETHEREUM_ADDRESS="0x..." tsx examples/hyperlane/solana.ts <route> [asset]
 *
 * Examples:
 *   ETHEREUM_ADDRESS="0x..." tsx examples/hyperlane/solana.ts sol-to-eth
 *   ETHEREUM_PRIVATE_KEY="0x..." tsx examples/hyperlane/solana.ts sol-to-paradex DIME
 *
 * Extra dependencies (install separately):
 *   npm i @solana/web3.js @solana/spl-token bs58
 */

import { BigNumber } from 'bignumber.js';

import {
  AMOUNT,
  ASSETS,
  confirm,
  DOMAINS,
  ENV,
  getEthereumAddress,
  getParadexAddress,
  hexToBytes,
  isProd,
  padBytesToLength,
  resolveAsset,
  type AssetConfig,
} from './config.js';

// ---------------------------------------------------------------------------
// Solana imports (lazy-loaded)
// ---------------------------------------------------------------------------

async function loadSolana() {
  const {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    TransactionInstruction,
    ComputeBudgetProgram,
    SystemProgram,
  } = await import('@solana/web3.js');
  const {
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
  } = await import('@solana/spl-token');
  const bs58 = await import('bs58');
  return {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    TransactionInstruction,
    ComputeBudgetProgram,
    SystemProgram,
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    bs58: bs58.default ?? bs58,
  };
}

// ---------------------------------------------------------------------------
// PDA derivation helpers
// ---------------------------------------------------------------------------

let _PublicKey: any;

function derivePda(seeds: (string | Uint8Array)[], programId: any): any {
  const [pda] = _PublicKey.findProgramAddressSync(
    seeds.map((s: string | Uint8Array) => Buffer.from(s)),
    programId,
  );
  return pda;
}

function deriveHypTokenAccount(p: any) {
  return derivePda(
    ['hyperlane_message_recipient', '-', 'handle', '-', 'account_metas'],
    p,
  );
}
function deriveMailboxOutbox(m: any) {
  return derivePda(['hyperlane', '-', 'outbox'], m);
}
function deriveDispatchAuthority(p: any) {
  return derivePda(['hyperlane_dispatcher', '-', 'dispatch_authority'], p);
}
function deriveMsgStorage(m: any, r: any) {
  return derivePda(
    ['hyperlane', '-', 'dispatched_message', '-', r.toBuffer()],
    m,
  );
}
function deriveIgpProgramPda(i: any) {
  return derivePda(['hyperlane_igp', '-', 'program_data'], i);
}
function deriveGasPaymentPda(i: any, r: any) {
  return derivePda(['hyperlane_igp', '-', 'gas_payment', '-', r.toBuffer()], i);
}
function deriveEscrow(p: any) {
  return derivePda(['hyperlane_token', '-', 'escrow'], p);
}

// ---------------------------------------------------------------------------
// Manual binary serialization (avoids borsh version compatibility issues)
// ---------------------------------------------------------------------------

/** Serialize a transfer_remote instruction payload (u8 + u32 + [32] + u256 LE) */
function serializeTransferRemote(
  destDomain: number,
  recipient: Uint8Array,
  amount: bigint,
): Buffer {
  // instruction(u8) + destination_domain(u32) + recipient(32) + amount_or_id(u256 = 32 bytes LE)
  const buf = Buffer.alloc(1 + 4 + 32 + 32);
  let offset = 0;
  buf.writeUInt8(1, offset);
  offset += 1; // instruction = 1 (TransferRemote)
  buf.writeUInt32LE(destDomain, offset);
  offset += 4;
  Buffer.from(recipient).copy(buf, offset);
  offset += 32;
  // u256 little-endian
  let val = amount;
  for (let i = 0; i < 32; i++) {
    buf.writeUInt8(Number(val & 0xffn), offset + i);
    val >>= 8n;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Manual binary deserialization for on-chain token data
// ---------------------------------------------------------------------------

class BufferReader {
  offset = 0;
  constructor(private data: Buffer) {}
  u8(): number {
    const v = this.data.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }
  u32(): number {
    const v = this.data.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }
  u64(): bigint {
    const v = this.data.readBigUInt64LE(this.offset);
    this.offset += 8;
    return v;
  }
  bytes(len: number): Uint8Array {
    const v = this.data.subarray(this.offset, this.offset + len);
    this.offset += len;
    return Uint8Array.from(v);
  }
  /** Borsh Option<[u8; 32]>: 1-byte tag (0=None, 1=Some) + optional 32 bytes */
  option32(): Uint8Array | null {
    const tag = this.u8();
    if (tag === 0) return null;
    return this.bytes(32);
  }
  /** Borsh Option<T> where T is { program_id: [32], type: u8, igp_account: [32] } */
  optionIgp(): IgpConfigData | null {
    const tag = this.u8();
    if (tag === 0) return null;
    const program_id = this.bytes(32);
    const type = this.u8();
    const igp_account = this.bytes(32);
    return { program_id, type, igp_account };
  }
}

interface IgpConfigData {
  program_id: Uint8Array;
  type: number;
  igp_account: Uint8Array;
}

/**
 * Read the IGP config from on-chain HyperlaneTokenData.
 * Schema ref: ui/paradex/src/utils/solana-schemas.ts → SealevelHyperlaneTokenDataSchema
 *
 * Layout (AccountDataWrapper + SealevelHyperlaneTokenData):
 *   initialized:                   u8
 *   bump:                          u8
 *   mailbox:                       [32]
 *   mailbox_process_authority:     [32]
 *   dispatch_authority_bump:       u8
 *   decimals:                      u8
 *   remote_decimals:               u8
 *   owner:                         Option<[32]>
 *   interchain_security_module:    Option<[32]>
 *   interchain_gas_paymaster:      Option<IgpConfig>
 *   destination_gas:               Map<u32, u64>    (NOT option — direct map)
 *   remote_routers:                Map<u32, [32]>   (NOT option — direct map)
 */
function readTokenData(buf: Buffer): { igp: IgpConfigData | null } {
  const r = new BufferReader(buf);
  r.u8(); // initialized
  r.u8(); // bump
  r.bytes(32); // mailbox
  r.bytes(32); // mailbox_process_authority
  r.u8(); // dispatch_authority_bump
  r.u8(); // decimals
  r.u8(); // remote_decimals
  r.option32(); // owner
  r.option32(); // interchain_security_module
  const igp = r.optionIgp(); // interchain_gas_paymaster
  return { igp };
}

/**
 * Read the inner IGP pubkey from an OverheadIgp account.
 * Schema ref: ui/paradex/src/utils/solana-schemas.ts → SealevelOverheadIgpDataSchema
 *
 * Layout (AccountDataWrapper with 8-byte discriminator + SealevelOverheadIgpData):
 *   initialized:    u8
 *   discriminator:  [8]       ← 8-byte discriminator present in OverheadIgp accounts
 *   bump:           u8
 *   salt:           [32]
 *   owner:          Option<[32]>
 *   inner:          [32]
 *   gas_overheads:  Map<u32, u64>
 */
function readOverheadIgpInner(buf: Buffer): Uint8Array {
  const r = new BufferReader(buf);
  r.u8(); // initialized
  r.bytes(8); // discriminator (8 bytes)
  r.u8(); // bump
  r.bytes(32); // salt
  r.option32(); // owner
  return r.bytes(32); // inner
}

// ---------------------------------------------------------------------------
// Solana context & IGP reading
// ---------------------------------------------------------------------------

async function getSolanaContext() {
  const sol = await loadSolana();
  _PublicKey = sol.PublicKey;
  const secretKey = process.env.SOLANA_PRIVATE_KEY ?? '';
  if (!secretKey) throw new Error('SOLANA_PRIVATE_KEY env var required');
  const keypair = sol.Keypair.fromSecretKey(sol.bs58.decode(secretKey));
  const rpcUrl = isProd
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.testnet.solana.com';
  const connection = new sol.Connection(rpcUrl, 'confirmed');
  return { keypair, connection, ...sol };
}

async function readIgpKeys(sol: any, warpProgram: any) {
  const tokenPda = deriveHypTokenAccount(warpProgram);
  const info = await sol.connection.getAccountInfo(tokenPda);
  if (!info) return undefined;
  try {
    const { igp } = readTokenData(Buffer.from(info.data));
    if (!igp) return undefined;
    const programId = new sol.PublicKey(igp.program_id);
    const account = new sol.PublicKey(igp.igp_account);
    if (igp.type === 1) {
      // OverheadIgp — read inner IGP account
      const overhead = await sol.connection.getAccountInfo(account);
      if (!overhead) return undefined;
      const inner = readOverheadIgpInner(Buffer.from(overhead.data));
      return {
        programId,
        overheadIgpAccount: account,
        igpAccount: new sol.PublicKey(inner),
      };
    }
    return { programId, igpAccount: account };
  } catch (e) {
    console.warn('Could not parse IGP config:', e);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Helpers: build Solana keys + instruction + send
// ---------------------------------------------------------------------------

function buildKeys(
  sol: any,
  sender: any,
  mailbox: any,
  randomPub: any,
  warpProgram: any,
  tokenMint: any,
  tokenProgramId: any,
  senderAta: any,
  igpKeys: any,
  isSynthetic: boolean,
) {
  const keys: any[] = [
    { pubkey: sol.SystemProgram.programId, isSigner: false, isWritable: false },
    {
      pubkey: new sol.PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV'),
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: deriveHypTokenAccount(warpProgram),
      isSigner: false,
      isWritable: false,
    },
    { pubkey: mailbox, isSigner: false, isWritable: false },
    { pubkey: deriveMailboxOutbox(mailbox), isSigner: false, isWritable: true },
    {
      pubkey: deriveDispatchAuthority(warpProgram),
      isSigner: false,
      isWritable: false,
    },
    { pubkey: sender, isSigner: true, isWritable: true },
    { pubkey: randomPub, isSigner: true, isWritable: false },
    {
      pubkey: deriveMsgStorage(mailbox, randomPub),
      isSigner: false,
      isWritable: true,
    },
  ];
  if (igpKeys) {
    keys.push(
      { pubkey: igpKeys.programId, isSigner: false, isWritable: false },
      {
        pubkey: deriveIgpProgramPda(igpKeys.programId),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: deriveGasPaymentPda(igpKeys.programId, randomPub),
        isSigner: false,
        isWritable: true,
      },
    );
    if (igpKeys.overheadIgpAccount) {
      keys.push({
        pubkey: igpKeys.overheadIgpAccount,
        isSigner: false,
        isWritable: false,
      });
    }
    keys.push({
      pubkey: igpKeys.igpAccount,
      isSigner: false,
      isWritable: true,
    });
  }
  keys.push(
    { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    { pubkey: tokenMint, isSigner: false, isWritable: true },
    { pubkey: senderAta, isSigner: false, isWritable: true },
  );
  if (!isSynthetic) {
    keys.push({
      pubkey: deriveEscrow(warpProgram),
      isSigner: false,
      isWritable: true,
    });
  }
  return keys;
}

function buildTransferIx(
  sol: any,
  warpProgram: any,
  keys: any[],
  destDomain: number,
  recipient: Uint8Array,
  amount: bigint,
) {
  const serialized = serializeTransferRemote(destDomain, recipient, amount);
  return new sol.TransactionInstruction({
    keys,
    programId: warpProgram,
    data: Buffer.concat([Buffer.from([1, 1, 1, 1, 1, 1, 1, 1]), serialized]),
  });
}

async function sendSolanaTransfer(
  sol: any,
  ix: any,
  sender: any,
  randomWallet: any,
  keypair: any,
) {
  const tx = new sol.Transaction()
    .add(sol.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }))
    .add(
      sol.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
    )
    .add(ix);
  const bh = await sol.connection.getLatestBlockhash();
  tx.recentBlockhash = bh.blockhash;
  tx.lastValidBlockHeight = bh.lastValidBlockHeight;
  tx.feePayer = sender;
  tx.partialSign(randomWallet);
  tx.partialSign(keypair);
  return sol.connection.sendRawTransaction(tx.serialize());
}

// ---------------------------------------------------------------------------
// Common Solana setup
// ---------------------------------------------------------------------------

async function setupSolanaTransfer(sol: any, solCfg: any) {
  const warpProgram = new sol.PublicKey(solCfg.contractAddress);
  const mailbox = new sol.PublicKey(solCfg.mailboxAddress);
  const tokenMint = new sol.PublicKey(solCfg.tokenAddress);
  const sender = sol.keypair.publicKey;
  const randomWallet = sol.Keypair.generate();

  const mintInfo = await sol.connection.getAccountInfo(tokenMint);
  const tokenProgramId = mintInfo?.owner.equals(sol.TOKEN_2022_PROGRAM_ID)
    ? sol.TOKEN_2022_PROGRAM_ID
    : sol.TOKEN_PROGRAM_ID;
  const senderAta = sol.getAssociatedTokenAddressSync(
    tokenMint,
    sender,
    true,
    tokenProgramId,
  );

  const igpKeys = await readIgpKeys(sol, warpProgram);
  const keys = buildKeys(
    sol,
    sender,
    mailbox,
    randomWallet.publicKey,
    warpProgram,
    tokenMint,
    tokenProgramId,
    senderAta,
    igpKeys,
    !!solCfg.isSynthetic,
  );

  return { warpProgram, sender, randomWallet, keys };
}

// ===========================================================================
// Solana → Ethereum
// ===========================================================================

async function solanaToEthereum(asset: AssetConfig) {
  console.log(`\n=== Solana → Ethereum (${asset.symbol}) ===`);
  if (!asset.solana)
    throw new Error(`${asset.symbol} not available on Solana for ${ENV}`);
  if (!asset.ethereum)
    throw new Error(`${asset.symbol} not available on Ethereum`);

  const ethAddress = getEthereumAddress();
  const sol = await getSolanaContext();
  const solCfg = asset.solana;

  await confirm({
    route: 'Solana → Ethereum',
    asset: asset.symbol,
    amount: AMOUNT,
    from: sol.keypair.publicKey.toBase58(),
    to: ethAddress,
    env: ENV,
  });

  const amount = BigInt(
    new BigNumber(AMOUNT)
      .times(new BigNumber(10).pow(solCfg.decimals))
      .toFixed(0),
  );

  const { warpProgram, sender, randomWallet, keys } = await setupSolanaTransfer(
    sol,
    solCfg,
  );

  // Ethereum address → 32-byte padded
  const recipientHex = ethAddress.replace(/^0x/i, '').padStart(64, '0');
  const recipientBytes = padBytesToLength(hexToBytes(recipientHex), 32);

  const ix = buildTransferIx(
    sol,
    warpProgram,
    keys,
    DOMAINS.ethereum,
    recipientBytes,
    amount,
  );

  console.log(
    `Transferring ${AMOUNT} ${asset.symbol} from Solana to Ethereum ${ethAddress}...`,
  );
  const txSig = await sendSolanaTransfer(
    sol,
    ix,
    sender,
    randomWallet,
    sol.keypair,
  );
  console.log(`Transaction signature: ${txSig}`);
}

// ===========================================================================
// Solana → Paradex
// ===========================================================================

async function solanaToParadex(asset: AssetConfig) {
  console.log(`\n=== Solana → Paradex (${asset.symbol}) ===`);
  if (!asset.solana)
    throw new Error(`${asset.symbol} not available on Solana for ${ENV}`);
  if (!asset.paradex)
    throw new Error(`${asset.symbol} not available on Paradex`);

  const paradexAddress = await getParadexAddress();
  const sol = await getSolanaContext();
  const solCfg = asset.solana;

  await confirm({
    route: 'Solana → Paradex',
    asset: asset.symbol,
    amount: AMOUNT,
    from: sol.keypair.publicKey.toBase58(),
    to: paradexAddress,
    env: ENV,
  });

  const amount = BigInt(
    new BigNumber(AMOUNT)
      .times(new BigNumber(10).pow(solCfg.decimals))
      .toFixed(0),
  );

  const { warpProgram, sender, randomWallet, keys } = await setupSolanaTransfer(
    sol,
    solCfg,
  );

  // Paradex (Starknet) address → 32-byte padded
  const normalizedAddr = paradexAddress.replace(/^0x/i, '').padStart(64, '0');
  const recipientBytes = padBytesToLength(hexToBytes(normalizedAddr), 32);

  const ix = buildTransferIx(
    sol,
    warpProgram,
    keys,
    DOMAINS.paradex,
    recipientBytes,
    amount,
  );

  console.log(
    `Transferring ${AMOUNT} ${asset.symbol} from Solana to Paradex ${paradexAddress}...`,
  );
  const txSig = await sendSolanaTransfer(
    sol,
    ix,
    sender,
    randomWallet,
    sol.keypair,
  );
  console.log(`Transaction signature: ${txSig}`);
}

// ===========================================================================
// Main
// ===========================================================================

const ROUTES: Record<string, (asset: AssetConfig) => Promise<void>> = {
  'sol-to-eth': solanaToEthereum,
  'sol-to-paradex': solanaToParadex,
};

const route = process.argv[2];
const asset = resolveAsset(process.argv);

if (route && route in ROUTES) {
  await ROUTES[route]!(asset);
} else {
  console.log('Solana → Hyperlane Bridge Examples');
  console.log('');
  console.log('Usage: tsx examples/hyperlane/solana.ts <route> [asset]');
  console.log('');
  console.log('Routes:');
  for (const name of Object.keys(ROUTES)) console.log(`  ${name}`);
  console.log('');
  console.log(`Assets: ${Object.keys(ASSETS).join(', ')} (default: USDC)`);
  console.log('');
  console.log('Note: DIME on Solana is prod-only (Token-2022, 9 decimals).');
}
