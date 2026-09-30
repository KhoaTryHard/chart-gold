import 'server-only';

import { shiftDate, vietnamDate } from '@/lib/analysis/dates';
import {
  getMarketCompany,
  getMarketProduct,
  getMarketProducts,
  isMarketProductSelectable,
} from '@/lib/market-sources';
import {
  isAnalysisFetch,
  marketFetch,
  marketHistoryDays,
} from '@/lib/server/market-fetch';
import type {
  MarketData,
  MarketDataOptions,
  PricePoint,
} from '@/lib/server/sjc';
import type {
  AggregatedMarketProduct,
  MarketCompany,
} from '@/lib/market-sources';

export const BTMH_PRICE_PAGE = 'https://baotinmanhhai.vn/bang-gia-vang';
export const BTMH_GRAPHQL_URL = 'https://baotinmanhhai.vn/api/graphql';
const BTMH_PROVIDER = 'Bảo Tín Mạnh Hải official';
const BTMH_HISTORY_PROVIDER = 'Bảo Tín Mạnh Hải official history';
const CACHE_TTL_MS = 4 * 60 * 1_000;

const GOLD_RATES_QUERY = `
  query GetBtmhGoldRates($limit: Int) {
    goldRates(limit: $limit) {
      items {
        code
        name
        vendor_name
        buy_price
        sell_price
        unit
        weight
        hl_vang
        last_updated
      }
    }
  }
`;

const GOLD_CHART_QUERY = `
  query GetBtmhGoldChart($code: String!, $from_date: String, $to_date: String, $max_days: Int) {
    goldChartData(code: $code, from_date: $from_date, to_date: $to_date, max_days: $max_days) {
      data_points { date buy sell }
      default_product
    }
  }
`;

export type BtmhProduct = AggregatedMarketProduct & { companyId: 'btmh' };

type BtmhRateRow = {
  code?: unknown;
  name?: unknown;
  vendor_name?: unknown;
  buy_price?: unknown;
  sell_price?: unknown;
  unit?: unknown;
  weight?: unknown;
  last_updated?: unknown;
};

type BtmhGoldRatesPayload = {
  data?: {
    goldRates?: {
      items?: BtmhRateRow[];
    };
  };
  errors?: Array<{ message?: string }>;
};

