import { z } from 'zod';

import {
  BillingError,
  ensureSessionUser,
  getDonationOrder,
  updateDonationOrderDetails,
} from '@/lib/billing/server';
import { donationAccessToken } from '@/lib/server/donation-access';
import { readJsonBody, RequestBodyTooLargeError } from '@/lib/server/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid();
const updateSchema = z
  .object({
    token: z.string().trim().min(16).max(128).nullable().optional(),
    isAnonymous: z.boolean(),
    displayName: z.string().trim().max(120).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (!value.isAnonymous && !value.displayName?.trim())
      context.addIssue({
        code: 'custom',
        path: ['displayName'],
        message: 'Vui lòng nhập tên hiển thị hoặc chọn ẩn danh.',
      });
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

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const parsed = idSchema.safeParse(id);
    if (!parsed.success)
      return Response.json(
        { error: 'Mã đơn ủng hộ không hợp lệ.' },
        { status: 400 },
      );
    const accessToken = donationAccessToken(_request);
    let user = null;
    if (!accessToken) {
      const { auth } = await import('@/auth');
      const session = await auth();
      user = session?.user?.email ? await ensureSessionUser(session) : null;
    }
    return Response.json({
      order: await getDonationOrder(parsed.data, user, accessToken),
    });
  } catch (error) {
    if (error instanceof BillingError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    return Response.json(
      { error: 'Không thể đọc trạng thái ủng hộ.' },
      { status: 503 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request))
    return Response.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 403 });
  try {
    const { id } = await context.params;
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success)
      return Response.json(
        { error: 'Mã đơn ủng hộ không hợp lệ.' },
        { status: 400 },
      );
    const parsed = updateSchema.safeParse(
      await readJsonBody(request, 20 * 1024),
    );
    if (!parsed.success)
      return Response.json(
        { error: 'Thông tin hiển thị không hợp lệ.' },
        { status: 400 },
      );
    let user = null;
    const accessToken = donationAccessToken(request) ?? parsed.data.token ?? null;
    if (!accessToken) {
      const { auth } = await import('@/auth');
      const session = await auth();
      user = session?.user?.email ? await ensureSessionUser(session) : null;
    }
    return Response.json({
      order: await updateDonationOrderDetails({
        orderId: parsedId.data,
        accessToken,
        user,
        isAnonymous: parsed.data.isAnonymous,
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
      { error: 'Không thể cập nhật thông tin hiển thị.' },
      { status: 503 },
    );
  }
}
