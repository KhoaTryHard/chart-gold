import 'server-only';

import { randomBytes } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import type { Session } from 'next-auth';

import { getDatabase, type AppDatabase } from '@/db';
import {
  aiUsageEvents,
  billingAuditEvents,
  donationOrders,
  paymentOrders,
  sepayTransactions,
  subscriptionPeriods,
  users,
} from '@/db/schema';
import {
  AI_RESERVATION_TTL_MS,
  aiBudgetConfig,
  DONATION_ORDER_TTL_MS,
  donationPaymentPrefix,
  donationsEnabled,
  SEPAY_ORDER_TTL_MS,
  subscriptionSalesEnabled,
  databaseConfigured,
  communityAiMonthlyLimit,
  sepayConfigured,
  sepayPaymentPrefix,
  subscriptionsEnabled,
} from './config';
import {
  budgetBounds,
  budgetSumCondition,
  estimateAiCostVnd,
  estimateAiReservationVnd,
} from './ai-budget';
import {
  vietnamMonthKey,
  vietnamMonthBounds,
} from './dates';
import {
  formatPlanDate,
  getPlan,
  isPaidPlan,
  subscriptionPlacement,
  type AiCapability,
  type EntitlementView,
  type PaidPlanCode,
  type PlanCode,
  type SubscriptionAllowance,
} from './plans';
import {
  buildSepayQrUrl,
  extractSepayPaymentCode,
  maskBankAccount,
  normalizeBankAccount,
  parseSepayTransactionDate,
  sha256Hex,
  validateSepayPayment,
  type SepayWebhookPayload,
} from './sepay';
import { isAdminEmail } from '@/lib/auth-authorization';

export type BillingIdentity = {
  /** Legacy field retained for callers; JWT-only Auth.js ids are not stable. */
  id?: string | null;
  googleSubject?: string | null;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  isAdmin?: boolean;
};

export type BillingUser = typeof users.$inferSelect;
export type EntitlementPlan = PlanCode | 'none';

export type UserEntitlement = EntitlementView;

export class BillingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

type DbExecutor = Pick<AppDatabase, 'select' | 'insert' | 'update' | 'execute'>;
type TransactionalDb = DbExecutor & {
  transaction?: <T>(callback: (tx: DbExecutor) => Promise<T>) => Promise<T>;
};

function nowDate(value?: Date) {
  return value ?? new Date();
}

function databaseTimestamp(value: unknown, fallback: Date) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return fallback;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isAdminUser(user: BillingUser | BillingIdentity) {
  return (
    ('isAdmin' in user && user.isAdmin === true) ||
    ('role' in user && user.role === 'admin') ||
    isAdminEmail(user.email)
  );
}

function countAlias() {
  return sql<number>`count(*)::int`.as('count');
}

function usageWindowCondition(now: Date) {
  const reservationCutoff = new Date(now.getTime() - AI_RESERVATION_TTL_MS);
  return or(
    eq(aiUsageEvents.status, 'completed'),
    and(
      eq(aiUsageEvents.status, 'reserved'),
      gt(aiUsageEvents.reservedAt, reservationCutoff),
    ),
  );
}

async function countUsage(
  db: DbExecutor,
  userId: string,
  bucket: 'trial' | 'subscription' | 'community',
  periodId: string | null,
  now: Date,
) {
  const bounds =
    bucket === 'trial'
      ? vietnamMonthBounds(now)
      : bucket === 'community'
        ? vietnamMonthBounds(now)
        : null;
  const conditions = [
    eq(aiUsageEvents.userId, userId),
    eq(aiUsageEvents.bucket, bucket),
    usageWindowCondition(now),
    periodId === null
      ? isNull(aiUsageEvents.periodId)
      : eq(aiUsageEvents.periodId, periodId),
    ...(bounds
      ? [
          gte(aiUsageEvents.reservedAt, bounds.start),
          lt(aiUsageEvents.reservedAt, bounds.end),
        ]
      : []),
  ];
  const [row] = await db
    .select({ count: countAlias() })
    .from(aiUsageEvents)
    .where(and(...conditions));
  return Number(row?.count ?? 0);
}

async function readAiBudget(
  db: DbExecutor,
  now: Date,
  bucket?: 'community' | 'subscription',
) {
  const config = aiBudgetConfig();
  const bounds = budgetBounds(now);
  const totals = await Promise.all(
    [bounds.month, bounds.day].map(async ({ start, end }) => {
      const [row] = await db
        .select({
          total: sql<number>`coalesce(sum(${aiUsageEvents.costVnd}), 0)::int`,
        })
        .from(aiUsageEvents)
        .where(budgetSumCondition(start, end, bucket));
      return Number(row?.total ?? 0);
    }),
  );
  return {
    monthUsedVnd: totals[0],
    monthLimitVnd: bucket === 'subscription'
      ? config.subscriptionMonthlyLimitVnd
      : bucket === 'community'
        ? config.monthlyLimitVnd
        : config.monthlyLimitVnd + config.subscriptionMonthlyLimitVnd,
    dayUsedVnd: totals[1],
    dayLimitVnd: bucket === 'subscription'
      ? config.subscriptionDailyLimitVnd
      : bucket === 'community'
        ? config.dailyLimitVnd
        : config.dailyLimitVnd + config.subscriptionDailyLimitVnd,
  };
}

