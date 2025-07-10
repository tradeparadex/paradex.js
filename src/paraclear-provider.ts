import * as Starknet from 'starknet';

import type { Account } from './account.js';
import type { ParadexConfig } from './config.js';
import { generateFullnodeRequestHeaders } from './fullnode-auth.js';

/**
 * Custom RPC Provider that can optionally inject Paradex fullnode authentication headers
 * into RPC requests, similar to how the Python SDK monkey patches the client.
 */
class AuthenticatedRpcProvider extends Starknet.RpcProvider {
  private account?: Account;
  private readonly chainId: string;
  private originalFetch?: (
    method: string,
    params?: object,
    requestOptions?: any,
  ) => Promise<any>;

  constructor(nodeUrl: string, chainId: string, account?: Account) {
    super({
      nodeUrl,
      chainId: Starknet.shortString.encodeShortString(
        chainId,
      ) as Starknet.RpcProviderOptions['chainId'],
    });
    this.chainId = chainId;
    this.account = account;

    // Only patch if account is provided
    if (account !== null && account !== undefined) {
      this.patchChannelFetch();
    }
  }

  /**
   * Enable authentication by providing an account
   */
  public enableAuthentication(account: Account): void {
    this.account = account;
    this.patchChannelFetch();
  }

  /**
   * Disable authentication
   */
  public disableAuthentication(): void {
    if (this.originalFetch !== null && this.originalFetch !== undefined) {
      this.channel.fetch = this.originalFetch;
      this.originalFetch = undefined;
    }
    this.account = undefined;
  }

  /**
   * Patch the channel's fetch method to inject authentication headers
   */
  private patchChannelFetch(): void {
    if (this.account === null || this.account === undefined) return;

    // Store original fetch method if not already stored
    if (this.originalFetch === null || this.originalFetch === undefined) {
      this.originalFetch = this.channel.fetch.bind(this.channel);
    }

    const account = this.account; // Capture account reference
    const originalFetch = this.originalFetch; // Capture original fetch reference

    this.channel.fetch = async (
      method: string,
      params?: object,
      requestOptions?: any,
    ): Promise<any> => {
      // Build the JSON payload similar to how Python SDK does it
      const payload = {
        jsonrpc: '2.0',
        method,
        params: params ?? [],
        id: Math.floor(Math.random() * 1000000),
      };

      // Generate authentication headers using our fullnode auth function
      const jsonPayload = JSON.stringify(payload, null, 2); // Use Python-style formatting with spaces
      const authHeaders = await generateFullnodeRequestHeaders(
        account,
        this.chainId,
        jsonPayload,
      );

      // Merge headers with existing ones
      const enhancedOptions = {
        ...requestOptions,
        headers: {
          ...requestOptions?.headers,
          ...authHeaders,
        },
      };

      // Call the original fetch method with enhanced options
      if (originalFetch === null || originalFetch === undefined) {
        throw new Error('Original fetch method is not available');
      }
      return await originalFetch(method, params, enhancedOptions);
    };
  }
}

export class DefaultProvider extends AuthenticatedRpcProvider {
  constructor(config: ParadexConfig, account?: Account) {
    super(config.paradexFullNodeRpcUrl, config.paradexChainId, account);
  }

  // Re-expose authentication methods for type safety
  public override enableAuthentication(account: Account): void {
    super.enableAuthentication(account);
  }

  public override disableAuthentication(): void {
    super.disableAuthentication();
  }
}

export type ParaclearProvider = DefaultProvider;
