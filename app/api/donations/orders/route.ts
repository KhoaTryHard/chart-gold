import { z } from 'zod';
import type { Session } from 'next-auth';

import {
  BillingError,
  createDonationOrder,
  ensureSessionUser,
} from '@/lib/billing/server';
import {
  checkRateLimit,
  rateLimitKey,
  requestAddress,
  tooManyRequests,
} from '@/lib/server/rate-limit';
import { readJsonBody, RequestBodyTooLargeError } from '@/lib/server/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const donationSchema = z
  .object({
    amountVnd: z.coerce.number().int().min(1_000).max(10_000_000),
    isAnonymous: z.boolean().default(true),
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

function errorResponse(error: unknown) {
  if (error instanceof BillingError)
    return Response.json(
      { error: error.message, code: error.code, ...error.details },
      { status: error.status },
    );
  console.error(
    '[donation-order] unexpected create error',
    error instanceof Error ? error.message : typeof error,
  );
  return Response.json(
    { error: 'Không thể tạo mã QR ủng hộ.' },
    { status: 503 },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 403 });
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 20_000)
    return Response.json({ error: 'Payload quá lớn.' }, { status: 413 });
  try {
    const minute = await checkRateLimit(
      rateLimitKey('donation-order-minute', requestAddress(request)),
      5,
      60_000,
    );
    const hour = await checkRateLimit(
      rateLimitKey('donation-order-hour', requestAddress(request)),
      20,
      60 * 60_000,
    );
    if (!minute.allowed) return tooManyRequests(minute);
    if (!hour.allowed) return tooManyRequests(hour);
    const parsed = donationSchema.safeParse(
      await readJsonBody(request, 20 * 1024),
    );
    if (!parsed.success)
      return Response.json(
        {
          error: 'Thông tin ủng hộ không hợp lệ.',
          code: 'INVALID_DONATION_AMOUNT',
        },
        { status: 400 },
      );
    let user = null;
    if (!parsed.data.isAnonymous) {
      let session: Session | null = null;
      try {
        const { auth } = await import('@/auth');
        session = await auth();
      } catch {
        // Public donations do not depend on Google sign-in.
      }
      if (session?.user?.email) user = await ensureSessionUser(session);
    }
    return Response.json({
      order: await createDonationOrder(
        user ? { ...parsed.data, userId: user.id } : parsed.data,
      ),
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return Response.json({ error: 'Payload quá lớn.' }, { status: 413 });
    return errorResponse(error);
  }
}