async function readEntitlement(
  db: DbExecutor,
  user: BillingUser,
  now: Date,
): Promise<UserEntitlement> {
  if (isAdminUser(user))
    return {
      billingEnabled: subscriptionsEnabled(),
      salesEnabled: subscriptionSalesEnabled(),
      plan: 'pro',
      planName: 'Quản trị',
      hasAccess: true,
      unlimited: true,
      used: 0,
      limit: null,
      remaining: null,
      capabilities: ['standard', 'research', 'portfolio', 'deep'],
      periodId: null,
      periodStart: null,
      periodEnd: null,
      nextPeriodEnd: null,
      community: null,
      subscription: null,
      accessSource: 'admin',
      budget: null,
    };

  const [currentRow] = await db
    .select()
    .from(subscriptionPeriods)
    .where(
      and(
        eq(subscriptionPeriods.userId, user.id),
        inArray(subscriptionPeriods.status, ['active', 'scheduled']),
        lte(subscriptionPeriods.startsAt, now),
        gt(subscriptionPeriods.endsAt, now),
      ),
    )
    .orderBy(desc(subscriptionPeriods.startsAt))
    .limit(1);
  const current =
    currentRow?.status === 'scheduled'
      ? ((
          await db
            .update(subscriptionPeriods)
            .set({ status: 'active', updatedAt: now })
            .where(
              and(
                eq(subscriptionPeriods.id, currentRow.id),
                eq(subscriptionPeriods.status, 'scheduled'),
              ),
            )
            .returning()
        )[0] ?? { ...currentRow, status: 'active' as const })
      : currentRow;
  if (currentRow?.status === 'scheduled' && current?.status === 'active')
    await db.insert(billingAuditEvents).values({
      userId: user.id,
      eventType: 'subscription_promoted',
      entityType: 'subscription_period',
      entityId: current.id,
      metadata: { plan: current.plan },
      createdAt: now,
    });
  let plan: EntitlementPlan = 'none';
  let subscription: SubscriptionAllowance | null = null;
  let periodId: string | null = null;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  if (current && isPaidPlan(current.plan)) {
    plan = current.plan;
    const used = await countUsage(db, user.id, 'subscription', current.id, now);
    const remaining = Math.max(0, current.quotaLimit - used);
    periodId = current.id;
    periodStart = current.startsAt.toISOString();
    periodEnd = current.endsAt.toISOString();
    subscription = {
      plan: current.plan,
      planName: getPlan(current.plan).name,
      used,
      limit: current.quotaLimit,
      remaining,
      capabilities: [...getPlan(current.plan).capabilities],
      periodId: current.id,
      periodEnd,
    };
  }

  const communityLimit = subscriptionsEnabled() ? communityAiMonthlyLimit() : 0;
  const communityUsed = communityLimit
    ? await countUsage(db, user.id, 'community', null, now)
    : 0;
  const community = communityLimit
    ? {
        limit: communityLimit,
        used: communityUsed,
        remaining: Math.max(0, communityLimit - communityUsed),
        resetAt: vietnamMonthBounds(now).end.toISOString(),
        capabilities: [
          'standard',
          'research',
          'portfolio',
          'deep',
        ] as AiCapability[],
      }
    : null;
  const accessSource =
    community && community.remaining > 0
      ? ('community' as const)
      : subscription &&
          (subscription.remaining === null || subscription.remaining > 0)
        ? ('subscription' as const)
        : null;
  const effective =
    accessSource === 'community'
      ? community
      : accessSource === 'subscription'
        ? subscription
        : null;
  const [next] = await db
    .select({ endsAt: subscriptionPeriods.endsAt })
    .from(subscriptionPeriods)
    .where(
      and(
        eq(subscriptionPeriods.userId, user.id),
        eq(subscriptionPeriods.status, 'scheduled'),
        gt(subscriptionPeriods.endsAt, now),
      ),
    )
    .orderBy(desc(subscriptionPeriods.endsAt))
    .limit(1);
  return {
    billingEnabled: subscriptionsEnabled(),
    salesEnabled: subscriptionSalesEnabled(),
    plan,
    planName: plan === 'none' ? 'Cộng đồng' : getPlan(plan).name,
    hasAccess: Boolean(effective),
    unlimited: false,
    used: effective?.used ?? 0,
    limit: effective?.limit ?? 0,
    remaining: effective?.remaining ?? 0,
    capabilities: effective ? [...effective.capabilities] : [],
    periodId,
    periodStart,
    periodEnd,
    nextPeriodEnd: next?.endsAt.toISOString() ?? null,
    community,
    subscription,
    accessSource,
    budget: await readAiBudget(
      db,
      now,
      accessSource === 'subscription' ? 'subscription' : 'community',
    ),
  };
}

export async function ensureBillingUser(
  identity: BillingIdentity,
  db = getDatabase(),
  now = new Date(),
) {
  const email = identity.email ? normalizeEmail(identity.email) : '';
  if (!email) throw new BillingError('NO_EMAIL', 'Tài khoản thiếu email.', 401);
  // Auth.js JWT sessions before this fix only exposed a random user id. Use an
  // email fallback for those sessions and never let that fallback replace a
  // stable subject already linked to the account.
  const requestedSubject =
    identity.googleSubject?.trim().slice(0, 255) || `email:${email}`;
  const role = isAdminEmail(email) ? 'admin' : 'user';
  const requestedStableSubject = requestedSubject !== `email:${email}`;
  const transactionalDb = db as TransactionalDb;

  const reconcile = async (executor: DbExecutor) => {
    const [subjectUser] = await executor
      .select()
      .from(users)
      .where(eq(users.googleSubject, requestedSubject))
      .limit(1);
    const [emailUser] = await executor
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (subjectUser && subjectUser.email !== email)
      throw new BillingError(
        'AI_IDENTITY_CONFLICT',
        'Google account không khớp với email tài khoản hiện tại.',
        409,
      );

    const existing = subjectUser ?? emailUser;
    if (existing) {
      const existingStableSubject =
        existing.googleSubject !== `email:${email}` &&
        !isLegacyAuthJsUserId(existing.googleSubject);

      if (
        emailUser &&
        emailUser.googleSubject !== requestedSubject &&
        existingStableSubject &&
        requestedStableSubject
      )
        throw new BillingError(
          'AI_IDENTITY_CONFLICT',
          'Google account này đã được liên kết với một tài khoản khác.',
          409,
        );

      const nextSubject =
        requestedStableSubject &&
        (!existingStableSubject || existing.googleSubject === requestedSubject)
          ? requestedSubject
          : existing.googleSubject;
      const [updated] = await executor
        .update(users)
        .set({
          googleSubject: nextSubject,
          name: identity.name?.trim().slice(0, 200) || null,
          image: identity.image?.trim() || null,
          role,
          updatedAt: now,
          lastLoginAt: now,
        })
        .where(eq(users.id, existing.id))
        .returning();
      if (updated) return updated;
    }

    const [created] = await executor
      .insert(users)
      .values({
        googleSubject: requestedSubject,
        email,
        name: identity.name?.trim().slice(0, 200) || null,
        image: identity.image?.trim() || null,
        role,
        lastLoginAt: now,
      })
      .returning();
    if (created) return created;

    throw new BillingError(
      'USER_UPSERT_FAILED',
      'Không tạo được tài khoản.',
      503,
    );
  };

  try {
    if (typeof transactionalDb.transaction === 'function')
      return await transactionalDb.transaction(reconcile);
    return await reconcile(transactionalDb);
  } catch (error) {
    // A failed insert aborts a PostgreSQL transaction, so the re-read must
    // happen after the transaction has rolled back. The second reconciliation
    // sees the row committed by the competing tab/device.
    if (isUniqueViolation(error)) {
      try {
        return await reconcile(transactionalDb);
      } catch (retryError) {
        if (retryError instanceof BillingError) throw retryError;
        throw new BillingError(
          'AI_ACCESS_UNAVAILABLE',
          'Không thể đồng bộ tài khoản AI lúc này. Vui lòng thử lại.',
          503,
        );
      }
    }
    if (error instanceof BillingError) throw error;
    throw new BillingError(
      'AI_ACCESS_UNAVAILABLE',
      'Không thể đồng bộ tài khoản AI lúc này. Vui lòng thử lại.',
      503,
      { databaseCode: databaseErrorCode(error) },
    );
  }
}

function isLegacyAuthJsUserId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505',
  );
}

function databaseErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : 'UNKNOWN';
}

export async function ensureSessionUser(session: Session, db = getDatabase()) {
  return ensureBillingUser(
    {
      googleSubject: session.user.googleSubject,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
      isAdmin: session.user.isAdmin,
    },
    db,
  );
}

/** Product funnel event with deliberately content-free metadata. */
export async function recordProductEvent({
  userId,
  eventType,
  entityType = 'product_usage',
  metadata = {},
  db = getDatabase(),
  now = new Date(),
}: {
  userId?: string | null;
  eventType: string;
  entityType?: string;
  metadata?: Record<string, unknown>;
  db?: AppDatabase;
  now?: Date;
}) {
  await db.insert(billingAuditEvents).values({
    userId: userId ?? null,
    eventType: eventType.slice(0, 60),
    entityType: entityType.slice(0, 60),
    metadata,
    createdAt: now,
  });
}

export async function getEntitlement(
  user: BillingUser,
  db = getDatabase(),
  now = new Date(),
) {
  return readEntitlement(db, user, now);
}

export type UsageReservation = {
  id: string | null;
  userId: string;
  entitlement: UserEntitlement;
};

