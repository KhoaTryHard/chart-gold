import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  donationsEnabled: vi.fn(),
  getDonationLeaderboard: vi.fn(),
  getDonationSummary: vi.fn(),
}));

vi.mock('@/lib/billing/config', () => ({ donationsEnabled: mocks.donationsEnabled }));
vi.mock('@/lib/billing/server', () => ({
  getDonationLeaderboard: mocks.getDonationLeaderboard,
  getDonationSummary: mocks.getDonationSummary,
}));

import { GET } from '@/app/api/donations/public/route';

const summary = {
  month: '2026-10', donationCount: 1, amountVnd: 20_000,
  operatingCostVnd: null, updatedAt: '2026-10-04T08:00:00.000Z',
};
const rows = [{ rank: 1, displayName: 'Nhà hảo tâm A', amountVnd: 20_000 }];
const request = (query = '') => new Request(`http://localhost/api/donations/public${query}`);

beforeEach(() => {
  mocks.donationsEnabled.mockReturnValue(true);
  mocks.getDonationSummary.mockResolvedValue(summary);
  mocks.getDonationLeaderboard.mockResolvedValue(rows);
});
afterEach(() => vi.resetAllMocks());

describe('donation public snapshot', () => {
  it.each(['', '?period=month', '?period=all'])('combines totals and the requested leaderboard (%s)', async (query) => {
    const period = query.includes('all') ? 'all' : 'month';
    const response = await GET(request(query));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(await response.json()).toEqual({ enabled: true, period, summary, rows });
    expect(mocks.getDonationLeaderboard).toHaveBeenCalledWith(period);
    expect(mocks.getDonationSummary).toHaveBeenCalledOnce();
  });

  it('rejects an invalid period before database reads', async () => {
    const response = await GET(request('?period=week'));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.getDonationSummary).not.toHaveBeenCalled();
    expect(mocks.getDonationLeaderboard).not.toHaveBeenCalled();
  });

  it('returns an uncached disabled snapshot without database access', async () => {
    mocks.donationsEnabled.mockReturnValue(false);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ enabled: false, period: 'month', summary: null, rows: [] });
    expect(mocks.getDonationSummary).not.toHaveBeenCalled();
    expect(mocks.getDonationLeaderboard).not.toHaveBeenCalled();
  });

  it.each(['getDonationSummary', 'getDonationLeaderboard'] as const)('fails the snapshot when %s fails without caching the error', async (name) => {
    mocks[name].mockRejectedValue(new Error('private database failure'));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({
      enabled: true, period: 'month', summary: null, rows: [], error: 'Chưa có số liệu đóng góp.',
    });
  });
});
