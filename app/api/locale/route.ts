import { cookies } from 'next/headers';
import { isLocale, localeCookieName } from '@/lib/i18n';
import { readJsonBody, RequestBodyTooLargeError } from '@/lib/server/body';
import { isTrustedOrigin } from '@/lib/server/origin';

export const dynamic = 'force-dynamic';

const responseHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};

export async function POST(request: Request) {
  if (!isTrustedOrigin(request))
    return Response.json(
      { code: 'INVALID_ORIGIN', error: 'Invalid request.' },
      { status: 403, headers: responseHeaders },
    );

  try {
    const body = await readJsonBody(request, 1024, request.signal);
    const locale =
      body && typeof body === 'object' && 'locale' in body
        ? (body as { locale?: unknown }).locale
        : undefined;
    if (!isLocale(locale))
      return Response.json(
        { code: 'INVALID_LOCALE', error: 'Unsupported locale.' },
        { status: 400, headers: responseHeaders },
      );

    const cookieStore = await cookies();
    const forwardedProtocol = request.headers
      .get('x-forwarded-proto')
      ?.split(',')[0]
      ?.trim();
    cookieStore.set(localeCookieName, locale, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
      sameSite: 'lax',
      secure:
        forwardedProtocol === 'https' ||
        new URL(request.url).protocol === 'https:',
    });
    return Response.json({ locale }, { headers: responseHeaders });
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
    return Response.json(
      { code: 'INVALID_INPUT', error: 'Invalid language preference.' },
      { status, headers: responseHeaders },
    );
  }
}