export async function reserveAiUsage({
  user,
  clientRequestId,
  capability,
  now: providedNow,
  db = getDatabase(),
}: {
  user: BillingUser;
  clientRequestId: string;
  capability: AiCapability;
  now?: Date;
  db?: AppDatabase;
}): Promise<UsageReservation> {
  const initialNow = nowDate(providedNow);
  if (isAdminUser(user))
    return {
      id: null,
      userId: user.id,
      entitlement: await readEntitlement(db, user, initialNow),
    };

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`,
    );
    const clock = providedNow
      ? null
      : await tx.execute(sql<{ now: Date }>`select clock_timestamp() as now`);
    const databaseClock = clock?.rows[0]?.now;
    const now: Date =
      providedNow ?? databaseTimestamp(databaseClock, initialNow);
    const [existing] = await tx
      .select()
      .from(aiUsageEvents)
      .where(
        and(
          eq(aiUsageEvents.userId, user.id),
          eq(aiUsageEvents.clientRequestId, clientRequestId),
        ),
      )
      .limit(1);
    if (existing?.status === 'completed' || existing?.status === 'refunded')
      throw new BillingError(
        'DUPLICATE_REQUEST',
        'Yêu cầu này đã được tính trước đó.',
        409,
      );
    if (
      existing?.status === 'reserved' &&
      existing.reservedAt.getTime() > now.getTime() - AI_RESERVATION_TTL_MS
    )
      throw new BillingError(
        'REQUEST_IN_PROGRESS',
        'Yêu cầu này đang được xử lý.',
        409,
      );

    if (existing?.status === 'reserved') {
      await tx
        .update(aiUsageEvents)
        .set({ status: 'refunded' })
        .where(eq(aiUsageEvents.id, existing.id));
      throw new BillingError(
        'REQUEST_EXPIRED',
        'Yêu cầu trước đã hết thời gian chờ. Hãy gửi lại câu hỏi.',
        409,
      );
    }

    const [active] = await tx
      .select({ id: aiUsageEvents.id })
      .from(aiUsageEvents)
      .where(
        and(
          eq(aiUsageEvents.userId, user.id),
          eq(aiUsageEvents.status, 'reserved'),
          gt(
            aiUsageEvents.reservedAt,
            new Date(now.getTime() - AI_RESERVATION_TTL_MS),
          ),
        ),
      )
      .limit(1);
    if (active)
      throw new BillingError(
        'REQUEST_IN_PROGRESS',
        'Đang có một phiên phân tích khác đang chạy.',
        409,
      );

    const entitlement = await readEntitlement(tx, user, now);
    if (!entitlement.hasAccess || entitlement.remaining === 0)
      throw new BillingError(
        'QUOTA_EXHAUSTED',
        'Bạn đã dùng hết lượt AI trong tháng này. Lượt mới sẽ có vào đầu tháng lịch Việt Nam tiếp theo.',
        402,
        { entitlement },
      );
    if (!entitlement.capabilities.includes(capability))
      throw new BillingError(
        'PLAN_REQUIRED',
        'Chế độ phân tích này chưa khả dụng cho lượt hiện tại.',
        403,
        { entitlement },
      );

    // The budget is global, so serialize the check across different users as
    // well as the per-user quota reservation above.
    await tx.execute(sql`select pg_advisory_xact_lock(424242)`);
    const budget = aiBudgetConfig();
    const budgetBucket =
      entitlement.accessSource === 'subscription' ? 'subscription' : 'community';
    const monthlyLimitVnd = budgetBucket === 'subscription'
      ? budget.subscriptionMonthlyLimitVnd
      : budget.monthlyLimitVnd;
    const dailyLimitVnd = budgetBucket === 'subscription'
      ? budget.subscriptionDailyLimitVnd
      : budget.dailyLimitVnd;
    const budgetTotals = await Promise.all(
      [vietnamMonthBounds(now), budgetBounds(now).day].map(
        async ({ start, end }) => {
          const [row] = await tx
            .select({
              total: sql<number>`coalesce(sum(${aiUsageEvents.costVnd}), 0)::int`,
            })
            .from(aiUsageEvents)
            .where(budgetSumCondition(start, end, budgetBucket));
          return Number(row?.total ?? 0);
        },
      ),
    );
    const reservationVnd = estimateAiReservationVnd(capability);
    if (
      budgetTotals[0] + reservationVnd > monthlyLimitVnd ||
      budgetTotals[1] + reservationVnd > dailyLimitVnd
    ) {
      await tx.insert(billingAuditEvents).values({
        userId: user.id,
        eventType: 'ai_budget_reached',
        entityType: 'ai_usage',
        metadata: {
          monthUsedVnd: budgetTotals[0],
          dayUsedVnd: budgetTotals[1],
        },
        createdAt: now,
      });
      throw new BillingError(
        'AI_BUDGET_EXHAUSTED',
        'Hạn mức chi phí AI của giai đoạn này đã chạm trần. Công cụ tính toán vẫn dùng được, vui lòng thử lại sau.',
        429,
        { entitlement },
      );
    }

    const values = {
      userId: user.id,
      clientRequestId,
      bucket:
        entitlement.accessSource === 'subscription'
          ? ('subscription' as const)
          : ('community' as const),
      periodId:
        entitlement.accessSource === 'subscription'
          ? entitlement.periodId
          : null,
      capability,
      status: 'reserved' as const,
      reservedAt: now,
      costVnd: reservationVnd,
    };
    const [row] = await tx
      .insert(aiUsageEvents)
      .values(values)
      .returning({ id: aiUsageEvents.id });
    if (!row)
      throw new BillingError(
        'RESERVATION_FAILED',
        'Không giữ được lượt AI.',
        503,
      );
    const nextUsed = entitlement.used + 1;
    const nextCommunity =
      entitlement.accessSource === 'community' && entitlement.community
        ? {
            ...entitlement.community,
            used: entitlement.community.used + 1,
            remaining: Math.max(0, entitlement.community.remaining - 1),
          }
        : entitlement.community;
    const nextSubscription =
      entitlement.accessSource === 'subscription' && entitlement.subscription
        ? {
            ...entitlement.subscription,
            used: entitlement.subscription.used + 1,
            remaining:
              entitlement.subscription.remaining === null
                ? null
                : Math.max(0, entitlement.subscription.remaining - 1),
          }
        : entitlement.subscription;
    return {
      id: row.id,
      userId: user.id,
      entitlement: {
        ...entitlement,
        used: nextUsed,
        remaining:
          entitlement.limit === null
            ? null
            : Math.max(0, entitlement.limit - nextUsed),
        community: nextCommunity,
        subscription: nextSubscription,
      },
    };
  });
}

/** Increase the same reservation before an automatic provider retry. */
export async function extendAiUsageReservation({
  id,
  capability,
  db = getDatabase(),
  now = new Date(),
}: {
  id: string | null;
  capability: AiCapability;
  db?: AppDatabase;
  now?: Date;
}) {
  if (!id) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(424242)`);
    const [reservation] = await tx
      .select()
      .from(aiUsageEvents)
      .where(and(eq(aiUsageEvents.id, id), eq(aiUsageEvents.status, 'reserved')))
      .limit(1);
    if (!reservation) return;
    const config = aiBudgetConfig();
    const bucket = reservation.bucket === 'subscription' ? 'subscription' : 'community';
    const reservationVnd = estimateAiReservationVnd(capability);
    const limits = bucket === 'subscription'
      ? { month: config.subscriptionMonthlyLimitVnd, day: config.subscriptionDailyLimitVnd }
      : { month: config.monthlyLimitVnd, day: config.dailyLimitVnd };
    const bounds = [vietnamMonthBounds(now), budgetBounds(now).day];
    const totals = await Promise.all(bounds.map(async ({ start, end }) => {
      const [row] = await tx
        .select({ total: sql<number>`coalesce(sum(${aiUsageEvents.costVnd}), 0)::int` })
        .from(aiUsageEvents)
        .where(budgetSumCondition(start, end, bucket));
      return Number(row?.total ?? 0);
    }));
    if (
      totals[0] + reservationVnd > limits.month ||
      totals[1] + reservationVnd > limits.day
    )
      throw new BillingError(
        'AI_BUDGET_EXHAUSTED',
        'Hạn mức chi phí AI đã chạm trần; không thể thử lại lúc này.',
        429,
      );
    await tx
      .update(aiUsageEvents)
      .set({ costVnd: sql`${aiUsageEvents.costVnd} + ${reservationVnd}` })
      .where(and(eq(aiUsageEvents.id, id), eq(aiUsageEvents.status, 'reserved')));
  });
}

