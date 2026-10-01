import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPortfolioMarketQuote: vi.fn() }));
vi.mock('@/lib/server/portfolio-market-quote', () => mocks);

import { GET } from '@/app/api/market-quote/route';

describe('GET /api/market-quote', () => {
  beforeEach(() => mocks.getPortfolioMarketQuote.mockReset());

  it.each([
    'http://localhost/api/market-quote',
    'http://localhost/api/market-quote?company=wrong&product=bar-1l&date=2026-09-30',
    'http://localhost/api/market-quote?company=btmh&product=btmc-ring&date=2026-09-30',
    'http://localhost/api/market-quote?company=btmh&product=btmh-kgb&date=2026-02-29',
  ])('rejects invalid query parameters: %s', async (url) => {
    const response = await GET(new Request(url));
    expect(response.status).toBe(400);
    expect(mocks.getPortfolioMarketQuote).not.toHaveBeenCalled();
  });

  it('returns the quote contract for an exact company, product, and date', async () => {
    mocks.getPortfolioMarketQuote.mockResolvedValue({
      companyId: 'btmh',
      productId: 'btmh-kgb',
      requestedDate: '2026-09-30',
      quoteDate: '2026-09-30',
      buyVndPerLuong: 140_000_000,
      sellVndPerLuong: 145_000_000,
      status: 'current',
      source: {
        provider: 'BTMH official',
        url: 'https://example.test',
        official: true,
      },
      observedAt: '2026-09-30T02:00:00.000Z',
      expiresAt: '2026-09-30T02:04:00.000Z',
      reason: null,
    });
    const response = await GET(
      new Request(
        'http://localhost/api/market-quote?company=btmh&product=btmh-kgb&date=2026-09-30',
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=240');
    expect(await response.json()).toMatchObject({
      companyId: 'btmh',
      productId: 'btmh-kgb',
      requestedDate: '2026-09-30',
      status: 'current',
      buyVndPerLuong: 140_000_000,
      sellVndPerLuong: 145_000_000,
    });
    expect(mocks.getPortfolioMarketQuote).toHaveBeenCalledWith(
      'btmh',
      'btmh-kgb',
      '2026-09-30',
      expect.any(AbortSignal),
    );
  });
});
