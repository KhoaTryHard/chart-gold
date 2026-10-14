import { isMarketCompanyId, isMarketProductId } from '@/lib/market-sources';
import { getMarketCandles } from '@/lib/server/market-candles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const company = params.get('company') ?? 'sjc';
  const product = params.get('product') ?? 'bar-1l';
  const range = params.get('range') ?? '1T';
  if (
    !isMarketCompanyId(company) ||
    !isMarketProductId(company, product) ||
    (range !== '7N' && range !== '1T')
  ) {
    return Response.json(
      { error: 'Invalid company, product or range.' },
      { status: 400 },
    );
  }
  const result = await getMarketCandles(company, product, range);
  return Response.json(result, {
    headers: {
      'Cache-Control':
        result.status === 'ready'
          ? 'public, max-age=60, s-maxage=240'
          : 'public, max-age=15, s-maxage=30',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
