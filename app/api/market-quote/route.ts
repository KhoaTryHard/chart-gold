import { isMarketCompanyId, isMarketProductId } from '@/lib/market-sources';
import { isCalendarDate } from '@/lib/portfolio-market-quote';
import { getPortfolioMarketQuote } from '@/lib/server/portfolio-market-quote';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const companyId = params.get('company');
  const productId = params.get('product');
  const date = params.get('date');
  if (
    !companyId ||
    !isMarketCompanyId(companyId) ||
    !productId ||
    !isMarketProductId(companyId, productId) ||
    !date ||
    !isCalendarDate(date)
  ) {
    return Response.json(
      { error: 'Thương hiệu, sản phẩm hoặc ngày giao dịch không hợp lệ.' },
      { status: 400, headers: { 'X-Content-Type-Options': 'nosniff' } },
    );
  }

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]);
  const quote = await getPortfolioMarketQuote(
    companyId,
    productId,
    date,
    signal,
  );
  const isCurrent = quote.status === 'current';
  return Response.json(quote, {
    headers: {
      'Cache-Control': isCurrent
        ? 'public, max-age=60, s-maxage=240'
        : quote.status === 'historical'
          ? 'public, max-age=60, s-maxage=240, stale-while-revalidate=60'
          : 'public, max-age=5, s-maxage=5',
      'Vercel-CDN-Cache-Control': isCurrent
        ? 's-maxage=240'
        : quote.status === 'historical'
          ? 's-maxage=240, stale-while-revalidate=60'
          : 's-maxage=5',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}
