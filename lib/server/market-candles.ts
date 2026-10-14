import 'server-only';
import { getMarketProduct } from '@/lib/market-sources';
import {
  enumerateCalendarDates,
  getCalendarWindow,
} from '@/lib/market-history';
import {
  candleCoverage,
  parsePnjCandle,
  parseVangTodayCandles,
  type CandleRange,
  type CandleSource,
  type MarketCandle,
  type MarketCandlesResponse,
} from '@/lib/market-candles';
import { marketFetch, withMarketFetch } from '@/lib/server/market-fetch';
import { fetchPnjHistoryPayload, PnjHistoryFetchError } from '@/lib/server/pnj';

const CODES = new Set([
  'SJL1L10',
  'SJ9999',
  'DOHNL',
  'DOHCML',
  'DOJINHTV',
  'BTSJC',
  'BT9999NTT',
  'VNGSJC',
  'VIETTINMSJC',
]);
const cache = new Map<
  string,
  { until: number; value: MarketCandlesResponse }
>();
const pending = new Map<string, Promise<MarketCandlesResponse>>();
const sourceRequests = new Map<string, Promise<unknown>>();

function sharedSource<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = sourceRequests.get(key);
  if (existing) return existing as Promise<T>;
  const request = fetcher().finally(() => sourceRequests.delete(key));
  sourceRequests.set(key, request);
  return request;
}

export function getCandleSource(
  companyId: string,
  productId: string,
): CandleSource | null {
  const product = getMarketProduct(companyId, productId);
  if (
    companyId === 'pnj' &&
    'officialLocation' in product &&
    product.officialMatch
  ) {
    return {
      provider: 'PNJ',
      url: 'https://www.pnj.com.vn/blog/gia-vang/',
      official: true,
      referenceGroup: null,
    };
  }
  const code =
    product.upstreamCode ??
    ('fallbackUpstreamCode' in product ? product.fallbackUpstreamCode : null);
  if (!code || !CODES.has(code)) return null;
  return {
    provider: 'Vàng.Today',
    url: `https://www.vang.today/vi/chi-tiet/${code}`,
    official: false,
    referenceGroup:
      companyId === 'sjc' ? (code === 'SJL1L10' ? 'bar' : 'ring') : null,
  };
}

async function load(
  companyId: string,
  productId: string,
  range: CandleRange,
): Promise<MarketCandlesResponse> {
  const { start, end } = getCalendarWindow(range === '7N' ? 7 : 30);
  const source = getCandleSource(companyId, productId);
  const result: MarketCandlesResponse = {
    companyId,
    productId,
    range,
    source,
    status: 'unsupported',
    unit: 'million-vnd-per-luong',
    requestedStart: start,
    requestedEnd: end,
    records: [],
    missingDates: enumerateCalendarDates(start, end),
    updatedAt: null,
  };
  if (!source) return result;
  const signal = AbortSignal.timeout(25_000);
  let records: MarketCandle[] = [];
  try {
    records = await withMarketFetch(
      signal,
      range === '7N' ? 7 : 30,
      async () => {
        if (companyId !== 'pnj') {
          return sharedSource(source.url, async () => {
            const response = await marketFetch(source.url, {
              headers: { Accept: 'text/html' },
              redirect: 'error',
            });
            if (!response.ok) throw new Error('Candle source unavailable');
            // Do not accept a redirect to a different product or the home page.
            if (
              response.url &&
              new URL(response.url).pathname !== new URL(source.url).pathname
            )
              throw new Error('Unexpected candle source');
            return parseVangTodayCandles(await response.text());
          });
        }
        const product = getMarketProduct(companyId, productId);
        if (
          !('officialLocation' in product) ||
          !product.officialLocation ||
          !product.officialMatch
        )
          return [];
        // Prioritize recent observations if the provider rate-limits a backfill.
        const days = enumerateCalendarDates(start, end).reverse();
        const collected: MarketCandle[] = [];
        let index = 0;
        let rateLimited = false;
        await Promise.all(
          Array.from({ length: 4 }, async () => {
            while (index < days.length && !signal.aborted && !rateLimited) {
              const date = days[index++];
              try {
                const payload = await sharedSource(`pnj:${date}`, () =>
                  fetchPnjHistoryPayload(date, true),
                );
                const candle = parsePnjCandle(
                  payload,
                  product.officialLocation!,
                  product.officialMatch!,
                  date,
                );
                if (candle) collected.push(candle);
              } catch (error) {
                if (
                  error instanceof PnjHistoryFetchError &&
                  error.status === 429
                )
                  rateLimited = true;
                /* Missing days remain explicit in coverage. */
              }
            }
          }),
        );
        return collected;
      },
    );
  } catch {
    /* The client can retain its independent daily line history. */
  }
  result.records = records
    .filter((row) => row.date >= start && row.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
  result.missingDates = candleCoverage(result.records, start, end);
  result.status = !result.records.length
    ? 'unavailable'
    : result.missingDates.length
      ? 'partial'
      : 'ready';
  result.updatedAt = result.records.at(-1)?.updatedAt ?? null;
  return result;
}

export function getMarketCandles(
  companyId: string,
  productId: string,
  range: CandleRange,
) {
  const key = `${companyId}:${productId}:${range}`;
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.value);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = load(companyId, productId, range)
    .then((value) => {
      for (const [entry, item] of cache)
        if (item.until <= Date.now()) cache.delete(entry);
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(key, {
        until: Date.now() + (value.status === 'unavailable' ? 30_000 : 240_000),
        value,
      });
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
