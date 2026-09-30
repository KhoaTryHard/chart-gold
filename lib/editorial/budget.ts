import 'server-only';

import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { editorialCostLedger } from '@/db/schema';
import { vietnamLocalDate } from './time';

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

export function editorialBudgetConfig() {
  return {
    monthlyLimitVnd: numberEnv('EDITORIAL_MONTHLY_BUDGET_VND', 300_000),
    dailyLimitVnd: numberEnv('EDITORIAL_DAILY_BUDGET_VND', 10_000),
    textInputVndPer1k: numberEnv('EDITORIAL_TEXT_INPUT_VND_PER_1K', 50),
    textOutputVndPer1k: numberEnv('EDITORIAL_TEXT_OUTPUT_VND_PER_1K', 300),
    maxOutputTokens: numberEnv('EDITORIAL_MAX_OUTPUT_TOKENS', 2_000),
    reservationVnd: numberEnv('EDITORIAL_COST_RESERVATION_VND', 2_000),
    imageReservationVnd: numberEnv(
      'EDITORIAL_IMAGE_COST_RESERVATION_VND',
      0,
    ),
  };
}

/**
 * Reserves an upper-bound estimate before a Gemini request. We use a
 * conservative four-characters-per-token approximation and settle against
 * provider usage when the provider returns it.
 */
export function estimateEditorialTextReservationVnd(input: {
  promptCharacters: number;
  outputTokens?: number;
}) {
  const config = editorialBudgetConfig();
  const inputTokens = Math.max(1, Math.ceil(input.promptCharacters / 4));
  const estimated = Math.ceil(
    (inputTokens / 1_000) * config.textInputVndPer1k +
      (Math.max(config.maxOutputTokens, input.outputTokens ?? 0) / 1_000) *
        config.textOutputVndPer1k,
  );
  return Math.max(1, estimated);
}

export function estimateEditorialTextActualVnd(input: {
  inputTokens: number | null;
  outputTokens: number | null;
}) {
  if (input.inputTokens === null || input.outputTokens === null) return null;
  const config = editorialBudgetConfig();
  return Math.max(
    1,
    Math.ceil(
      (input.inputTokens / 1_000) * config.textInputVndPer1k +
        (input.outputTokens / 1_000) * config.textOutputVndPer1k,
    ),
  );
}

export function estimateEditorialImageReservationVnd() {
  return editorialBudgetConfig().imageReservationVnd;
}

function vietnamBounds(now = new Date()) {
  const local = new Date(now.getTime() + 7 * 60 * 60 * 1_000);
  const dayStart = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
      7 * 60 * 60 * 1_000,
  );
  const monthStart = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) -
      7 * 60 * 60 * 1_000,
  );
  const nextMonthStart = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) -
      7 * 60 * 60 * 1_000,
  );
  return {
    day: {
      start: dayStart,
      end: new Date(dayStart.getTime() + 24 * 60 * 60 * 1_000),
    },
    month: { start: monthStart, end: nextMonthStart },
  };
}

const billableStatuses = ['reserved', 'settled'] as const;

