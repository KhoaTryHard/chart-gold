import { describe, expect, it } from 'vitest';

import {
  calculateGoldOutcome,
  convertGoldQuantity,
} from '@/components/market/converter-panel';

describe('free community gold tools', () => {
  it('converts Vietnam gold units using the fixed market convention', () => {
    expect(convertGoldQuantity(5, 'chi')).toBe(0.5);
    expect(convertGoldQuantity(37.5, 'gram')).toBe(1);
    expect(convertGoldQuantity(1, 'luong')).toBe(1);
  });

  it('calculates cost, breakeven, and profit with fees without an AI call', () => {
    expect(
      calculateGoldOutcome({
        quantityLuongs: 0.5,
        costPerLuong: 100_000_000,
        buybackPerLuong: 101_000_000,
        fees: 100_000,
      }),
    ).toMatchObject({
      invested: 50_100_000,
      proceeds: 50_500_000,
      pnl: 400_000,
      breakeven: 100_200_000,
    });
  });
});
