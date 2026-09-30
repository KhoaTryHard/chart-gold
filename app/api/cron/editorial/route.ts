import { editorialAutomationStatus } from '@/lib/editorial/qstash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Kept only so an older Vercel cron configuration cannot create an unreviewed
 * article. Editorial work is now signed and scheduled by QStash.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json(
      { error: 'Không có quyền chạy job biên tập.' },
      { status: 401 },
    );
  }
  return Response.json({
    status: 'disabled',
    reason: 'Editorial automation is managed by QStash.',
    automation: editorialAutomationStatus(),
  });
}
