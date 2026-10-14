import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  marketFetch: vi.fn(),
  fetchPnjHistoryPayload: vi.fn(),
}));
vi.mock('@/lib/server/market-fetch', () => ({
  marketFetch: mocks.marketFetch,
  withMarketFetch: (_signal: unknown, _days: number, work: () => unknown) =>
    work(),
}));
vi.mock('@/lib/server/pnj', () => ({
  fetchPnjHistoryPayload: mocks.fetchPnjHistoryPayload,
  PnjHistoryFetchError: class extends Error {
    status = 429;
  },
}));
import { GET } from '@/app/api/market-candles/route';
import { getCandleSource, getMarketCandles } from '@/lib/server/market-candles';
import { PnjHistoryFetchError } from '@/lib/server/pnj';
afterEach(() => {
  vi.clearAllMocks();
});

describe('candle source contract', () => {
  it.each([
    ['sjc', 'bar-1l', 'SJL1L10'],
    ['sjc', 'bar-5c', 'SJL1L10'],
    ['sjc', 'ring-1c', 'SJ9999'],
    ['doji', 'doji-hanoi', 'DOHNL'],
    ['doji', 'doji-hcm', 'DOHCML'],
    ['doji', 'doji-jewelry', 'DOJINHTV'],
    ['baotin', 'baotin-sjc', 'BTSJC'],
    ['baotin', 'baotin-9999', 'BT9999NTT'],
    ['vngold', 'vngold-sjc', 'VNGSJC'],
    ['viettin', 'viettin-sjc', 'VIETTINMSJC'],
    ['btmc', 'btmc-ring', 'BT9999NTT'],
    ['btmc', 'btmc-sjc', 'BTSJC'],
  ])('uses the registered mapping for %s/%s', (company, product, code) => {
    expect(getCandleSource(company, product)).toMatchObject({
      official: false,
      url: `https://www.vang.today/vi/chi-tiet/${code}`,
    });
  });
  it('labels shared SJC references and never swaps PNJ or unsupported sources', () => {
    expect(getCandleSource('sjc', 'bar-5c')?.referenceGroup).toBe('bar');
    expect(getCandleSource('pnj', 'pnj-sjc-hcm')).toMatchObject({
      official: true,
      provider: 'PNJ',
      referenceGroup: null,
    });
    expect(getCandleSource('btmh', 'btmh-kgb')).toBeNull();
    expect(getCandleSource('btmc', 'btmc-bar')).toBeNull();
  });
  it('validates product ownership and supports only 7N/1T without upstream calls', async () => {
    for (const query of [
      'company=pnj&product=bar-1l',
      'range=1N',
      'company=evil',
      'range=bad',
    ]) {
      expect(
        (await GET(new Request(`https://local/api/market-candles?${query}`)))
          .status,
      ).toBe(400);
    }
    expect(mocks.marketFetch).not.toHaveBeenCalled();
  });
  it('deduplicates concurrent requests and returns explicit unavailable coverage on failure', async () => {
    mocks.marketFetch.mockRejectedValue(new Error('private upstream details'));
    const [a, b] = await Promise.all([
      getMarketCandles('sjc', 'bar-1l', '7N'),
      getMarketCandles('sjc', 'bar-1l', '7N'),
    ]);
    expect(mocks.marketFetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a.status).toBe('unavailable');
    expect(a.missingDates).toHaveLength(7);
    expect(JSON.stringify(a)).not.toContain('private');
    await getMarketCandles('sjc', 'bar-1l', '7N');
    expect(mocks.marketFetch).toHaveBeenCalledTimes(1);
  });
  it('returns unsupported without requesting or inventing prices', async () => {
    const res = await GET(
      new Request(
        'https://local/api/market-candles?company=btmh&product=btmh-kgb&range=1T',
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'unsupported',
      records: [],
      source: null,
    });
    expect(mocks.marketFetch).not.toHaveBeenCalled();
  });
  it('bounds PNJ request concurrency and reports missing days', async () => {
    let active = 0;
    let peak = 0;
    mocks.fetchPnjHistoryPayload.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return { locations: [] };
    });
    const response = await getMarketCandles('pnj', 'pnj-hcm', '7N');
    expect(mocks.fetchPnjHistoryPayload).toHaveBeenCalledTimes(7);
    expect(peak).toBeLessThanOrEqual(4);
    expect(response).toMatchObject({ status: 'unavailable', records: [] });
  });
  it('stops backfill on a provider rate limit and requests recent days first', async () => {
    mocks.fetchPnjHistoryPayload.mockRejectedValue(
      new PnjHistoryFetchError('Limited', 429, 60_000),
    );
    const response = await getMarketCandles('pnj', 'pnj-hanoi', '1T');
    expect(mocks.fetchPnjHistoryPayload.mock.calls.length).toBeLessThanOrEqual(
      4,
    );
    expect(mocks.fetchPnjHistoryPayload.mock.calls[0][0]).toBe(
      response.requestedEnd,
    );
    expect(response.status).toBe('unavailable');
  });
});
