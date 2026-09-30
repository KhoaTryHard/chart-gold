export type PlanCode = 'trial' | 'basic' | 'plus' | 'pro';

export type AiCapability = 'standard' | 'research' | 'portfolio' | 'deep';

export type CommunityAllowance = {
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
  capabilities: AiCapability[];
};

export type SubscriptionAllowance = {
  plan: Exclude<PlanCode, 'trial'>;
  planName: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  capabilities: AiCapability[];
  periodId: string;
  periodEnd: string;
};

export type EntitlementView = {
  billingEnabled: boolean;
  salesEnabled: boolean;
  plan: PlanCode | 'none';
  planName: string;
  hasAccess: boolean;
  unlimited: boolean;
  used: number;
  limit: number | null;
  remaining: number | null;
  capabilities: AiCapability[];
  periodId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  nextPeriodEnd: string | null;
  community: CommunityAllowance | null;
  subscription: SubscriptionAllowance | null;
  accessSource: 'community' | 'subscription' | 'admin' | null;
  budget: {
    monthUsedVnd: number;
    monthLimitVnd: number;
    dayUsedVnd: number;
    dayLimitVnd: number;
  } | null;
};

export const PLAN_RANK: Record<'basic' | 'plus' | 'pro', number> = {
  basic: 1,
  plus: 2,
  pro: 3,
};

export type PlanDefinition = {
  code: PlanCode;
  name: string;
  priceVnd: number;
  quota: number | null;
  cycleDays: number | null;
  capabilities: readonly AiCapability[];
  description: string;
  features: readonly string[];
};

export const PLAN_CATALOG = {
  trial: {
    code: 'trial',
    name: 'Dùng thử',
    priceVnd: 0,
    quota: 3,
    cycleDays: 30,
    capabilities: ['standard', 'portfolio'],
    description:
      'Ba lượt phân tích cơ bản mỗi tháng lịch sau khi đăng nhập Google.',
    features: [
      'Giá và so sánh',
      'Spread, hòa vốn, lãi/lỗ cơ bản',
      'Đọc sổ vàng do bạn chủ động nhập',
    ],
  },
  basic: {
    code: 'basic',
    name: 'Basic',
    priceVnd: 49_000,
    quota: 30,
    cycleDays: 30,
    capabilities: ['standard'],
    description: 'Theo dõi và phân tích chuẩn cho nhu cầu hằng ngày.',
    features: ['30 lượt / 30 ngày', 'Giá, xếp hạng, lãi/lỗ, spread'],
  },
  plus: {
    code: 'plus',
    name: 'Plus',
    priceVnd: 99_000,
    quota: 20,
    cycleDays: 30,
    capabilities: ['standard', 'research', 'portfolio'],
    description: 'Gói beta phân tích khoản vàng cá nhân trong 30 ngày.',
    features: [
      '20 lượt phân tích hoàn tất / 30 ngày',
      'Nguồn trích dẫn và kịch bản danh mục',
      'Hồ sơ đầu tư và sổ vàng',
    ],
  },
  pro: {
    code: 'pro',
    name: 'Pro',
    priceVnd: 199_000,
    quota: 300,
    cycleDays: 30,
    capabilities: ['standard', 'research', 'portfolio', 'deep'],
    description: 'Phân tích sâu nhiều kịch bản với ngữ cảnh dài hơn.',
    features: [
      '300 lượt / 30 ngày',
      'Phân tích 1–4 tuần, 1–3 tháng, 6–12 tháng',
      'Output và ngữ cảnh chuyên sâu',
    ],
  },
} as const satisfies Record<PlanCode, PlanDefinition>;

export const PAID_PLANS = ['basic', 'plus', 'pro'] as const;
export type PaidPlanCode = (typeof PAID_PLANS)[number];

/** The first paid beta sells one understandable product; the full ladder stays
 * available in the catalog for existing records and a later pricing decision. */
export const BETA_PAID_PLANS = ['plus'] as const satisfies readonly PaidPlanCode[];

export function getPlan(code: PlanCode) {
  return PLAN_CATALOG[code];
}

export function isPaidPlan(code: PlanCode): code is PaidPlanCode {
  return PAID_PLANS.includes(code as PaidPlanCode);
}

export function planHasCapability(plan: PlanCode, capability: AiCapability) {
  return (PLAN_CATALOG[plan].capabilities as readonly AiCapability[]).includes(
    capability,
  );
}

export function requiredPlanForCapability(capability: AiCapability) {
  return capability === 'deep'
    ? 'pro'
    : capability === 'standard'
      ? 'basic'
      : 'plus';
}

function normalizeQuestion(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

export function questionNeedsPortfolio(question: string) {
  return /danh muc|so giao dich|so vang|lo vang|da mua|dang giu|chot loi|lai lo|portfolio/.test(
    normalizeQuestion(question),
  );
}

export function requiredCapability({
  question,
  needsResearch,
  depth,
}: {
  question: string;
  needsResearch: boolean;
  depth: 'short' | 'standard' | 'deep';
}): AiCapability {
  if (depth === 'deep') return 'deep';
  if (needsResearch) return 'research';
  if (questionNeedsPortfolio(question)) return 'portfolio';
  return 'standard';
}

export function formatVnd(value: number) {
  return `${value.toLocaleString('vi-VN')}đ`;
}

export function formatPlanDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        dateStyle: 'medium',
      }).format(date)
    : '—';
}

export function subscriptionPlacement({
  plan,
  now,
  active,
  scheduled,
}: {
  plan: PaidPlanCode;
  now: Date;
  active?: { plan: PaidPlanCode; endsAt: Date };
  scheduled?: { plan: PaidPlanCode; startsAt: Date; endsAt: Date };
}) {
  const targetRank = PLAN_RANK[plan];
  const activeRank = active ? PLAN_RANK[active.plan] : 0;
  const scheduledRank = scheduled ? PLAN_RANK[scheduled.plan] : 0;
  const isQueuedRenewal =
    (active && targetRank <= activeRank) ||
    (!active && scheduled && targetRank <= scheduledRank);
  const startsAt = isQueuedRenewal
    ? new Date(
        Math.max(
          active?.endsAt.getTime() ?? now.getTime(),
          scheduled?.endsAt.getTime() ?? now.getTime(),
        ),
      )
    : now;
  return {
    status: isQueuedRenewal ? ('scheduled' as const) : ('active' as const),
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 24 * 60 * 60 * 1_000),
    revokeExisting: !isQueuedRenewal,
  };
}
