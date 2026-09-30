import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMarketData: vi.fn(),
}));

// @ts-expect-error server-only is a Next.js virtual module, not a test dependency.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('@/lib/server/sjc', () => ({ getMarketData: mocks.getMarketData }));
vi.mock('@/lib/server/market-fetch', () => ({
  withMarketFetch: async (
    _signal: AbortSignal,
    _historyDays: number,
    work: () => Promise<unknown>,
  ) => work(),
}));

import { GET } from '@/app/api/compare/route';

function responseFor(companyId: string, productId: string) {
  const values: Record<string, [number, number]> = {
    'sjc:ring-1c': [145, 149],
    'pnj:pnj-ring-9999': [144, 148],
    'btmc:btmc-ring': [146, 150],
    'phuquy:phuquy-ring-9999': [143, 147],
    'sjc:bar-1l': [145, 149],
    'pnj:pnj-sjc-hcm': [144, 148],
    'btmc:btmc-sjc': [146, 150],
    'phuquy:phuquy-bar': [143, 147],
    'vngold:vngold-sjc': [147, 151],
    'viettin:viettin-sjc': [148, 152],
  };
  const [buy, sell] = values[`${companyId}:${productId}`] ?? [145, 150];
  return {
    latest: { date: '2026-09-08', buy, sell, spread: sell - buy, eventId: null },
    mode: 'live' as const,
    availability: 'available' as const,
    unavailableReason: null,
    observedAt: '2026-09-08T10:00:00.000Z',
    source: {
      provider: `${companyId} official`,
      url: `https://example.test/${companyId}`,
      official: companyId === 'sjc' || companyId === 'pnj' || companyId === 'btmc' || companyId === 'phuquy',
    },
  };
}

describe('GET /api/compare', () => {
  it('returns catalog metadata and ranks eligible same-group rows', async () => {
    mocks.getMarketData.mockImplementation(async (companyId: string, productId: string) =>
      responseFor(companyId, productId),
    );

    const response = await GET(
      new Request('http://localhost/api/compare?set=ring-9999&direction=buy'),
    );
    const body = (await response.json()) as {
      set: string;
      mode: string;
      ranking: { enabled: boolean; metric: string; eligibleCount: number };
      rows: Array<{
        id: string;
        sourceIdentity: string;
        productId: string;
        category: string;
        rank: number | null;
        eligibleForRanking: boolean;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.set).toBe('ring-9999');
    expect(body.mode).toBe('same-group');
    expect(body.ranking).toMatchObject({
      enabled: true,
      metric: 'sell',
      eligibleCount: 4,
    });
    expect(body.rows).toHaveLength(4);
    expect(body.rows[0]).toMatchObject({
      id: 'phuquy:phuquy-ring-9999',
      productId: 'phuquy-ring-9999',
      category: 'ring',
      rank: 1,
      eligibleForRanking: true,
    });
    expect(new Set(body.rows.map((row) => row.sourceIdentity)).size).toBe(
      body.rows.length,
    );
    expect(mocks.getMarketData.mock.calls.every((call) => call[2]?.view === 'quote')).toBe(true);
  });

  it('does not rank products across ring and SJC groups', async () => {
    mocks.getMarketData.mockImplementation(async (companyId: string, productId: string) =>
      responseFor(companyId, productId),
    );

    const response = await GET(
      new Request('http://localhost/api/compare?set=ring-9999-vs-sjc'),
    );
    const body = (await response.json()) as {
      mode: string;
      ranking: { enabled: boolean; eligibleCount: number; label: string };
      rows: Array<{ rank: number | null; eligibleForRanking: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(body.mode).toBe('cross-group');
    expect(body.ranking).toMatchObject({
      enabled: false,
      eligibleCount: 0,
      label: 'Đối chiếu giữa các nhóm, không xếp hạng chung',
    });
    expect(body.rows.every((row) => row.rank === null && !row.eligibleForRanking)).toBe(
      true,
    );
  });

  it('returns English presentation labels while preserving catalog identifiers', async () => {
    mocks.getMarketData.mockImplementation(async (companyId: string, productId: string) =>
      responseFor(companyId, productId),
    );

    const response = await GET(
      new Request('http://localhost/api/compare?set=sjc-bar&locale=en'),
    );
    const body = (await response.json()) as {
      label: string;
      rows: Array<{
        id: string;
        companyId: string;
        productId: string;
        product: string;
        region: string | null;
        regionId: string | null;
      }>;
    };

    expect(body.label).toBe('SJC gold bars');
    const sjcRow = body.rows.find((row) => row.companyId === 'sjc');
    expect(sjcRow).toMatchObject({
      id: 'sjc:bar-1l',
      companyId: 'sjc',
      productId: 'bar-1l',
      product: 'Gold bar SJC 1 lượng',
      region: null,
      regionId: null,
    });
    const pnjRow = body.rows.find((row) => row.companyId === 'pnj');
    expect(pnjRow).toMatchObject({
      product: 'SJC gold bar at PNJ · Ho Chi Minh City',
      region: 'Ho Chi Minh City',
      regionId: 'TPHCM',
    });
  });

  it('ranks all eligible same-group sources by highest buyback price when selling', async () => {
    mocks.getMarketData.mockImplementation(async (companyId: string, productId: string) =>
      responseFor(companyId, productId),
    );

    const response = await GET(
      new Request('http://localhost/api/compare?set=ring-9999&direction=sell'),
    );
    const body = (await response.json()) as {
      ranking: { direction: string; metric: string };
      rows: Array<{ rank: number | null; latest: { buy: number } | null }>;
    };

    expect(response.status).toBe(200);
    expect(body.ranking).toMatchObject({ direction: 'sell', metric: 'buy' });
    expect(body.rows[0]?.latest?.buy).toBe(146);
  });

  it('rejects unknown or over-large share-link selections', async () => {
    const unknown = await GET(
      new Request('http://localhost/api/compare?set=ring-9999&products=unknown'),
    );
    expect(unknown.status).toBe(400);

    const tooMany = await GET(
      new Request(
        'http://localhost/api/compare?set=ring-9999&products=sjc:ring-1c,pnj:pnj-ring-9999,btmc:btmc-ring,baotin:baotin-9999',
      ),
    );
    expect(tooMany.status).toBe(400);
  });
});