async function sumLedger(
  db: ReturnType<typeof getDatabase>,
  range: { start: Date; end: Date },
) {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(coalesce(${editorialCostLedger.actualVnd}, ${editorialCostLedger.reservedVnd})), 0)::int`,
    })
    .from(editorialCostLedger)
    .where(
      and(
        inArray(editorialCostLedger.status, [...billableStatuses]),
        gte(editorialCostLedger.createdAt, range.start),
        lt(editorialCostLedger.createdAt, range.end),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function readEditorialBudget(now = new Date()) {
  const config = editorialBudgetConfig();
  const bounds = vietnamBounds(now);
  try {
    const db = getDatabase();
    const [monthUsedVnd, dayUsedVnd] = await Promise.all([
      sumLedger(db, bounds.month),
      sumLedger(db, bounds.day),
    ]);
    return {
      ...config,
      monthUsedVnd,
      dayUsedVnd,
      monthRemainingVnd: Math.max(0, config.monthlyLimitVnd - monthUsedVnd),
      dayRemainingVnd: Math.max(0, config.dailyLimitVnd - dayUsedVnd),
    };
  } catch {
    return {
      ...config,
      monthUsedVnd: 0,
      dayUsedVnd: 0,
      monthRemainingVnd: 0,
      dayRemainingVnd: 0,
      unavailable: true,
    };
  }
}

export type EditorialCostReservation = {
  idempotencyKey: string;
  entryType: 'scouting' | 'generation' | 'image' | 'rewrite' | 'translation';
  reservedVnd: number;
  provider?: string | null;
  model?: string | null;
  jobId?: string | null;
  articleId?: string | null;
  revisionId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function reserveEditorialCost(input: EditorialCostReservation) {
  const now = new Date();
  const bounds = vietnamBounds(now);
  const config = editorialBudgetConfig();
  const amount = Math.max(0, Math.round(input.reservedVnd));
  const db = getDatabase();
  return db.transaction(async (tx) => {
    // A monthly transaction lock prevents parallel workers from overspending.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`editorial-budget:${vietnamLocalDate(now).slice(0, 7)}`}))`,
    );
    const [existing] = await tx
      .select()
      .from(editorialCostLedger)
      .where(eq(editorialCostLedger.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing) {
      return {
        accepted:
          existing.status === 'reserved' || existing.status === 'settled',
        entry: existing,
        duplicate: true,
      };
    }
    const [monthUsedVnd, dayUsedVnd] = await Promise.all(
      [bounds.month, bounds.day].map(async (range) => {
        const [row] = await tx
          .select({
            total: sql<number>`coalesce(sum(coalesce(${editorialCostLedger.actualVnd}, ${editorialCostLedger.reservedVnd})), 0)::int`,
          })
          .from(editorialCostLedger)
          .where(
            and(
              inArray(editorialCostLedger.status, [...billableStatuses]),
              gte(editorialCostLedger.createdAt, range.start),
              lt(editorialCostLedger.createdAt, range.end),
            ),
          );
        return Number(row?.total ?? 0);
      }),
    );
    if (
      monthUsedVnd + amount > config.monthlyLimitVnd ||
      dayUsedVnd + amount > config.dailyLimitVnd
    ) {
      return {
        accepted: false,
        reason: 'budget' as const,
        monthRemainingVnd: Math.max(0, config.monthlyLimitVnd - monthUsedVnd),
        dayRemainingVnd: Math.max(0, config.dailyLimitVnd - dayUsedVnd),
      };
    }
    const [entry] = await tx
      .insert(editorialCostLedger)
      .values({
        idempotencyKey: input.idempotencyKey,
        entryType: input.entryType,
        status: 'reserved',
        reservedVnd: amount,
        provider: input.provider ?? null,
        model: input.model ?? null,
        jobId: input.jobId ?? null,
        articleId: input.articleId ?? null,
        revisionId: input.revisionId ?? null,
        metadata: input.metadata ?? {},
      })
      .returning();
    return { accepted: true, entry, duplicate: false };
  });
}

export async function settleEditorialCost(
  idempotencyKey: string,
  input: {
    actualVnd?: number | null;
    provider?: string | null;
    model?: string | null;
    jobAttemptId?: string | null;
  },
) {
  const [entry] = await getDatabase()
    .update(editorialCostLedger)
    .set({
      status: 'settled',
      actualVnd:
        input.actualVnd == null
          ? null
          : Math.max(0, Math.round(input.actualVnd)),
      provider: input.provider ?? null,
      model: input.model ?? null,
      jobAttemptId: input.jobAttemptId ?? null,
      settledAt: new Date(),
    })
    .where(eq(editorialCostLedger.idempotencyKey, idempotencyKey))
    .returning();
  return entry ?? null;
}

export async function releaseEditorialCost(idempotencyKey: string) {
  const [entry] = await getDatabase()
    .update(editorialCostLedger)
    .set({ status: 'released', releasedAt: new Date() })
    .where(eq(editorialCostLedger.idempotencyKey, idempotencyKey))
    .returning();
  return entry ?? null;
}
