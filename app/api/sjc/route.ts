import { getMarketData } from '@/lib/server/sjc';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const market = await getMarketData(
    params.get('company') ?? params.get('companyId') ?? 'sjc',
    params.get('product'),
  );
  return Response.json(market, {
    // A known company with no upstream quote is a valid response. The client
    // uses `availability` to render an explicit unavailable state rather than
    // silently substituting another company's prices.
    status: 200,
    headers: {
      'Cache-Control': 'public, s-maxage=240, stale-while-revalidate=600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
