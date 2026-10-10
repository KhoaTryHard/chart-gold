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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete process.env.CRON_SECRET;
});

describe('market history routes', () => {
  it('logs partial business outcomes independently of HTTP status and omits private details', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('CRON_SECRET', 'private-test-secret');
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.recentHistoryWindow.mockReturnValue({ start: '2026-10-01', end: '2026-10-04' });
    mocks.syncAnnualMarketHistory.mockResolvedValue({ pnj: {
      companyId: 'pnj', status: 'partial', okDays: 2, missingDays: 1, errorDays: 1,
      message: 'private upstream error', rawPayload: { token: 'private-token' },
    } });
    const response = await runCron(new Request('http://localhost/api/cron/market-history', {
      headers: { authorization: 'Bearer private-test-secret' },
    }));
    expect(response.status).toBe(200);
    const emitted = String(log.mock.calls[0][0]);
    expect(JSON.parse(emitted)).toMatchObject({ event: 'market_history_sync', outcomes: [{
      companyId: 'pnj', status: 'partial', okDays: 2, missingDays: 1, errorDays: 1,
    }] });
    expect(emitted).not.toMatch(/private|token|rawPayload/);
  });

  it('keeps unexpected cron error text out of the log and response', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('CRON_SECRET', 'private-test-secret');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.recentHistoryWindow.mockReturnValue({ start: '2026-10-01', end: '2026-10-04' });
    mocks.syncAnnualMarketHistory.mockRejectedValue(new Error('private database connection string'));
    const response = await runCron(new Request('http://localhost/api/cron/market-history', {
      headers: { authorization: 'Bearer private-test-secret' },
    }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
    expect(String(log.mock.calls[0][0])).not.toContain('private');
  });

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
