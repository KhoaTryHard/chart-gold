import { and, eq, gte, inArray, lt } from 'drizzle-orm';

import { aiUsageEvents } from '@/db/schema';
import { aiBudgetConfig } from './config';
import type { AiCapability } from './plans';
import { vietnamDayBounds, vietnamMonthBounds } from './dates';

export { vietnamDayBounds, vietnamMonthBounds };

export function estimateAiCostVnd({
  usage,
}: {
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  } | null;
}) {
  const { inputCostPer1kVnd: inputRate, outputCostPer1kVnd: outputRate } =
    aiBudgetConfig();
  if (
    Number.isFinite(inputRate) &&
    inputRate >= 0 &&
    Number.isFinite(outputRate) &&
    outputRate >= 0 &&
    usage
  ) {
    const input = Math.max(0, usage.inputTokens ?? 0) / 1_000;
    const output = Math.max(0, usage.outputTokens ?? 0) / 1_000;
    return Math.max(0, Math.ceil(input * inputRate + output * outputRate));
  }
  return aiBudgetConfig().reservationVnd;
}

const reservationTokenCeilings: Record<
  AiCapability,
  { input: number; output: number }
> = {
  standard: { input: 4_000, output: 1_200 },
  portfolio: { input: 6_000, output: 1_800 },
  research: { input: 7_000, output: 2_000 },
  deep: { input: 10_000, output: 3_000 },
};

/**
 * A capability-specific ceiling is used before a provider request. Explicit
 * per-token prices take precedence; otherwise the configured conservative
 * reservation keeps the global operational budget bounded.
 */
export function estimateAiReservationVnd(capability: AiCapability) {
  const config = aiBudgetConfig();
  if (config.inputCostPer1kVnd < 0 || config.outputCostPer1kVnd < 0)
    return config.reservationVnd;
  const ceiling = reservationTokenCeilings[capability];
  return Math.max(
    0,
    Math.ceil(
      (ceiling.input / 1_000) * config.inputCostPer1kVnd +
        (ceiling.output / 1_000) * config.outputCostPer1kVnd,
    ),
  );
}

export function budgetSumCondition(
  start: Date,
  end: Date,
  bucket?: 'community' | 'subscription',
) {
  return and(
    gte(aiUsageEvents.reservedAt, start),
    lt(aiUsageEvents.reservedAt, end),
    // A refunded reservation can still represent a provider call that failed
    // after the request started; its cost remains for the global ceiling.
    inArray(aiUsageEvents.status, ['reserved', 'completed', 'refunded']),
    bucket ? eq(aiUsageEvents.bucket, bucket) : undefined,
  );
}

export function budgetBounds(now: Date) {
  return {
    month: vietnamMonthBounds(now),
    day: vietnamDayBounds(now),
  };
}
