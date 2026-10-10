import { z } from 'zod';

import { donationsEnabled } from '@/lib/billing/config';
import { getDonationLeaderboard, getDonationSummary } from '@/lib/billing/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const periodSchema = z.enum(['month', 'all']).default('month');
const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' };

export async function GET(request: Request) {
  const parsedPeriod = periodSchema.safeParse(
    new URL(request.url).searchParams.get('period') ?? undefined,
  );
  if (!parsedPeriod.success)
    return Response.json(
      { error: 'Kỳ xếp hạng không hợp lệ.' },
      { status: 400, headers: noStoreHeaders },
    );
  const period = parsedPeriod.data;
  if (!donationsEnabled())
    return Response.json(
      { enabled: false, period, summary: null, rows: [] },
      { headers: noStoreHeaders },
    );

  try {
    const [summary, rows] = await Promise.all([
      getDonationSummary(),
      getDonationLeaderboard(period),
    ]);
    return Response.json(
      { enabled: true, period, summary, rows },
      { headers: noStoreHeaders },
    );
  } catch {
    return Response.json(
      { enabled: true, period, summary: null, rows: [], error: 'Chưa có số liệu đóng góp.' },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
