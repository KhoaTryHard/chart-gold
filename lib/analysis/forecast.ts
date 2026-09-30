import type { PricePoint, MarketData } from '@/lib/server/sjc';
import { shiftDate, vietnamDate } from './dates';

export type ForecastStatus =
  | 'experimental'
  | 'insufficient-data'
  | 'unavailable';

export type ForecastRange = {
  label: 'downside' | 'base' | 'upside';
  buyVndPerLuong: number | null;
  sellVndPerLuong: number | null;
  changePercent: number | null;
};

export type ForecastResult = {
  status: ForecastStatus;
  requestedHorizonDays: 7;
  targetDate: string;
  anchorDate: string | null;
  anchorBuyVndPerLuong: number | null;
  anchorSellVndPerLuong: number | null;
  ranges: ForecastRange[];
  observationCount: number;
  pairCount: number;
  method: 'seven-day-change-quantiles';
  reason: string | null;
  source: {
    provider: string;
    url: string | null;
    observedAt: string | null;
    mode: MarketData['mode'] | 'unavailable';
  };
};

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    : null;
}

/** Return true for a request that asks for a forward-looking price estimate. */
export function isForecastQuestion(question: string) {
  const q = normalize(question);
  return /du doan|du bao|uoc tinh gia|gia.*(tuan sau|tuan toi|7 ngay nua|next week|7 days)|forecast|predict|projection/.test(q);
}

/** Resolve an explicit future date or the next seven calendar days in Vietnam time. */
export function resolveForecastTargetDate(
  question: string,
  now = new Date(),
) {
  const q = normalize(question);
  const today = vietnamDate(now);
  const futureOnly = (value: string | null) => value && value > today ? value : null;
  const iso = q.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return futureOnly(validDate(Number(iso[1]), Number(iso[2]), Number(iso[3])));
  const local = q.match(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/);
  if (local) return futureOnly(validDate(Number(local[3]), Number(local[2]), Number(local[1])));
  if (/7\s*(?:ngay|days?)\s*(?:nua|from now|ahead)?|tuan\s*(?:sau|toi)|next\s+week/.test(q))
    return shiftDate(today, 7);
  if (!iso && !local && /du doan|du bao|forecast|predict|projection/.test(q))
    return shiftDate(today, 7);
  return null;
}

function quantile(values: readonly number[], probability: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function validPoints(records: readonly PricePoint[]) {
  return [...new Map(
    records
      .filter((point) =>
        /^\d{4}-\d{2}-\d{2}$/.test(point.date) &&
        point.buy > 0 &&
        point.sell >= point.buy &&
        Number.isFinite(point.buy) &&
        Number.isFinite(point.sell),
      )
      .map((point) => [point.date, point]),
  ).values()].sort((left, right) => left.date.localeCompare(right.date));
}

function unavailableResult(
  targetDate: string,
  market: MarketData | null | undefined,
  reason: string,
): ForecastResult {
  return {
    status: 'unavailable',
    requestedHorizonDays: 7,
    targetDate,
    anchorDate: market?.latest?.date ?? null,
    anchorBuyVndPerLuong: market?.latest ? Math.round(market.latest.buy * 1_000_000) : null,
    anchorSellVndPerLuong: market?.latest ? Math.round(market.latest.sell * 1_000_000) : null,
    ranges: [],
    observationCount: market?.records.length ?? 0,
    pairCount: 0,
    method: 'seven-day-change-quantiles',
    reason,
    source: {
      provider: market?.source.provider ?? '',
      url: market?.source.url ?? null,
      observedAt: market?.observedAt ?? null,
      mode: market?.mode ?? 'unavailable',
    },
  };
}

export function calculateForecast(
  market: MarketData | null | undefined,
  targetDate: string,
  now = new Date(),
): ForecastResult {
  if (!market || market.availability !== 'available' || market.mode === 'fallback')
    return unavailableResult(targetDate, market, 'Chưa có nguồn giá hiện tại đủ tin cậy để neo dự báo.');
  const today = vietnamDate(now);
  if (targetDate !== shiftDate(today, 7))
    return {
      ...unavailableResult(
        targetDate,
        market,
        'Khoảng giá định lượng hiện chỉ hỗ trợ đúng mốc 7 ngày lịch; hãy hỏi lại với “7 ngày nữa” hoặc “tuần sau”.',
      ),
      status: 'insufficient-data',
    };
  const points = validPoints(market.records);
  const anchor = market.latest && market.latest.date === today
    ? market.latest
    : points.at(-1);
  if (!anchor || anchor.date !== today)
    return unavailableResult(targetDate, market, 'Chưa có bản ghi giá của ngày hiện tại để làm mốc dự báo.');
  const byDate = new Map(points.map((point) => [point.date, point]));
  const buyChanges: number[] = [];
  const sellChanges: number[] = [];
  for (const point of points) {
    const prior = byDate.get(shiftDate(point.date, -7));
    if (!prior) continue;
    buyChanges.push(point.buy - prior.buy);
    sellChanges.push(point.sell - prior.sell);
  }
  if (points.length < 90 || buyChanges.length < 60)
    return {
      ...unavailableResult(
        targetDate,
        market,
        `Chưa đủ lịch sử: cần tối thiểu 90 ngày và 60 cặp cách nhau 7 ngày; hiện có ${points.length} ngày và ${buyChanges.length} cặp.`,
      ),
      status: 'insufficient-data',
      anchorDate: anchor.date,
    };

  const buyQuantiles = [quantile(buyChanges, 0.1)!, quantile(buyChanges, 0.5)!, quantile(buyChanges, 0.9)!];
  const sellQuantiles = [quantile(sellChanges, 0.1)!, quantile(sellChanges, 0.5)!, quantile(sellChanges, 0.9)!];
  const labels: ForecastRange['label'][] = ['downside', 'base', 'upside'];
  const ranges = labels.map((label, index) => {
    const sell = Math.max(0, anchor.sell + sellQuantiles[index]);
    const buy = Math.max(0, Math.min(sell, anchor.buy + buyQuantiles[index]));
    return {
      label,
      buyVndPerLuong: Math.round(buy * 1_000_000),
      sellVndPerLuong: Math.round(sell * 1_000_000),
      changePercent: anchor.sell > 0
        ? Number((((sell - anchor.sell) / anchor.sell) * 100).toFixed(2))
        : null,
    } satisfies ForecastRange;
  });
  return {
    status: 'experimental',
    requestedHorizonDays: 7,
    targetDate,
    anchorDate: anchor.date,
    anchorBuyVndPerLuong: Math.round(anchor.buy * 1_000_000),
    anchorSellVndPerLuong: Math.round(anchor.sell * 1_000_000),
    ranges,
    observationCount: points.length,
    pairCount: buyChanges.length,
    method: 'seven-day-change-quantiles',
    reason: 'Khoảng tham chiếu thực nghiệm từ thay đổi lịch sử cách nhau 7 ngày; không phải xác suất xảy ra trong tương lai.',
    source: {
      provider: market.source.provider,
      url: market.source.url,
      observedAt: market.observedAt,
      mode: market.mode,
    },
  };
}
