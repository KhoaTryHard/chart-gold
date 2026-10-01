import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  getMarketData: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/db', () => ({ getDatabase: mocks.getDatabase }));
vi.mock('@/lib/server/sjc', () => ({ getMarketData: mocks.getMarketData }));

import { getPortfolioMarketQuote } from '@/lib/server/portfolio-market-quote';

const signal = AbortSignal.timeout(8_000);

function setHistoryRows(rows: Record<string, unknown>[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn().mockResolvedValue(rows),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  mocks.getDatabase.mockReturnValue({
    select: vi.fn(() => query),
  });
}

describe('portfolio market quote service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T02:00:00.000Z'));
    mocks.getDatabase.mockReset();
    mocks.getMarketData.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it('reads an exact BTMH annual history point and preserves source metadata', async () => {
    setHistoryRows([
      {
        companyId: 'btmh',
        productId: 'btmh-kgb',
        date: '2026-09-29',
        buyVndPerLuong: 140_000_000,
        sellVndPerLuong: 145_000_000,
        publishedAt: new Date('2026-09-29T03:00:00.000Z'),
        retrievedAt: new Date('2026-09-29T03:01:00.000Z'),
        provider: 'Bảo Tín Mạnh Hải official history',
        sourceUrl: 'https://baotinmanhhai.vn/api/graphql',
        status: 'ok',
      },
    ]);
    const quote = await getPortfolioMarketQuote(
      'btmh',
      'btmh-kgb',
      '2026-09-29',
      signal,
    );
    expect(quote).toMatchObject({
      companyId: 'btmh',
      productId: 'btmh-kgb',
      requestedDate: '2026-09-29',
      quoteDate: '2026-09-29',
      buyVndPerLuong: 140_000_000,
      sellVndPerLuong: 145_000_000,
      status: 'historical',
      source: { provider: 'Bảo Tín Mạnh Hải official history', official: true },
    });
    expect(mocks.getDatabase).toHaveBeenCalledOnce();
  });

  it('does not fill a missing annual date with an adjacent history record', async () => {
    setHistoryRows([
      {
        companyId: 'btmh',
        productId: 'btmh-kgb',
        date: '2026-09-28',
        buyVndPerLuong: 140_000_000,
        sellVndPerLuong: 145_000_000,
        publishedAt: null,
        retrievedAt: new Date('2026-09-28T03:01:00.000Z'),
        provider: 'BTMH official history',
        sourceUrl: null,
        status: 'ok',
      },
    ]);
    const quote = await getPortfolioMarketQuote(
      'btmh',
      'btmh-kgb',
      '2026-09-29',
      signal,
    );
    expect(quote).toMatchObject({ status: 'unavailable', quoteDate: null });
  });

  it('uses a rolling source only within its supported window and exact date', async () => {
    mocks.getMarketData.mockResolvedValue({
      company: { id: 'btmc' },
      product: { id: 'btmc-ring' },
      records: [
        {
          date: '2026-09-23',
          buy: 140,
          sell: 145,
        },
      ],
      historySource: {
        provider: 'BTMC official history',
        url: 'https://btmc.vn',
      },
      source: { official: true },
    });
    const quote = await getPortfolioMarketQuote(
      'btmc',
      'btmc-ring',
      '2026-09-23',
      signal,
    );
    expect(quote).toMatchObject({
      status: 'historical',
      quoteDate: '2026-09-23',
      buyVndPerLuong: 140_000_000,
      sellVndPerLuong: 145_000_000,
    });
    expect(mocks.getMarketData).toHaveBeenCalledWith('btmc', 'btmc-ring', {
      view: 'history',
      historyDays: 7,
    });
  });

  it('does not query an unsupported rolling history outside its window', async () => {
    const quote = await getPortfolioMarketQuote(
      'btmc',
      'btmc-ring',
      '2026-09-22',
      signal,
    );
    expect(quote.status).toBe('unavailable');
    expect(mocks.getMarketData).not.toHaveBeenCalled();
  });

  it('does not use snapshot-only products for a past date', async () => {
    const quote = await getPortfolioMarketQuote(
      'vgj',
      'vgj-bar-sjc-1l',
      '2026-09-29',
      signal,
    );
    expect(quote.status).toBe('unavailable');
    expect(mocks.getMarketData).not.toHaveBeenCalled();
  });

  it('requires an exact live current quote and never reads a saved snapshot', async () => {
    mocks.getMarketData.mockResolvedValue({
      company: { id: 'btmh' },
      product: { id: 'btmh-kgb' },
      availability: 'available',
      mode: 'fallback',
      latest: { date: '2026-09-30', buy: 140, sell: 145 },
      observedAt: '2026-09-30T02:00:00.000Z',
      generatedAt: '2026-09-30T02:00:00.000Z',
      source: { provider: 'snapshot', url: null, official: false },
    });
    const quote = await getPortfolioMarketQuote(
      'btmh',
      'btmh-kgb',
      '2026-09-30',
      signal,
    );
    expect(quote).toMatchObject({ status: 'unavailable', quoteDate: null });
    expect(mocks.getMarketData).toHaveBeenCalledWith('btmh', 'btmh-kgb', {
      view: 'quote',
    });
  });
});
