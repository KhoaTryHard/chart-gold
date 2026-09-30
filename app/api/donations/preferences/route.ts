import { z } from 'zod';

import { BillingError, ensureSessionUser } from '@/lib/billing/server';
import { donationOrders } from '@/db/schema';
import { getDatabase } from '@/db';
import { and, eq } from 'drizzle-orm';
import { readJsonBody, RequestBodyTooLargeError } from '@/lib/server/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const preferenceSchema = z.object({
  displayName: z.string().trim().min(1).max(120).nullable().optional(),
  leaderboardOptIn: z.boolean(),
});

export async function PATCH(request: Request) {
  try {
    const { auth } = await import('@/auth');
    const session = await auth();
    if (!session?.user?.email)
      throw new BillingError('UNAUTHENTICATED', 'Vui lòng đăng nhập.', 401);
    const origin = request.headers.get('origin');
    if (!origin || new URL(origin).origin !== new URL(request.url).origin)
      return Response.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 403 });
    const parsed = preferenceSchema.safeParse(
      await readJsonBody(request, 20 * 1024),
    );
    if (!parsed.success)
      return Response.json(
        { error: 'Thông tin hiển thị không hợp lệ.' },
        { status: 400 },
      );
    const user = await ensureSessionUser(session);
    const nextName = parsed.data.leaderboardOptIn
      ? parsed.data.displayName?.trim() || user.name?.trim() || 'Nhà hảo tâm'
      : null;
    await getDatabase()
      .update(donationOrders)
      .set({
        displayName: nextName,
        leaderboardOptIn: parsed.data.leaderboardOptIn,
      })
      .where(
        and(
          eq(donationOrders.userId, user.id),
          eq(donationOrders.status, 'paid'),
        ),
      );
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return Response.json({ error: 'Payload quá lớn.' }, { status: 413 });
    if (error instanceof BillingError)
      return Response.json({ error: error.message }, { status: error.status });
    return Response.json(
      { error: 'Không cập nhật được quyền hiển thị.' },
      { status: 503 },
    );
  }
}
