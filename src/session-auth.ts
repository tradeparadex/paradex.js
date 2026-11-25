import BigNumber from 'bignumber.js';
import * as Starknet from 'starknet';

import { builderAddress } from './session-typed-data.js';

/**
 * Typed data a session key signs: the `/auth` request that mints a JWT and
 * the orders it places. Both are today's SNIP-12 (revision 0) "Paradex"
 * domain messages, signed for the account in `PARADEX-STARKNET-ACCOUNT`.
 *
 * @experimental
 */

const REQUEST_DOMAIN_TYPES = [
  { name: 'name', type: 'felt' },
  { name: 'chainId', type: 'felt' },
  { name: 'version', type: 'felt' },
];

function paradexDomain(paradexChain: string): Starknet.TypedData['domain'] {
  return {
    name: 'Paradex',
    chainId: Starknet.shortString.encodeShortString(paradexChain),
    version: '1',
  };
}

/** Session JWTs live at most 15 minutes, and never past the session. */
export const SESSION_AUTH_MAX_TTL = 15 * 60;

/** The path the `/auth` request signs, whichever key signs in. */
export const AUTH_PATH = '/v1/auth';

/**
 * Where a session key signs in: `POST /v1/auth/{public_key}`. Plain
 * `/v1/auth` verifies the signature against the account's main key, so a
 * session key is refused there. The signed path stays {@link AUTH_PATH}.
 */
export function sessionAuthPath(sessionPublicKey: string): string {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(sessionPublicKey)) {
    throw new Error('session public key must be 0x-prefixed hex');
  }
  return `${AUTH_PATH}/${sessionPublicKey}`;
}

export function buildAuthTypedData(
  paradexChain: string,
  timestamp: number,
  expiration: number,
): Starknet.TypedData {
  return {
    domain: paradexDomain(paradexChain),
    primaryType: 'Request',
    types: {
      StarkNetDomain: REQUEST_DOMAIN_TYPES,
      Request: [
        { name: 'method', type: 'felt' },
        { name: 'path', type: 'felt' },
        { name: 'body', type: 'felt' },
        { name: 'timestamp', type: 'felt' },
        { name: 'expiration', type: 'felt' },
      ],
    },
    message: {
      method: 'POST',
      path: AUTH_PATH,
      body: '',
      timestamp,
      expiration,
    },
  };
}

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';

export interface SessionOrder {
  readonly market: string;
  readonly side: OrderSide;
  readonly type: OrderType;
  /** Decimal string in base asset units. */
  readonly size: string;
  /** Decimal string; required for LIMIT, ignored for MARKET. */
  readonly price?: string;
  readonly instruction?: 'GTC' | 'IOC' | 'POST_ONLY' | 'RPI';
  readonly clientId?: string;
  readonly reduceOnly?: boolean;
  /**
   * Builder the order is attributed to: its Paradex account address. The
   * builder charges `builderFeeRate` in USDC on every fill. Set it with
   * `builderFeeRate`, or neither. The account must hold a live approval of
   * this builder at a rate at least as high, such as a grant's `builder`.
   */
  readonly builder?: string;
  /**
   * Builder fee as a fraction of each fill's notional, a decimal string with
   * at most 8 decimal places: `"0.0005"` is 5 bps.
   */
  readonly builderFeeRate?: string;
}

/** Decimal string → 8-decimal quantum integer string, as the chain signs it. */
export function toChainQuantums(value: string, field: string): string {
  const n = new BigNumber(value);
  if (!n.isFinite() || n.isNegative() || !/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`${field} must be a non-negative decimal string`);
  }
  const scaled = n.shiftedBy(8);
  if (!scaled.isInteger()) {
    throw new Error(`${field} has more than 8 decimal places`);
  }
  return scaled.toFixed(0);
}

const ORDER_TYPES = [
  { name: 'timestamp', type: 'felt' },
  { name: 'market', type: 'felt' },
  { name: 'side', type: 'felt' },
  { name: 'orderType', type: 'felt' },
  { name: 'size', type: 'felt' },
  { name: 'price', type: 'felt' },
];

/**
 * The order's builder and its fee rate at 8 decimals (`"0.0005"` →
 * `"50000"`), or `undefined` for an order naming none.
 */
export function orderBuilder(
  order: SessionOrder,
): { builder: string; builderFeeRate: string } | undefined {
  const { builder, builderFeeRate } = order;
  if (builder == null && builderFeeRate == null) return undefined;
  if (builder == null || builderFeeRate == null) {
    throw new Error('builder and builderFeeRate must be set together');
  }
  builderAddress(builder);
  const rate = toChainQuantums(builderFeeRate, 'builderFeeRate');
  if (rate === '0') throw new Error('builderFeeRate must be above 0');
  return { builder, builderFeeRate: rate };
}

/**
 * The SNIP-12 (revision 0) typed data `order` is signed under. An order
 * naming a builder signs as `BuilderOrder`: the `Order` fields, in order,
 * then `builder` and `builderFeeRate` at 8 decimals. Its distinct type hash
 * keeps either signature from being replayed as the other. An order without
 * a builder keeps the `Order` hash.
 */
export function buildOrderTypedData(
  paradexChain: string,
  order: SessionOrder,
  signatureTimestampMs: number,
): Starknet.TypedData {
  if (order.type === 'LIMIT' && order.price == null) {
    throw new Error('LIMIT orders need a price');
  }
  const message: Record<string, string> = {
    timestamp: String(signatureTimestampMs),
    market: Starknet.shortString.encodeShortString(order.market),
    side: order.side === 'BUY' ? '1' : '2',
    orderType: Starknet.shortString.encodeShortString(order.type),
    size: toChainQuantums(order.size, 'size'),
    price:
      order.type === 'MARKET'
        ? '0'
        : toChainQuantums(order.price ?? '', 'price'),
  };
  const builder = orderBuilder(order);
  if (builder == null) {
    return {
      domain: paradexDomain(paradexChain),
      primaryType: 'Order',
      types: { StarkNetDomain: REQUEST_DOMAIN_TYPES, Order: ORDER_TYPES },
      message,
    };
  }
  return {
    domain: paradexDomain(paradexChain),
    primaryType: 'BuilderOrder',
    types: {
      StarkNetDomain: REQUEST_DOMAIN_TYPES,
      BuilderOrder: [
        ...ORDER_TYPES,
        { name: 'builder', type: 'felt' },
        { name: 'builderFeeRate', type: 'felt' },
      ],
    },
    message: { ...message, ...builder },
  };
}

/** Reads `exp` (seconds) from a JWT without verifying it. */
export function jwtExpiry(token: string): number | undefined {
  const payload = token.split('.')[1];
  if (payload == null) return undefined;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(base64)) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp : undefined;
  } catch {
    return undefined;
  }
}
