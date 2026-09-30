import { afterEach, describe, expect, it } from 'vitest';

import {
  aiBudgetConfig,
  communityAiMonthlyLimit,
  donationPaymentPrefix,
  donationsEnabled,
  subscriptionSalesEnabled,
} from '@/lib/billing/config';
import {
  estimateAiCostVnd,
  estimateAiReservationVnd,
  vietnamDayBounds,
  vietnamMonthBounds,
} from '@/lib/billing/ai-budget';

const original = new Map<string, string | undefined>();

function remember(name: string) {
  if (!original.has(name)) original.set(name, process.env[name]);
}

afterEach(() => {
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  original.clear();
});

describe('90-day community policy', () => {
  it('keeps donation and subscription sales switches independent', () => {
    remember('DONATIONS_ENABLED');
    remember('SUBSCRIPTIONS_SALES_ENABLED');
    delete process.env.DONATIONS_ENABLED;
    delete process.env.SUBSCRIPTIONS_SALES_ENABLED;
    expect(donationsEnabled()).toBe(true);
    expect(subscriptionSalesEnabled()).toBe(false);
    process.env.DONATIONS_ENABLED = 'false';
    process.env.SUBSCRIPTIONS_SALES_ENABLED = 'true';
    expect(donationsEnabled()).toBe(false);
    expect(subscriptionSalesEnabled()).toBe(true);
  });

  it('creates separate DN order prefixes and applies community budget defaults', () => {
    remember('DONATION_PAYMENT_PREFIX');
    remember('AI_MONTHLY_BUDGET_VND');
    remember('AI_DAILY_BUDGET_VND');
    remember('AI_COST_RESERVATION_VND');
    remember('AI_SUBSCRIPTION_MONTHLY_BUDGET_VND');
    remember('AI_SUBSCRIPTION_DAILY_BUDGET_VND');
    remember('AI_COMMUNITY_MONTHLY_LIMIT');
    delete process.env.DONATION_PAYMENT_PREFIX;
    delete process.env.AI_MONTHLY_BUDGET_VND;
    delete process.env.AI_DAILY_BUDGET_VND;
    delete process.env.AI_COST_RESERVATION_VND;
    delete process.env.AI_SUBSCRIPTION_MONTHLY_BUDGET_VND;
    delete process.env.AI_SUBSCRIPTION_DAILY_BUDGET_VND;
    delete process.env.AI_COMMUNITY_MONTHLY_LIMIT;
    expect(donationPaymentPrefix()).toBe('DN');
    expect(aiBudgetConfig()).toEqual({
      monthlyLimitVnd: 300_000,
      dailyLimitVnd: 10_000,
      subscriptionMonthlyLimitVnd: 300_000,
      subscriptionDailyLimitVnd: 30_000,
      reservationVnd: 1_000,
      inputCostPer1kVnd: -1,
      outputCostPer1kVnd: -1,
    });
    expect(communityAiMonthlyLimit()).toBe(3);
  });

  it('uses Vietnam calendar boundaries rather than a rolling 30-day window', () => {
    const value = new Date('2026-08-31T17:30:00.000Z');
    const month = vietnamMonthBounds(value);
    const day = vietnamDayBounds(value);
    expect(month.start.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(month.end.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(day.start.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(day.end.toISOString()).toBe('2026-09-01T17:00:00.000Z');
  });

  it('honors optional token pricing and falls back to the reservation estimate', () => {
    remember('AI_INPUT_COST_PER_1K_VND');
    remember('AI_OUTPUT_COST_PER_1K_VND');
    remember('AI_COST_RESERVATION_VND');
    process.env.AI_INPUT_COST_PER_1K_VND = '100';
    process.env.AI_OUTPUT_COST_PER_1K_VND = '200';
    expect(
      estimateAiCostVnd({
        usage: { inputTokens: 1_500, outputTokens: 2_000, totalTokens: 3_500 },
      }),
    ).toBe(550);
    delete process.env.AI_INPUT_COST_PER_1K_VND;
    delete process.env.AI_OUTPUT_COST_PER_1K_VND;
    process.env.AI_COST_RESERVATION_VND = '10000';
    expect(
      estimateAiCostVnd({
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      }),
    ).toBe(10_000);
    process.env.AI_INPUT_COST_PER_1K_VND = '100';
    process.env.AI_OUTPUT_COST_PER_1K_VND = '200';
    expect(estimateAiReservationVnd('deep')).toBeGreaterThan(
      estimateAiReservationVnd('standard'),
    );
  });
});
