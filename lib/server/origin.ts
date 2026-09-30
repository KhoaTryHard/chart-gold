/**
 * Validate a browser Origin without relying on Next's internal request URL.
 * Vercel can expose an internal localhost URL while the browser uses the
 * forwarded public host, which otherwise creates a false CSRF rejection.
 */
export function isTrustedOrigin(request: Request) {
  const rawOrigin = request.headers.get('origin');
  if (!rawOrigin || rawOrigin === 'null') return false;
  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(origin.protocol)) return false;

  const expected = new Set<string>();
  try {
    expected.add(new URL(request.url).origin);
  } catch {
    return false;
  }
  const configuredSite = process.env.SITE_URL?.trim();
  if (configuredSite) {
    try {
      expected.add(new URL(configuredSite).origin);
    } catch {
      // Ignore malformed optional configuration; host validation still applies.
    }
  }
  const forwardedHost =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host')?.trim();
  const forwardedProto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    new URL(request.url).protocol.replace(':', '');
  if (forwardedHost && ['http', 'https'].includes(forwardedProto))
    expected.add(`${forwardedProto}://${forwardedHost}`);
  return expected.has(origin.origin);
}