export async function completeAiUsage({
  id,
  provider,
  model,
  usage,
  durationMs,
  db = getDatabase(),
  now = new Date(),
}: {
  id: string | null;
  provider: string;
  model: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  } | null;
  durationMs: number;
  db?: AppDatabase;
  now?: Date;
}) {
  if (!id) return;
  await db
    .update(aiUsageEvents)
    .set({
      status: 'completed',
      completedAt: now,
      provider: provider.slice(0, 40),
      model: model.slice(0, 120),
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      durationMs: Math.max(0, Math.round(durationMs)),
      costVnd: estimateAiCostVnd({ usage }),
    })
    .where(and(eq(aiUsageEvents.id, id), eq(aiUsageEvents.status, 'reserved')));
}

export async function refundAiUsage(
  id: string | null,
  options: { providerStarted?: boolean } = {},
  db = getDatabase(),
) {
  if (!id) return;
  await db
    .update(aiUsageEvents)
    .set({
      status: 'refunded',
      ...(options.providerStarted ? {} : { costVnd: 0 }),
    })
    .where(and(eq(aiUsageEvents.id, id), eq(aiUsageEvents.status, 'reserved')));
}

function createOrderCode() {
  return `${sepayPaymentPrefix()}${randomBytes(8)
    .toString('hex')
    .toUpperCase()
    .slice(0, 10)}`;
}

export type PaymentOrderView = {
  id: string;
  plan: PaidPlanCode;
  planName: string;
  amountVnd: number;
  orderCode: string;
  status: 'pending' | 'paid' | 'needs_review' | 'expired' | 'cancelled';
  expiresAt: string;
  paidAt: string | null;
  qrUrl: string | null;
};

export type DonationOrderView = {
  id: string;
  accessToken: string | null;
  amountVnd: number;
  orderCode: string;
  createdAt: string;
  serverTime: string;
  displayName: string | null;
  isAnonymous: boolean;
  status: 'pending' | 'paid' | 'needs_review' | 'expired' | 'cancelled';
  expiresAt: string;
  paidAt: string | null;
  qrUrl: string | null;
  bankCode: string;
  accountNumber: string;
  accountHolder: string;
};

function paymentOrderView(order: typeof paymentOrders.$inferSelect) {
  const plan = isPaidPlan(order.plan) ? order.plan : 'basic';
  return {
    id: order.id,
    plan,
    planName: getPlan(plan).name,
    amountVnd: order.amountVnd,
    orderCode: order.orderCode,
    status: order.status,
    expiresAt: order.expiresAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    qrUrl:
      order.status === 'pending'
        ? buildSepayQrUrl({
            amountVnd: order.amountVnd,
            orderCode: order.orderCode,
          })
        : null,
  } satisfies PaymentOrderView;
}

function createDonationOrderCode() {
  return `${donationPaymentPrefix()}${randomBytes(8)
    .toString('hex')
    .toUpperCase()
    .slice(0, 10)}`;
}

function donationOrderView(
  order: typeof donationOrders.$inferSelect,
  accessToken?: string,
  serverTime = new Date(),
) {
  const bankCode = process.env.SEPAY_BANK_CODE?.trim() ?? '';
  const accountNumber = normalizeBankAccount(
    process.env.SEPAY_ACCOUNT_NUMBER ?? '',
  );
  const accountHolder = process.env.SEPAY_ACCOUNT_HOLDER?.trim() ?? '';
  return {
    id: order.id,
    accessToken: accessToken ?? null,
    amountVnd: order.amountVnd,
    orderCode: order.orderCode,
    createdAt: order.createdAt.toISOString(),
    serverTime: serverTime.toISOString(),
    displayName: order.displayName,
    isAnonymous: order.isAnonymous,
    status: order.status,
    expiresAt: order.expiresAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    qrUrl:
      order.status === 'pending'
        ? buildSepayQrUrl({
            amountVnd: order.amountVnd,
            orderCode: order.orderCode,
          })
        : null,
    bankCode,
    accountNumber,
    accountHolder,
  } satisfies DonationOrderView;
}

export async function createDonationOrder({
  amountVnd,
  displayName,
  isAnonymous,
  userId = null,
  reusePending = true,
  db = getDatabase(),
  now: providedNow,
}: {
  amountVnd: number;
  displayName?: string | null;
  isAnonymous: boolean;
  userId?: string | null;
  reusePending?: boolean;
  db?: AppDatabase;
  now?: Date;
}) {
  if (!donationsEnabled())
    throw new BillingError('DONATIONS_DISABLED', 'Ủng hộ đang tạm đóng.', 404);
  if (!databaseConfigured())
    throw new BillingError(
      'BILLING_NOT_CONFIGURED',
      'Chưa cấu hình database.',
      503,
    );
  if (!sepayConfigured())
    throw new BillingError(
      'PAYMENT_NOT_CONFIGURED',
      'Chưa cấu hình tài khoản nhận ủng hộ.',
      503,
    );
  if (
    !Number.isSafeInteger(amountVnd) ||
    amountVnd < 1_000 ||
    amountVnd > 10_000_000
  )
    throw new BillingError(
      'INVALID_DONATION_AMOUNT',
      'Số tiền ủng hộ phải từ 1.000đ đến 10.000.000đ.',
      400,
    );
  const now = nowDate(providedNow);
  const accessToken = randomBytes(24).toString('base64url');
  let reusedPending = false;
  const normalizedDisplayName = isAnonymous
    ? null
    : displayName
      ? normalizeDonationDisplayName(displayName) || null
      : null;
  if (!isAnonymous && !normalizedDisplayName)
    throw new BillingError(
      'DISPLAY_NAME_REQUIRED',
      'Vui lòng nhập tên hiển thị hoặc chọn ẩn danh.',
      400,
    );
  const order = await db.transaction(async (tx) => {
    if (userId && reusePending !== false) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(donationOrders)
        .where(
          and(
            eq(donationOrders.userId, userId),
            eq(donationOrders.amountVnd, amountVnd),
            eq(donationOrders.isAnonymous, isAnonymous),
            eq(donationOrders.status, 'pending'),
            gt(donationOrders.expiresAt, now),
            normalizedDisplayName
              ? eq(donationOrders.displayName, normalizedDisplayName)
              : isNull(donationOrders.displayName),
          ),
        )
        .orderBy(desc(donationOrders.createdAt))
        .limit(1);
      if (existing) {
        reusedPending = true;
        return existing;
      }
    }
    const [created] = await tx
      .insert(donationOrders)
      .values({
        userId,
        accessTokenHash: sha256Hex(accessToken),
        amountVnd,
        orderCode: createDonationOrderCode(),
        displayName: normalizedDisplayName,
        isAnonymous,
        leaderboardOptIn: Boolean(!isAnonymous && normalizedDisplayName),
        status: 'pending',
        expiresAt: new Date(now.getTime() + DONATION_ORDER_TTL_MS),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) throw new Error('Donation order insert failed');
    await tx.insert(billingAuditEvents).values({
      eventType: 'donation_checkout_created',
      entityType: 'donation_order',
      entityId: created.id,
      metadata: { amountVnd, isAnonymous },
      createdAt: now,
    });
    return created;
  });
  return donationOrderView(order, reusedPending ? undefined : accessToken, now);
}

