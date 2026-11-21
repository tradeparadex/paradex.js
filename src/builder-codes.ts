import {
  defaultApiUrl,
  fetchTransport,
  SessionApiError,
  type HttpRequest,
  type HttpTransport,
} from './session-transport.js';
import type { SessionEnvironment } from './session-typed-data.js';

/**
 * Builder Codes reads: an owner's builder approvals (list and revoke) and
 * the public builder stats and leaderboard.
 *
 * @experimental The request and response shapes may change.
 */

export const BUILDER_APPROVALS_LIST_PATH = '/v2/builders/approvals';
export const BUILDER_STATS_WINDOWS = ['24h', '7d', '30d', 'all'] as const;
export type BuilderStatsWindow = (typeof BUILDER_STATS_WINDOWS)[number];

/** A builder as the API names it. */
export interface BuilderRef {
  readonly account: string;
  /** The builder's registered name; `null` when it has none. */
  readonly name: string | null;
}

export type BuilderApprovalStatus = 'active' | 'revoked' | 'expired';

/** One of an account's builder approvals. */
export interface BuilderApprovalRecord {
  readonly builder: BuilderRef;
  readonly status: BuilderApprovalStatus;
  /** Highest fee rate the builder may charge, as a decimal fraction. */
  readonly max_fee_rate: string;
  /** Milliseconds. */
  readonly expires_at: number;
  /** When the approval took effect, in milliseconds. */
  readonly approved_at: number;
  /** Milliseconds; 0 while not revoked. */
  readonly revoked_at: number;
}

/** A builder's stats over one window. */
export interface BuilderStats {
  readonly builder: BuilderRef;
  readonly window: BuilderStatsWindow;
  /** Builder fees traders paid, in USDC, before any protocol share. */
  readonly fees_paid: string;
  /** USD notional of the fill sides that paid this builder a fee. */
  readonly volume: string;
  /** Distinct accounts that paid the builder a fee. */
  readonly users: number;
  readonly fills: number;
  /** When the stats were computed, in milliseconds. */
  readonly as_of: number;
}

export interface BuilderLeaderboardRow extends BuilderStats {
  /** 1 for the builder paid the most fees. */
  readonly rank: number;
}

export interface BuilderCodesClientParams {
  /** Picks the default API host. */
  readonly environment: SessionEnvironment;
  /** API host root, such as `https://api.testnet.paradex.trade`. */
  readonly apiUrl?: string;
  readonly transport?: HttpTransport;
}

export interface ListBuilderApprovalsOptions {
  /** Also list revoked and expired approvals, for the approval history. */
  readonly includeInactive?: boolean;
}

/**
 * Reads Builder Codes approvals and stats.
 *
 * Listing and revoking approvals needs the account owner's main-key JWT,
 * passed as `token`; a session or subkey token is refused with 403. The
 * stats and leaderboard are public. The stats endpoints answer 404 while the
 * server has no stats to serve.
 *
 * @experimental
 */
export class BuilderCodesClient {
  private readonly apiUrl: string;
  private readonly transport: HttpTransport;

  constructor(params: BuilderCodesClientParams) {
    this.apiUrl = (params.apiUrl ?? defaultApiUrl(params.environment)).replace(
      /\/+$/,
      '',
    );
    this.transport = params.transport ?? fetchTransport;
  }

  /**
   * `GET /v2/builders/approvals`: the account's live approvals, newest first;
   * with `includeInactive` also its revoked and expired ones.
   */
  async listApprovals(
    token: string,
    options: ListBuilderApprovalsOptions = {},
  ): Promise<BuilderApprovalRecord[]> {
    const query =
      options.includeInactive === true ? '?include_inactive=true' : '';
    return await this.results<BuilderApprovalRecord>({
      method: 'GET',
      url: `${this.apiUrl}${BUILDER_APPROVALS_LIST_PATH}${query}`,
      headers: bearer(token),
    });
  }

  /**
   * `DELETE /v2/builders/approvals/{builder_account}`: new orders naming the
   * builder are refused at once, on the account and its sub-accounts. A
   * builder with no live approval is a 404 `SessionApiError`.
   */
  async revokeApproval(token: string, builderAccount: string): Promise<void> {
    await this.send({
      method: 'DELETE',
      url: `${this.apiUrl}${BUILDER_APPROVALS_LIST_PATH}/${builderAddress(builderAccount)}`,
      headers: bearer(token),
    });
  }

  /**
   * `GET /v1/builders/{builder_account}/stats`: one row per window. A window
   * with no paid fill, or with too few paying users, is zeros. Stats lag the
   * fills they count.
   */
  async fetchStats(builderAccount: string): Promise<BuilderStats[]> {
    return await this.results<BuilderStats>({
      method: 'GET',
      url: `${this.apiUrl}/v1/builders/${builderAddress(builderAccount)}/stats`,
      headers: {},
    });
  }

  /**
   * `GET /v1/builders/leaderboard`: builders ranked by `fees_paid` over one
   * window, then by volume. The server's default window is `7d`.
   */
  async fetchLeaderboard(
    window?: BuilderStatsWindow,
  ): Promise<BuilderLeaderboardRow[]> {
    if (window != null && !BUILDER_STATS_WINDOWS.includes(window)) {
      throw new Error(
        `window must be one of ${BUILDER_STATS_WINDOWS.join(', ')}`,
      );
    }
    const query = window != null ? `?window=${window}` : '';
    return await this.results<BuilderLeaderboardRow>({
      method: 'GET',
      url: `${this.apiUrl}/v1/builders/leaderboard${query}`,
      headers: {},
    });
  }

  private async send(request: HttpRequest): Promise<unknown> {
    const response = await this.transport(request);
    if (response.status < 200 || response.status >= 300) {
      throw new SessionApiError(response.status, response.body);
    }
    return response.body;
  }

  private async results<T>(request: HttpRequest): Promise<T[]> {
    const body = await this.send(request);
    const results = (body as { results?: unknown } | null)?.results;
    if (!Array.isArray(results)) {
      throw new SessionApiError(200, {
        error: 'INVALID_RESPONSE',
        message: `${request.method} ${new URL(request.url).pathname} returned no results`,
      });
    }
    return results as T[];
  }
}

function bearer(token: string): Record<string, string> {
  if (typeof token !== 'string' || token === '') {
    throw new Error("token must be the account owner's JWT");
  }
  return { Authorization: `Bearer ${token}` };
}

/** A builder account as a canonical 0x address for a URL path. */
function builderAddress(builderAccount: string): string {
  if (
    typeof builderAccount !== 'string' ||
    !/^0x[0-9a-fA-F]{1,64}$/.test(builderAccount)
  ) {
    throw new Error('builderAccount must be a 0x hex address');
  }
  return `0x${BigInt(builderAccount).toString(16)}`;
}
