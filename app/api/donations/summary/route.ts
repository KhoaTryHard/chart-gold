import { getDonationSummary } from '@/lib/billing/server';
import { donationsEnabled } from '@/lib/billing/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!donationsEnabled())
    return Response.json({ enabled: false, summary: null });
  try {
    return Response.json({
      enabled: true,
      summary: await getDonationSummary(),
    });
  } catch {
    return Response.json(
      { enabled: true, summary: null, error: 'Chưa có số liệu đóng góp.' },
      { status: 503 },
    );
  }
}
