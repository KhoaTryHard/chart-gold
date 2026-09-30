import { describe, expect, it } from 'vitest';

import { calculateAnalysisMetrics } from '@/lib/analysis/metrics';
import type { PricePoint } from '@/lib/server/sjc';

const records: PricePoint[] = [
  { date: '2026-01-01', buy: 99, sell: 100, spread: 1, eventId: null },
  { date: '2026-01-02', buy: 109, sell: 110, spread: 1, eventId: null },
  { date: '2026-01-03', buy: 104, sell: 105, spread: 1, eventId: null },
];

describe('calculateAnalysisMetrics', () => {
  it('computes latest, return, moving averages, volatility, and drawdown deterministically', () => {
    const metrics = calculateAnalysisMetrics(records, '7N');

    expect(metrics.latest).toEqual({
      date: '2026-01-03',
      buy: 104,
      sell: 105,
      spread: 1,
    });
    expect(metrics.dailyChange).toEqual({
      buy: -5,
      sell: -5,
      spread: 0,
      sellPercent: -4.5455,
    });
    expect(metrics.selectedPeriod).toEqual({
      days: 7,
      from: '2026-01-01',
      to: '2026-01-03',
      return: 5,
      returnPercent: 5,
    });
    expect(metrics.movingAverage).toEqual({ ma7: null, ma30: null });
    expect(metrics.highLow).toEqual({ high: 110, low: 100 });
    expect(metrics.dailyReturnVolatilityPercent).toBeGreaterThan(0);
    expect(metrics.maxDrawdownPercent).toBe(-4.5455);
  });
});
