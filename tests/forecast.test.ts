import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  calculateForecast,
  isForecastQuestion,
  resolveForecastTargetDate,
} from '@/lib/analysis/forecast';
import { shiftDate } from '@/lib/analysis/dates';
import { resolveIntent } from '@/lib/analysis/intent';
import { factualAnswer, buildMarketContext, selectQuoteGroups } from '@/lib/analysis/market-context';
import type { MarketData, PricePoint } from '@/lib/server/sjc';
import { getMarketCompany, getMarketProduct } from '@/lib/market-sources';

function point(date: string, buy: number, sell: number): PricePoint {
  return { date, buy, sell, spread: sell - buy, eventId: null };
}

function market(records: PricePoint[], mode: MarketData['mode'] = 'live'): MarketData {
  const latest = records.at(-1) ?? null;
  return {
    company: getMarketCompany('sjc'),
    product: getMarketProduct('sjc', 'bar-1l'),
    products: [],
    mode,
    availability: 'available',
    unavailableReason: null,
    records,
    latest,
    observedAt: `${latest?.date ?? '2026-09-14'}T08:00:00+07:00`,
    source: { provider: 'SJC fixture', url: 'https://example.test/sjc', official: true },
    historySource: { provider: 'SJC fixture history', url: 'https://example.test/sjc/history' },
    generatedAt: '2026-09-14T01:00:00.000Z',
  };
}

describe('seven-day forecast', () => {
  it('recognizes Vietnamese forecast wording and resolves the next week in Vietnam time', () => {
    const now = new Date('2026-09-14T01:00:00.000Z');
    expect(isForecastQuestion('hãy dự đoán giá vàng trong ngày này tuần sau ?')).toBe(true);
    expect(resolveForecastTargetDate('hãy dự đoán giá vàng trong ngày này tuần sau ?', now)).toBe('2026-09-21');
    expect(resolveForecastTargetDate('Dự đoán giá vàng ngày 21/09/2026', now)).toBe('2026-09-21');
    const intent = resolveIntent('hãy dự đoán giá vàng trong ngày này tuần sau ?', [], now);
    expect(intent).toMatchObject({ kind: 'macro', needsResearch: true, range: '1N', forecast: true, targetDate: '2026-09-21' });
  });

  it('produces bounded downside, base, and upside ranges from seven-day changes', () => {
    const records = Array.from({ length: 120 }, (_, index) => {
      const date = shiftDate('2026-05-18', index);
      const buy = 140 + index * 0.05;
      return point(date, buy, buy + 3);
    });
    const result = calculateForecast(
      market(records),
      '2026-09-21',
      new Date('2026-09-14T01:00:00.000Z'),
    );
    expect(result.status).toBe('experimental');
    expect(result.anchorDate).toBe('2026-09-14');
    expect(result.targetDate).toBe('2026-09-21');
    expect(result.pairCount).toBeGreaterThanOrEqual(60);
    expect(result.ranges).toHaveLength(3);
    expect(result.ranges.every((range) =>
      (range.buyVndPerLuong ?? 0) <= (range.sellVndPerLuong ?? 0),
    )).toBe(true);
  });

  it('refuses a fallback snapshot instead of presenting it as a forecast', () => {
    const records = Array.from({ length: 120 }, (_, index) => {
      const date = shiftDate('2026-05-18', index);
      return point(date, 140 + index * 0.05, 143 + index * 0.05);
    });
    const result = calculateForecast(
      market(records, 'fallback'),
      '2026-09-21',
      new Date('2026-09-14T01:00:00.000Z'),
    );
    expect(result.status).toBe('unavailable');
    expect(result.ranges).toHaveLength(0);
  });

  it('includes the target date and ranges in the deterministic fallback answer', () => {
    const records = Array.from({ length: 120 }, (_, index) => {
      const date = shiftDate('2026-05-18', index);
      const buy = 140 + index * 0.05;
      return point(date, buy, buy + 3);
    });
    const selectedGroups = selectQuoteGroups(resolveIntent('dự đoán giá vàng tuần sau'), 'sjc', 'bar-1l');
    const context = buildMarketContext(
      selectedGroups,
      [market(records)],
      resolveIntent('dự đoán giá vàng tuần sau'),
      '1N',
      new Date('2026-09-14T01:00:00.000Z'),
    );
    const forecast = calculateForecast(market(records), '2026-09-21', new Date('2026-09-14T01:00:00.000Z'));
    const answer = factualAnswer(context, resolveIntent('dự đoán giá vàng tuần sau'), 'vi', forecast);
    expect(answer).toContain('2026-09-21');
    expect(answer).toContain('Kịch bản cơ sở');
  });
});
