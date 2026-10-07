import * as Starknet from 'starknet';

import {
  hashTypedData as hashEip712TypedData,
  type Eip712TypedData,
  type Eip712Types,
} from './eip712.js';
import type { Hex } from './types.js';

/**
 * Typed data for session grants: `SessionGrant`, `PasskeyGrant` and
 * `SessionMint`, in EIP-712 (EVM owners) and SNIP-12 revision 1 (Stark
 * owners) encodings with the same field names and order.
 *
 * @experimental The server side of sessions is not released yet. Field
 * shapes follow the published session-grant spec and may still change.
 */

export const SESSION_DOMAIN_NAME = 'Paradex Session';
export const SESSION_DOMAIN_VERSION = '1';

/** The "none" builder / first-party passkey sentinel. */
export const NO_BUILDER = '0x0';

export type SessionEnvironment = 'mainnet' | 'testnet' | 'nightly';
export const SESSION_ENVIRONMENTS: readonly SessionEnvironment[] = [
  'mainnet',
  'testnet',
  'nightly',
];

/** Scopes a grant may request. `read` is always implied and never listed. */
export type SessionScope =
  | 'trade'
  | 'trade:rfq'
  | 'trade:block'
  | 'account:settings';
export const GRANTABLE_SCOPES: readonly SessionScope[] = [
  'trade',
  'trade:rfq',
  'trade:block',
  'account:settings',
];
/** Scopes that exist in the format but are refused. */
export const RESERVED_SCOPES: readonly string[] = [
  'withdraw:owner',
  'trade:isolated',
];

const DAY = 24 * 60 * 60;
/** Server caps on session lifetime, in seconds. */
export const SESSION_TTL = {
  browserDefault: 7 * DAY,
  browserMax: 30 * DAY,
  apiMax: 180 * DAY,
  /** Cap for grants that include `trade:block` or `account:settings`. */
  sensitiveScopeMax: 7 * DAY,
  passkeyMax: 180 * DAY,
  passkeySessionMax: 7 * DAY,
} as const;
const SENSITIVE_SCOPES: readonly SessionScope[] = [
  'trade:block',
  'account:settings',
];
export const MAX_PASSKEY_CONCURRENT_SESSIONS = 5;
/** `issuedAt` may be at most this far ahead of the server clock. */
const MAX_ISSUED_AT_SKEW = 5 * 60;

export type SessionGrantErrorCode =
  | 'INVALID_FIELD'
  | 'UNKNOWN_SCOPE'
  | 'RESERVED_SCOPE'
  | 'TTL_EXCEEDED'
  | 'BUILDER_LIMITS_REQUIRED'
  | 'BUILDER_REQUIRES_EIP712'
  | 'GRANT_EXPIRED'
  | 'GRANT_REVOKED'
  | 'ENVIRONMENT_MISMATCH'
  | 'ACCOUNT_NOT_IN_GRANT';

export class SessionGrantError extends Error {
  readonly code: SessionGrantErrorCode;

  constructor(code: SessionGrantErrorCode, message: string) {
    super(message);
    this.name = 'SessionGrantError';
    this.code = code;
  }
}

/** USD decimal strings such as `"25000"` or `"0.0005"`. `""` = server default. */
export interface Limits {
  readonly maxOrderNotional: string;
  readonly maxOpenNotional: string;
  readonly dailyNotional: string;
  readonly maxLoss: string;
  readonly maxLeverage: string;
  /** Symbols or patterns (`"BTC-USD-PERP"`, `"*-USD-PERP"`); `[]` = server default. */
  readonly markets: readonly string[];
}

export interface Builder {
  /** Builder's Paradex account; `"0x0"` = none. */
  readonly account: string;
  /** Fee ceiling as a decimal fraction: `"0.0005"` = 5 bps. */
  readonly maxFeeRate: string;
  /** Seconds; `0` = follows the session. */
  readonly expiresAt: number;
}

