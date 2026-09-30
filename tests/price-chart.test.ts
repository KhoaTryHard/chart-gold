import { describe, expect, it } from 'vitest';

import {
  chooseLabelIndexes,
  chooseResponsiveLabelLayout,
  getPriceRangeStats,
  type PricePoint,
} from '@/lib/price-chart';

const records: PricePoint[] = [
  { date: '2026-09-01', buy: 140, sell: 142, spread: 2, eventId: null },
  { date: '2026-09-02', buy: 141, sell: 143, spread: 2, eventId: null },
  { date: '2026-09-03', buy: 139, sell: 141, spread: 2, eventId: null },
  { date: '2026-09-04', buy: 144, sell: 146, spread: 2, eventId: null },
  { date: '2026-09-05', buy: 143, sell: 145, spread: 2, eventId: null },
];

describe('price chart helpers', () => {
  it('calculates statistics for the selected range', () => {
    expect(getPriceRangeStats(records, 1, 3)).toMatchObject({
      first: records[1],
      latest: records[3],
      change: 3,
      percent: expect.closeTo((3 / 143) * 100, 8),
      highestSell: 146,
      lowestSell: 141,
    });
  });

  it('keeps first, last and extrema labels separated', () => {
    const indexes = chooseLabelIndexes(records, 0, records.length - 1, 120, 56);
    expect(indexes).toEqual([0, 2, 4]);
  });

  it('limits responsive labels and keeps the latest/extreme values', () => {
    const wide = chooseResponsiveLabelLayout(
      records,
      0,
      records.length - 1,
      { x: 0, y: 0, width: 400, height: 220 },
      (index) => 30 + index * 80,
      (series, index) =>
        series === 'sell' ? 130 - records[index].sell : 160 - records[index].buy,
    );
    const narrow = chooseResponsiveLabelLayout(
      records,
      0,
      records.length - 1,
      { x: 0, y: 0, width: 220, height: 220 },
      (index) => 20 + index * 42,
      (series, index) =>
        series === 'sell' ? 130 - records[index].sell : 160 - records[index].buy,
    );

    expect(wide.sell.size + wide.buy.size).toBeLessThanOrEqual(6);
    expect(narrow.sell.size + narrow.buy.size).toBeLessThanOrEqual(4);
    expect(wide.sell.has(4)).toBe(true);
    expect(wide.buy.has(4)).toBe(true);
    expect(narrow.sell.has(4)).toBe(true);
    expect(narrow.buy.has(4)).toBe(true);
  });

  it('drops labels whose measured boxes collide', () => {
    const layout = chooseResponsiveLabelLayout(
      records,
      0,
      records.length - 1,
      { x: 0, y: 0, width: 400, height: 220 },
      () => 120,
      () => 100,
    );

    expect(layout.sell.size + layout.buy.size).toBeLessThan(6);
  });
});
