import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  donationsEnabled: vi.fn(),
  getDonationLeaderboard: vi.fn(),
}));

vi.mock('@/lib/billing/config', () => ({
  donationsEnabled: mocks.donationsEnabled,
}));
vi.mock('@/lib/billing/server', () => ({
  getDonationLeaderboard: mocks.getDonationLeaderboard,
}));

import { GET } from '@/app/api/donations/leaderboard/route';

afterEach(() => vi.clearAllMocks());

describe('donation leaderboard route', () => {
  it('returns no-store headers so paid donations are visible on the next poll', async () => {
    mocks.donationsEnabled.mockReturnValue(true);
    mocks.getDonationLeaderboard.mockResolvedValue([
      { rank: 1, displayName: 'Nhà hảo tâm A', amountVnd: 100_000 },
    ]);

    const response = await GET(
      new Request(
        'http://localhost:3000/api/donations/leaderboard?period=month',
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(await response.json()).toMatchObject({
      enabled: true,
      period: 'month',
      rows: [{ displayName: 'Nhà hảo tâm A', amountVnd: 100_000 }],
    });
  });

  it('rejects an invalid period without querying the database', async () => {
    mocks.donationsEnabled.mockReturnValue(true);

    const response = await GET(
      new Request(
        'http://localhost:3000/api/donations/leaderboard?period=week',
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.getDonationLeaderboard).not.toHaveBeenCalled();
  });
});
