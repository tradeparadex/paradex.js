import BigNumber from 'bignumber.js';
import * as Starknet from 'starknet';

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

export const AUTH_PATH = '/v1/auth';

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

export function buildOrderTypedData(
  paradexChain: string,
  order: SessionOrder,
  signatureTimestampMs: number,
): Starknet.TypedData {
  if (order.type === 'LIMIT' && order.price == null) {
    throw new Error('LIMIT orders need a price');
  }
  return {
    domain: paradexDomain(paradexChain),
    primaryType: 'Order',
    types: {
      StarkNetDomain: REQUEST_DOMAIN_TYPES,
      Order: [
        { name: 'timestamp', type: 'felt' },
        { name: 'market', type: 'felt' },
        { name: 'side', type: 'felt' },
        { name: 'orderType', type: 'felt' },
        { name: 'size', type: 'felt' },
        { name: 'price', type: 'felt' },
      ],
    },
    message: {
      timestamp: String(signatureTimestampMs),
      market: Starknet.shortString.encodeShortString(order.market),
      side: order.side === 'BUY' ? '1' : '2',
      orderType: Starknet.shortString.encodeShortString(order.type),
      size: toChainQuantums(order.size, 'size'),
      price:
        order.type === 'MARKET'
          ? '0'
          : toChainQuantums(order.price ?? '', 'price'),
    },
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
