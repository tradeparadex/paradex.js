import * as Starknet from 'starknet';

import type { Account, AccountCredentials } from './account.js';
import type { ParadexConfig } from './config.js';

export interface AuthSignature {
  account: string;
  signature: [string, string];
  timestamp: string;
  id: number; // RPC request ID used for signature generation
}

/**
 * Stateless RPC provider that supports Paradex authentication
 * Extends Starknet.RpcProvider with automatic EIP-712 signature authentication
 * All RPC calls automatically include authentication headers when account is present
 */
export class AuthenticatedRpcProvider extends Starknet.RpcProvider {
  protected chainId: string;

  constructor(nodeUrl: string, chainId: string) {
    super({
      nodeUrl,
      chainId: Starknet.shortString.encodeShortString(
        chainId,
      ) as Starknet.RpcProviderOptions['chainId'],
    });
    this.chainId = chainId;
  }

  /**
   * Get the chain ID string (not encoded)
   */
  getChainIdString(): string {
    return this.chainId;
  }
}

export class DefaultProvider extends AuthenticatedRpcProvider {
  private readonly account?: Account;
  private readonly nodeUrl: string;

  constructor(
    config: ParadexConfig,
    credentials?: AccountCredentials | Account,
  ) {
    super(config.paradexFullNodeRpcUrl, config.paradexChainId);
    this.nodeUrl = config.paradexFullNodeRpcUrl;

    if (credentials != null) {
      // If it's already an Account, use it directly
      if ('address' in credentials && 'signer' in credentials) {
        this.account = credentials;
      } else {
        this.account = new Starknet.Account({
          provider: this,
          address: credentials.address,
          signer: credentials.privateKey,
        });
      }
    }
  }

  /**
   * Get the account (internal use only)
   * @internal
   */
  getAccount(): Account | undefined {
    return this.account;
  }

  /**
   * Override callContract to add authentication headers
   */
  override async callContract(
    call: Starknet.Call,
    blockIdentifier: Starknet.BlockIdentifier = Starknet.BlockTag.PRE_CONFIRMED,
  ): Promise<Starknet.CallContractResponse> {
    // If no account, use standard callContract
    if (this.account == null) {
      return await super.callContract(call, blockIdentifier);
    }

    // Build the RPC params
    const request = {
      contract_address: call.contractAddress,
      entry_point_selector: Starknet.hash.getSelectorFromName(call.entrypoint),
      calldata: call.calldata ?? [],
    };

    const params = {
      request,
      block_id: blockIdentifier,
    };

    const method = 'starknet_call';

    // Generate auth signature
    const { generateAuthSignature } = await import('./fullnode-auth.js');
    const signature = await generateAuthSignature(
      this.account,
      this.chainId,
      method,
      params,
    );

    // Build the JSON-RPC payload with the same ID used in signature
    const payload = {
      jsonrpc: '2.0',
      method,
      params,
      id: signature.id,
    };

    const jsonPayload = JSON.stringify(payload, (_, value): unknown =>
      typeof value === 'bigint' ? value.toString() : value,
    );

    // Add auth headers
    const authHeaders = {
      'Content-Type': 'application/json',
      'PARADEX-STARKNET-ACCOUNT': signature.account,
      'PARADEX-STARKNET-SIGNATURE': JSON.stringify(signature.signature),
      'PARADEX-STARKNET-SIGNATURE-TIMESTAMP': signature.timestamp,
      'PARADEX-STARKNET-SIGNATURE-VERSION': '1.0.0',
    };

    // Make authenticated request directly
    const response = await fetch(this.nodeUrl, {
      method: 'POST',
      headers: authHeaders,
      body: jsonPayload,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = (await response.json()) as {
      error?: { message: string; code: number; data?: unknown };
      result?: unknown;
    };

    // Handle RPC errors
    if (result.error !== undefined) {
      throw new Error(`RPC error: ${result.error.message}`);
    }

    return result.result as Starknet.CallContractResponse;
  }
}

export type ParaclearProvider = DefaultProvider;
