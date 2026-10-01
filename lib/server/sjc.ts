import 'server-only';
import {
  marketFetch as fetch,
  marketHistoryDays,
  isAnalysisFetch,
} from '@/lib/server/market-fetch';

import fallbackDataset from '@/lib/sjc-data.json';
import {
  getPnjMarketData,
  type PnjCompany,
  type PnjProduct,
} from '@/lib/server/pnj';
import { getVgjMarketData } from '@/lib/server/vgj';
import { getBtmhMarketData } from '@/lib/server/btmh';
import type { SjcProduct } from '@/lib/sjc-products';
import {
  getMarketCompany,
  getMarketProduct,
  getMarketProducts,
  type MarketProduct,
} from '@/lib/market-sources';

export type PricePoint = {
  date: string;
  buy: number;
  sell: number;
  spread: number;
  eventId: null;
};

type LiveQuote = {
  timestampKind?: 'source' | 'retrieval-or-date';
  buy: number;
  sell: number;
  observedAt: string;
  provider: string;
  providerUrl: string;
};

type BtmcProduct = MarketProduct & { companyId: 'btmc' };
type PhuQuyProduct = MarketProduct & { companyId: 'phuquy' };

export type MarketDataMode = 'live' | 'delayed' | 'fallback' | 'unavailable';

export type MarketAvailability = 'available' | 'unavailable';

export type MarketData = {
  timestampKind?: 'source' | 'retrieval-or-date';
  mode: MarketDataMode;
  availability: MarketAvailability;
  unavailableReason: string | null;
  company: ReturnType<typeof getMarketCompany>;
  product: MarketProduct;
  products: readonly MarketProduct[];
  records: PricePoint[];
  latest: PricePoint | null;
  observedAt: string;
  source: { provider: string; url: string | null; official: boolean };
  historySource: { provider: string; url: string | null };
  generatedAt: string;
  /** Time the application fetched or generated this normalized record. */
  fetchedAt?: string;
  /** Upstream publication time when the source explicitly provides one. */
  sourcePublishedAt?: string;
};

export type MarketDataView = 'full' | 'quote' | 'history';
export type MarketDataOptions = {
  view?: MarketDataView;
  historyDays?: number;
};

const OFFICIAL_SJC_URL = 'https://sjc.com.vn/xml/tygiavang.xml';
const VANG_TODAY_API = 'https://www.vang.today/api/prices';
export const SJC_HISTORY_CSV_URL =
  'https://raw.githubusercontent.com/vkhuy/SJC-price/main/docs/data/sjc_final.csv';
const VANG_TODAY_HISTORY_DAYS = 30;
const BTMC_GOLD_DATE_API = 'https://btmc.vn/ProductHome/getGoldDate';
const BTMC_PRICE_PAGE = 'https://btmc.vn/Home/BGiaVang';
const PHU_QUY_PRICE_PAGE = 'https://gold.phuquy.com.vn/giavang';
const PHU_QUY_HISTORY_PAGE = 'https://gold.phuquy.com.vn/XemLai';
const OFFICIAL_HISTORY_DAYS = 7;
const FIRST_PARTY_CACHE_TTL_MS = 4 * 60 * 1_000;

const firstPartyMarketCache = new Map<
  string,
  { expiresAt: number; data: MarketData }
>();
const firstPartyMarketInFlight = new Map<string, Promise<MarketData>>();
const btmcHistoryPayloadCache = new Map<
  string,
  { expiresAt: number; payload: BtmcHistoryPayload }
>();
const btmcHistoryPayloadInFlight = new Map<
  string,
  Promise<BtmcHistoryPayload>
>();
const phuQuyHistoryHtmlCache = new Map<
  string,
  { expiresAt: number; html: string }
>();
const phuQuyHistoryHtmlInFlight = new Map<string, Promise<string>>();