export async function updateDonationOrderDetails({
  orderId,
  accessToken,
  user,
  isAnonymous,
  displayName,
  db = getDatabase(),
  now: providedNow,
}: {
  orderId: string;
  accessToken?: string | null;
  user?: BillingUser | null;
  isAnonymous: boolean;
  displayName?: string | null;
  db?: AppDatabase;
  now?: Date;
}) {
  const now = nowDate(providedNow);
  const [order] = await db
    .select()
    .from(donationOrders)
    .where(eq(donationOrders.id, orderId))
    .limit(1);
  const ownsOrder = Boolean(
    order &&
    ((user && (isAdminUser(user) || order.userId === user.id)) ||
      (order.accessTokenHash &&
        accessToken &&
        sha256Hex(accessToken) === order.accessTokenHash)),
  );
  if (!order || !ownsOrder)
    throw new BillingError(
      'DONATION_NOT_FOUND',
      'Không tìm thấy đơn ủng hộ.',
      404,
    );
  if (order.status !== 'pending')
    throw new BillingError(
      'DONATION_NOT_EDITABLE',
      'Chỉ có thể sửa thông tin khi đơn đang chờ thanh toán.',
      409,
    );
  const normalizedName = isAnonymous
    ? null
    : displayName
      ? normalizeDonationDisplayName(displayName) || null
      : null;
  if (!isAnonymous && !normalizedName)
    throw new BillingError(
      'DISPLAY_NAME_REQUIRED',
      'Vui lòng nhập tên hiển thị hoặc chọn ẩn danh.',
      400,
    );
  const [updated] = await db
    .update(donationOrders)
    .set({
      displayName: normalizedName,
      isAnonymous,
      leaderboardOptIn: Boolean(!isAnonymous && normalizedName),
      updatedAt: now,
    })
    .where(
      and(eq(donationOrders.id, orderId), eq(donationOrders.status, 'pending')),
    )
    .returning();
  if (!updated)
    throw new BillingError(
      'DONATION_NOT_EDITABLE',
      'Đơn vừa chuyển trạng thái và không còn chỉnh sửa được.',
      409,
    );
  await db.insert(billingAuditEvents).values({
    userId: updated.userId,
    eventType: 'donation_checkout_updated',
    entityType: 'donation_order',
    entityId: updated.id,
    metadata: { isAnonymous, displayName: normalizedName },
    createdAt: now,
  });
  return donationOrderView(updated, undefined, now);
}

export async function createReplacementDonationOrder({
  orderId,
  accessToken,
  user,
  displayName,
  db = getDatabase(),
  now: providedNow,
}: {
  orderId: string;
  accessToken: string | null;
  user: BillingUser;
  displayName: string;
  db?: AppDatabase;
  now?: Date;
}) {
  const now = nowDate(providedNow);
  const [oldOrder] = await db
    .select()
    .from(donationOrders)
    .where(eq(donationOrders.id, orderId))
    .limit(1);
  if (!oldOrder)
    throw new BillingError(
      'DONATION_NOT_FOUND',
      'Không tìm thấy đơn ủng hộ.',
      404,
    );
  const ownsOrder =
    isAdminUser(user) ||
    oldOrder.userId === user.id ||
    Boolean(
      oldOrder.accessTokenHash &&
      accessToken &&
      sha256Hex(accessToken) === oldOrder.accessTokenHash,
    );
  if (!ownsOrder)
    throw new BillingError(
      'DONATION_NOT_FOUND',
      'Không tìm thấy đơn ủng hộ.',
      404,
    );
  if (oldOrder.status === 'paid')
    throw new BillingError(
      'DONATION_ALREADY_PAID',
      'Khoản ủng hộ đã được xác nhận, không cần tạo mã mới.',
      409,
    );
  const normalizedName = displayName.trim().slice(0, 120);
  if (!normalizedName)
    throw new BillingError(
      'DISPLAY_NAME_REQUIRED',
      'Vui lòng nhập tên hiển thị.',
      400,
    );
  return createDonationOrder({
    amountVnd: oldOrder.amountVnd,
    displayName: normalizedName,
    isAnonymous: false,
    userId: user.id,
    reusePending: false,
    db,
    now,
  });
}

export async function getDonationOrder(
  orderId: string,
  user: BillingUser | null = null,
  accessToken: string | null = null,
  db = getDatabase(),
  now = new Date(),
) {
  const [order] = await db
    .select()
    .from(donationOrders)
    .where(eq(donationOrders.id, orderId))
    .limit(1);
  const ownsOrder = Boolean(
    user && (isAdminUser(user) || order?.userId === user.id),
  );
  const hasValidToken = Boolean(
    order?.accessTokenHash &&
    accessToken &&
    sha256Hex(accessToken) === order.accessTokenHash,
  );
  if (
    !order ||
    (order.userId && !ownsOrder && !hasValidToken) ||
    (!order.userId && order.accessTokenHash && !hasValidToken)
  )
    throw new BillingError(
      'DONATION_NOT_FOUND',
      'Không tìm thấy đơn ủng hộ.',
      404,
    );
  if (order.status === 'pending' && order.expiresAt <= now) {
    const [expired] = await db
      .update(donationOrders)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(donationOrders.id, order.id),
          eq(donationOrders.status, 'pending'),
        ),
      )
      .returning();
    return donationOrderView(expired ?? { ...order, status: 'expired' });
  }
  return donationOrderView(order);
}

export async function getDonationSummary(db = getDatabase(), now = new Date()) {
  const { start, end } = vietnamMonthBounds(now);
  const [row] = await db
    .select({
      donationCount: sql<number>`count(*)::int`,
      amountVnd: sql<number>`coalesce(sum(${donationOrders.amountVnd}), 0)::int`,
    })
    .from(donationOrders)
    .where(
      and(
        eq(donationOrders.status, 'paid'),
        gte(donationOrders.paidAt, start),
        lt(donationOrders.paidAt, end),
      ),
    );
  const operatingCostVnd = Number(process.env.OPERATING_COST_MONTHLY_VND);
  return {
    month: vietnamMonthKey(now),
    donationCount: Number(row?.donationCount ?? 0),
    amountVnd: Number(row?.amountVnd ?? 0),
    operatingCostVnd:
      Number.isSafeInteger(operatingCostVnd) && operatingCostVnd >= 0
        ? operatingCostVnd
        : null,
    updatedAt: now.toISOString(),
  };
}

export type DonationLeaderboardRow = {
  rank: number;
  displayName: string;
  amountVnd: number;
};

function normalizeDonationDisplayName(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 120);
}

