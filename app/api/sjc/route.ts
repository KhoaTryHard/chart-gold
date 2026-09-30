import { after } from 'next/server';
import { getMarketData, type MarketDataView } from '@/lib/server/sjc';
import {
  isMarketCompanyId,
  isMarketProductId,
} from '@/lib/market-sources';
import {
  getLatestMarketQuoteSnapshot,
  saveMarketQuoteSnapshot,
} from '@/lib/server/market-snapshot';
import { withMarketFetch } from '@/lib/server/market-fetch';

function scheduleAfterResponse(work: () => Promise<void>) {
  try {
    after(work);
  } catch {
    void work().catch(() => undefined);
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const company = params.get('company') ?? params.get('companyId') ?? 'sjc';
  const product = params.get('product');
  const requestedView = params.get('view');
  const view: MarketDataView = requestedView === 'quote' || requestedView === 'history' ? requestedView : 'full';
  const requestedRange = params.get('range');
  const historyDays = requestedRange === '7N' ? 7 : requestedRange === '1T' ? 30 : undefined;
  if (!isMarketCompanyId(company) || (product && !isMarketProductId(company, product))) {
    return Response.json(
      { error: 'Thương hiệu hoặc sản phẩm không hợp lệ.' },
      { status: 400, headers: { 'X-Content-Type-Options': 'nosniff' } },
    );
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(view === 'quote' ? 8_000 : 25_000)]);
  let market = await withMarketFetch(signal, historyDays ?? (view === 'history' ? 30 : 7), () => getMarketData(company, product, { view, historyDays }));
  if (market.mode === 'live' && view !== 'history') {
    scheduleAfterResponse(() => saveMarketQuoteSnapshot(market).catch((error) =>
      console.error(
        '[market-snapshot] save failed',
        error instanceof Error ? error.message : typeof error,
      ),
    ));
  } else if (view !== 'history' && market.availability === 'unavailable') {
    try {
      const snapshot = await getLatestMarketQuoteSnapshot(company, market.product.id);
      if (snapshot) {
        market = {
          ...snapshot.market,
          mode: 'fallback',
          availability: 'available',
          unavailableReason:
            'Nguồn giá hiện chưa phản hồi; đang hiển thị snapshot cùng thương hiệu và sản phẩm.',
        };
      }
    } catch (error) {
      console.error(
        '[market-snapshot] read failed',
        error instanceof Error ? error.message : typeof error,
      );
    }
  }
  const fetchedAt = market.generatedAt;
  const expiresAt = new Date(
    new Date(fetchedAt).getTime() + 240_000,
  ).toISOString();
  const cacheControl =
    view === 'history'
      ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=60'
      : market.mode === 'live'
      ? 'public, max-age=60, s-maxage=240, stale-while-revalidate=60'
      : 'public, max-age=15, s-maxage=30, stale-while-revalidate=30';
  return Response.json({
    ...market,
    view,
    requestedRange: requestedRange === '7N' || requestedRange === '1T' ? requestedRange : null,
    fetchedAt,
    expiresAt,
    stale: market.mode !== 'live',
  }, {
    // A known company with no upstream quote is a valid response. The client
    // uses `availability` to render an explicit unavailable state rather than
    // silently substituting another company's prices.
    status: 200,
    headers: {
      'Cache-Control': cacheControl,
      'Vercel-CDN-Cache-Control':
        view === 'history'
          ? 's-maxage=300, stale-while-revalidate=60'
          : market.mode === 'live'
          ? 's-maxage=240, stale-while-revalidate=60'
          : 's-maxage=30, stale-while-revalidate=30',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}
