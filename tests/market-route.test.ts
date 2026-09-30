import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getMarketData: vi.fn(),
  getLatestMarketQuoteSnapshot: vi.fn(),
  saveMarketQuoteSnapshot: vi.fn(),
}));

vi.mock('@/lib/server/sjc', () => ({ getMarketData: mocks.getMarketData }));
vi.mock('@/lib/server/market-snapshot', () => ({
  getLatestMarketQuoteSnapshot: mocks.getLatestMarketQuoteSnapshot,
  saveMarketQuoteSnapshot: mocks.saveMarketQuoteSnapshot,
}));

import { GET } from '@/app/api/sjc/route';

const liveMarket = {
  mode: 'live' as const,
  availability: 'available' as const,
  unavailableReason: null,
  company: { id: 'sjc' },
  product: { id: 'bar-1l' },
  products: [],
  records: [],
  latest: { date: '2026-09-09', buy: 142, sell: 145, spread: 3, eventId: null },
  observedAt: '2026-09-09T01:00:00.000Z',
  source: { provider: 'SJC', url: null, official: true },
  historySource: { provider: 'SJC-price dataset', url: null },
  generatedAt: '2026-09-09T01:00:00.000Z',
};

afterEach(() => vi.clearAllMocks());

describe('market route cache policy', () => {
  it('rejects an unknown company or product instead of silently using SJC', async () => {
    const response = await GET(
      new Request('http://localhost/api/sjc?company=unknown&product=bar-1l'),
    );
    expect(response.status).toBe(400);
    expect(mocks.getMarketData).not.toHaveBeenCalled();
  });

  it('returns source timing metadata and the four-minute public cache policy', async () => {
    mocks.getMarketData.mockResolvedValue(liveMarket);
    mocks.saveMarketQuoteSnapshot.mockResolvedValue(undefined);
    const response = await GET(
      new Request('http://localhost/api/sjc?company=sjc&product=bar-1l'),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('s-maxage=240');
    expect(response.headers.get('vercel-cdn-cache-control')).toContain(
      's-maxage=240',
    );
    expect(body).toMatchObject({
      fetchedAt: liveMarket.generatedAt,
      stale: false,
    });
    expect(mocks.saveMarketQuoteSnapshot).toHaveBeenCalledWith(liveMarket);
  });

  it('supports a quote-only response without waiting for snapshot persistence', async () => {
    mocks.getMarketData.mockResolvedValue(liveMarket);
    mocks.saveMarketQuoteSnapshot.mockImplementation(() => new Promise(() => {}));
    const response = await GET(
      new Request('http://localhost/api/sjc?company=sjc&product=bar-1l&view=quote'),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).view).toBe('quote');
    expect(mocks.getMarketData).toHaveBeenCalledWith('sjc', 'bar-1l', {
      view: 'quote',
      historyDays: undefined,
    });
  });

  it('supports history-only responses without writing live snapshots', async () => {
    mocks.getMarketData.mockResolvedValue({ ...liveMarket, mode: 'delayed' });
    const response = await GET(
      new Request('http://localhost/api/sjc?company=sjc&product=bar-1l&view=history&range=7N'),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).view).toBe('history');
    expect(mocks.saveMarketQuoteSnapshot).not.toHaveBeenCalled();
    expect(mocks.getMarketData).toHaveBeenCalledWith('sjc', 'bar-1l', {
      view: 'history',
      historyDays: 7,
    });
  });
});
