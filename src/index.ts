import * as _Client from './client.js';
import * as _Config from './config.js';
import * as _Signer from './ethereum-signer.js';
import * as _SessionKey from './session-key.js';
import * as _SessionOwnerSigner from './session-owner-signer.js';
import * as _SessionTypedData from './session-typed-data.js';

// Recommended: High-level client interface
export const Client = {
  fromEthSigner: async (params: _Client.CreateClientFromEthSignerParams) =>
    await _Client.ParadexClient.createFromEthSigner(params),
  fromStarknetAccount: async (
    params: _Client.CreateClientFromStarknetAccountParams,
  ) => await _Client.ParadexClient.createFromStarknetAccount(params),
};

export const Config = {
  fetch: _Config.fetchConfig,
};

export const Signer = {
  fromEthers: _Signer.ethersSignerAdapter,
};

/**
 * Session grant typed data and hashing.
 * @experimental The server side of sessions is not released yet.
 */
export const SessionTypedData = {
  createGrant: _SessionTypedData.createSessionGrant,
  validateGrant: _SessionTypedData.validateSessionGrant,
  validatePasskeyGrant: _SessionTypedData.validatePasskeyGrant,
  validateMint: _SessionTypedData.validateSessionMint,
  buildGrantEip712: _SessionTypedData.buildSessionGrantEip712,
  buildGrantSnip12: _SessionTypedData.buildSessionGrantSnip12,
  buildPasskeyGrantEip712: _SessionTypedData.buildPasskeyGrantEip712,
  buildPasskeyGrantSnip12: _SessionTypedData.buildPasskeyGrantSnip12,
  buildMintEip712: _SessionTypedData.buildSessionMintEip712,
  buildMintSnip12: _SessionTypedData.buildSessionMintSnip12,
  hashEip712: _SessionTypedData.hashEip712,
  hashSnip12: _SessionTypedData.hashSnip12,
  generateNonce: _SessionTypedData.generateSessionNonce,
  grantAccounts: _SessionTypedData.grantAccounts,
  assertGrantActive: _SessionTypedData.assertGrantActive,
  maxSessionTtl: _SessionTypedData.maxSessionTtl,
};

/**
 * Session connector: open a session with one owner signature, then trade
 * every account the grant lists with the session key.
 * @experimental `POST /v2/sessions` is not released yet.
 */
export const Session = {
  ownerSignerFromEip1193: _SessionOwnerSigner.eip1193OwnerSigner,
  ownerSignerFromExternal: _SessionOwnerSigner.externalOwnerSigner,
  memoryStorage: _SessionKey.memorySessionStorage,
  indexedDbStorage: _SessionKey.indexedDbSessionStorage,
};

export { SessionGrantError } from './session-typed-data.js';
export { SessionConnector } from './session-connector.js';
export { SessionAccounts } from './session-accounts.js';
export { SessionApiError } from './session-transport.js';
export { SessionKey } from './session-key.js';

// Export types for TypeScript users
export type {
  ParadexClient,
  CreateClientFromEthSignerParams,
  CreateClientFromStarknetAccountParams,
  TokenBalance,
  SocializedLossFactor,
  ReceivableAmount,
  MaxWithdraw,
  WithdrawResult,
} from './client.js';
export type { ParadexConfig } from './config.js';
export type { EthereumSigner } from './ethereum-signer.js';
export type { Hex } from './types.js';
export type { Eip712TypedData, Eip712Domain } from './eip712.js';
export type {
  Builder,
  Ceiling,
  CreateSessionGrantParams,
  Limits,
  Passkey,
  PasskeyGrant,
  SessionEnvironment,
  SessionGrant,
  SessionGrantErrorCode,
  SessionMint,
  SessionScope,
  SessionType,
} from './session-typed-data.js';
export type {
  OpenSessionParams,
  Session as RegisteredSession,
  SessionConnectorParams,
} from './session-connector.js';
export type {
  SessionAccountsParams,
  SessionRequest,
  SubscriptionHandler,
} from './session-accounts.js';
export type { OrderSide, OrderType, SessionOrder } from './session-auth.js';
export type { SessionStorage, StoredSession } from './session-key.js';
export type {
  Eip1193Provider,
  OwnerSignRequest,
  SessionOwnerSigner,
} from './session-owner-signer.js';
export type {
  HttpRequest,
  HttpResponse,
  HttpTransport,
  WebSocketFactory,
  WebSocketLike,
} from './session-transport.js';
