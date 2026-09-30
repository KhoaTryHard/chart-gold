const donationTokenPattern = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Query tokens remain a short compatibility path for links created before the
 * header migration. New browser requests always use X-Donation-Token so a
 * token does not enter URLs, referrers or access logs.
 */
export function donationAccessToken(request: Request) {
  const header = request.headers.get('x-donation-token')?.trim() ?? '';
  const legacy = new URL(request.url).searchParams.get('token')?.trim() ?? '';
  const token = header || legacy;
  return donationTokenPattern.test(token) ? token : null;
}
