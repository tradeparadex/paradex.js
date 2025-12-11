import * as _Client from './client.js';
import * as _Config from './config.js';
import * as _Signer from './ethereum-signer.js';

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
