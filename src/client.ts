import type * as Starknet from 'starknet';

import {
  deriveFromEthSigner,
  deriveFromStarknetAccount,
  type Account,
} from './account.js';
import type { ParadexConfig } from './config.js';
import type { EthereumSigner } from './ethereum-signer.js';
import { DefaultProvider } from './paraclear-provider.js';
import * as Paraclear from './paraclear.js';

export interface CreateClientFromEthSignerParams {
  readonly config: ParadexConfig;
  readonly signer: EthereumSigner;
}

export interface CreateClientFromStarknetAccountParams {
  readonly config: ParadexConfig;
  readonly account: Starknet.AccountInterface;
  readonly starknetProvider?: Starknet.ProviderInterface;
  readonly rpcUrl?: string;
}

export interface TokenBalance {
  readonly size: string;
}

export interface SocializedLossFactor {
  readonly socializedLossFactor: string;
}

export interface ReceivableAmount {
  readonly receivableAmount: string;
  readonly receivableAmountChain: string;
  readonly socializedLossFactor: string;
}

export interface MaxWithdraw {
  readonly amount: string;
  readonly amountChain: string;
}

export interface WithdrawResult {
  readonly hash: string;
}

/**
 * High-level Paradex client with clean interface
 */
export class ParadexClient {
  private readonly provider: DefaultProvider;
  private readonly config: ParadexConfig;
  private readonly account: Account;

  private constructor(
    config: ParadexConfig,
    provider: DefaultProvider,
    account: Account,
  ) {
    this.config = config;
    this.provider = provider;
    this.account = account;
  }

  /**
   * Create a Paradex client from an Ethereum signer
   */
  static async createFromEthSigner({
    config,
    signer,
  }: CreateClientFromEthSignerParams): Promise<ParadexClient> {
    // Derive credentials internally (privateKey never exposed)
    const credentials = await deriveFromEthSigner({ config, signer });

    // Create authenticated provider
    const provider = new DefaultProvider(config, credentials);

    // Get the account from provider
    const account = provider.getAccount();
    if (account == null) {
      throw new Error('Failed to create authenticated provider');
    }

    return new ParadexClient(config, provider, account);
  }

  /**
   * Create a Paradex client from a Starknet account
   */
  static async createFromStarknetAccount({
    config,
    account,
    starknetProvider,
    rpcUrl,
  }: CreateClientFromStarknetAccountParams): Promise<ParadexClient> {
    // Derive credentials internally (privateKey never exposed)
    const credentials = await deriveFromStarknetAccount({
      config,
      account,
      starknetProvider,
      rpcUrl,
    });

    // Create authenticated provider
    const provider = new DefaultProvider(config, credentials);

    // Get the account from provider
    const paradexAccount = provider.getAccount();
    if (paradexAccount == null) {
      throw new Error('Failed to create authenticated provider');
    }

    return new ParadexClient(config, provider, paradexAccount);
  }

  /**
   * Get maximum withdrawable amount (includes balance and accounts for socialized loss)
   */
  async getMaxWithdraw(token: string): Promise<MaxWithdraw> {
    return await Paraclear.getMaxWithdraw({
      provider: this.provider,
      config: this.config,
      account: this.account,
      token,
    });
  }

  /**
   * Get token balance
   */
  async getTokenBalance(token: string): Promise<TokenBalance> {
    return await Paraclear.getTokenBalance({
      provider: this.provider,
      config: this.config,
      account: this.account,
      token,
    });
  }

  /**
   * Get socialized loss factor
   */
  async getSocializedLossFactor(): Promise<SocializedLossFactor> {
    return await Paraclear.getSocializedLossFactor({
      provider: this.provider,
      config: this.config,
    });
  }

  /**
   * Get receivable amount after applying socialized loss
   */
  async getReceivableAmount(
    token: string,
    amount: string,
  ): Promise<ReceivableAmount> {
    return await Paraclear.getReceivableAmount({
      provider: this.provider,
      config: this.config,
      token,
      amount,
    });
  }

  /**
   * Withdraw tokens
   */
  async withdraw(
    token: string,
    amount: string,
    bridgeCall: Starknet.Call | readonly Starknet.Call[],
  ): Promise<WithdrawResult> {
    return await Paraclear.withdraw({
      config: this.config,
      account: this.account,
      token,
      amount,
      bridgeCall,
    });
  }

  /**
   * Wait for transaction to complete
   */
  async waitForTransaction(
    txHash: string,
    options?: Starknet.waitForTransactionOptions,
  ): Promise<Starknet.GetTransactionReceiptResponse> {
    return await this.provider.waitForTransaction(txHash, options);
  }

  /**
   * Get the account address (public key, safe to expose)
   */
  getAddress(): string {
    return this.account.address;
  }

  /**
   * Get the underlying provider (for advanced use cases)
   */
  getProvider(): DefaultProvider {
    return this.provider;
  }
}