export async function getDonationLeaderboard(
  period: 'month' | 'all' = 'month',
  db = getDatabase(),
  now = new Date(),
): Promise<DonationLeaderboardRow[]> {
  const { start, end } = vietnamMonthBounds(now);
  const donorKey = sql<string>`case
    when ${donationOrders.userId} is not null
      then 'user:' || ${donationOrders.userId}::text
    else 'guest:' || lower(regexp_replace(trim(coalesce(${donationOrders.displayName}, '')), '\\s+', ' ', 'g'))
  end`;
  const rows = await db
    .select({
      donorKey,
      displayName: sql<string | null>`max(${donationOrders.displayName})`,
      amountVnd: sql<number>`sum(${donationOrders.amountVnd})::int`,
      firstPaidAt: sql<Date>`min(${donationOrders.paidAt})`,
    })
    .from(donationOrders)
    .where(
      and(
        eq(donationOrders.status, 'paid'),
        or(
          eq(donationOrders.leaderboardOptIn, true),
          and(
            eq(donationOrders.isAnonymous, false),
            sql`${donationOrders.displayName} is not null`,
            sql`length(trim(${donationOrders.displayName})) > 0`,
          ),
        ),
        period === 'month'
          ? and(
              gte(donationOrders.paidAt, start),
              lt(donationOrders.paidAt, end),
            )
          : undefined,
      ),
    )
    .groupBy(donorKey)
    .orderBy(
      desc(sql`sum(${donationOrders.amountVnd})`),
      asc(sql`min(${donationOrders.paidAt})`),
      asc(donorKey),
    )
    .limit(10);
  return rows.map((row, index) => ({
    rank: index + 1,
    displayName: row.displayName?.trim() || 'Nhà hảo tâm',
    amountVnd: Number(row.amountVnd ?? 0),
  }));
}

export async function createPaymentOrder({
  user,
  plan,
  db = getDatabase(),
  now: providedNow,
}: {
  user: BillingUser;
  plan: PaidPlanCode;
  db?: AppDatabase;
  now?: Date;
}) {
  if (!subscriptionSalesEnabled())
    throw new BillingError(
      'SUBSCRIPTIONS_SALES_DISABLED',
      'Thuê bao đang tạm ẩn trong giai đoạn thử nghiệm cộng đồng.',
      404,
    );
  if (!subscriptionsEnabled())
    throw new BillingError('BILLING_DISABLED', 'Đăng ký chưa được mở.', 404);
  if (!databaseConfigured())
    throw new BillingError(
      'BILLING_NOT_CONFIGURED',
      'Chưa cấu hình database.',
      503,
    );
  if (!sepayConfigured())
    throw new BillingError(
      'PAYMENT_NOT_CONFIGURED',
      'Chưa cấu hình SePay.',
      503,
    );
  const now = nowDate(providedNow);
  const expiresAt = new Date(now.getTime() + SEPAY_ORDER_TTL_MS);
  const amountVnd = getPlan(plan).priceVnd;
  const order = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(paymentOrders)
      .where(
        and(
          eq(paymentOrders.userId, user.id),
          eq(paymentOrders.plan, plan),
          eq(paymentOrders.status, 'pending'),
          gt(paymentOrders.expiresAt, now),
        ),
      )
      .orderBy(desc(paymentOrders.createdAt))
      .limit(1);
    if (existing) return existing;
    const [created] = await tx
      .insert(paymentOrders)
      .values({
        userId: user.id,
        plan,
        amountVnd,
        orderCode: createOrderCode(),
        status: 'pending',
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) throw new Error('Payment order insert failed');
    await tx.insert(billingAuditEvents).values({
      userId: user.id,
      eventType: 'checkout_created',
      entityType: 'payment_order',
      entityId: created.id,
      metadata: { plan, amountVnd },
      createdAt: now,
    });
    return created;
  });
  return paymentOrderView(order);
}

export async function getPaymentOrder(
  user: BillingUser,
  orderId: string,
  db = getDatabase(),
  now = new Date(),
) {
  const [order] = await db
    .select()
    .from(paymentOrders)
    .where(eq(paymentOrders.id, orderId))
    .limit(1);
  if (!order || (!isAdminUser(user) && order.userId !== user.id))
    throw new BillingError(
      'ORDER_NOT_FOUND',
      'Không tìm thấy đơn thanh toán.',
      404,
    );
  if (order.status === 'pending' && order.expiresAt <= now) {
    const [expired] = await db
      .update(paymentOrders)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(paymentOrders.id, order.id),
          eq(paymentOrders.status, 'pending'),
        ),
      )
      .returning();
    return paymentOrderView(expired ?? { ...order, status: 'expired' });
  }
  return paymentOrderView(order);
}

function maskUserEmail(email: string) {
  const [local, domain] = email.split('@');
  if (!domain) return 'ẩn';
  return `${local.slice(0, 2)}***@${domain}`;
}

