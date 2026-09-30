import { describe, expect, it } from 'vitest';

import {
  buildHistoryCoverage,
  enumerateCalendarDates,
  filterRecordsByCalendarWindow,
  getCalendarWindow,
  mergeRecordsByDate,
} from '@/lib/market-history';
import { getMarketHistoryCapability } from '@/lib/market-sources';

describe('market history calendar windows', () => {
  it('uses calendar days instead of the number of available observations', () => {
    expect(getCalendarWindow(365, '2026-09-09')).toEqual({
      start: '2025-09-10',
      end: '2026-09-09',
    });
    expect(getCalendarWindow(365, '2028-02-29')).toEqual({
      start: '2027-03-02',
      end: '2028-02-29',
    });
    expect(enumerateCalendarDates('2026-09-07', '2026-09-09')).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ]);
  });

  it('does not let 365 sparse records escape the requested calendar window', () => {
    const sparse = [
      { date: '2025-08-29' },
      { date: '2025-09-10' },
      { date: '2026-09-09' },
    ];
    expect(filterRecordsByCalendarWindow(sparse, 365, '2026-09-09')).toEqual([
      { date: '2025-09-10' },
      { date: '2026-09-09' },
    ]);
  });

  it('overlays the live point only on the same verified date', () => {
    expect(
      mergeRecordsByDate(
        [
          { date: '2026-09-08', value: 1 },
          { date: '2026-09-09', value: 2 },
        ],
        [{ date: '2026-09-09', value: 3 }],
      ),
    ).toEqual([
      { date: '2026-09-08', value: 1 },
      { date: '2026-09-09', value: 3 },
    ]);
  });

  it('only advertises annual history for the verified annual sources', () => {
    expect(getMarketHistoryCapability('sjc', 'bar-1l')).toBe('annual');
    expect(getMarketHistoryCapability('pnj', 'pnj-ring-9999')).toBe('annual');
    expect(getMarketHistoryCapability('btmh', 'btmh-kgb')).toBe('annual');
    expect(getMarketHistoryCapability('btmh', 'btmh-bt-tkc')).toBe('annual');
    expect(getMarketHistoryCapability('sjc', 'ring-1c')).toBe('rolling-30');
    expect(getMarketHistoryCapability('phuquy', 'phuquy-ring-9999')).toBe(
      'rolling-7',
    );
    expect(getMarketHistoryCapability('vgj', 'vgj-bar-sjc-1l')).toBe(
      'snapshot',
    );
  });

  it('distinguishes checked market closures from unresolved upstream errors', () => {
    const dates = ['2026-09-07', '2026-09-08', '2026-09-09'];
    expect(
      buildHistoryCoverage(
        dates,
        new Map([
          ['2026-09-07', 'ok'],
          ['2026-09-08', 'missing'],
          ['2026-09-09', 'ok'],
        ]),
      ),
    ).toEqual({ status: 'ready', missingDates: ['2026-09-08'] });
    expect(
      buildHistoryCoverage(
        dates,
        new Map([
          ['2026-09-07', 'ok'],
          ['2026-09-08', 'error'],
        ]),
      ),
    ).toEqual({
      status: 'partial',
      missingDates: ['2026-09-08', '2026-09-09'],
    });
  });
});
