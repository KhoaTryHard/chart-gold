import type { PricePoint } from '@/lib/server/sjc';

export const ANALYSIS_RANGES = {
  '7N': 7,
  '1T': 30,
  '1N': 365,
} as const;

export type AnalysisRange = keyof typeof ANALYSIS_RANGES;

export type AnalysisMetrics = {
  sampleSize: number;
  latest: {
    date: string | null;
    buy: number | null;
    sell: number | null;
    spread: number | null;
  };
  dailyChange: {
    buy: number | null;
    sell: number | null;
    spread: number | null;
    sellPercent: number | null;
  };
  selectedPeriod: {
    days: number;
    from: string | null;
    to: string | null;
    return: number | null;
    returnPercent: number | null;
  };
  movingAverage: {
    ma7: number | null;
    ma30: number | null;
  };
  highLow: {
    high: number | null;
    low: number | null;
  };
  dailyReturnVolatilityPercent: number | null;
  maxDrawdownPercent: number | null;
};

function round(value: number, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length
    ? round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
}

function percentChange(start: number | undefined, end: number | undefined) {
  return start && Number.isFinite(start) && Number.isFinite(end)
    ? round(((end! - start) / start) * 100)
    : null;
}

/**
 * Computes all assistant-facing market statistics from normalized, sorted data.
 * Sell prices are used for returns, volatility, highs/lows, and drawdown because
 * they represent the user's purchase-side quote in this dashboard.
 */
export function calculateAnalysisMetrics(
  records: readonly PricePoint[],
  range: AnalysisRange,
): AnalysisMetrics {
  const sorted = [...records].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  const selected = sorted.slice(-ANALYSIS_RANGES[range]);
  const latest = selected.at(-1) ?? sorted.at(-1);
  const previous = selected.at(-2) ?? sorted.at(-2);
  const first = selected[0];
  const sellValues = selected.map((point) => point.sell);
  const dailyReturns = selected.slice(1).flatMap((point, index) => {
    const prior = selected[index].sell;
    return prior ? [(point.sell - prior) / prior] : [];
  });
  const meanDailyReturn = dailyReturns.length
    ? dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length
    : 0;
  const variance = dailyReturns.length
    ? dailyReturns.reduce(
        (sum, value) => sum + (value - meanDailyReturn) ** 2,
        0,
      ) / dailyReturns.length
    : null;
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const price of sellValues) {
    peak = Math.max(peak, price);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, price / peak - 1);
  }

  return {
    sampleSize: selected.length,
    latest: {
      date: latest?.date ?? null,
      buy: latest?.buy ?? null,
      sell: latest?.sell ?? null,
      spread: latest?.spread ?? null,
    },
    dailyChange: {
      buy: latest && previous ? round(latest.buy - previous.buy) : null,
      sell: latest && previous ? round(latest.sell - previous.sell) : null,
      spread:
        latest && previous ? round(latest.spread - previous.spread) : null,
      sellPercent: percentChange(previous?.sell, latest?.sell),
    },
    selectedPeriod: {
      days: ANALYSIS_RANGES[range],
      from: first?.date ?? null,
      to: latest?.date ?? null,
      return: first && latest ? round(latest.sell - first.sell) : null,
      returnPercent: percentChange(first?.sell, latest?.sell),
    },
    movingAverage: {
      ma7: average(sorted.slice(-7).map((point) => point.sell)),
      ma30: average(sorted.slice(-30).map((point) => point.sell)),
    },
    highLow: {
      high: sellValues.length ? round(Math.max(...sellValues)) : null,
      low: sellValues.length ? round(Math.min(...sellValues)) : null,
    },
    dailyReturnVolatilityPercent:
      variance === null ? null : round(Math.sqrt(variance) * 100),
    maxDrawdownPercent: sellValues.length ? round(maxDrawdown * 100) : null,
  };
}