function timeoutSignal(milliseconds = 7_000) {
  return AbortSignal.timeout(milliseconds);
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

function vietnamDate(instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function normalizeOfficialName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

async function fetchOfficialQuote(product: SjcProduct): Promise<LiveQuote> {
  const response = await fetch(OFFICIAL_SJC_URL, {
    headers: {
      Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'KimTuyen-SJC-MarketView/1.0',
    },
    signal: timeoutSignal(),
  });
  if (!response.ok) throw new Error(`SJC upstream ${response.status}`);

  const xml = await response.text();
  const tags = xml.match(/<item\b[^>]*>/gi) ?? [];
  const normalizedMatch = normalizeOfficialName(product.officialMatch);
  const tag = tags.find((item) => {
    const type = item.match(/\btype=["']([^"']+)["']/i)?.[1] ?? '';
    return normalizeOfficialName(type).includes(normalizedMatch);
  });
  if (!tag) throw new Error('SJC product not found');

  const buyValue = tag.match(/\bbuy=["']([^"']+)["']/i)?.[1];
  const sellValue = tag.match(/\bsell=["']([^"']+)["']/i)?.[1];
  if (!buyValue || !sellValue) throw new Error('SJC quote is incomplete');

  const buy = Number(buyValue.replace(/[.,]/g, '')) / 1_000;
  const sell = Number(sellValue.replace(/[.,]/g, '')) / 1_000;
  if (!isValidPrice(buy, sell)) throw new Error('SJC quote is invalid');

  return {
    buy,
    sell,
    observedAt: new Date().toISOString(),
    provider: 'SJC',
    providerUrl: 'https://sjc.com.vn/bieu-do-gia-vang',
  };
}

function previousDates(days: number) {
  const today = vietnamDate();
  const base = new Date(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(base);
    date.setUTCDate(date.getUTCDate() - index - 1);
    return date.toISOString().slice(0, 10);
  });
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value
    .replace(/&#(x[\da-f]+|\d+);/gi, (_match, code: string) => {
      const radix = code.toLowerCase().startsWith('x') ? 16 : 10;
      const digits = radix === 16 ? code.slice(1) : code;
      const point = Number.parseInt(digits, radix);
      return Number.isFinite(point) ? String.fromCodePoint(point) : '';
    })
    .replace(
      /&([a-z]+);/gi,
      (_match, name: string) => named[name.toLowerCase()] ?? '',
    );
}

function stripHtml(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseWholeNumber(value: string | null | undefined) {
  if (!value) return null;
  const digits = stripHtml(value).replace(/[^\d]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

type OfficialTableRow = {
  label: string;
  buy: number | null;
  sell: number | null;
};

function parseOfficialTableRows(html: string): OfficialTableRow[] {
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  return rows.flatMap((row) => {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => stripHtml(match[1]),
    );
    if (cells.length < 3) return [];
    // BTMC prepends a logo cell with rowspan; Phú Quý does not. Select the
    // first textual product cell instead of assuming it is cells[0].
    const label = cells.find(
      (cell) =>
        /[^\d\s.,]/.test(cell) && !/^\(?\d+(?:[.,]\d+)?k\)?$/i.test(cell),
    );
    const buy = parseWholeNumber(cells.at(-2));
    const sell = parseWholeNumber(cells.at(-1));
    return label && (buy !== null || sell !== null)
      ? [{ label, buy, sell }]
      : [];
  });
}

function findOfficialRow(rows: OfficialTableRow[], match: string) {
  const expected = normalizeOfficialName(match);
  return rows.find((row) => {
    const actual = normalizeOfficialName(row.label);
    return actual === expected || actual.includes(expected);
  });
}

async function fetchPhuQuyQuote(
  product: PhuQuyProduct,
  url = PHU_QUY_PRICE_PAGE,
  observedAt = new Date().toISOString(),
): Promise<LiveQuote> {
  if (!product.officialMatch)
    throw new Error('Phú Quý product has no official match');
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'KimTuyen-MarketView/1.0',
    },
    signal: timeoutSignal(),
  });
  if (!response.ok) throw new Error(`Phú Quý upstream ${response.status}`);

  return parsePhuQuyQuoteFromHtml(product, await response.text(), observedAt);
}

