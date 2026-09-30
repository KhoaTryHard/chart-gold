import { auth } from '@/auth';
import {
  BillingError,
  getBillingUserFromSession,
  getPaymentOrder,
} from '@/lib/billing/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    const user = await getBillingUserFromSession(session);
    const { id } = await params;
    return Response.json({ order: await getPaymentOrder(user, id) });
  } catch (error) {
    if (error instanceof BillingError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    return Response.json(
      { error: 'Không thể đọc đơn thanh toán.' },
      { status: 503 },
    );
  }
}
