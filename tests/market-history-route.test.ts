import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAnnualMarketHistory: vi.fn(),
  isHistorySyncCompany: vi.fn((value) =>
    ['sjc', 'pnj', 'btmh'].includes(String(value)),
  ),
  recentHistoryWindow: vi.fn(),
  syncAnnualMarketHistory: vi.fn(),
}));

vi.mock('@/lib/server/market-history', () => mocks);

import { GET as getHistory } from '@/app/api/market-history/route';
import { GET as runCron } from '@/app/api/cron/market-history/route';

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
});

describe('market history routes', () => {
  it('reads only the annual history range', async () => {
    mocks.getAnnualMarketHistory.mockResolvedValue({ status: 'partial' });
    const invalid = await getHistory(
      new Request('http://localhost/api/market-history?range=1T'),
    );
    expect(invalid.status).toBe(400);

    const response = await getHistory(
      new Request(
        'http://localhost/api/market-history?company=pnj&product=pnj-ring-9999&range=1N',
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.getAnnualMarketHistory).toHaveBeenCalledWith(
      'pnj',
      'pnj-ring-9999',
    );
    await getHistory(
      new Request(
        'http://localhost/api/market-history?company=btmh&product=btmh-kgb&range=1N',
      ),
    );
    expect(mocks.getAnnualMarketHistory).toHaveBeenCalledWith(
      'btmh',
      'btmh-kgb',
    );
  });

  it('requires a cron secret and accepts a validated sync range', async () => {
    mocks.recentHistoryWindow.mockReturnValue({
      start: '2026-09-03',
      end: '2026-09-09',
    });
    mocks.syncAnnualMarketHistory.mockResolvedValue({ pnj: {}, sjc: {} });
    const unauthorized = await runCron(
      new Request('http://localhost/api/cron/market-history'),
    );
    expect(unauthorized.status).toBe(401);

    process.env.CRON_SECRET = 'test-history-secret';
    const invalid = await runCron(
      new Request('http://localhost/api/cron/market-history?start=bad', {
        headers: { authorization: 'Bearer test-history-secret' },
      }),
    );
    expect(invalid.status).toBe(400);

    const response = await runCron(
      new Request(
        'http://localhost/api/cron/market-history?start=2025-09-10&end=2026-09-09',
        { headers: { authorization: 'Bearer test-history-secret' } },
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.syncAnnualMarketHistory).toHaveBeenCalledWith(
      '2025-09-10',
      '2026-09-09',
    );
    const selectedBrand = await runCron(
      new Request(
        'http://localhost/api/cron/market-history?company=btmh&start=2025-09-10&end=2026-09-09',
        { headers: { authorization: 'Bearer test-history-secret' } },
      ),
    );
    expect(selectedBrand.status).toBe(200);
    expect(mocks.syncAnnualMarketHistory).toHaveBeenCalledWith(
      '2025-09-10',
      '2026-09-09',
      'btmh',
    );
  });
});
