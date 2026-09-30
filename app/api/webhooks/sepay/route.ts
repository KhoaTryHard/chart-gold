import { BillingError, processSepayTransaction } from '@/lib/billing/server';
import { donationsEnabled, subscriptionsEnabled } from '@/lib/billing/config';
import {
  sepayWebhookPayloadSchema,
  verifySepaySignature,
} from '@/lib/billing/sepay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Browser-friendly health check; transaction deliveries must use POST. */
export async function GET() {
  return Response.json({
    ok: true,
    endpoint: 'sepay-webhook',
    method: 'POST',
    configured: Boolean(process.env.SEPAY_WEBHOOK_SECRET?.trim()),
  });
}

export async function POST(request: Request) {
  if (!subscriptionsEnabled() && !donationsEnabled())
    return Response.json({ success: true, status: 'disabled' });
  const secret = process.env.SEPAY_WEBHOOK_SECRET?.trim();
  if (!secret)
    return Response.json(
      { success: false, error: 'Webhook chưa cấu hình.' },
      { status: 503 },
    );
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 1_000_000)
    return Response.json(
      { success: false, error: 'Payload quá lớn.' },
      { status: 413 },
    );
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000)
    return Response.json(
      { success: false, error: 'Payload quá lớn.' },
      { status: 413 },
    );
  if (!verifySepaySignature(rawBody, request.headers, secret))
    return Response.json(
      { success: false, error: 'Chữ ký không hợp lệ.' },
      { status: 401 },
    );
  let input: unknown;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return Response.json(
      { success: false, error: 'JSON không hợp lệ.' },
      { status: 400 },
    );
  }
  const parsed = sepayWebhookPayloadSchema.safeParse(input);
  if (!parsed.success) {
    console.error(
      '[sepay-webhook] payload validation failed',
      parsed.error.issues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    );
    return Response.json(
      { success: false, error: 'Payload giao dịch không hợp lệ.' },
      { status: 400 },
    );
  }
  if (parsed.data.id === 0) {
    // Dashboard "Gửi thử" events are synthetic and must not create a ledger row.
    return Response.json({ success: true });
  }
  try {
    await processSepayTransaction({
      payload: parsed.data,
      rawBody,
    });
    // SePay requires a 2xx response with the exact success flag to stop retries.
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof BillingError)
      return Response.json(
        { success: false, error: error.message },
        { status: error.status },
      );
    // A transient database error should make SePay retry the delivery.
    return Response.json(
      { success: false, error: 'Chưa xử lý được giao dịch.' },
      { status: 503 },
    );
  }
}
