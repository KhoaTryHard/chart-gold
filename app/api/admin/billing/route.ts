import { z } from 'zod';

import { auth } from '@/auth';
import {
  adminGrantSubscription,
  adminConfirmDonation,
  adminRevokeSubscription,
  BillingError,
  getBillingUserFromSession,
  listAdminBilling,
} from '@/lib/billing/server';
import { PAID_PLANS } from '@/lib/billing/plans';
import { readJsonBody, RequestBodyTooLargeError } from '@/lib/server/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const mutationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('grant'),
    email: z.email().max(320),
    plan: z.enum(PAID_PLANS),
  }),
  z.object({
    action: z.literal('revoke'),
    email: z.email().max(320),
  }),
  z.object({
    action: z.literal('confirmDonation'),
    donationId: z.uuid(),
    sepayId: z.coerce.number().int().positive(),
  }),
]);

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

function responseError(error: unknown) {
  if (error instanceof BillingError)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  return Response.json(
    { error: 'Không thể xử lý billing admin.' },
    { status: 503 },
  );
}

export async function GET() {
  try {
    const session = await auth();
    const admin = await getBillingUserFromSession(session);
    return Response.json(await listAdminBilling(admin));
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 403 });
  try {
    const session = await auth();
    const admin = await getBillingUserFromSession(session);
    const parsed = mutationSchema.safeParse(
      await readJsonBody(request, 20 * 1024),
    );
    if (!parsed.success)
      return Response.json(
        { error: 'Thao tác billing không hợp lệ.' },
        { status: 400 },
      );
    if (parsed.data.action === 'grant')
      return Response.json({
        result: await adminGrantSubscription({
          admin,
          email: parsed.data.email,
          plan: parsed.data.plan,
        }),
      });
    return Response.json({
      result:
        parsed.data.action === 'revoke'
          ? await adminRevokeSubscription({ admin, email: parsed.data.email })
          : await adminConfirmDonation({
              admin,
              donationId: parsed.data.donationId,
              sepayId: parsed.data.sepayId,
            }),
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return Response.json({ error: 'Payload quá lớn.' }, { status: 413 });
    return responseError(error);
  }
}
