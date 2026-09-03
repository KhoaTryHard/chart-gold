import { env } from 'cloudflare:workers';

import fallbackDataset from '@/lib/sjc-data.json';
import {
  getSjcProduct,
  SJC_PRODUCTS,
  type SjcProduct,
} from '@/lib/sjc-products';

type PricePoint = {
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

type StoredQuote = PricePoint & {
  observedAt: string;
  provider: string;
  sourceUrl: string;
};

const OFFICIAL_SJC_URL = 'https://sjc.com.vn/xml/tygiavang.xml';
const VANG_TODAY_API = 'https://www.vang.today/api/prices';
const HISTORY_CSV_URL =
  'https://raw.githubusercontent.com/vkhuy/SJC-price/main/docs/data/sjc_final.csv';
const timeoutSignal = () => AbortSignal.timeout(7_000);

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
  const normalizedMatch = product.officialMatch
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const tag = tags.find((item) => {
    const type = item.match(/\btype=["']([^"']+)["']/i)?.[1] ?? '';
    return type
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .includes(normalizedMatch);
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

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS gold_product_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        series_id TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        observed_date TEXT NOT NULL,
        buy REAL NOT NULL,
        sell REAL NOT NULL,
        provider TEXT NOT NULL,
        source_url TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_gold_product_snapshots_series_observed
       ON gold_product_snapshots(series_id, observed_at)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_gold_product_snapshots_series_date
       ON gold_product_snapshots(series_id, observed_date)`,
    ),
  ]);
}

async function persistQuote(product: SjcProduct, quote: LiveQuote) {
  const db = database();
  if (!db) return;
  await ensureSchema(db);
  await db
    .prepare(
      `INSERT OR IGNORE INTO gold_product_snapshots
        (series_id, observed_at, observed_date, buy, sell, provider, source_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      product.seriesId,
      quote.observedAt,
      vietnamDate(new Date(quote.observedAt)),
      quote.buy,
      quote.sell,
      quote.provider,
      quote.providerUrl,
      new Date().toISOString(),
    )
    .run();
}

async function fetchStoredHistory(product: SjcProduct): Promise<{
  records: PricePoint[];
  latest: StoredQuote | null;
}> {
  const db = database();
  if (!db) return { records: [], latest: null };
  await ensureSchema(db);

  const result = await db
    .prepare(
      `SELECT observed_date, buy, sell, observed_at, provider, source_url
       FROM gold_product_snapshots AS snapshot
       WHERE series_id = ? AND observed_at = (
         SELECT MAX(newer.observed_at)
         FROM gold_product_snapshots AS newer
         WHERE newer.series_id = snapshot.series_id
           AND newer.observed_date = snapshot.observed_date
       )
       ORDER BY observed_date DESC
       LIMIT 365`,
    )
    .bind(product.seriesId)
    .all<{
      observed_date: string;
      buy: number;
      sell: number;
      observed_at: string;
      provider: string;
      source_url: string;
    }>();

  const rows = result.results ?? [];
  const records = rows
    .map((row) => toPoint(row.observed_date, row.buy, row.sell))
    .reverse();
  const newest = rows[0];
  return {
    records,
    latest: newest
      ? {
          ...toPoint(newest.observed_date, newest.buy, newest.sell),
          observedAt: newest.observed_at,
          provider: newest.provider,
          sourceUrl: newest.source_url,
        }
      : null,
  };
}

export async function GET(request: Request) {
  const product = getSjcProduct(
    new URL(request.url).searchParams.get('product'),
  );
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

  if (liveQuote) {
    try {
      await persistQuote(product, liveQuote);
    } catch {
      // Remote data remains useful if durable caching is temporarily unavailable.
    }
  }

  let stored: Awaited<ReturnType<typeof fetchStoredHistory>> = {
    records: [],
    latest: null,
  };
  try {
    stored = await fetchStoredHistory(product);
  } catch {
    // The remote series remains available if D1 is temporarily unavailable.
  }

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
  for (const point of stored.records) merged.set(point.date, point);
  if (liveQuote) {
    const date = vietnamDate(new Date(liveQuote.observedAt));
    merged.set(date, toPoint(date, liveQuote.buy, liveQuote.sell));
  }

  const records = [...merged.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-365);
  const latest = records.at(-1) ?? null;
  const lastKnownQuote =
    liveQuote ??
    (stored.latest
      ? {
          buy: stored.latest.buy,
          sell: stored.latest.sell,
          observedAt: stored.latest.observedAt,
          provider: stored.latest.provider,
          providerUrl: stored.latest.sourceUrl,
        }
      : null);
  const mode = liveQuote
    ? 'live'
    : stored.latest || productHistory.length || barHistory.length
      ? 'delayed'
      : 'fallback';

  return Response.json(
    {
      mode,
      product,
      products: SJC_PRODUCTS,
      records,
      latest,
      observedAt:
        lastKnownQuote?.observedAt ??
        `${latest?.date ?? vietnamDate()}T00:00:00+07:00`,
      source: lastKnownQuote
        ? {
            provider: lastKnownQuote.provider,
            url: lastKnownQuote.providerUrl,
            official: lastKnownQuote.provider === 'SJC',
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
              : stored.records.length > 0
                ? 'Snapshot đã lưu'
                : 'Bản dự phòng cục bộ',
        url:
          productHistory.length > 0
            ? 'https://www.vang.today/vi/api'
            : barHistory.length > 0
              ? 'https://github.com/vkhuy/SJC-price'
              : null,
      },
      generatedAt: new Date().toISOString(),
    },
    {
      status: records.length > 0 ? 200 : 503,
      headers: {
        'Cache-Control': 'public, s-maxage=240, stale-while-revalidate=600',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
