import { z } from 'zod';

import { auth } from '@/auth';
import {
  BillingError,
  createPaymentOrder,
  getBillingUserFromSession,
} from '@/lib/billing/server';
import { BETA_PAID_PLANS, PAID_PLANS, type PaidPlanCode } from '@/lib/billing/plans';
import { checkRateLimit, rateLimitKey, tooManyRequests } from '@/lib/server/rate-limit';
import { readJsonBody, RequestBodyTooLargeError } from '@/lib/server/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const orderSchema = z.object({ plan: z.enum(PAID_PLANS) });

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
  return Response.json(
    { error: 'Không thể tạo đơn thanh toán.' },
    { status: 503 },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 403 });
  try {
    const session = await auth();
    const user = await getBillingUserFromSession(session);
    const minute = await checkRateLimit(
      rateLimitKey('payment-order-minute', user.id),
      5,
      60_000,
    );
    const hour = await checkRateLimit(
      rateLimitKey('payment-order-hour', user.id),
      20,
      60 * 60_000,
    );
    if (!minute.allowed) return tooManyRequests(minute);
    if (!hour.allowed) return tooManyRequests(hour);
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > 20_000)
      return Response.json({ error: 'Payload quá lớn.' }, { status: 413 });
    const parsed = orderSchema.safeParse(await readJsonBody(request, 20 * 1024));
    if (!parsed.success)
      return Response.json(
        { error: 'Gói đăng ký không hợp lệ.', code: 'INVALID_PLAN' },
        { status: 400 },
      );
    if (
      process.env.SUBSCRIPTION_BETA_SINGLE_PLAN !== 'false' &&
      !(BETA_PAID_PLANS as readonly string[]).includes(parsed.data.plan)
    )
      return Response.json(
        { error: 'Gói beta hiện chỉ hỗ trợ một lựa chọn.', code: 'PLAN_NOT_AVAILABLE' },
        { status: 400 },
      );
    return Response.json({
      order: await createPaymentOrder({ user, plan: parsed.data.plan as PaidPlanCode }),
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return Response.json({ error: 'Payload quá lớn.' }, { status: 413 });
    return errorResponse(error);
  }
}