function parsePhuQuyQuoteFromHtml(
  product: PhuQuyProduct,
  html: string,
  observedAt: string,
): LiveQuote {
  if (!product.officialMatch)
    throw new Error('Phú Quý product has no official match');
  const row = findOfficialRow(
    parseOfficialTableRows(html),
    product.officialMatch,
  );
  // The official Phú Quý table is denominated in VND/chỉ. The dashboard
  // standard is VND/lượng, so convert only after parsing both sides.
  if (!row?.buy || !row.sell) throw new Error('Phú Quý quote is incomplete');
  const buy = (row.buy * 10) / 1_000_000;
  const sell = (row.sell * 10) / 1_000_000;
  if (!isValidPrice(buy, sell)) throw new Error('Phú Quý quote is invalid');

  return {
    buy,
    sell,
    observedAt,
    provider: 'Phú Quý official',
    providerUrl: PHU_QUY_PRICE_PAGE,
  };
}

async function fetchPhuQuyHistory(
  product: PhuQuyProduct,
  requestedDays?: number,
): Promise<PricePoint[]> {
  if (!product.officialMatch) return [];
  const dates = previousDates(requestedDays ?? marketHistoryDays(OFFICIAL_HISTORY_DAYS));
  const responses = await Promise.allSettled(
    dates.map(async (date) => {
      const html = await fetchPhuQuyHistoryHtml(date);
      const quote = parsePhuQuyQuoteFromHtml(
        product,
        html,
        `${date}T12:00:00+07:00`,
      );
      return toPoint(date, quote.buy, quote.sell);
    }),
  );
  return responses.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
}

type BtmcHistoryPayload = {
  Data?: Record<string, string | null>;
};

async function fetchBtmcHistoryPayload(
  date: string,
): Promise<BtmcHistoryPayload> {
  const cached = btmcHistoryPayloadCache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  const existing = btmcHistoryPayloadInFlight.get(date);
  if (existing && !isAnalysisFetch()) return existing;

  const [year, month, day] = date.split('-');
  const btmcDate = `${day}/${month}/${year}`;
  const url = `${BTMC_GOLD_DATE_API}?date=${encodeURIComponent(btmcDate)}`;
  const pending = fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'KimTuyen-MarketView/1.0',
    },
    signal: timeoutSignal(),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`BTMC upstream ${response.status}`);
      const payload = (await response.json()) as BtmcHistoryPayload;
      btmcHistoryPayloadCache.set(date, {
        payload,
        expiresAt: Date.now() + FIRST_PARTY_CACHE_TTL_MS,
      });
      return payload;
    })
    .finally(() => {
      btmcHistoryPayloadInFlight.delete(date);
    });
  btmcHistoryPayloadInFlight.set(date, pending);
  return pending;
}