type BtmhChartPayload = {
  data?: {
    goldChartData?: {
      default_product?: unknown;
      data_points?: Array<{
        date?: unknown;
        buy?: unknown;
        sell?: unknown;
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

export type BtmhQuote = {
  buy: number;
  sell: number;
  observedAt: string;
  provider: string;
  providerUrl: string;
};

export type BtmhHistoryWindow = { start: string; end: string };

const marketCache = new Map<string, { expiresAt: number; data: MarketData }>();
const marketInFlight = new Map<string, Promise<MarketData>>();

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePrice(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '') return null;
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** Convert a published VND/chỉ or VND/lượng unit into lượng. */
export function parseBtmhUnitWeight(value: string | null | undefined) {
  const match = value
    ?.trim()
    .match(/^VND\s*\/\s*(\d+(?:[.,]\d+)?)\s*(chỉ|lượng)$/i);
  if (!match) return null;
  const quantity = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return Number(
    (quantity * (match[2].toLowerCase() === 'chỉ' ? 0.1 : 1)).toFixed(8),
  );
}

export function parseBtmhTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = value.trim();
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)
    ? timestamp
    : `${timestamp.replace(' ', 'T')}+07:00`;
  const instant = new Date(zoned);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
}

export function parseBtmhQuote(
  payload: BtmhGoldRatesPayload,
  product: BtmhProduct,
): BtmhQuote {
  const key = product.officialKey;
  if (!key || product.weightInLuong === null) {
    throw new Error('BTMH product has no verified code or size');
  }
  if (payload.errors?.length) throw new Error('BTMH price query failed');
  const row = payload.data?.goldRates?.items?.find(
    (item) =>
      item.code === key &&
      normalize(
        typeof item.vendor_name === 'string' ? item.vendor_name : '',
      ) === normalize('Công ty cổ phần Bảo Tín Mạnh Hải') &&
      normalize(typeof item.name === 'string' ? item.name : '') ===
        normalize(product.officialMatch ?? ''),
  );
  if (!row) throw new Error('BTMH official price row is missing');

  const unitWeight = parseBtmhUnitWeight(
    typeof row.unit === 'string' ? row.unit : null,
  );
  if (
    unitWeight === null ||
    Math.abs(unitWeight - product.weightInLuong) > 0.000001
  ) {
    throw new Error('BTMH price unit does not match the verified product size');
  }

  const buyVnd = parsePrice(row.buy_price);
  const sellVnd = parsePrice(row.sell_price);
  if (
    buyVnd === null ||
    sellVnd === null ||
    sellVnd <= buyVnd ||
    sellVnd > 500_000_000
  ) {
    throw new Error('BTMH quote does not contain a valid buy and sell price');
  }

  const observedAt = parseBtmhTimestamp(
    typeof row.last_updated === 'string' ? row.last_updated : null,
  );
  if (!observedAt) throw new Error('BTMH price timestamp is invalid');

  return {
    buy: Number((buyVnd / product.weightInLuong / 1_000_000).toFixed(4)),
    sell: Number((sellVnd / product.weightInLuong / 1_000_000).toFixed(4)),
    observedAt,
    provider: BTMH_PROVIDER,
    providerUrl: BTMH_PRICE_PAGE,
  };
}

/** Split a day range at New Year so dd/MM labels always have an exact year. */
export function splitBtmhHistoryWindows(
  start: string,
  end: string,
): BtmhHistoryWindow[] {
  if (start > end) return [];
  const windows: BtmhHistoryWindow[] = [];
  let cursor = start;
  while (cursor <= end) {
    const yearEnd = `${cursor.slice(0, 4)}-12-31`;
    const windowEnd = yearEnd < end ? yearEnd : end;
    windows.push({ start: cursor, end: windowEnd });
    cursor = shiftDate(windowEnd, 1);
  }
  return windows;
}

function parseChartDate(value: string, year: string) {
  const match = value.trim().match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/);
  if (!match) return null;
  return `${match[3] ?? year}-${match[2]}-${match[1]}`;
}

export function parseBtmhHistoryPoints(
  payload: BtmhChartPayload,
  product: BtmhProduct,
  window: BtmhHistoryWindow,
): PricePoint[] {
  const key = product.officialKey;
  if (!key || product.weightInLuong === null) return [];
  if (payload.errors?.length) throw new Error('BTMH history query failed');
  const chart = payload.data?.goldChartData;
  if (
    !chart ||
    chart.default_product !== key ||
    !Array.isArray(chart.data_points)
  ) {
    throw new Error('BTMH returned history for a different product');
  }

  const points = new Map<string, PricePoint>();
  for (const row of chart.data_points) {
    if (typeof row.date !== 'string') continue;
    const date = parseChartDate(row.date, window.start.slice(0, 4));
    if (!date || date < window.start || date > window.end) continue;
    const buyVnd = parsePrice(row.buy);
    const sellVnd = parsePrice(row.sell);
    if (
      buyVnd === null ||
      sellVnd === null ||
      sellVnd <= buyVnd ||
      sellVnd > 500_000_000
    ) {
      continue;
    }
    points.set(
      date,
      toPoint(
        date,
        buyVnd / product.weightInLuong,
        sellVnd / product.weightInLuong,
      ),
    );
  }
  return [...points.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

export function toPoint(
  date: string,
  buyVndPerLuong: number,
  sellVndPerLuong: number,
): PricePoint {
  const buy = Number((buyVndPerLuong / 1_000_000).toFixed(4));
  const sell = Number((sellVndPerLuong / 1_000_000).toFixed(4));
  return {
    date,
    buy,
    sell,
    spread: Number((sell - buy).toFixed(4)),
    eventId: null,
  };
}

async function postGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await marketFetch(
    BTMH_GRAPHQL_URL,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Store: '/bang-gia-vang',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(7_000),
    },
    { cacheReadOnly: true },
  );
  if (!response.ok) throw new Error(`BTMH upstream ${response.status}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') {
    throw new Error('BTMH returned an invalid response');
  }
  return payload as T;
}

export async function fetchBtmhRates() {
  return postGraphql<BtmhGoldRatesPayload>(GOLD_RATES_QUERY, { limit: 50 });
}

export async function fetchBtmhHistory(
  product: BtmhProduct,
  requestedStart: string,
  requestedEnd: string,
) {
  if (!product.officialKey || product.weightInLuong === null) return [];
  const points: PricePoint[] = [];
  for (const window of splitBtmhHistoryWindows(requestedStart, requestedEnd)) {
    const days =
      Math.round(
        (Date.parse(`${window.end}T00:00:00Z`) -
          Date.parse(`${window.start}T00:00:00Z`)) /
          86_400_000,
      ) + 1;
    const payload = await postGraphql<BtmhChartPayload>(GOLD_CHART_QUERY, {
      code: product.officialKey,
      from_date: window.start,
      to_date: window.end,
      max_days: days,
    });
    points.push(...parseBtmhHistoryPoints(payload, product, window));
  }
  return points;
}

function unavailableMarketData(
  company: Extract<MarketCompany, { id: 'btmh' }>,
  product: BtmhProduct,
  reason: string,
): MarketData {
  return {
    mode: 'unavailable',
    availability: 'unavailable',
    unavailableReason: reason,
    company,
    product,
    products: getMarketProducts(company.id),
    records: [],
    latest: null,
    observedAt: new Date().toISOString(),
    source: {
      provider: company.provider,
      url: company.sourceUrl,
      official: true,
    },
    historySource: { provider: 'Chưa có dữ liệu lịch sử khả dụng', url: null },
    generatedAt: new Date().toISOString(),
  };
}

async function loadBtmhMarketData(
  company: Extract<MarketCompany, { id: 'btmh' }>,
  product: BtmhProduct,
  options: MarketDataOptions,
): Promise<MarketData> {
  const view = options.view ?? 'full';
  let quote: BtmhQuote | null = null;
  if (view !== 'history') {
    try {
      quote = parseBtmhQuote(await fetchBtmhRates(), product);
    } catch {
      // A first-party chart point can still serve the product when today's quote is down.
    }
  }

  let history: PricePoint[] = [];
  const isTieuKimCat = product.id === 'btmh-bt-tkc';
  if (view !== 'quote' && !isTieuKimCat && product.weightInLuong !== null) {
    const end = vietnamDate();
    const days = Math.max(
      1,
      Math.min(
        365,
        options.historyDays ?? marketHistoryDays(company.maxHistoryDays),
      ),
    );
    const start = shiftDate(end, 1 - days);
    try {
      history = await fetchBtmhHistory(product, start, end);
    } catch {
      // Keep the live price available if the independent history query fails.
    }
  }

  const merged = new Map(history.map((point) => [point.date, point]));
  if (quote) {
    const date = vietnamDate(new Date(quote.observedAt));
    merged.set(
      date,
      toPoint(date, quote.buy * 1_000_000, quote.sell * 1_000_000),
    );
  }
  const records = [...merged.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-(options.historyDays ?? company.maxHistoryDays));
  const latest = records.at(-1) ?? null;
  if (!latest) {
    return unavailableMarketData(
      company,
      product,
      isTieuKimCat
        ? 'Chưa có lịch sử Tiểu Kim Cát đã xác minh; giá hiện tại chưa tải được.'
        : `Nguồn BTMH hiện không trả dữ liệu hợp lệ cho ${product.label}.`,
    );
  }

  return {
    mode: quote ? 'live' : 'delayed',
    availability: 'available',
    unavailableReason: null,
    company,
    product,
    products: getMarketProducts(company.id),
    records,
    latest,
    observedAt: quote?.observedAt ?? `${latest.date}T12:00:00+07:00`,
    timestampKind: quote ? 'source' : 'retrieval-or-date',
    source: quote
      ? { provider: quote.provider, url: quote.providerUrl, official: true }
      : {
          provider: BTMH_HISTORY_PROVIDER,
          url: BTMH_GRAPHQL_URL,
          official: true,
        },
    historySource: {
      provider: isTieuKimCat
        ? 'Lịch sử Tiểu Kim Cát tích lũy từ ngày tích hợp'
        : `${BTMH_HISTORY_PROVIDER} (tối đa 365 ngày)`,
      url: isTieuKimCat ? null : BTMH_GRAPHQL_URL,
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Fetch BTMH prices only from the matching first-party code and label. */
export async function getBtmhMarketData(
  productId: string | null | undefined,
  options: MarketDataOptions = {},
): Promise<MarketData> {
  const company = getMarketCompany('btmh') as Extract<
    MarketCompany,
    { id: 'btmh' }
  >;
  const product = getMarketProduct(company.id, productId) as BtmhProduct;
  if (!isMarketProductSelectable(product)) {
    return unavailableMarketData(
      company,
      product,
      'unavailableReason' in product && product.unavailableReason
        ? product.unavailableReason
        : 'Sản phẩm BTMH chưa có giá hai chiều và quy cách đã xác minh.',
    );
  }
  if (!('officialKey' in product) || !product.officialKey) {
    return unavailableMarketData(
      company,
      product,
      'Sản phẩm không có mã nguồn chính thức đã xác minh.',
    );
  }

  const view = options.view ?? 'full';
  const days = options.historyDays ?? 'default';
  const key = `${product.id}:${view}:${days}`;
  if (isAnalysisFetch()) return loadBtmhMarketData(company, product, options);
  const cached = marketCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const existing = marketInFlight.get(key);
  if (existing) return existing;
  const pending = loadBtmhMarketData(company, product, options)
    .then((data) => {
      marketCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      return data;
    })
    .finally(() => marketInFlight.delete(key));
  marketInFlight.set(key, pending);
  return pending;
}
