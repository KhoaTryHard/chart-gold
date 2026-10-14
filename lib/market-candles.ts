import { enumerateCalendarDates } from '@/lib/market-history';
import { vietnamDate } from '@/lib/analysis/dates';

export type CandleRange = '7N' | '1T';
export type Ohlc = { open: number; high: number; low: number; close: number };
export type MarketCandle = {
  date: string;
  buy: Ohlc;
  sell: Ohlc;
  updatedAt: string;
  observations: number;
};
export type CandleSource = {
  provider: string;
  url: string;
  official: boolean;
  referenceGroup: 'bar' | 'ring' | null;
};
export type MarketCandlesResponse = {
  companyId: string;
  productId: string;
  range: CandleRange;
  status: 'ready' | 'partial' | 'unavailable' | 'unsupported';
  source: CandleSource | null;
  unit: 'million-vnd-per-luong';
  requestedStart: string;
  requestedEnd: string;
  missingDates: string[];
  records: MarketCandle[];
  updatedAt: string | null;
};
export type QuoteObservation = { timestamp: number; buy: number; sell: number };

/** Values are normalized to million VND/lượng before aggregation. */
export function aggregateCandle(
  date: string,
  observations: QuoteObservation[],
): MarketCandle | null {
  if (!observations.length) return null;
  const sorted = [...observations].sort((a, b) => a.timestamp - b.timestamp);
  if (
    sorted.some(
      (row, index) =>
        !Number.isFinite(row.timestamp) ||
        !Number.isFinite(row.buy) ||
        !Number.isFinite(row.sell) ||
        row.buy <= 0 ||
        row.sell < row.buy ||
        row.sell > 500 ||
        vietnamDate(new Date(row.timestamp)) !== date ||
        (index > 0 &&
          sorted[index - 1].timestamp === row.timestamp &&
          (sorted[index - 1].buy !== row.buy ||
            sorted[index - 1].sell !== row.sell)),
    )
  )
    return null;
  const side = (key: 'buy' | 'sell'): Ohlc => ({
    open: sorted[0][key],
    high: Math.max(...sorted.map((row) => row[key])),
    low: Math.min(...sorted.map((row) => row[key])),
    close: sorted.at(-1)![key],
  });
  return {
    date,
    buy: side('buy'),
    sell: side('sell'),
    updatedAt: new Date(sorted.at(-1)!.timestamp).toISOString(),
    observations: sorted.length,
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Extract data only; never execute upstream scripts. Malformed days stay missing. */
export function parseVangTodayCandles(html: string): MarketCandle[] {
  const match = html.match(/const\s+chartData\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error('Candle data not found');
  const payload: unknown = JSON.parse(match[1]);
  if (!Array.isArray(payload)) throw new Error('Invalid candle data');
  const seen = new Set<string>();
  return payload
    .flatMap((value) => {
      const row = object(value);
      if (
        !row ||
        typeof row.date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
        !Array.isArray(row.entries) ||
        row.entries.length !== row.entry_count ||
        seen.has(row.date)
      )
        return [];
      seen.add(row.date);
      const observations = row.entries.map((entry: unknown) => {
        const item = object(entry);
        return {
          timestamp: typeof item?.unix === 'number' ? item.unix * 1000 : NaN,
          buy: typeof item?.buy === 'number' ? item.buy / 1_000_000 : NaN,
          sell: typeof item?.sell === 'number' ? item.sell / 1_000_000 : NaN,
        };
      });
      const candle = aggregateCandle(row.date, observations);
      if (!candle) return [];
      for (const side of ['buy', 'sell'] as const) {
        for (const field of ['open', 'high', 'low', 'close'] as const) {
          const supplied = row[field === 'close' ? side : `${field}_${side}`];
          if (
            typeof supplied !== 'number' ||
            Math.abs(candle[side][field] * 1_000_000 - supplied) > 0.5
          )
            return [];
        }
      }
      return [candle];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function parsePnjCandle(
  payload: unknown,
  location: string,
  productName: string,
  date: string,
): MarketCandle | null {
  const normalize = (value: unknown) =>
    typeof value === 'string'
      ? value
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase()
      : '';
  const locations = object(payload)?.locations;
  if (!Array.isArray(locations)) return null;
  const place = locations
    .map(object)
    .find((item) => normalize(item?.name) === normalize(location));
  if (!Array.isArray(place?.gold_type)) return null;
  const product = place.gold_type
    .map(object)
    .find((item) => normalize(item?.name) === normalize(productName));
  if (!Array.isArray(product?.data)) return null;
  const observations = product.data.map((value: unknown) => {
    const row = object(value);
    const match =
      typeof row?.updated_at === 'string'
        ? row.updated_at.match(
            /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/,
          )
        : null;
    const timestamp = match
      ? Date.parse(
          `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6] ?? '00'}+07:00`,
        )
      : NaN;
    return { timestamp, buy: Number(row?.gia_mua), sell: Number(row?.gia_ban) };
  });
  return aggregateCandle(date, observations);
}

export function candleCoverage(
  records: MarketCandle[],
  start: string,
  end: string,
) {
  const dates = new Set(records.map((row) => row.date));
  return enumerateCalendarDates(start, end).filter((date) => !dates.has(date));
}
