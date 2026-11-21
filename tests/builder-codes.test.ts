import { BuilderCodesClient } from '../src/builder-codes';
import {
  SessionApiError,
  type HttpRequest,
  type HttpResponse,
} from '../src/session-transport';

const APPROVAL = {
  builder: { account: '0xb1', name: null },
  status: 'active',
  max_fee_rate: '0.0005',
  expires_at: 1760572800000,
  approved_at: 1760000000000,
  revoked_at: 0,
};
const STATS = {
  builder: { account: '0xb1', name: null },
  window: '7d',
  fees_paid: '125.5',
  volume: '2500000',
  users: 42,
  fills: 1800,
  as_of: 1760000000000,
};

function setup(
  respond: (req: HttpRequest) => HttpResponse = (req) =>
    req.method === 'DELETE'
      ? { status: 204, body: '' }
      : { status: 200, body: { results: [] } },
): {
  client: BuilderCodesClient;
  transport: jest.Mock<Promise<HttpResponse>, [HttpRequest]>;
} {
  const transport = jest.fn(async (req: HttpRequest) => respond(req));
  return {
    client: new BuilderCodesClient({ environment: 'testnet', transport }),
    transport,
  };
}

describe('BuilderCodesClient', () => {
  test('lists approvals with the owner token, and the history on request', async () => {
    const { client, transport } = setup(() => ({
      status: 200,
      body: { results: [APPROVAL] },
    }));
    expect(await client.listApprovals('jwt-1')).toEqual([APPROVAL]);
    await client.listApprovals('jwt-1', { includeInactive: true });
    const [live, history] = transport.mock.calls.map(([req]) => req);
    expect(live).toEqual({
      method: 'GET',
      url: 'https://api.testnet.paradex.trade/v2/builders/approvals',
      headers: { Authorization: 'Bearer jwt-1' },
    });
    expect(history?.url).toBe(
      'https://api.testnet.paradex.trade/v2/builders/approvals?include_inactive=true',
    );
  });

  test('revokes an approval by the canonical builder address', async () => {
    const { client, transport } = setup();
    await client.revokeApproval('jwt-1', '0x00B1');
    expect(transport.mock.calls[0]?.[0]).toEqual({
      method: 'DELETE',
      url: 'https://api.testnet.paradex.trade/v2/builders/approvals/0xb1',
      headers: { Authorization: 'Bearer jwt-1' },
    });
  });

  test('a revoke with no live approval surfaces the 404', async () => {
    const { client } = setup(() => ({
      status: 404,
      body: {
        error: 'NOT_FOUND',
        message: 'no live approval for this builder',
      },
    }));
    const error = await client
      .revokeApproval('jwt-1', '0xb1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SessionApiError);
    expect((error as SessionApiError).status).toBe(404);
  });

  test('stats and the leaderboard are public', async () => {
    const { client, transport } = setup((req) => ({
      status: 200,
      body: {
        results: req.url.includes('leaderboard')
          ? [{ rank: 1, ...STATS }]
          : [STATS],
      },
    }));
    expect(await client.fetchStats('0x00B1')).toEqual([STATS]);
    expect((await client.fetchLeaderboard())[0]?.rank).toBe(1);
    await client.fetchLeaderboard('30d');
    const urls = transport.mock.calls.map(([req]) => req.url);
    expect(urls).toEqual([
      'https://api.testnet.paradex.trade/v1/builders/0xb1/stats',
      'https://api.testnet.paradex.trade/v1/builders/leaderboard',
      'https://api.testnet.paradex.trade/v1/builders/leaderboard?window=30d',
    ]);
    for (const [req] of transport.mock.calls) {
      expect(req.headers).toEqual({});
    }
  });

  test('a 404 before stats are loaded surfaces as a SessionApiError', async () => {
    const { client } = setup(() => ({
      status: 404,
      body: { error: 'NOT_FOUND', message: 'builder stats not found' },
    }));
    await expect(client.fetchLeaderboard()).rejects.toBeInstanceOf(
      SessionApiError,
    );
  });

  test('refuses bad input before sending', async () => {
    const { client, transport } = setup();
    await expect(client.fetchStats('builder')).rejects.toThrow(
      'builderAccount must be a 0x hex address',
    );
    await expect(client.revokeApproval('jwt-1', '0x')).rejects.toThrow(
      'builderAccount must be a 0x hex address',
    );
    await expect(client.listApprovals('')).rejects.toThrow('token');
    await expect(
      client.fetchLeaderboard('1h' as unknown as '7d'),
    ).rejects.toThrow('window must be one of');
    expect(transport).not.toHaveBeenCalled();
  });

  test('a response without results is refused', async () => {
    const { client } = setup(() => ({ status: 200, body: {} }));
    const error = await client.fetchStats('0xb1').catch((e: unknown) => e);
    expect((error as SessionApiError).code).toBe('INVALID_RESPONSE');
  });

  test('uses a custom API host', async () => {
    const transport = jest.fn(async () => ({
      status: 200,
      body: { results: [] },
    }));
    await new BuilderCodesClient({
      environment: 'mainnet',
      apiUrl: 'https://example.test/',
      transport,
    }).fetchStats('0xb1');
    expect(transport.mock.calls[0]).toEqual([
      expect.objectContaining({
        url: 'https://example.test/v1/builders/0xb1/stats',
      }),
    ]);
  });
});
