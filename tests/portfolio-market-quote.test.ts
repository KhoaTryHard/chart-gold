import { describe, expect, it } from 'vitest';

import {
  isCalendarDate,
  isPortfolioMarketQuote,
  portfolioPriceVndPerLuongForSave,
  portfolioQuotePriceForSide,
  portfolioUnitPriceFromLuong,
  resolveCurrentPortfolioQuote,
  resolveHistoricalPortfolioQuote,
} from '@/lib/portfolio-market-quote';

const currentCandidate = {
  companyId: 'btmh',
  productId: 'btmh-bt-tkc',
  availability: 'available',
  mode: 'live',
  latest: { date: '2026-09-30', buy: 140, sell: 145 },
  observedAt: '2026-09-30T02:00:00.000Z',
  timestampKind: 'source',
  sourcePublishedAt: '2026-09-30T02:00:00.000Z',
  generatedAt: '2026-09-30T02:01:00.000Z',
  source: {
    provider: 'BTMH official',
    url: 'https://example.test',
    official: true,
  },
};

describe('Sổ vàng market quote helpers', () => {
  it('validates calendar dates and rejects impossible dates', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-9-30')).toBe(false);
  });

  it('uses the dealer sell quote for buys and dealer buy quote for sells', () => {
    expect(
      portfolioQuotePriceForSide(
        { buyVndPerLuong: 140_000_000, sellVndPerLuong: 145_000_000 },
        'buy',
      ),
    ).toBe(145_000_000);
    expect(
      portfolioQuotePriceForSide(
        { buyVndPerLuong: 140_000_000, sellVndPerLuong: 145_000_000 },
        'sell',
      ),
    ).toBe(140_000_000);
  });

  it('converts per-lượng prices to per-chỉ without changing the canonical price', () => {
    expect(portfolioUnitPriceFromLuong(145_000_000, 'chi')).toBe(14_500_000);
    expect(portfolioUnitPriceFromLuong(145_000_000, 'luong')).toBe(145_000_000);
  });

  it('preserves the canonical saved price when an edited per-chỉ value was rounded for display', () => {
    expect(
      portfolioPriceVndPerLuongForSave(15_000_000, 'chi', 150_000_001),
    ).toBe(150_000_001);
    expect(portfolioPriceVndPerLuongForSave(15_000_001, 'chi', null)).toBe(
      150_000_010,
    );
  });

  it('rejects an expired cached current quote in the browser', () => {
    expect(
      isPortfolioMarketQuote(
        {
          companyId: 'btmh',
          productId: 'btmh-kgb',
          requestedDate: '2026-09-30',
          quoteDate: '2026-09-30',
          buyVndPerLuong: 140_000_000,
          sellVndPerLuong: 145_000_000,
          status: 'current',
          source: null,
          observedAt: null,
          expiresAt: '2026-09-30T01:00:00.000Z',
          reason: null,
        },
        'btmh',
        'btmh-kgb',
        '2026-09-30',
      ),
    ).toBe(false);
  });

  it('accepts only a fresh exact live quote for the requested identity and Vietnam date', () => {
    const now = Date.parse('2026-09-30T02:02:00.000Z');
    expect(
      resolveCurrentPortfolioQuote(
        currentCandidate,
        'btmh',
        'btmh-bt-tkc',
        '2026-09-30',
        '2026-09-30',
        now,
      ),
    ).toMatchObject({
      status: 'current',
      buyVndPerLuong: 140_000_000,
      sellVndPerLuong: 145_000_000,
      quoteDate: '2026-09-30',
    });

    for (const changed of [
      { ...currentCandidate, companyId: 'btmc' },
      { ...currentCandidate, productId: 'btmh-kgb' },
      {
        ...currentCandidate,
        latest: { ...currentCandidate.latest, date: '2026-09-29' },
      },
      { ...currentCandidate, mode: 'fallback' },
      { ...currentCandidate, generatedAt: '2026-09-30T01:50:00.000Z' },
      { ...currentCandidate, latest: { ...currentCandidate.latest, sell: 0 } },
      { ...currentCandidate, sourcePublishedAt: '2026-09-29T16:00:00.000Z' },
    ]) {
      expect(
        resolveCurrentPortfolioQuote(
          changed,
          'btmh',
          'btmh-bt-tkc',
          '2026-09-30',
          '2026-09-30',
          now,
        ),
      ).toBeNull();
    }
    expect(
      resolveCurrentPortfolioQuote(
        currentCandidate,
        'btmh',
        'btmh-bt-tkc',
        '2026-09-29',
        '2026-09-30',
        now,
      ),
    ).toBeNull();
  });

  it('returns history only for the exact requested date', () => {
    const exact = resolveHistoricalPortfolioQuote({
      companyId: 'btmh',
      productId: 'btmh-kgb',
      requestedDate: '2026-09-29',
      record: {
        date: '2026-09-29',
        buy: 140_000_000,
        sell: 145_000_000,
      },
      source: { provider: 'BTMH official history', url: null, official: true },
    });
    expect(exact.status).toBe('historical');

    const missing = resolveHistoricalPortfolioQuote({
      companyId: 'btmh',
      productId: 'btmh-kgb',
      requestedDate: '2026-09-29',
      record: {
        date: '2026-09-28',
        buy: 140_000_000,
        sell: 145_000_000,
      },
      source: null,
    });
    expect(missing).toMatchObject({
      status: 'unavailable',
      quoteDate: null,
      buyVndPerLuong: null,
    });
  });
});
