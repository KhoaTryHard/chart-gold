import { z } from 'zod';

import {
  BillingError,
  createReplacementDonationOrder,
  ensureSessionUser,
} from '@/lib/billing/server';
import { donationAccessToken } from '@/lib/server/donation-access';
import { readJsonBody, RequestBodyTooLargeError } from '@/lib/server/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  token: z.string().trim().min(16).max(128).nullable().optional(),
  displayName: z.string().trim().min(1).max(120),
});

function sameOrigin(request: Request) {
  try {
    const origin = request.headers.get('origin');
    return Boolean(
      origin && new URL(origin).origin === new URL(request.url).origin,
    );
  } catch {
    return false;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request))
    return Response.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 403 });
  try {
    const { auth } = await import('@/auth');
    const session = await auth();
    if (!session?.user?.email)
      throw new BillingError(
        'UNAUTHENTICATED',
        'Vui lòng đăng nhập để công khai tên.',
        401,
      );
    const parsed = bodySchema.safeParse(
      await readJsonBody(request, 20 * 1024),
    );
    if (!parsed.success)
      return Response.json(
        { error: 'Tên hiển thị không hợp lệ.' },
        { status: 400 },
      );
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return Response.json({ error: 'Mã đơn không hợp lệ.' }, { status: 400 });
    const user = await ensureSessionUser(session);
    return Response.json({
      order: await createReplacementDonationOrder({
        orderId: id,
        accessToken: donationAccessToken(request) ?? parsed.data.token ?? null,
        user,
        displayName: parsed.data.displayName,
      }),
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return Response.json({ error: 'Payload quá lớn.' }, { status: 413 });
    if (error instanceof BillingError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    return Response.json(
      { error: 'Không thể tạo mã QR mới.' },
      { status: 503 },
    );
  }
}