export interface SessionGrant {
  readonly paradexChain: string;
  readonly environment: SessionEnvironment;
  readonly account: string;
  readonly sessionKey: string;
  readonly label: string;
  readonly scopes: readonly SessionScope[];
  readonly limits: Limits;
  readonly builder: Builder;
  readonly subaccounts: readonly string[];
  readonly nonce: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface Passkey {
  /** base64url credential id. */
  readonly credentialId: string;
  /** P-256 public key coordinates, 0x-prefixed 32-byte hex. */
  readonly pubkeyX: string;
  readonly pubkeyY: string;
  readonly rpId: string;
  readonly label: string;
}

export interface Ceiling {
  readonly scopes: readonly SessionScope[];
  readonly limits: Limits;
  readonly subaccounts: readonly string[];
  /** Allowed only for first-party passkeys (`builderAccount = "0x0"`). */
  readonly includeFutureSubaccounts: boolean;
  readonly maxSessionTtl: number;
  readonly maxConcurrentSessions: number;
}

export interface PasskeyGrant {
  readonly paradexChain: string;
  readonly environment: SessionEnvironment;
  readonly account: string;
  readonly passkey: Passkey;
  readonly ceiling: Ceiling;
  /** `"0x0"` = Paradex app; otherwise binds the passkey to one builder. */
  readonly builderAccount: string;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface SessionMint {
  readonly paradexChain: string;
  readonly environment: SessionEnvironment;
  readonly account: string;
  readonly subaccounts: readonly string[];
  readonly credentialId: string;
  readonly sessionKey: string;
  readonly scopes: readonly SessionScope[];
  readonly limits: Limits;
  readonly nonce: string;
  readonly expiresAt: number;
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

const EIP712_LIMITS = [
  { name: 'maxOrderNotional', type: 'string' },
  { name: 'maxOpenNotional', type: 'string' },
  { name: 'dailyNotional', type: 'string' },
  { name: 'maxLoss', type: 'string' },
  { name: 'maxLeverage', type: 'string' },
  { name: 'markets', type: 'string[]' },
] as const;

export const SESSION_GRANT_EIP712_TYPES: Eip712Types = {
  SessionGrant: [
    { name: 'paradexChain', type: 'string' },
    { name: 'environment', type: 'string' },
    { name: 'account', type: 'string' },
    { name: 'sessionKey', type: 'string' },
    { name: 'label', type: 'string' },
    { name: 'scopes', type: 'string[]' },
    { name: 'limits', type: 'Limits' },
    { name: 'builder', type: 'Builder' },
    { name: 'subaccounts', type: 'string[]' },
    { name: 'nonce', type: 'string' },
    { name: 'issuedAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
  ],
  Limits: EIP712_LIMITS,
  Builder: [
    { name: 'account', type: 'string' },
    { name: 'maxFeeRate', type: 'string' },
    { name: 'expiresAt', type: 'uint64' },
  ],
};

export const PASSKEY_GRANT_EIP712_TYPES: Eip712Types = {
  PasskeyGrant: [
    { name: 'paradexChain', type: 'string' },
    { name: 'environment', type: 'string' },
    { name: 'account', type: 'string' },
    { name: 'passkey', type: 'Passkey' },
    { name: 'ceiling', type: 'Ceiling' },
    { name: 'builderAccount', type: 'string' },
    { name: 'nonce', type: 'string' },
    { name: 'issuedAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
  ],
  Passkey: [
    { name: 'credentialId', type: 'string' },
    { name: 'pubkeyX', type: 'string' },
    { name: 'pubkeyY', type: 'string' },
    { name: 'rpId', type: 'string' },
    { name: 'label', type: 'string' },
  ],
  Ceiling: [
    { name: 'scopes', type: 'string[]' },
    { name: 'limits', type: 'Limits' },
    { name: 'subaccounts', type: 'string[]' },
    { name: 'includeFutureSubaccounts', type: 'bool' },
    { name: 'maxSessionTtl', type: 'uint64' },
    { name: 'maxConcurrentSessions', type: 'uint64' },
  ],
  Limits: EIP712_LIMITS,
};

export const SESSION_MINT_EIP712_TYPES: Eip712Types = {
  SessionMint: [
    { name: 'paradexChain', type: 'string' },
    { name: 'environment', type: 'string' },
    { name: 'account', type: 'string' },
    { name: 'subaccounts', type: 'string[]' },
    { name: 'credentialId', type: 'string' },
    { name: 'sessionKey', type: 'string' },
    { name: 'scopes', type: 'string[]' },
    { name: 'limits', type: 'Limits' },
    { name: 'nonce', type: 'string' },
    { name: 'expiresAt', type: 'uint64' },
  ],
  Limits: EIP712_LIMITS,
};

const SNIP12_DOMAIN = [
  { name: 'name', type: 'shortstring' },
  { name: 'version', type: 'shortstring' },
  { name: 'chainId', type: 'shortstring' },
  { name: 'revision', type: 'shortstring' },
];

const SNIP12_LIMITS = [
  { name: 'maxOrderNotional', type: 'string' },
  { name: 'maxOpenNotional', type: 'string' },
  { name: 'dailyNotional', type: 'string' },
  { name: 'maxLoss', type: 'string' },
  { name: 'maxLeverage', type: 'string' },
  { name: 'markets', type: 'shortstring*' },
];

export const SESSION_GRANT_SNIP12_TYPES: Starknet.TypedData['types'] = {
  StarknetDomain: SNIP12_DOMAIN,
  SessionGrant: [
    { name: 'paradexChain', type: 'shortstring' },
    { name: 'environment', type: 'shortstring' },
    { name: 'account', type: 'ContractAddress' },
    { name: 'sessionKey', type: 'felt' },
    { name: 'label', type: 'string' },
    { name: 'scopes', type: 'shortstring*' },
    { name: 'limits', type: 'Limits' },
    { name: 'builder', type: 'Builder' },
    { name: 'subaccounts', type: 'ContractAddress*' },
    { name: 'nonce', type: 'felt' },
    { name: 'issuedAt', type: 'timestamp' },
    { name: 'expiresAt', type: 'timestamp' },
  ],
  Limits: SNIP12_LIMITS,
  Builder: [
    { name: 'account', type: 'ContractAddress' },
    { name: 'maxFeeRate', type: 'string' },
    { name: 'expiresAt', type: 'timestamp' },
  ],
};

export const PASSKEY_GRANT_SNIP12_TYPES: Starknet.TypedData['types'] = {
  StarknetDomain: SNIP12_DOMAIN,
  PasskeyGrant: [
    { name: 'paradexChain', type: 'shortstring' },
    { name: 'environment', type: 'shortstring' },
    { name: 'account', type: 'ContractAddress' },
    { name: 'passkey', type: 'Passkey' },
    { name: 'ceiling', type: 'Ceiling' },
    { name: 'builderAccount', type: 'ContractAddress' },
    { name: 'nonce', type: 'felt' },
    { name: 'issuedAt', type: 'timestamp' },
    { name: 'expiresAt', type: 'timestamp' },
  ],
  Passkey: [
    { name: 'credentialId', type: 'string' },
    { name: 'pubkeyX', type: 'string' },
    { name: 'pubkeyY', type: 'string' },
    { name: 'rpId', type: 'string' },
    { name: 'label', type: 'string' },
  ],
  Ceiling: [
    { name: 'scopes', type: 'shortstring*' },
    { name: 'limits', type: 'Limits' },
    { name: 'subaccounts', type: 'ContractAddress*' },
    { name: 'includeFutureSubaccounts', type: 'bool' },
    { name: 'maxSessionTtl', type: 'u128' },
    { name: 'maxConcurrentSessions', type: 'u128' },
  ],
  Limits: SNIP12_LIMITS,
};

export const SESSION_MINT_SNIP12_TYPES: Starknet.TypedData['types'] = {
  StarknetDomain: SNIP12_DOMAIN,
  SessionMint: [
    { name: 'paradexChain', type: 'shortstring' },
    { name: 'environment', type: 'shortstring' },
    { name: 'account', type: 'ContractAddress' },
    { name: 'subaccounts', type: 'ContractAddress*' },
    { name: 'credentialId', type: 'string' },
    { name: 'sessionKey', type: 'felt' },
    { name: 'scopes', type: 'shortstring*' },
    { name: 'limits', type: 'Limits' },
    { name: 'nonce', type: 'felt' },
    { name: 'expiresAt', type: 'timestamp' },
  ],
  Limits: SNIP12_LIMITS,
};

// ---------------------------------------------------------------------------
// Canonical field forms
// ---------------------------------------------------------------------------

/** Starknet field prime. */
const FELT_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n;
/** Upper bound (exclusive) of a Starknet contract address. */
const ADDRESS_BOUND = 2n ** 251n - 256n;
const NONCE_BOUND = 2n ** 128n;
const UINT64_BOUND = 2n ** 64n;
const DECIMAL_RE = /^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/;
const MARKET_RE = /^[A-Z0-9*]+(-[A-Z0-9*]+)*$/;
const P256_COORD_RE = /^0x[0-9a-f]{64}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const SHORT_STRING_MAX = 31;

function invalid(field: string, reason: string): SessionGrantError {
  return new SessionGrantError('INVALID_FIELD', `${field}: ${reason}`);
}

function parseHexFelt(field: string, value: unknown, bound: bigint): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw invalid(field, 'must be 0x-prefixed hex');
  }
  const n = BigInt(value);
  if (n >= bound) throw invalid(field, 'out of range');
  return n;
}

/**
 * Canonical hex for felts and addresses: lowercase, `0x`-prefixed, no leading
 * zeros (`0x0` for zero). EIP-712 hashes these as strings, so the form is part
 * of the signed bytes; every builder normalizes to it and validation rejects
 * anything else.
 */
export function canonicalFelt(value: string | bigint): string {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  if (n < 0n || n >= FELT_PRIME) throw invalid('felt', 'out of range');
  return `0x${n.toString(16)}`;
}

function requireCanonicalHex(
  field: string,
  value: unknown,
  bound: bigint,
): void {
  const n = parseHexFelt(field, value, bound);
  if (value !== `0x${n.toString(16)}`) {
    throw invalid(field, 'must be lowercase hex without leading zeros');
  }
}

function requireAddress(field: string, value: unknown, nonZero = true): void {
  requireCanonicalHex(field, value, ADDRESS_BOUND);
  if (nonZero && value === '0x0') throw invalid(field, 'must not be zero');
}

function requireTimestamp(field: string, value: unknown): void {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    BigInt(value) >= UINT64_BOUND
  ) {
    throw invalid(field, 'must be a non-negative integer of seconds');
  }
}

function requireShortString(field: string, value: unknown): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > SHORT_STRING_MAX ||
    !/^[\x20-\x7e]+$/.test(value)
  ) {
    throw invalid(field, `must be 1-${SHORT_STRING_MAX} printable ASCII chars`);
  }
}

