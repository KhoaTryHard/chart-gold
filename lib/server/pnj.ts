import 'server-only';
import {
  marketFetch as fetch,
  marketHistoryDays,
  isAnalysisFetch,
} from '@/lib/server/market-fetch';

import type { MarketData, MarketDataOptions, PricePoint } from '@/lib/server/sjc';
import {
  getMarketProducts,
  type AggregatedMarketProduct,
  type MarketCompany,
} from '@/lib/market-sources';

/** PNJ's public first-party endpoints used by the dashboard. */
export const PNJ_GOLD_PRICE_URL =
  'https://edge-cf-api.pnj.io/ecom-frontend/v3/get-gold-price';
export const PNJ_GOLD_HISTORY_URL =
  'https://edge-cf-api.pnj.io/ecom-frontend/v1/get-gold-price-history';

const PNJ_HISTORY_CACHE_TTL_MS = 4 * 60 * 1_000;
const PNJ_HISTORY_TIMEOUT_MS = 7_000;

export type PnjCompany = Extract<MarketCompany, { id: 'pnj' }>;
export type PnjProduct = AggregatedMarketProduct & { companyId: 'pnj' };

type PnjPriceRow = {
  name?: string;
  gia_ban?: string | number | null;
  gia_mua?: string | number | null;
  updated_at?: string | null;
};

type PnjCurrentPayload = {
  updated_text?: string;
  locations?: Array<{
    name?: string;
    gold_type?: PnjPriceRow[];
  }>;
};

export type PnjHistoryPayload = {
  locations?: Array<{
    name?: string;
    gold_type?: Array<PnjPriceRow & { data?: PnjPriceRow[] }>;
  }>;
};

type PnjHistoryRow = PnjPriceRow & { data?: PnjPriceRow[] };

export class PnjHistoryFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs: number | null,
  ) {
    super(message);
  }
}

type LiveQuote = {
  timestampKind?: 'source' | 'retrieval-or-date';
  buy: number;
  sell: number;
  observedAt: string;
  provider: string;
  providerUrl: string;
};

const historyCache = new Map<
  string,
  { expiresAt: number; payload: PnjHistoryPayload }
>();
const historyInFlight = new Map<string, Promise<PnjHistoryPayload>>();
const marketCache = new Map<string, { expiresAt: number; data: MarketData }>();
const marketInFlight = new Map<string, Promise<MarketData>>();

function timeoutSignal(milliseconds = PNJ_HISTORY_TIMEOUT_MS) {
  return AbortSignal.timeout(milliseconds);
}

