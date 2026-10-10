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

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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

  it('reports old publication age independently of live mode and emits only sanitized metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-04T08:30:00Z');
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    mocks.getMarketData.mockResolvedValue({
      ...liveMarket,
      generatedAt: '2026-10-04T08:29:00Z',
      timestampKind: 'source',
      sourcePublishedAt: '2026-10-03T00:57:00Z',
      source: { provider: 'secret provider text', url: 'https://example.test/?token=secret', official: true },
    });
    mocks.saveMarketQuoteSnapshot.mockResolvedValue(undefined);
    const response = await GET(new Request('http://localhost/api/sjc?view=quote&token=private'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ mode: 'live', stale: false, freshness: {
      evaluatedAt: '2026-10-04T08:30:00.000Z', recordAgeSeconds: 60, sourceAgeSeconds: 113_580,
    } });
    const emitted = String(log.mock.calls[0][0]);
    expect(JSON.parse(emitted)).toMatchObject({ event: 'market_origin', provider: 'sjc-official', networkRequests: 0 });
    expect(emitted).not.toMatch(/secret|private|token/);
  });

  it('preserves old snapshot timestamps and HTTP compatibility during a fallback', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-04T08:30:00Z');
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.getMarketData.mockResolvedValue({ ...liveMarket, mode: 'unavailable', availability: 'unavailable', latest: null });
    mocks.getLatestMarketQuoteSnapshot.mockResolvedValue({ market: {
      ...liveMarket, generatedAt: '2026-10-03T08:30:00Z', timestampKind: 'source', observedAt: '2026-10-03T08:00:00Z',
    } });
    const response = await GET(new Request('http://localhost/api/sjc?view=quote'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('s-maxage=30');
    expect(await response.json()).toMatchObject({
      mode: 'fallback', availability: 'available', stale: true,
      fetchedAt: '2026-10-03T08:30:00Z', expiresAt: '2026-10-03T08:34:00.000Z',
      freshness: { recordAgeSeconds: 86_400, sourceAgeSeconds: 88_200 },
    });
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ event: 'market_origin', mode: 'fallback' });
  });

  it('keeps a usable quote when a provider returns malformed timing metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-04T08:30:00Z');
    mocks.getMarketData.mockResolvedValue({
      ...liveMarket, fetchedAt: 'invalid', timestampKind: 'source',
      sourcePublishedAt: '2026-10-05T00:00:00Z',
    });
    mocks.saveMarketQuoteSnapshot.mockResolvedValue(undefined);
    const response = await GET(new Request('http://localhost/api/sjc?view=quote'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      fetchedAt: 'invalid', expiresAt: '2026-10-04T08:34:00.000Z',
      freshness: { recordAgeSeconds: null, sourceAgeSeconds: null },
    });
  });

  it('keeps snapshot and unexpected errors out of logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getMarketData.mockResolvedValue({ ...liveMarket, mode: 'unavailable', availability: 'unavailable', latest: null });
    mocks.getLatestMarketQuoteSnapshot.mockRejectedValue(new Error('postgres://password@host?token=private'));
    const response = await GET(new Request('http://localhost/api/sjc?view=quote'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ availability: 'unavailable', stale: true });
    expect(String(log.mock.calls[0][0])).not.toMatch(/password|token|private/);
    mocks.getMarketData.mockRejectedValue(new Error('upstream secret'));
    await expect(GET(new Request('http://localhost/api/sjc?view=quote'))).rejects.toThrow('Market data request failed');
    expect(String(log.mock.calls.at(-1)?.[0])).not.toContain('secret');
  });
});