async function fetchPhuQuyHistoryHtml(date: string): Promise<string> {
  const cached = phuQuyHistoryHtmlCache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.html;
  const existing = phuQuyHistoryHtmlInFlight.get(date);
  if (existing && !isAnalysisFetch()) return existing;

  const url = `${PHU_QUY_HISTORY_PAGE}?date=${encodeURIComponent(date)}`;
  const pending = fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'KimTuyen-MarketView/1.0',
    },
    signal: timeoutSignal(),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Phú Quý upstream ${response.status}`);
      const html = await response.text();
      phuQuyHistoryHtmlCache.set(date, {
        html,
        expiresAt: Date.now() + FIRST_PARTY_CACHE_TTL_MS,
      });
      return html;
    })
    .finally(() => {
      phuQuyHistoryHtmlInFlight.delete(date);
    });
  phuQuyHistoryHtmlInFlight.set(date, pending);
  return pending;
}

function parseBtmcValue(value: string | null | undefined) {
  const parsed = parseWholeNumber(value);
  // BTMC reports thousand VND per chỉ. The dashboard uses million VND per
  // lượng, so multiply by ten chỉ/lượng before converting thousand to million.
  return parsed === null ? null : parsed / 100;
}

function getBtmcKey(product: BtmcProduct) {
  if (!('officialKey' in product) || !product.officialKey) {
    throw new Error('BTMC product has no official key');
  }
  return product.officialKey;
}

async function fetchBtmcCurrentQuote(product: BtmcProduct): Promise<LiveQuote> {
  if (!product.officialMatch) {
    throw new Error('BTMC product has no official match');
  }
  const response = await fetch(BTMC_PRICE_PAGE, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'KimTuyen-MarketView/1.0',
    },
    signal: timeoutSignal(4_000),
  });
  if (!response.ok) throw new Error(`BTMC upstream ${response.status}`);
  const row = findOfficialRow(
    parseOfficialTableRows(await response.text()),
    product.officialMatch,
  );
  const buy =
    row?.buy === null || row?.buy === undefined ? null : row.buy / 100;
  const sell =
    row?.sell === null || row?.sell === undefined ? null : row.sell / 100;
  if (buy === null || sell === null || !isValidPrice(buy, sell)) {
    throw new Error('BTMC quote is incomplete or invalid');
  }
  return {
    buy,
    sell,
    observedAt: new Date().toISOString(),
    provider: 'Bảo Tín Minh Châu official',
    providerUrl: BTMC_PRICE_PAGE,
  };
}

async function fetchBtmcQuote(
  product: BtmcProduct,
  date: string,
): Promise<LiveQuote> {
  const payload = await fetchBtmcHistoryPayload(date);
  const data = payload.Data;
  const key = getBtmcKey(product);
  const buy = parseBtmcValue(data?.[key]);
  const sell = parseBtmcValue(data?.[key.replace(/mua$/, 'ban')]);
  if (buy === null || sell === null || !isValidPrice(buy, sell)) {
    throw new Error('BTMC quote is incomplete or invalid');
  }
  return {
    buy,
    sell,
    observedAt:
      date === vietnamDate()
        ? new Date().toISOString()
        : `${date}T12:00:00+07:00`,
    provider: 'Bảo Tín Minh Châu official',
    providerUrl: BTMC_PRICE_PAGE,
  };
}

async function fetchBtmcHistory(product: BtmcProduct, requestedDays?: number): Promise<PricePoint[]> {
  const responses = await Promise.allSettled(
    previousDates(requestedDays ?? marketHistoryDays(OFFICIAL_HISTORY_DAYS)).map(
      async (date) => {
        const quote = await fetchBtmcQuote(product, date);
        return toPoint(date, quote.buy, quote.sell);
      },
    ),
  );
  return responses.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
}

async function getFirstPartyMarketData(
  company: ReturnType<typeof getMarketCompany>,
  product: BtmcProduct | PhuQuyProduct,
  fetchQuote: () => Promise<LiveQuote>,
  fetchHistory: () => Promise<PricePoint[]>,
  options: MarketDataOptions & { loadHistoryWhenQuoteUnavailable?: boolean } = {},
): Promise<MarketData> {
  const view = options.view ?? 'full';
  // Fetch the live quote first. Official history endpoints are one-date-per-
  // request and may be slow; a history timeout must never hide a live quote.
  let quote: LiveQuote | null = null;
  if (view !== 'history') {
    try {
      quote = await fetchQuote();
    } catch {
    // A delayed official history point may still be useful when today's quote
    // is temporarily unavailable, so continue with the best-effort history.
    }
  }
  let history: PricePoint[] = [];
  if (view !== 'quote' && (quote || options.loadHistoryWhenQuoteUnavailable !== false)) {
    try {
      history = await fetchHistory();
    } catch {
      // Keep the current quote available even if history cannot be loaded.
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
      `Nguồn ${company.name} hiện không trả dữ liệu cho sản phẩm này. Không có snapshot thay thế để tránh hiển thị giá không xác thực.`,
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
    source: quote
      ? {
          provider: quote.provider,
          url: quote.providerUrl,
          official: true,
        }
      : {
          provider: `${company.name} official (history)`,
          url: company.sourceUrl,
          official: true,
        },
    historySource: {
      provider: `${company.name} official history (tối đa ${company.maxHistoryDays} ngày)`,
      url: company.sourceUrl,
    },
    generatedAt: new Date().toISOString(),
  };
}

async function getCachedFirstPartyMarketData(
  company: ReturnType<typeof getMarketCompany>,
  product: BtmcProduct | PhuQuyProduct,
  fetchQuote: () => Promise<LiveQuote>,
  fetchHistory: () => Promise<PricePoint[]>,
  options: MarketDataOptions & { loadHistoryWhenQuoteUnavailable?: boolean } = {},
) {
  const key = `${company.id}:${product.id}:${options.view ?? 'full'}:${options.historyDays ?? 'default'}`;
  if (isAnalysisFetch())
    return getFirstPartyMarketData(
      company,
      product,
      fetchQuote,
      fetchHistory,
      options,
    );
  const cached = firstPartyMarketCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const existing = firstPartyMarketInFlight.get(key);
  if (existing) return existing;

  const pending = getFirstPartyMarketData(
    company,
    product,
    fetchQuote,
    fetchHistory,
    options,
  )
    .then((data) => {
      firstPartyMarketCache.set(key, {
        data,
        expiresAt: Date.now() + FIRST_PARTY_CACHE_TTL_MS,
      });
      return data;
    })
    .finally(() => {
      firstPartyMarketInFlight.delete(key);
    });
  firstPartyMarketInFlight.set(key, pending);
  return pending;
}

async function getBtmcWithFallback(
  company: ReturnType<typeof getMarketCompany>,
  product: BtmcProduct,
  options: MarketDataOptions = {},
): Promise<MarketData> {
  const official = await getCachedFirstPartyMarketData(
    company,
    product,
    () => fetchBtmcCurrentQuote(product),
    () => fetchBtmcHistory(product, options.historyDays),
    // Do not spend another seven upstream timeouts before trying the known,
    // exact Vang.Today code when today's official page is unavailable.
    {
      ...options,
      loadHistoryWhenQuoteUnavailable: options.view === 'history',
    },
  );
  if (official.availability === 'available') return official;

  const fallbackCode =
    'fallbackUpstreamCode' in product
      ? product.fallbackUpstreamCode
      : undefined;
  if (!fallbackCode) return official;

  return getAggregatedMarketData(
    company,
    product,
    fallbackCode,
    'Vang.Today aggregator (BTMC fallback)',
    options,
  );
}

async function fetchAggregatedQuote(
  product: MarketProduct,
  upstreamCodeOverride?: string,
): Promise<LiveQuote> {
  const upstreamCode = upstreamCodeOverride ?? product.upstreamCode;
  if (!upstreamCode) throw new Error('Market product has no Vang.Today code');
  const url = `${VANG_TODAY_API}?type=${upstreamCode}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: timeoutSignal(),
  });
  if (!response.ok) throw new Error(`Vang.Today upstream ${response.status}`);

  const payload = (await response.json()) as {
    success?: boolean;
    timestamp?: number;
    buy?: number;
    sell?: number;
  };
  const buy = Number(payload.buy) / 1_000_000;
  const sell = Number(payload.sell) / 1_000_000;
  if (!payload.success || !isValidPrice(buy, sell)) {
    throw new Error('Vang.Today quote is invalid');
  }

  return {
    buy,
    sell,
    observedAt: payload.timestamp
      ? new Date(payload.timestamp * 1_000).toISOString()
      : new Date().toISOString(),
    timestampKind: payload.timestamp ? 'source' : 'retrieval-or-date',
    provider: 'Vàng.Today',
    providerUrl: 'https://www.vang.today/vi/api',
  };
}