function requireDecimal(
  field: string,
  value: unknown,
  allowEmpty: boolean,
): void {
  if (typeof value !== 'string') throw invalid(field, 'must be a string');
  if (value === '' && allowEmpty) return;
  if (!DECIMAL_RE.test(value)) {
    throw invalid(field, 'must be a canonical decimal string like "25000"');
  }
}

function requireEnvironment(value: unknown): void {
  if (!SESSION_ENVIRONMENTS.includes(value as SessionEnvironment)) {
    throw invalid(
      'environment',
      `must be one of ${SESSION_ENVIRONMENTS.join(', ')}`,
    );
  }
}

function requireNonce(field: string, value: unknown): void {
  requireCanonicalHex(field, value, NONCE_BOUND);
  if (value === '0x0') throw invalid(field, 'must not be zero');
}

function requireUniqueAddresses(
  field: string,
  values: unknown,
  anchor: string,
): void {
  if (!Array.isArray(values)) throw invalid(field, 'must be an array');
  const seen = new Set<string>();
  values.forEach((v, i) => {
    requireAddress(`${field}[${i}]`, v);
    if (v === anchor) throw invalid(field, 'must not include the account');
    if (seen.has(v as string)) throw invalid(field, 'has duplicates');
    seen.add(v as string);
  });
}

