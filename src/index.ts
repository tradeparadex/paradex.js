import * as _Client from './client.js';
import * as _Config from './config.js';
import * as _Signer from './ethereum-signer.js';
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
  mintChallenge: _SessionTypedData.sessionMintChallenge,
  grantAccounts: _SessionTypedData.grantAccounts,
  assertGrantActive: _SessionTypedData.assertGrantActive,
  assertMintWithinCeiling: _SessionTypedData.assertMintWithinCeiling,
  summarizeGrant: _SessionTypedData.summarizeGrant,
  lossSummary: _SessionTypedData.lossSummary,
  marketCovers: _SessionTypedData.marketCovers,
  maxSessionTtl: _SessionTypedData.maxSessionTtl,
};

export { DEFAULT_LIMIT_CAPS, SessionGrantError } from './session-typed-data.js';

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
  LimitCaps,
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