async function createSubscriptionForPayment(
  tx: DbExecutor,
  order: typeof paymentOrders.$inferSelect,
  now: Date,
  sepayId: number,
) {
  const periods = await tx
    .select()
    .from(subscriptionPeriods)
    .where(
      and(
        eq(subscriptionPeriods.userId, order.userId),
        inArray(subscriptionPeriods.status, ['active', 'scheduled']),
      ),
    )
    .orderBy(desc(subscriptionPeriods.endsAt));
  const active = periods.find(
    (period) =>
      period.status === 'active' &&
      period.startsAt <= now &&
      period.endsAt > now,
  );
  const scheduled = periods.find((period) => period.status === 'scheduled');
  const placement = subscriptionPlacement({
    plan: order.plan as PaidPlanCode,
    now,
    active:
      active && isPaidPlan(active.plan)
        ? { plan: active.plan, endsAt: active.endsAt }
        : undefined,
    scheduled:
      scheduled && isPaidPlan(scheduled.plan)
        ? {
            plan: scheduled.plan,
            startsAt: scheduled.startsAt,
            endsAt: scheduled.endsAt,
          }
        : undefined,
  });
  if (placement.revokeExisting) {
    for (const period of periods)
      await tx
        .update(subscriptionPeriods)
        .set({ status: 'revoked', updatedAt: now })
        .where(eq(subscriptionPeriods.id, period.id));
  }
  if (active && placement.status === 'active')
    await tx
      .update(subscriptionPeriods)
      .set({ status: 'expired', updatedAt: now })
      .where(eq(subscriptionPeriods.id, active.id));
  const [period] = await tx
    .insert(subscriptionPeriods)
    .values({
      userId: order.userId,
      plan: order.plan,
      status: placement.status,
      startsAt: placement.startsAt,
      endsAt: placement.endsAt,
      quotaLimit: getPlan(order.plan).quota ?? 0,
      amountVnd: order.amountVnd,
      paymentOrderId: order.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!period) throw new Error('Subscription period insert failed');
  await tx.insert(billingAuditEvents).values({
    userId: order.userId,
    eventType:
      placement.status === 'active'
        ? 'subscription_activated'
        : 'subscription_scheduled',
    entityType: 'subscription_period',
    entityId: period.id,
    metadata: { plan: order.plan, amountVnd: order.amountVnd, sepayId },
    createdAt: now,
  });
  return period;
}

export type SepayProcessResult =
  | { status: 'duplicate' }
  | {
      status: 'needs_review';
      reason: string;
      kind: 'subscription' | 'donation';
    }
  | { status: 'accepted'; kind: 'donation' }
  | {
      status: 'accepted';
      kind: 'subscription';
      periodStatus: 'active' | 'scheduled';
    };

export async function processSepayTransaction({
  payload,
  rawBody,
  db = getDatabase(),
  now: providedNow,
}: {
  payload: SepayWebhookPayload;
  rawBody: string;
  db?: AppDatabase;
  now?: Date;
}): Promise<SepayProcessResult> {
  const now = nowDate(providedNow);
  const expectedAccount = normalizeBankAccount(
    process.env.SEPAY_ACCOUNT_NUMBER ?? '',
  );
  const orderCode = extractSepayPaymentCode(payload, [
    donationPaymentPrefix(),
    sepayPaymentPrefix(),
  ]);
  const payloadWithOrderCode =
    orderCode && !payload.code ? { ...payload, code: orderCode } : payload;
  const transactionDate = parseSepayTransactionDate(payload.transactionDate);
  const [inserted] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(sepayTransactions)
      .values({
        sepayId: payload.id,
        gateway: payload.gateway,
        accountNumber: maskBankAccount(payload.accountNumber),
        transferType: payload.transferType,
        amountVnd: payload.transferAmount,
        donationOrderId: null,
        orderCode,
        referenceCode: payload.referenceCode?.trim() || null,
        transactionDate,
        rawBodyHash: sha256Hex(rawBody),
        status: 'needs_review',
        receivedAt: now,
      })
      .onConflictDoNothing()
      .returning({ sepayId: sepayTransactions.sepayId });
    if (!created) return [{ status: 'duplicate' } as const];
    const [paymentOrder] = orderCode
      ? await tx
          .select()
          .from(paymentOrders)
          .where(eq(paymentOrders.orderCode, orderCode))
          .limit(1)
      : [];
    const [donationOrder] =
      !paymentOrder && orderCode
        ? await tx
            .select()
            .from(donationOrders)
            .where(eq(donationOrders.orderCode, orderCode))
            .limit(1)
        : [];
    const order = paymentOrder ?? donationOrder;
    const kind = donationOrder ? 'donation' : 'subscription';
    const validation = validateSepayPayment({
      payload: payloadWithOrderCode,
      expectedAccount,
      order,
      transactionDate,
      now,
    });
    if (!validation.valid || !order) {
      if (order && transactionDate && transactionDate > order.expiresAt) {
        if (donationOrder)
          await tx
            .update(donationOrders)
            .set({ status: 'expired', updatedAt: now })
            .where(
              and(
                eq(donationOrders.id, order.id),
                inArray(donationOrders.status, ['pending', 'expired']),
              ),
            );
        else
          await tx
            .update(paymentOrders)
            .set({ status: 'expired', updatedAt: now })
            .where(
              and(
                eq(paymentOrders.id, order.id),
                inArray(paymentOrders.status, ['pending', 'expired']),
              ),
            );
      }
      await tx.insert(billingAuditEvents).values({
        userId: paymentOrder?.userId ?? null,
        eventType: donationOrder
          ? 'donation_needs_review'
          : 'payment_needs_review',
        entityType: 'sepay_transaction',
        entityId: String(payload.id),
        metadata: {
          sepayId: payload.id,
          orderCode,
          reason: validation.reason || 'không đối soát được',
        },
        createdAt: now,
      });
      return [
        {
          status: 'needs_review',
          reason: validation.reason || 'không đối soát được',
          kind,
        } as const,
      ];
    }
    if (donationOrder) {
      const [confirmedDonation] = await tx
        .update(donationOrders)
        .set({
          status: 'paid',
          paidAt: now,
          sepayTransactionId: payload.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(donationOrders.id, donationOrder.id),
            inArray(donationOrders.status, ['pending', 'expired']),
          ),
        )
        .returning({ id: donationOrders.id });
      if (!confirmedDonation) {
        await tx.insert(billingAuditEvents).values({
          eventType: 'donation_needs_review',
          entityType: 'sepay_transaction',
          entityId: String(payload.id),
          metadata: {
            sepayId: payload.id,
            orderCode,
            reason: 'đơn hàng đã được xử lý đồng thời',
          },
          createdAt: now,
        });
        return [
          {
            status: 'needs_review',
            reason: 'đơn hàng đã được xử lý đồng thời',
            kind: 'donation',
          } as const,
        ];
      }
      await tx
        .update(sepayTransactions)
        .set({ status: 'accepted', donationOrderId: donationOrder.id })
        .where(eq(sepayTransactions.sepayId, payload.id));
      await tx.insert(billingAuditEvents).values({
        eventType: 'donation_confirmed',
        entityType: 'donation_order',
        entityId: donationOrder.id,
        metadata: { amountVnd: donationOrder.amountVnd, sepayId: payload.id },
        createdAt: now,
      });
      return [{ status: 'accepted', kind: 'donation' } as const];
    }
    const period = await createSubscriptionForPayment(
      tx,
      paymentOrder!,
      now,
      payload.id,
    );
    await tx
      .update(paymentOrders)
      .set({
        status: 'paid',
        paidAt: now,
        sepayTransactionId: payload.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(paymentOrders.id, paymentOrder!.id),
          inArray(paymentOrders.status, ['pending', 'expired']),
        ),
      );
    await tx
      .update(sepayTransactions)
      .set({ status: 'accepted', paymentOrderId: paymentOrder!.id })
      .where(eq(sepayTransactions.sepayId, payload.id));
    return [
      {
        status: 'accepted',
        kind: 'subscription',
        periodStatus: period.status as 'active' | 'scheduled',
      } as const,
    ];
  });
  return inserted;
}

export async function listAdminBilling(admin: BillingUser, db = getDatabase()) {
  if (!isAdminUser(admin))
    throw new BillingError(
      'FORBIDDEN',
      'Không có quyền quản trị billing.',
      403,
    );
  const orders = await db
    .select({
      id: paymentOrders.id,
      email: users.email,
      plan: paymentOrders.plan,
      amountVnd: paymentOrders.amountVnd,
      orderCode: paymentOrders.orderCode,
      status: paymentOrders.status,
      expiresAt: paymentOrders.expiresAt,
      paidAt: paymentOrders.paidAt,
      createdAt: paymentOrders.createdAt,
    })
    .from(paymentOrders)
    .innerJoin(users, eq(paymentOrders.userId, users.id))
    .orderBy(desc(paymentOrders.createdAt))
    .limit(100);
  const donations = await db
    .select({
      id: donationOrders.id,
      userId: donationOrders.userId,
      amountVnd: donationOrders.amountVnd,
      orderCode: donationOrders.orderCode,
      status: donationOrders.status,
      isAnonymous: donationOrders.isAnonymous,
      displayName: donationOrders.displayName,
      leaderboardOptIn: donationOrders.leaderboardOptIn,
      expiresAt: donationOrders.expiresAt,
      paidAt: donationOrders.paidAt,
      createdAt: donationOrders.createdAt,
    })
    .from(donationOrders)
    .orderBy(desc(donationOrders.createdAt))
    .limit(100);
  const transactions = await db
    .select({
      sepayId: sepayTransactions.sepayId,
      orderCode: sepayTransactions.orderCode,
      amountVnd: sepayTransactions.amountVnd,
      status: sepayTransactions.status,
      gateway: sepayTransactions.gateway,
      referenceCode: sepayTransactions.referenceCode,
      receivedAt: sepayTransactions.receivedAt,
    })
    .from(sepayTransactions)
    .orderBy(desc(sepayTransactions.receivedAt))
    .limit(100);
  const audits = await db
    .select({
      id: billingAuditEvents.id,
      userId: billingAuditEvents.userId,
      actorUserId: billingAuditEvents.actorUserId,
      eventType: billingAuditEvents.eventType,
      entityType: billingAuditEvents.entityType,
      entityId: billingAuditEvents.entityId,
      metadata: billingAuditEvents.metadata,
      createdAt: billingAuditEvents.createdAt,
    })
    .from(billingAuditEvents)
    .orderBy(desc(billingAuditEvents.createdAt))
    .limit(100);
  return {
    orders: orders.map((order) => ({
      ...order,
      email: maskUserEmail(order.email),
      planName: isPaidPlan(order.plan) ? getPlan(order.plan).name : order.plan,
      expiresAt: formatPlanDate(order.expiresAt.toISOString()),
      paidAt: order.paidAt ? formatPlanDate(order.paidAt.toISOString()) : null,
      createdAt: order.createdAt.toISOString(),
    })),
    donations: donations.map((donation) => ({
      ...donation,
      displayName: donation.isAnonymous ? null : donation.displayName,
      expiresAt: formatPlanDate(donation.expiresAt.toISOString()),
      paidAt: donation.paidAt
        ? formatPlanDate(donation.paidAt.toISOString())
        : null,
      createdAt: donation.createdAt.toISOString(),
    })),
    transactions: transactions.map((transaction) => ({
      ...transaction,
      receivedAt: transaction.receivedAt.toISOString(),
    })),
    audits: audits.map((audit) => ({
      ...audit,
      metadata: audit.metadata ?? {},
      createdAt: audit.createdAt.toISOString(),
    })),
  };
}

