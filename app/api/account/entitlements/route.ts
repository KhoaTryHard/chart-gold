import { auth } from '@/auth';
import {
  getBillingUserFromSession,
  getEntitlement,
  BillingError,
} from '@/lib/billing/server';
import {
  databaseConfigured,
  subscriptionSalesEnabled,
  subscriptionsEnabled,
} from '@/lib/billing/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof BillingError)
    return Response.json(
      { error: error.message, code: error.code, ...error.details },
      { status: error.status },
    );
  return Response.json(
    { error: 'Không thể đọc quyền sử dụng AI.' },
    { status: 503 },
  );
}

export async function GET() {
  if (!subscriptionsEnabled())
    return Response.json({
      billingEnabled: false,
      salesEnabled: subscriptionSalesEnabled(),
      entitlement: null,
    });
  if (!databaseConfigured())
    return Response.json(
      { error: 'Billing chưa được cấu hình database.' },
      { status: 503 },
    );
  try {
    const session = await auth();
    const user = await getBillingUserFromSession(session);
    return Response.json({
      billingEnabled: true,
      salesEnabled: subscriptionSalesEnabled(),
      entitlement: await getEntitlement(user),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
