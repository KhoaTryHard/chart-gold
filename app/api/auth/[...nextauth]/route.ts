import { handlers } from '@/auth';

export const dynamic = 'force-dynamic';

async function handle(request: Parameters<typeof handlers.GET>[0]) {
  const response = await (request.method === 'GET'
    ? handlers.GET(request)
    : handlers.POST(request));
  // Login callbacks and session responses must never be cached by an upstream proxy.
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('Vercel-CDN-Cache-Control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const GET = handle;
export const POST = handle;
