import { describe, expect, it } from 'vitest';

import { resolveMarketQuote } from '@/lib/market-quote';

const baseResponse = {
  company: { id: 'pnj' },
  product: { id: 'pnj-ring-9999' },
  latest: { buy: 143.2 },
  mode: 'live' as const,
  availability: 'available' as const,
  observedAt: '2026-09-08T13:19:00.000Z',
  source: { provider: 'PNJ official', url: 'https://example.test/pnj' },
};

describe('market quote resolution', () => {
  it('accepts only the requested product and converts million VND once', () => {
    const resolved = resolveMarketQuote(baseResponse, 'pnj', 'pnj-ring-9999');
    expect(resolved).toMatchObject({
      priceVndPerLuong: 143_200_000,
      canAutofill: true,
      status: 'live',
    });
  });

  it('rejects a quote returned for another brand or product', () => {
    const resolved = resolveMarketQuote(baseResponse, 'pnj', 'pnj-sjc-hcm');
    expect(resolved.priceVndPerLuong).toBeNull();
    expect(resolved.canAutofill).toBe(false);
    expect(resolved.reason).toContain('không khớp');
  });

  it('keeps delayed quotes available as explicit references without autofill', () => {
    const resolved = resolveMarketQuote(
      { ...baseResponse, mode: 'delayed' },
      'pnj',
      'pnj-ring-9999',
    );
    expect(resolved.priceVndPerLuong).toBe(143_200_000);
    expect(resolved.canAutofill).toBe(false);
  });

  it('does not turn a missing, zero, or negative buy price into a quote', () => {
    for (const buy of [null, 0, -1]) {
      const resolved = resolveMarketQuote(
        { ...baseResponse, latest: { buy } },
        'pnj',
        'pnj-ring-9999',
      );
      expect(resolved.priceVndPerLuong).toBeNull();
      expect(resolved.canAutofill).toBe(false);
    }
  });
});