export async function adminConfirmDonation({
  admin,
  donationId,
  sepayId,
  db = getDatabase(),
  now: providedNow,
}: {
  admin: BillingUser;
  donationId: string;
  sepayId: number;
  db?: AppDatabase;
  now?: Date;
}) {
  if (!isAdminUser(admin))
    throw new BillingError(
      'FORBIDDEN',
      'Không có quyền quản trị billing.',
      403,
    );
  const now = nowDate(providedNow);
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(donationOrders)
      .where(eq(donationOrders.id, donationId))
      .limit(1);
    const [transaction] = await tx
      .select()
      .from(sepayTransactions)
      .where(eq(sepayTransactions.sepayId, sepayId))
      .limit(1);
    if (!order || !transaction)
      throw new BillingError(
        'REVIEW_NOT_FOUND',
        'Không tìm thấy dữ liệu cần ghép.',
        404,
      );
    if (
      order.status !== 'needs_review' ||
      transaction.status !== 'needs_review'
    )
      throw new BillingError(
        'REVIEW_ALREADY_PROCESSED',
        'Dữ liệu đã được xử lý.',
        409,
      );
    if (transaction.amountVnd !== order.amountVnd)
      throw new BillingError(
        'AMOUNT_MISMATCH',
        'Số tiền giao dịch không khớp đơn.',
        400,
      );
    const [updated] = await tx
      .update(donationOrders)
      .set({
        status: 'paid',
        paidAt: now,
        sepayTransactionId: sepayId,
        updatedAt: now,
      })
      .where(
        and(
          eq(donationOrders.id, donationId),
          eq(donationOrders.status, 'needs_review'),
        ),
      )
      .returning();
    if (!updated)
      throw new BillingError(
        'REVIEW_ALREADY_PROCESSED',
        'Đơn đã được xử lý.',
        409,
      );
    await tx
      .update(sepayTransactions)
      .set({ status: 'accepted', donationOrderId: donationId })
      .where(eq(sepayTransactions.sepayId, sepayId));
    await tx.insert(billingAuditEvents).values({
      actorUserId: admin.id,
      eventType: 'admin_donation_confirmed',
      entityType: 'donation_order',
      entityId: donationId,
      metadata: { sepayId, amountVnd: order.amountVnd },
      createdAt: now,
    });
    return { status: 'paid' as const, donationId, sepayId };
  });
}

export async function adminGrantSubscription({
  admin,
  email,
  plan,
  db = getDatabase(),
  now: providedNow,
}: {
  admin: BillingUser;
  email: string;
  plan: PaidPlanCode;
  db?: AppDatabase;
  now?: Date;
}) {
  if (!isAdminUser(admin))
    throw new BillingError(
      'FORBIDDEN',
      'Không có quyền quản trị billing.',
      403,
    );
  const targetEmail = normalizeEmail(email);
  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.email, targetEmail))
    .limit(1);
  if (!target)
    throw new BillingError(
      'USER_NOT_FOUND',
      'Chưa có tài khoản này trong hệ thống.',
      404,
    );
  const now = nowDate(providedNow);
  const period = await db.transaction(async (tx) => {
    await tx
      .update(subscriptionPeriods)
      .set({ status: 'revoked', updatedAt: now })
      .where(
        and(
          eq(subscriptionPeriods.userId, target.id),
          inArray(subscriptionPeriods.status, ['active', 'scheduled']),
        ),
      );
    const [created] = await tx
      .insert(subscriptionPeriods)
      .values({
        userId: target.id,
        plan,
        status: 'active',
        startsAt: now,
        endsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
        quotaLimit: getPlan(plan).quota ?? 0,
        amountVnd: getPlan(plan).priceVnd,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) throw new Error('Admin grant failed');
    await tx.insert(billingAuditEvents).values({
      userId: target.id,
      actorUserId: admin.id,
      eventType: 'admin_grant',
      entityType: 'subscription_period',
      entityId: created.id,
      metadata: { plan },
      createdAt: now,
    });
    return created;
  });
  return {
    id: period.id,
    email: target.email,
    plan,
    endsAt: period.endsAt.toISOString(),
  };
}

export async function adminRevokeSubscription({
  admin,
  email,
  db = getDatabase(),
  now: providedNow,
}: {
  admin: BillingUser;
  email: string;
  db?: AppDatabase;
  now?: Date;
}) {
  if (!isAdminUser(admin))
    throw new BillingError(
      'FORBIDDEN',
      'Không có quyền quản trị billing.',
      403,
    );
  const targetEmail = normalizeEmail(email);
  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.email, targetEmail))
    .limit(1);
  if (!target)
    throw new BillingError(
      'USER_NOT_FOUND',
      'Chưa có tài khoản này trong hệ thống.',
      404,
    );
  const now = nowDate(providedNow);
  await db
    .update(subscriptionPeriods)
    .set({ status: 'revoked', updatedAt: now })
    .where(
      and(
        eq(subscriptionPeriods.userId, target.id),
        inArray(subscriptionPeriods.status, ['active', 'scheduled']),
      ),
    );
  await db.insert(billingAuditEvents).values({
    userId: target.id,
    actorUserId: admin.id,
    eventType: 'admin_revoke',
    entityType: 'subscription_period',
    entityId: target.id,
    metadata: {},
    createdAt: now,
  });
  return { email: target.email, revoked: true };
}

export async function getBillingUserFromSession(
  session: Session | null,
  db?: AppDatabase,
) {
  if (!session?.user?.email)
    throw new BillingError(
      'UNAUTHENTICATED',
      'Vui lòng đăng nhập bằng Google.',
      401,
    );
  if (!subscriptionsEnabled() && !session.user.isAdmin)
    throw new BillingError(
      'BILLING_DISABLED',
      'Tính năng AI B2C chưa được mở cho tài khoản này.',
      403,
    );
  return ensureSessionUser(session, db ?? getDatabase());
}