async function fetchProductHistory(
  product: MarketProduct,
  upstreamCodeOverride?: string,
  requestedDays?: number,
): Promise<PricePoint[]> {
  const upstreamCode = upstreamCodeOverride ?? product.upstreamCode;
  if (!upstreamCode) return [];
  // Vang.Today documents a maximum of 30 calendar days. Keep the adapter
  // inside that contract instead of implying a longer history exists.
  const days = requestedDays ?? marketHistoryDays(VANG_TODAY_HISTORY_DAYS);
  const url = `${VANG_TODAY_API}?type=${upstreamCode}&days=${Math.max(2, Math.min(VANG_TODAY_HISTORY_DAYS, days))}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: timeoutSignal(),
  });
  if (!response.ok) throw new Error(`History upstream ${response.status}`);

  const payload = (await response.json()) as {
    success?: boolean;
    history?: Array<{
      date?: string;
      prices?: Record<string, { buy?: number; sell?: number }>;
    }>;
  };
  if (!payload.success || !Array.isArray(payload.history)) return [];

  return payload.history.flatMap((row) => {
    const quote = row.prices?.[upstreamCode];
    const buy = Number(quote?.buy) / 1_000_000;
    const sell = Number(quote?.sell) / 1_000_000;
    return row.date && isValidPrice(buy, sell)
      ? [toPoint(row.date, buy, sell)]
      : [];
  });
}

export async function fetchSjcHistoricalCsv(): Promise<PricePoint[]> {
  const response = await fetch(SJC_HISTORY_CSV_URL, {
    headers: { Accept: 'text/csv' },
    signal: timeoutSignal(),
  });
  if (!response.ok) throw new Error(`CSV upstream ${response.status}`);

  const rows = (await response.text()).trim().split(/\r?\n/).slice(1);
  return rows.flatMap((row) => {
    const [date, buyValue, sellValue] = row.split(',');
    const buy = Number(buyValue);
    const sell = Number(sellValue);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && isValidPrice(buy, sell)
      ? [toPoint(date, buy, sell)]
      : [];
  });
}

async function getSjcMarketDataInternal(
  product: SjcProduct,
  options: MarketDataOptions = {},
): Promise<MarketData> {
  const company = getMarketCompany('sjc');
  const view = options.view ?? 'full';
  const requestedDays = Math.max(2, Math.min(365, options.historyDays ?? marketHistoryDays(365)));
  const [
    officialResult,
    aggregateResult,
    productHistoryResult,
    barHistoryResult,
  ] = await Promise.allSettled([
    view === 'history' ? Promise.resolve(null) : fetchOfficialQuote(product),
    view === 'history' ? Promise.resolve(null) : fetchAggregatedQuote(product),
    view === 'quote' ? Promise.resolve([]) : fetchProductHistory(product, undefined, requestedDays),
    view === 'full' && product.seriesId === 'bar' && marketHistoryDays(365) > 2
      ? fetchSjcHistoricalCsv()
      : Promise.resolve([]),
  ]);

  const official =
    officialResult.status === 'fulfilled' ? officialResult.value : null;
  const aggregate =
    aggregateResult.status === 'fulfilled' ? aggregateResult.value : null;
  const liveQuote = official ?? aggregate;
  const productHistory =
    productHistoryResult.status === 'fulfilled'
      ? productHistoryResult.value
      : [];
  const barHistory =
    barHistoryResult.status === 'fulfilled' ? barHistoryResult.value : [];

  const localBarFallback = fallbackDataset.records as PricePoint[];
  const merged = new Map<string, PricePoint>();
  const baseHistory =
    barHistory.length > 0
      ? barHistory
      : view === 'full' && product.seriesId === 'bar' && marketHistoryDays(365) > 2
        ? localBarFallback
        : [];
  for (const point of baseHistory) merged.set(point.date, point);
  for (const point of productHistory) merged.set(point.date, point);
  if (liveQuote) {
    const date = vietnamDate(new Date(liveQuote.observedAt));
    merged.set(date, toPoint(date, liveQuote.buy, liveQuote.sell));
  }

  const records = [...merged.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-(view === 'history' ? requestedDays : 365));
  const latest = records.at(-1) ?? null;
  const mode: MarketDataMode = liveQuote
    ? 'live'
    : productHistory.length || barHistory.length
      ? 'delayed'
      : view === 'quote'
        ? 'unavailable'
        : 'fallback';

  if (!latest && view === 'quote') {
    return unavailableMarketData(
      company,
      product,
      'Nguồn giá hiện chưa phản hồi cho sản phẩm này.',
    );
  }

  return {
    mode,
    timestampKind: liveQuote?.timestampKind ?? 'retrieval-or-date',
    availability: 'available',
    unavailableReason: null,
    company,
    product,
    products: getMarketProducts(company.id),
    records,
    latest,
    observedAt:
      liveQuote?.observedAt ??
      `${latest?.date ?? vietnamDate()}T00:00:00+07:00`,
    source: liveQuote
      ? {
          provider: liveQuote.provider,
          url: liveQuote.providerUrl,
          official: liveQuote.provider === 'SJC',
        }
      : {
          provider:
            product.seriesId === 'bar'
              ? 'SJC-price dataset'
              : 'Chưa có nguồn trực tiếp',
          url:
            product.seriesId === 'bar'
              ? 'https://github.com/vkhuy/SJC-price'
              : null,
          official: false,
        },
    historySource: {
      provider:
        productHistory.length > 0
          ? 'Vàng.Today'
          : barHistory.length > 0
            ? 'SJC-price dataset'
            : 'Bản dự phòng cục bộ',
      url:
        productHistory.length > 0
          ? 'https://www.vang.today/vi/api'
          : barHistory.length > 0
            ? 'https://github.com/vkhuy/SJC-price'
            : null,
    },
    generatedAt: new Date().toISOString(),
  };
}

function unavailableMarketData(
  company: ReturnType<typeof getMarketCompany>,
  product: MarketProduct,
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

async function getAggregatedMarketData(
  company: ReturnType<typeof getMarketCompany>,
  product: MarketProduct,
  upstreamCodeOverride?: string,
  providerLabel = 'Vang.Today aggregator',
  options: MarketDataOptions = {},
): Promise<MarketData> {
  const view = options.view ?? 'full';
  const [quoteResult, historyResult] = await Promise.allSettled([
    view === 'history' ? Promise.resolve(null) : fetchAggregatedQuote(product, upstreamCodeOverride),
    view === 'quote' ? Promise.resolve([]) : fetchProductHistory(product, upstreamCodeOverride, options.historyDays),
  ]);
  const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
  const history =
    historyResult.status === 'fulfilled' ? historyResult.value : [];
  const merged = new Map<string, PricePoint>();
  for (const point of history) merged.set(point.date, point);
  if (quote) {
    const date = vietnamDate(new Date(quote.observedAt));
    merged.set(date, toPoint(date, quote.buy, quote.sell));
  }
  const records = [...merged.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-VANG_TODAY_HISTORY_DAYS);
  const latest = records.at(-1) ?? null;
  if (!latest) {
    return unavailableMarketData(
      company,
      product,
      'Nguồn Vang.Today hiện không trả dữ liệu cho mã sản phẩm này. Không có snapshot thay thế để tránh hiển thị giá không xác thực.',
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
    observedAt: quote?.observedAt ?? `${latest.date}T00:00:00+07:00`,
    timestampKind: quote?.timestampKind ?? 'retrieval-or-date',
    source: quote
      ? {
          provider: providerLabel,
          url: quote.providerUrl,
          official: false,
        }
      : {
          provider: `${providerLabel} history`,
          url: 'https://www.vang.today/vi/api',
          official: false,
        },
    historySource: {
      provider: `${providerLabel} history (tối đa 30 ngày)`,
      url: 'https://www.vang.today/vi/api',
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Resolve a company/product pair and dispatch to that company's adapter. */
export async function getMarketData(
  companyId: string | null | undefined,
  productId: string | null | undefined,
  options: MarketDataOptions = {},
): Promise<MarketData> {
  const company = getMarketCompany(companyId);
  const product = getMarketProduct(company.id, productId);
  const result = await (async () => {
  switch (company.adapter) {
    case 'sjc-official':
      return getSjcMarketDataInternal(product as SjcProduct, options);
    case 'pnj-official':
      return getPnjMarketData(company as PnjCompany, product as PnjProduct, options);
    case 'btmc-official':
      return getBtmcWithFallback(company, product as BtmcProduct, options);
    case 'btmh-official':
      return getBtmhMarketData(product.id, options);
    case 'phuquy-official':
      return getCachedFirstPartyMarketData(
        company,
        product as PhuQuyProduct,
        () => fetchPhuQuyQuote(product as PhuQuyProduct),
        () => fetchPhuQuyHistory(product as PhuQuyProduct, options.historyDays),
        options,
      );
    case 'vgj-official':
      return getVgjMarketData(product.id, options);
    case 'unavailable':
      return unavailableMarketData(
        company,
        product,
        'Chưa có endpoint Mi Hồng hoạt động và đã xác minh. Không hiển thị giá từ nguồn tổng hợp không kiểm chứng.',
      );
    case 'vang-today':
      return getAggregatedMarketData(company, product, undefined, 'Vang.Today aggregator', options);
  }
  })();
  return {
    ...result,
    fetchedAt: result.fetchedAt ?? result.generatedAt,
    sourcePublishedAt:
      result.sourcePublishedAt ??
      (result.timestampKind === 'source' ? result.observedAt : undefined),
  };
}

/** Backward-compatible SJC entry point for existing consumers. */
export async function getSjcMarketData(
  productId: string | null | undefined,
): Promise<MarketData> {
  return getMarketData('sjc', productId);
}