/** Rejects unknown and reserved scopes, duplicates and an empty list. */
export function validateScopes(
  scopes: readonly string[],
  field = 'scopes',
): asserts scopes is readonly SessionScope[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw invalid(field, 'must list at least one scope');
  }
  const seen = new Set<string>();
  for (const scope of scopes as readonly unknown[]) {
    if (typeof scope !== 'string') throw invalid(field, 'must be strings');
    if (RESERVED_SCOPES.includes(scope)) {
      throw new SessionGrantError(
        'RESERVED_SCOPE',
        `${field}: "${scope}" is reserved and cannot be granted`,
      );
    }
    if (!GRANTABLE_SCOPES.includes(scope as SessionScope)) {
      throw new SessionGrantError(
        'UNKNOWN_SCOPE',
        `${field}: unknown scope "${scope}"`,
      );
    }
    if (seen.has(scope)) throw invalid(field, `duplicate scope "${scope}"`);
    seen.add(scope);
  }
}

/**
 * @param requireAll builder grants must state every limit (no `""`, no `[]`).
 */
export function validateLimits(
  limits: Limits,
  requireAll: boolean,
  field = 'limits',
): void {
  if (limits == null || typeof limits !== 'object') {
    throw invalid(field, 'is required');
  }
  for (const key of [
    'maxOrderNotional',
    'maxOpenNotional',
    'dailyNotional',
    'maxLoss',
    'maxLeverage',
  ] as const) {
    if (requireAll && limits[key] === '') {
      throw new SessionGrantError(
        'BUILDER_LIMITS_REQUIRED',
        `${field}.${key}: builder grants must state every limit`,
      );
    }
    requireDecimal(`${field}.${key}`, limits[key], true);
  }
  if (!Array.isArray(limits.markets)) {
    throw invalid(`${field}.markets`, 'must be an array');
  }
  if (requireAll && limits.markets.length === 0) {
    throw new SessionGrantError(
      'BUILDER_LIMITS_REQUIRED',
      `${field}.markets: builder grants must list markets`,
    );
  }
  const seen = new Set<string>();
  (limits.markets as readonly unknown[]).forEach((market, i) => {
    if (typeof market !== 'string' || !MARKET_RE.test(market)) {
      throw invalid(`${field}.markets[${i}]`, 'is not a market symbol');
    }
    requireShortString(`${field}.markets[${i}]`, market);
    if (seen.has(market)) throw invalid(`${field}.markets`, 'has duplicates');
    seen.add(market);
  });
}

