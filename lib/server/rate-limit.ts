import { createHash } from 'node:crypto';

import { consumeRateLimit } from '@/db';

export type RateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);
}

export function requestAddress(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
}

export function rateLimitKey(scope: string, identity: string) {
  return `${scope}:${hash(identity)}`;
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  try {
    return await consumeRateLimit(key, limit, windowMs);
  } catch (error) {
    console.error(
      '[rate-limit] unavailable',
      error instanceof Error ? error.message : typeof error,
    );
    return { allowed: false, retryAfterMs: 30_000 };
  }
}

export function tooManyRequests(result: RateLimitResult, locale: 'vi' | 'en' = 'vi') {
  return Response.json(
    {
      error: locale === 'en'
        ? 'You are making requests too quickly. Please try again shortly.'
        : 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, Math.ceil(result.retryAfterMs / 1_000))),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