function normalize(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isValidPrice(buy: number, sell: number) {
  return (
    Number.isFinite(buy) &&
    Number.isFinite(sell) &&
    buy > 10 &&
    sell < 500 &&
    buy <= sell
  );
}

function toPoint(date: string, buy: number, sell: number): PricePoint {
  return {
    date,
    buy: Number(buy.toFixed(2)),
    sell: Number(sell.toFixed(2)),
    spread: Number((sell - buy).toFixed(2)),
    eventId: null,
  };
}

function parsePrice(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse PNJ's dd/MM/yyyy HH:mm:ss timestamps as an explicit Vietnam time. */
export function parsePnjTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const match = value
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const [, day, month, year, hour, minute, second = '00'] = match;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}+07:00`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getLocation(
  payload: PnjCurrentPayload | PnjHistoryPayload,
  product: PnjProduct,
) {
  const expectedLocation = normalize(product.officialLocation);
  return payload.locations?.find(
    (location) => normalize(location.name) === expectedLocation,
  );
}

function getCurrentRow(payload: PnjCurrentPayload, product: PnjProduct) {
  const expected = normalize(product.officialMatch);
  return getLocation(payload, product)?.gold_type?.find(
    (row) => normalize(row.name) === expected,
  );
}

function getHistoryRow(payload: PnjHistoryPayload, product: PnjProduct) {
  const expected = normalize(product.officialMatch);
  return getLocation(payload, product)?.gold_type?.find(
    (row) => normalize(row.name) === expected,
  ) as PnjHistoryRow | undefined;
}

/** Convert a current response row into the dashboard's common quote shape. */
export function parsePnjCurrentQuote(
  payload: PnjCurrentPayload,
  product: PnjProduct,
  fallbackObservedAt = new Date().toISOString(),
): LiveQuote {
  const row = getCurrentRow(payload, product);
  const buy = parsePrice(row?.gia_mua);
  const sell = parsePrice(row?.gia_ban);
  if (buy === null || sell === null || !isValidPrice(buy, sell)) {
    throw new Error('PNJ quote is incomplete or invalid');
  }
  return {
    buy,
    sell,
    observedAt: parsePnjTimestamp(row?.updated_at) ?? fallbackObservedAt,
    timestampKind: parsePnjTimestamp(row?.updated_at)
      ? 'source'
      : 'retrieval-or-date',
    provider: 'PNJ official',
    providerUrl: PNJ_GOLD_PRICE_URL,
  };
}

/**
 * Pick the last complete intraday row from PNJ's date-specific history API.
 * The API returns all products in one response, so history requests are shared
 * across every PNJ filter in the dashboard.
 */
export function parsePnjHistoryEntry(
  payload: PnjHistoryPayload,
  product: PnjProduct,
  date: string,
): { point: PricePoint; observedAt: string; raw: PnjPriceRow } | null {
  const data = getHistoryRow(payload, product)?.data ?? [];
  const candidates: Array<{
    point: PricePoint;
    observedAt: string;
    raw: PnjPriceRow;
  }> =
    data.flatMap((row) => {
      const buy = parsePrice(row.gia_mua);
      const sell = parsePrice(row.gia_ban);
      if (buy === null || sell === null || !isValidPrice(buy, sell)) return [];
      const observedAt =
        parsePnjTimestamp(row.updated_at) ?? `${date}T12:00:00+07:00`;
      if (observedAt.slice(0, 10) !== date) return [];
      return [
        {
          point: toPoint(date, buy, sell),
          observedAt,
          raw: row,
        },
      ];
    });
  candidates.sort((left, right) =>
    left.observedAt.localeCompare(right.observedAt),
  );
  return candidates.at(-1) ?? null;
}

export function parsePnjHistoryPoint(
  payload: PnjHistoryPayload,
  product: PnjProduct,
  date: string,
): PricePoint | null {
  return parsePnjHistoryEntry(payload, product, date)?.point ?? null;
}

async function fetchPnjCurrentQuote(product: PnjProduct): Promise<LiveQuote> {
  const response = await fetch(PNJ_GOLD_PRICE_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'KimTuyen-MarketView/1.0',
    },
    signal: timeoutSignal(),
  });
  if (!response.ok) throw new Error(`PNJ upstream ${response.status}`);
  return parsePnjCurrentQuote(
    (await response.json()) as PnjCurrentPayload,
    product,
  );
}

export async function fetchPnjHistoryPayload(date: string) {
  const cached = historyCache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  const existing = historyInFlight.get(date);
  if (existing && !isAnalysisFetch()) return existing;

  const dateToken = date.replace(/-/g, '');
  const url = `${PNJ_GOLD_HISTORY_URL}?date=${encodeURIComponent(dateToken)}`;
  const pending = fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'KimTuyen-MarketView/1.0',
    },
    signal: timeoutSignal(),
  })
    .then(async (response) => {
      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        const retryAfterMs = retryAfter
          ? Math.max(0, Number(retryAfter) * 1_000) || null
          : response.status === 429
            ? 60_000
            : null;
        throw new PnjHistoryFetchError(
          `PNJ history upstream ${response.status}`,
          response.status,
          retryAfterMs,
        );
      }
      const payload = (await response.json()) as PnjHistoryPayload;
      historyCache.set(date, {
        payload,
        expiresAt: Date.now() + PNJ_HISTORY_CACHE_TTL_MS,
      });
      return payload;
    })
    .finally(() => {
      historyInFlight.delete(date);
    });
  historyInFlight.set(date, pending);
  return pending;
}

function vietnamDate(instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function previousDates(days: number) {
  const base = new Date(`${vietnamDate()}T00:00:00Z`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(base);
    date.setUTCDate(date.getUTCDate() - index - 1);
    return date.toISOString().slice(0, 10);
  });
}

async function fetchPnjHistory(
  product: PnjProduct,
  maxHistoryDays: number,
  requestedDays?: number,
): Promise<PricePoint[]> {
  const dates = previousDates(
    requestedDays === undefined
      ? marketHistoryDays(Math.max(0, maxHistoryDays - 1))
      : Math.max(0, Math.min(maxHistoryDays - 1, requestedDays - 1)),
  );
  const responses = await Promise.allSettled(
    dates.map(async (date) => {
      const payload = await fetchPnjHistoryPayload(date);
      const point = parsePnjHistoryPoint(payload, product, date);
      if (!point) throw new Error('PNJ history quote is incomplete or invalid');
      return point;
    }),
  );
  return responses.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
}

function unavailableMarketData(
  company: PnjCompany,
  product: PnjProduct,
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
      official: false,
    },
    historySource: {
      provider: 'Chưa có dữ liệu lịch sử khả dụng',
      url: null,
    },
    generatedAt: new Date().toISOString(),
  };
}

async function loadPnjMarketData(
  company: PnjCompany,
  product: PnjProduct,
  options: MarketDataOptions = {},
): Promise<MarketData> {
  const view = options.view ?? 'full';
  let quote: LiveQuote | null = null;
  if (view !== 'history') {
    try {
      quote = await fetchPnjCurrentQuote(product);
    } catch {
    // Keep trying the official history endpoint if only the live snapshot is
    // temporarily unavailable.
    }
  }

  let history: PricePoint[] = [];
  if (view !== 'quote') {
    try {
      history = await fetchPnjHistory(product, company.maxHistoryDays, options.historyDays);
    } catch {
    // A live quote remains useful when a date-specific history request fails.
    }
  }

  const merged = new Map<string, PricePoint>();
  for (const point of history) merged.set(point.date, point);
  if (quote) {
    const date = vietnamDate(new Date(quote.observedAt));
    merged.set(date, toPoint(date, quote.buy, quote.sell));
  }
  const records = [...merged.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-(options.historyDays ?? company.maxHistoryDays));
  const latest = records.at(-1) ?? null;
  if (!latest) {
    return unavailableMarketData(
      company,
      product,
      `Nguồn PNJ hiện không trả dữ liệu cho ${product.label}. Không có snapshot thay thế để tránh hiển thị giá không xác thực.`,
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
    timestampKind: quote?.timestampKind ?? 'retrieval-or-date',
    source: quote
      ? {
          provider: quote.provider,
          url: quote.providerUrl,
          official: true,
        }
      : {
          provider: 'PNJ official (history)',
          url: PNJ_GOLD_HISTORY_URL,
          official: true,
        },
    historySource: {
      provider: `PNJ official history (tối đa ${company.maxHistoryDays} ngày)`,
      url: PNJ_GOLD_HISTORY_URL,
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Load PNJ data with the same short cache/in-flight guard as other sources. */
export async function getPnjMarketData(
  company: PnjCompany,
  product: PnjProduct,
  options: MarketDataOptions = {},
): Promise<MarketData> {
  const key = `${company.id}:${product.id}:${options.view ?? 'full'}:${options.historyDays ?? 'default'}`;
  if (isAnalysisFetch()) return loadPnjMarketData(company, product, options);
  const cached = marketCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const existing = marketInFlight.get(key);
  if (existing) return existing;
  const pending = loadPnjMarketData(company, product, options)
    .then((data) => {
      marketCache.set(key, {
        data,
        expiresAt: Date.now() + PNJ_HISTORY_CACHE_TTL_MS,
      });
      return data;
    })
    .finally(() => {
      marketInFlight.delete(key);
    });
  marketInFlight.set(key, pending);
  return pending;
}