function validateBinding(
  value: { paradexChain: unknown; environment: unknown; account: unknown },
  noncePresent: { nonce: unknown },
): void {
  requireShortString('paradexChain', value.paradexChain);
  requireEnvironment(value.environment);
  requireAddress('account', value.account);
  requireNonce('nonce', noncePresent.nonce);
}

export type SessionType = 'browser' | 'api';

/** Longest lifetime the server accepts for these scopes. */
export function maxSessionTtl(
  scopes: readonly SessionScope[],
  sessionType: SessionType = 'browser',
): number {
  if (scopes.some((s) => SENSITIVE_SCOPES.includes(s))) {
    return SESSION_TTL.sensitiveScopeMax;
  }
  return sessionType === 'api' ? SESSION_TTL.apiMax : SESSION_TTL.browserMax;
}

export interface ValidateSessionGrantOptions {
  /** IP-pinned API grants may last up to 180 days. Defaults to `browser`. */
  readonly sessionType?: SessionType;
}

/**
 * Checks a grant against the spec's format rules and server caps. Throws a
 * {@link SessionGrantError}. The server repeats every check; this one fails
 * before the owner is asked to sign.
 */
export function validateSessionGrant(
  grant: SessionGrant,
  options: ValidateSessionGrantOptions = {},
): void {
  validateBinding(grant, grant);
  requireCanonicalHex('sessionKey', grant.sessionKey, FELT_PRIME);
  if (grant.sessionKey === '0x0') throw invalid('sessionKey', 'is zero');
  if (typeof grant.label !== 'string') throw invalid('label', 'is required');
  validateScopes(grant.scopes);
  requireUniqueAddresses('subaccounts', grant.subaccounts, grant.account);
  requireTimestamp('issuedAt', grant.issuedAt);
  requireTimestamp('expiresAt', grant.expiresAt);
  if (grant.expiresAt <= grant.issuedAt) {
    throw invalid('expiresAt', 'must be after issuedAt');
  }
  const ttl = grant.expiresAt - grant.issuedAt;
  const cap = maxSessionTtl(grant.scopes, options.sessionType);
  if (ttl > cap) {
    throw new SessionGrantError(
      'TTL_EXCEEDED',
      `expiresAt: lifetime ${ttl}s exceeds the ${cap}s cap for these scopes`,
    );
  }

  const builder = grant.builder;
  if (builder == null || typeof builder !== 'object') {
    throw invalid('builder', 'is required');
  }
  requireAddress('builder.account', builder.account, false);
  requireDecimal('builder.maxFeeRate', builder.maxFeeRate, false);
  requireTimestamp('builder.expiresAt', builder.expiresAt);
  const hasBuilder = builder.account !== NO_BUILDER;
  if (!hasBuilder && (builder.maxFeeRate !== '0' || builder.expiresAt !== 0)) {
    throw invalid('builder', 'no builder must have maxFeeRate "0" and 0');
  }
  if (hasBuilder && builder.account === grant.account) {
    throw invalid('builder.account', 'must not be the granting account');
  }
  if (builder.expiresAt > grant.expiresAt) {
    throw invalid('builder.expiresAt', 'must not outlive the session');
  }
  validateLimits(grant.limits, hasBuilder);
}

