import { describe, expect, it } from 'vitest';

import {
  calculateAdditionalPurchase,
  calculateGoldOutcome,
  convertGoldQuantity,
} from '@/lib/gold-calculator';

describe('gold calculator', () => {
  it('normalizes Vietnamese gold units', () => {
    expect(convertGoldQuantity(2, 'chi')).toBe(0.2);
    expect(convertGoldQuantity(37.5, 'gram')).toBe(1);
    expect(convertGoldQuantity(1, 'luong')).toBe(1);
  });

  it('calculates profit and breakeven with multiple purchases and fees', () => {
    const result = calculateGoldOutcome({
      purchases: [
        { quantity: 2, unit: 'chi', priceMode: 'per-luong', unitPriceVnd: 140_000_000, feeVnd: 20_000 },
        { quantity: 3, unit: 'chi', priceMode: 'per-luong', unitPriceVnd: 145_000_000, feeVnd: 30_000 },
      ],
      sellPriceVndPerLuong: 144_000_000,
      sellFeeVnd: 50_000,
    });

    expect(result.quantityLuong).toBeCloseTo(0.5);
    expect(result.totalCostVnd).toBe(71_550_000);
    expect(result.averageCostVndPerLuong).toBe(143_100_000);
    expect(result.breakevenVndPerLuong).toBe(143_200_000);
    expect(result.netProceedsVnd).toBe(71_950_000);
    expect(result.pnlVnd).toBe(400_000);
  });

  it('keeps purchase price and selling venue as separate inputs', () => {
    const base = { purchases: [{ quantity: 1, unit: 'luong' as const, priceMode: 'per-luong' as const, unitPriceVnd: 140_000_000 }] };
    const otherVenue = calculateGoldOutcome({ ...base, sellPriceVndPerLuong: 138_000_000 });
    expect(otherVenue.pnlVnd).toBe(-2_000_000);
  });

  it('explains a real Vietnamese two-chi transaction with fees', () => {
    const result = calculateGoldOutcome({
      purchases: [
        {
          quantity: 2,
          unit: 'chi',
          priceMode: 'total',
          totalGoldVnd: 29_000_000,
        },
      ],
      sellPriceVndPerLuong: 140_000_000,
      sellFeeVnd: 50_000,
    });

    expect(result.netProceedsVnd).toBe(27_950_000);
    expect(result.pnlVnd).toBe(-1_050_000);
    expect(result.breakevenVndPerLuong).toBe(145_250_000);
  });

  it('simulates buying more without mutating the original inputs', () => {
    const current = { purchases: [{ quantity: 1, unit: 'luong' as const, priceMode: 'per-luong' as const, unitPriceVnd: 140_000_000 }], sellPriceVndPerLuong: 145_000_000 };
    const after = calculateAdditionalPurchase(current, { quantity: 1, unit: 'luong', priceMode: 'per-luong', unitPriceVnd: 150_000_000 });
    expect(after.averageCostVndPerLuong).toBe(145_000_000);
    expect(current.purchases).toHaveLength(1);
  });
});

