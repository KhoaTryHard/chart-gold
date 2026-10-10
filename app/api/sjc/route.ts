import { after } from 'next/server';
import { getMarketData, type MarketData, type MarketDataView } from '@/lib/server/sjc';
import {
  isMarketCompanyId,
  isMarketProductId,
  getMarketCompany,
} from '@/lib/market-sources';
import {
  getLatestMarketQuoteSnapshot,
  saveMarketQuoteSnapshot,
} from '@/lib/server/market-snapshot';
import { createMarketFetchDiagnostics, withMarketFetch } from '@/lib/server/market-fetch';
import { getMarketFreshness } from '@/lib/market-freshness';
import { logMarketEvent, marketFailureKind } from '@/lib/server/market-telemetry';

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
  const startedAt = performance.now();
  const diagnostics = createMarketFetchDiagnostics();
  const identity = {
    route: '/api/sjc',
    companyId: company,
    productId: product,
    view,
    provider: getMarketCompany(company).adapter,
  };
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(view === 'quote' ? 8_000 : 25_000)]);
  let market: MarketData;
  try {
    market = await withMarketFetch(signal, historyDays ?? (view === 'history' ? 30 : 7), () => getMarketData(company, product, { view, historyDays }), diagnostics);
  } catch (error) {
    logMarketEvent('error', 'market_origin', {
      ...identity,
      outcome: marketFailureKind(error),
      durationMs: Math.round(performance.now() - startedAt),
      ...diagnostics,
    });
    // Next logs uncaught errors too; do not forward upstream text to that logger.
    throw new Error('Market data request failed');
  }
  if (market.mode === 'live' && view !== 'history') {
    scheduleAfterResponse(() => saveMarketQuoteSnapshot(market).catch((error) =>
      logMarketEvent('error', 'market_snapshot', {
        ...identity, operation: 'save', outcome: marketFailureKind(error),
      }),
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
      logMarketEvent('error', 'market_snapshot', {
        ...identity, operation: 'read', outcome: marketFailureKind(error),
      });
    }
  }
  const fetchedAt = market.fetchedAt ?? market.generatedAt;
  const freshness = getMarketFreshness(market);
  const fetchedAtMs = Date.parse(fetchedAt);
  const expiresAt = new Date(
    (Number.isFinite(fetchedAtMs) ? fetchedAtMs : Date.parse(freshness.evaluatedAt)) + 240_000,
  ).toISOString();
  const cacheControl =
    view === 'history'
      ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=60'
      : market.mode === 'live'
      ? 'public, max-age=60, s-maxage=240, stale-while-revalidate=60'
      : 'public, max-age=15, s-maxage=30, stale-while-revalidate=30';
  // One origin execution; CDN hits never execute this handler or emit this log.
  logMarketEvent(
    market.mode === 'fallback' || market.availability === 'unavailable' ? 'warn' : 'info',
    'market_origin',
    {
      ...identity,
      productId: market.product.id,
      mode: market.mode,
      availability: market.availability,
      officialSource: market.source.official === true,
      durationMs: Math.round(performance.now() - startedAt),
      ...freshness,
      ...diagnostics,
    },
  );
  return Response.json({
    ...market,
    view,
    requestedRange: requestedRange === '7N' || requestedRange === '1T' ? requestedRange : null,
    fetchedAt,
    expiresAt,
    stale: market.mode !== 'live',
    freshness,
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