export function validatePasskeyGrant(grant: PasskeyGrant): void {
  validateBinding(grant, grant);
  requireAddress('builderAccount', grant.builderAccount, false);
  requireTimestamp('issuedAt', grant.issuedAt);
  requireTimestamp('expiresAt', grant.expiresAt);
  if (grant.expiresAt <= grant.issuedAt) {
    throw invalid('expiresAt', 'must be after issuedAt');
  }
  if (grant.expiresAt - grant.issuedAt > SESSION_TTL.passkeyMax) {
    throw new SessionGrantError(
      'TTL_EXCEEDED',
      `expiresAt: passkey grants last at most ${SESSION_TTL.passkeyMax}s`,
    );
  }

  const passkey = grant.passkey;
  if (passkey == null || typeof passkey !== 'object') {
    throw invalid('passkey', 'is required');
  }
  if (!BASE64URL_RE.test(passkey.credentialId)) {
    throw invalid('passkey.credentialId', 'must be base64url');
  }
  if (!P256_COORD_RE.test(passkey.pubkeyX)) {
    throw invalid('passkey.pubkeyX', 'must be 0x + 64 lowercase hex');
  }
  if (!P256_COORD_RE.test(passkey.pubkeyY)) {
    throw invalid('passkey.pubkeyY', 'must be 0x + 64 lowercase hex');
  }
  if (typeof passkey.rpId !== 'string' || passkey.rpId === '') {
    throw invalid('passkey.rpId', 'is required');
  }
  if (typeof passkey.label !== 'string') {
    throw invalid('passkey.label', 'is required');
  }

  const ceiling = grant.ceiling;
  if (ceiling == null || typeof ceiling !== 'object') {
    throw invalid('ceiling', 'is required');
  }
  validateScopes(ceiling.scopes, 'ceiling.scopes');
  validateLimits(ceiling.limits, false, 'ceiling.limits');
  requireUniqueAddresses(
    'ceiling.subaccounts',
    ceiling.subaccounts,
    grant.account,
  );
  if (typeof ceiling.includeFutureSubaccounts !== 'boolean') {
    throw invalid('ceiling.includeFutureSubaccounts', 'must be a boolean');
  }
  if (ceiling.includeFutureSubaccounts && grant.builderAccount !== NO_BUILDER) {
    throw invalid(
      'ceiling.includeFutureSubaccounts',
      'is allowed only for first-party passkeys',
    );
  }
  requireTimestamp('ceiling.maxSessionTtl', ceiling.maxSessionTtl);
  if (
    ceiling.maxSessionTtl === 0 ||
    ceiling.maxSessionTtl > SESSION_TTL.passkeySessionMax
  ) {
    throw new SessionGrantError(
      'TTL_EXCEEDED',
      `ceiling.maxSessionTtl: must be 1-${SESSION_TTL.passkeySessionMax}s`,
    );
  }
  if (
    !Number.isSafeInteger(ceiling.maxConcurrentSessions) ||
    ceiling.maxConcurrentSessions < 1 ||
    ceiling.maxConcurrentSessions > MAX_PASSKEY_CONCURRENT_SESSIONS
  ) {
    throw invalid(
      'ceiling.maxConcurrentSessions',
      `must be 1-${MAX_PASSKEY_CONCURRENT_SESSIONS}`,
    );
  }
}

export function validateSessionMint(mint: SessionMint): void {
  validateBinding(mint, mint);
  requireUniqueAddresses('subaccounts', mint.subaccounts, mint.account);
  if (!BASE64URL_RE.test(mint.credentialId)) {
    throw invalid('credentialId', 'must be base64url');
  }
  requireCanonicalHex('sessionKey', mint.sessionKey, FELT_PRIME);
  if (mint.sessionKey === '0x0') throw invalid('sessionKey', 'is zero');
  validateScopes(mint.scopes);
  validateLimits(mint.limits, false);
  requireTimestamp('expiresAt', mint.expiresAt);
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** A fresh 128-bit random nonce in canonical hex. */
export function generateSessionNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  // A zero nonce is refused; the chance is 2^-128 but stay correct.
  return n === 0n ? '0x1' : canonicalFelt(n);
}

