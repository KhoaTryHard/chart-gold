import { z } from 'zod';

import { donationsEnabled } from '@/lib/billing/config';
import { getDonationLeaderboard } from '@/lib/billing/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const periodSchema = z.enum(['month', 'all']).default('month');
const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' };

export async function GET(request: Request) {
  if (!donationsEnabled())
    return Response.json(
      { enabled: false, rows: [] },
      { headers: noStoreHeaders },
    );
  const parsedPeriod = periodSchema.safeParse(
    new URL(request.url).searchParams.get('period') ?? undefined,
  );
  if (!parsedPeriod.success)
    return Response.json(
      { error: 'Kỳ xếp hạng không hợp lệ.' },
      { status: 400, headers: noStoreHeaders },
    );
  const period = parsedPeriod.data;
  try {
    const rows = await getDonationLeaderboard(period);
    return Response.json(
      { enabled: true, period, rows },
      {
        headers: noStoreHeaders,
      },
    );
  } catch {
    return Response.json(
      { enabled: true, period, rows: [], error: 'Chưa có bảng xếp hạng.' },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
