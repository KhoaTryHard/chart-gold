import 'server-only';

import fallbackDataset from '@/lib/sjc-data.json';
import {
  getSjcProduct,
  SJC_PRODUCTS,
  type SjcProduct,
} from '@/lib/sjc-products';

export type PricePoint = {
  date: string;
  buy: number;
  sell: number;
  spread: number;
  eventId: null;
};

type LiveQuote = {
  buy: number;
  sell: number;
  observedAt: string;
  provider: string;
  providerUrl: string;
};

export type MarketDataMode = 'live' | 'delayed' | 'fallback';

export type MarketData = {
  mode: MarketDataMode;
  product: SjcProduct;
  products: typeof SJC_PRODUCTS;
  records: PricePoint[];
  latest: PricePoint | null;
  observedAt: string;
  source: { provider: string; url: string | null; official: boolean };
  historySource: { provider: string; url: string | null };
  generatedAt: string;
};

const OFFICIAL_SJC_URL = 'https://sjc.com.vn/xml/tygiavang.xml';
const VANG_TODAY_API = 'https://www.vang.today/api/prices';
const HISTORY_CSV_URL =
  'https://raw.githubusercontent.com/vkhuy/SJC-price/main/docs/data/sjc_final.csv';

function timeoutSignal() {
  return AbortSignal.timeout(7_000);
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

async function fetchAggregatedQuote(product: SjcProduct): Promise<LiveQuote> {
  const url = `${VANG_TODAY_API}?type=${product.upstreamCode}`;
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
    provider: 'Vàng.Today',
    providerUrl: 'https://www.vang.today/vi/api',
  };
}

async function fetchProductHistory(product: SjcProduct): Promise<PricePoint[]> {
  const url = `${VANG_TODAY_API}?type=${product.upstreamCode}&days=365`;
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
    const quote = row.prices?.[product.upstreamCode];
    const buy = Number(quote?.buy) / 1_000_000;
    const sell = Number(quote?.sell) / 1_000_000;
    return row.date && isValidPrice(buy, sell)
      ? [toPoint(row.date, buy, sell)]
      : [];
  });
}

async function fetchHistoricalCsv(): Promise<PricePoint[]> {
  const response = await fetch(HISTORY_CSV_URL, {
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

export async function getSjcMarketData(
  productId: string | null | undefined,
): Promise<MarketData> {
  const product = getSjcProduct(productId);
  const [
    officialResult,
    aggregateResult,
    productHistoryResult,
    barHistoryResult,
  ] = await Promise.allSettled([
    fetchOfficialQuote(product),
    fetchAggregatedQuote(product),
    fetchProductHistory(product),
    product.seriesId === 'bar' ? fetchHistoricalCsv() : Promise.resolve([]),
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
      : product.seriesId === 'bar'
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
    .slice(-365);
  const latest = records.at(-1) ?? null;
  const mode: MarketDataMode = liveQuote
    ? 'live'
    : productHistory.length || barHistory.length
      ? 'delayed'
      : 'fallback';

  return {
    mode,
    product,
    products: SJC_PRODUCTS,
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