const NO_LIMITS: Limits = {
  maxOrderNotional: '',
  maxOpenNotional: '',
  dailyNotional: '',
  maxLoss: '',
  maxLeverage: '',
  markets: [],
};

export interface CreateSessionGrantParams {
  readonly paradexChain: string;
  readonly environment: SessionEnvironment;
  readonly account: string;
  readonly sessionKey: string;
  readonly scopes?: readonly SessionScope[];
  readonly label?: string;
  /** Omitted fields mean "server default" (refused for builder grants). */
  readonly limits?: Partial<Limits>;
  readonly builder?: {
    readonly account: string;
    readonly maxFeeRate: string;
    readonly expiresAt?: number;
  };
  readonly subaccounts?: readonly string[];
  readonly nonce?: string;
  /** Seconds. Defaults to now. */
  readonly issuedAt?: number;
  /** Seconds. Defaults to `issuedAt + ttlSeconds`. */
  readonly expiresAt?: number;
  /** Defaults to 7 days, the browser-session default. */
  readonly ttlSeconds?: number;
  readonly sessionType?: SessionType;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Builds a canonical, validated `SessionGrant`. Addresses and keys are
 * normalized to canonical hex; everything else is checked as given.
 */
export function createSessionGrant(
  params: CreateSessionGrantParams,
): SessionGrant {
  const issuedAt = params.issuedAt ?? nowSeconds();
  const expiresAt =
    params.expiresAt ??
    issuedAt + (params.ttlSeconds ?? SESSION_TTL.browserDefault);
  const grant: SessionGrant = {
    paradexChain: params.paradexChain,
    environment: params.environment,
    account: canonicalFelt(params.account),
    sessionKey: canonicalFelt(params.sessionKey),
    label: params.label ?? '',
    scopes: [...(params.scopes ?? ['trade'])],
    limits: {
      ...NO_LIMITS,
      ...Object.fromEntries(
        Object.entries(params.limits ?? {}).filter(([, v]) => v !== undefined),
      ),
      markets: [...(params.limits?.markets ?? [])],
    },
    builder:
      params.builder == null
        ? { account: NO_BUILDER, maxFeeRate: '0', expiresAt: 0 }
        : {
            account: canonicalFelt(params.builder.account),
            maxFeeRate: params.builder.maxFeeRate,
            expiresAt: params.builder.expiresAt ?? 0,
          },
    subaccounts: (params.subaccounts ?? []).map((a) => canonicalFelt(a)),
    nonce:
      params.nonce != null
        ? canonicalFelt(params.nonce)
        : generateSessionNonce(),
    issuedAt,
    expiresAt,
  };
  validateSessionGrant(grant, { sessionType: params.sessionType });
  return grant;
}

/** Every account a grant reaches: the anchor first, then its sub-accounts. */
export function grantAccounts(
  grant: Pick<SessionGrant, 'account' | 'subaccounts'>,
): readonly string[] {
  return [grant.account, ...grant.subaccounts];
}

/**
 * Throws `GRANT_EXPIRED` once the grant (or a time just ahead of `now`) has
 * passed its expiry, and `INVALID_FIELD` if `issuedAt` is too far ahead.
 */
export function assertGrantActive(
  grant: Pick<SessionGrant, 'issuedAt' | 'expiresAt'>,
  now: number = nowSeconds(),
): void {
  if (now >= grant.expiresAt) {
    throw new SessionGrantError(
      'GRANT_EXPIRED',
      `grant expired at ${grant.expiresAt}`,
    );
  }
  if (grant.issuedAt > now + MAX_ISSUED_AT_SKEW) {
    throw invalid('issuedAt', 'is in the future');
  }
}

// ---------------------------------------------------------------------------
// Encodings and hashes
// ---------------------------------------------------------------------------

function toChainId(signatureChainId: number | string | bigint): number {
  let n = Number.NaN;
  try {
    n =
      typeof signatureChainId === 'number'
        ? signatureChainId
        : Number(BigInt(signatureChainId));
  } catch {
    // Not an integer; rejected below.
  }
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw invalid('signatureChainId', 'must be a positive EVM chain id');
  }
  return n;
}

