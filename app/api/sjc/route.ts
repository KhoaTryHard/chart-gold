import { getSjcMarketData } from '@/lib/server/sjc';

export async function GET(request: Request) {
  const market = await getSjcMarketData(
    new URL(request.url).searchParams.get('product'),
  );
  return Response.json(market, {
    status: market.records.length > 0 ? 200 : 503,
    headers: {
      'Cache-Control': 'public, s-maxage=240, stale-while-revalidate=600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
