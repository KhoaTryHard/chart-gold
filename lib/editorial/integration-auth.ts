import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export class IntegrationError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
export const integrationClient = 'kim-tuyen-newsroom';
export const sha256 = (bytes: string | Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export function integrationSignature(
  key: string,
  method: string,
  path: string,
  timestamp: string,
  body: Uint8Array,
) {
  return createHmac('sha256', key)
    .update([method.toUpperCase(), path, timestamp, sha256(body)].join('\n'))
    .digest('hex');
}
export async function verifyIntegrationRequest(request: Request) {
  if (process.env.HERMES_EDITORIAL_ENABLED !== 'true')
    throw new IntegrationError('Tích hợp chưa bật.', 503);
  const client = request.headers.get('x-editorial-client');
  const timestamp = request.headers.get('x-editorial-timestamp') ?? '';
  const signature = request.headers.get('x-editorial-signature') ?? '';
  const keys = [
    process.env.HERMES_EDITORIAL_SECRET,
    process.env.HERMES_EDITORIAL_NEXT_SECRET,
  ].filter((key): key is string => Boolean(key && key.length >= 32));
  const url = new URL(request.url);
  if (
    client !== integrationClient ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !keys.length
  )
    throw new IntegrationError('Chữ ký dịch vụ không hợp lệ.', 401);
  if (
    url.protocol !== 'https:' &&
    process.env.NODE_ENV !== 'test' &&
    process.env.NODE_ENV !== 'development' &&
    !(
      process.env.HERMES_EDITORIAL_TEST_LOCAL === 'true' &&
      process.env.VERCEL !== '1' &&
      ['localhost', '127.0.0.1'].includes(url.hostname)
    )
  )
    throw new IntegrationError('Cần HTTPS.', 401);
  const limit = 4_400_000;
  if (Number(request.headers.get('content-length') ?? 0) > limit)
    throw new IntegrationError('Payload quá lớn.', 413);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader)
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > limit) {
          await reader.cancel();
          throw new IntegrationError('Payload quá lớn.', 413);
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
  const bytes = Buffer.concat(chunks);
  const valid = keys.some((key) =>
    timingSafeEqual(
      Buffer.from(
        integrationSignature(
          key,
          request.method,
          url.pathname + url.search,
          timestamp,
          bytes,
        ),
        'hex',
      ),
      Buffer.from(signature, 'hex'),
    ),
  );
  if (!valid) throw new IntegrationError('Chữ ký dịch vụ không hợp lệ.', 401);
  return bytes;
}
export function integrationErrorResponse(error: unknown) {
  const status =
    error instanceof IntegrationError
      ? error.status
      : error &&
          typeof error === 'object' &&
          'status' in error &&
          typeof error.status === 'number'
        ? error.status
        : 503;
  return Response.json(
    {
      error:
        status >= 500
          ? 'Dịch vụ chưa sẵn sàng. Thử lại cùng mã gói.'
          : error instanceof Error
            ? error.message
            : 'Yêu cầu không hợp lệ.',
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