function eip712(
  primaryType: string,
  types: Eip712Types,
  message: object,
  signatureChainId: number | string | bigint,
): Eip712TypedData {
  return {
    domain: {
      name: SESSION_DOMAIN_NAME,
      version: SESSION_DOMAIN_VERSION,
      chainId: toChainId(signatureChainId),
    },
    primaryType,
    types,
    message: structuredClone(message) as Record<string, unknown>,
  };
}

/**
 * SNIP-12 `string` is a Cairo ByteArray. Keep every string ASCII so the
 * byte encoding cannot differ between implementations.
 */
function requireAsciiStrings(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (!/^[\x20-\x7e]*$/.test(value)) {
      throw invalid(path, 'must be printable ASCII in SNIP-12 typed data');
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => {
      requireAsciiStrings(v, `${path}[${i}]`);
    });
  } else if (value != null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      requireAsciiStrings(v, path === '' ? k : `${path}.${k}`);
    }
  }
}

function snip12(
  primaryType: string,
  types: Starknet.TypedData['types'],
  message: object,
  paradexChain: string,
): Starknet.TypedData {
  requireAsciiStrings(message, '');
  return {
    domain: {
      name: SESSION_DOMAIN_NAME,
      version: SESSION_DOMAIN_VERSION,
      chainId: paradexChain,
      revision: '1',
    },
    primaryType,
    types,
    message: structuredClone(message) as Record<string, unknown>,
  };
}

/**
 * EIP-712 `SessionGrant`. `signatureChainId` is the wallet's *current* EVM
 * chain, so no network switch is needed; send it along with the signature.
 */
export function buildSessionGrantEip712(
  grant: SessionGrant,
  signatureChainId: number | string | bigint,
): Eip712TypedData {
  validateSessionGrant(grant, { sessionType: 'api' });
  return eip712(
    'SessionGrant',
    SESSION_GRANT_EIP712_TYPES,
    grant,
    signatureChainId,
  );
}

/**
 * SNIP-12 revision 1 `SessionGrant`, signed by a Stark owner key. Builder
 * grants are EIP-712 only, so a grant naming a builder is refused here.
 */
export function buildSessionGrantSnip12(
  grant: SessionGrant,
): Starknet.TypedData {
  validateSessionGrant(grant, { sessionType: 'api' });
  if (grant.builder.account !== NO_BUILDER) {
    throw new SessionGrantError(
      'BUILDER_REQUIRES_EIP712',
      'builder grants are accepted only from EIP-191 accounts (EIP-712)',
    );
  }
  return snip12(
    'SessionGrant',
    SESSION_GRANT_SNIP12_TYPES,
    grant,
    grant.paradexChain,
  );
}

export function buildPasskeyGrantEip712(
  grant: PasskeyGrant,
  signatureChainId: number | string | bigint,
): Eip712TypedData {
  validatePasskeyGrant(grant);
  return eip712(
    'PasskeyGrant',
    PASSKEY_GRANT_EIP712_TYPES,
    grant,
    signatureChainId,
  );
}

export function buildPasskeyGrantSnip12(
  grant: PasskeyGrant,
): Starknet.TypedData {
  validatePasskeyGrant(grant);
  return snip12(
    'PasskeyGrant',
    PASSKEY_GRANT_SNIP12_TYPES,
    grant,
    grant.paradexChain,
  );
}

export function buildSessionMintEip712(
  mint: SessionMint,
  signatureChainId: number | string | bigint,
): Eip712TypedData {
  validateSessionMint(mint);
  return eip712(
    'SessionMint',
    SESSION_MINT_EIP712_TYPES,
    mint,
    signatureChainId,
  );
}

export function buildSessionMintSnip12(mint: SessionMint): Starknet.TypedData {
  validateSessionMint(mint);
  return snip12(
    'SessionMint',
    SESSION_MINT_SNIP12_TYPES,
    mint,
    mint.paradexChain,
  );
}

/** EIP-712 digest (`0x1901 ‖ domain ‖ struct`) as 0x-prefixed 32-byte hex. */
export function hashEip712(typedData: Eip712TypedData): Hex {
  return hashEip712TypedData(typedData);
}

/**
 * SNIP-12 message hash for `account` (the signer's address), as 0x-prefixed
 * 32-byte hex.
 */
export function hashSnip12(
  typedData: Starknet.TypedData,
  account: string,
): Hex {
  const hash = Starknet.typedData.getMessageHash(typedData, account);
  return `0x${BigInt(hash).toString(16).padStart(64, '0')}`;
}
