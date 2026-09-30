import { z } from 'zod';
import { auth } from '@/auth';
import { getBillingUserFromSession } from '@/lib/billing/server';
import { databaseConfigured } from '@/lib/billing/config';
import { recordAnalysisFeedback } from '@/lib/analysis/telemetry';

export const runtime = 'nodejs';

const feedbackSchema = z.object({
  requestId: z.uuid(),
  rating: z.number().int().min(0).max(1),
  reason: z
    .enum(['wrong-data', 'missing-context', 'hard-to-read', 'too-long', 'missing-source', 'slow'])
    .optional(),
});

export async function POST(request: Request) {
  if (!databaseConfigured()) return Response.json({ accepted: false }, { status: 503 });
  const session = await auth();
  if (!session?.user?.email) return Response.json({ error: 'Vui lòng đăng nhập.' }, { status: 401 });
  const parsed = feedbackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Phản hồi không hợp lệ.' }, { status: 400 });
  try {
    const user = await getBillingUserFromSession(session);
    const accepted = await recordAnalysisFeedback({
      ...parsed.data,
      userId: user.id,
    });
    return Response.json({ accepted }, { status: accepted ? 200 : 404 });
  } catch {
    return Response.json({ error: 'Không thể lưu phản hồi.' }, { status: 503 });
  }
}

