import type { Session } from 'next-auth';
import type { AiCapability, EntitlementView } from '@/lib/billing/plans';
import type { Locale } from '@/lib/i18n';
import {
  subscriptionsEnabled,
  databaseConfigured,
  subscriptionSalesEnabled,
} from '@/lib/billing/config';
import { estimateAiReservationVnd } from '@/lib/billing/ai-budget';
import { analysisExperienceV2Enabled } from './experience';

export type AnalysisAccess = {
  account: { email: string; name: string | null } | null;
  authenticated: boolean;
  isAdmin: boolean;
  canAnalyze: boolean;
  code: string | null;
  message: string;
  capabilities: AiCapability[];
  remaining: number | null;
  unlimited: boolean;
  salesEnabled: boolean;
  community?: EntitlementView['community'];
  subscription?: EntitlementView['subscription'];
  accessSource?: EntitlementView['accessSource'];
};

export class AnalysisAccessError extends Error {
  constructor(
    public readonly code: 'AI_ACCESS_UNAVAILABLE' | 'AI_IDENTITY_CONFLICT',
    message: string,
    public readonly status = 503,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AnalysisAccessError';
  }
}

/** Login and AI access are different states. Both API entrypoints use this gate. */
export function analysisAccess(
  session: Session | null,
  version = 2,
  locale: Locale = 'vi',
): AnalysisAccess {
  const english = locale === 'en';
  const authenticated = Boolean(session?.user?.email);
  const isAdmin = authenticated && session?.user?.isAdmin === true;
  const base: AnalysisAccess = {
    account: authenticated
      ? {
          email: session!.user.email!.trim().toLowerCase(),
          name: session!.user.name?.trim() || null,
        }
      : null,
    authenticated,
    isAdmin,
    canAnalyze: false,
    code: null,
    message: '',
    capabilities: [],
    remaining: null,
    unlimited: isAdmin,
    salesEnabled: subscriptionSalesEnabled(),
    community: null,
    subscription: null,
    accessSource: isAdmin ? 'admin' : null,
  };
  if (!authenticated)
    return {
      ...base,
      code: 'AUTH_REQUIRED',
      message: english
        ? 'Sign in with Google to submit your question. Your draft will be kept.'
        : 'Đăng nhập Google để gửi câu hỏi. Bản nháp sẽ được giữ lại.',
    };
  if (isAdmin)
    return {
      ...base,
      canAnalyze: true,
      capabilities: ['standard', 'portfolio', 'research', 'deep'],
      accessSource: 'admin',
      message: english ? 'Administrator account · AI Analysis is available.' : 'Tài khoản quản trị · có quyền dùng Phân tích AI.',
    };
  if (!subscriptionsEnabled())
    return {
      ...base,
      code: 'AI_ACCESS_DISABLED',
      message: english
        ? 'You are signed in. AI Analysis is currently limited to the testing group; this account has not been granted access.'
        : 'Bạn đã đăng nhập. Phân tích AI hiện chỉ mở cho nhóm thử nghiệm; tài khoản này chưa được cấp quyền.',
    };
  if (version === 2 && !analysisExperienceV2Enabled())
    return {
      ...base,
      code: 'AI_V2_DISABLED',
      message: english
        ? 'You are signed in, but the new AI experience is not enabled for this account. You can still use the existing AI on the price table.'
        : 'Bạn đã đăng nhập, nhưng trải nghiệm AI mới chưa được mở cho tài khoản này. Bạn vẫn có thể dùng AI hiện có trên bảng giá.',
    };
  if (!databaseConfigured())
    return {
      ...base,
      code: 'AI_UNAVAILABLE',
      message: english ? 'AI is not available yet. Please try again later.' : 'Dịch vụ AI đang chưa sẵn sàng. Vui lòng thử lại sau.',
    };
  return { ...base, canAnalyze: true, message: english ? 'Signed in.' : 'Đã đăng nhập.' };
}

export function accessWithEntitlement(
  access: AnalysisAccess,
  entitlement: EntitlementView,
  capability?: AiCapability,
  locale: Locale = 'vi',
): AnalysisAccess {
  const english = locale === 'en';
  if (!access.canAnalyze || access.isAdmin) return access;
  const base = {
    ...access,
    capabilities: entitlement.capabilities,
    remaining: entitlement.remaining,
    unlimited: entitlement.unlimited,
    salesEnabled: entitlement.salesEnabled,
    community: entitlement.community,
    subscription: entitlement.subscription,
    accessSource: entitlement.accessSource,
  };
  if (!entitlement.hasAccess || entitlement.remaining === 0)
    return {
      ...base,
      canAnalyze: false,
      code: 'QUOTA_EXHAUSTED',
      message: entitlement.community
        ? english
          ? `You have used all community AI analyses for this month. Your quota resets in the next Vietnam calendar month.`
          : `Bạn đã dùng hết lượt AI cộng đồng trong tháng này. Lượt mới sẽ có vào tháng lịch Việt Nam tiếp theo.`
        : english ? 'You have used all AI requests for this period.' : 'Bạn đã hết lượt AI trong kỳ này.',
    };
  if (capability && !entitlement.capabilities.includes(capability))
    return {
      ...base,
      canAnalyze: false,
      code: 'PLAN_REQUIRED',
      message: entitlement.salesEnabled
        ? english ? 'Your plan does not include this analysis depth. Choose Standard or review the available plans.' : 'Gói hiện tại chưa hỗ trợ mức phân tích này. Hãy chọn Thông thường hoặc xem gói sử dụng.'
        : english ? 'This account does not include this analysis depth. Choose Standard and ask about prices, comparisons, or calculations.' : 'Tài khoản hiện chưa hỗ trợ mức phân tích này. Hãy chọn Thông thường và hỏi về giá, so sánh hoặc phép tính.',
    };
  const budget = entitlement.budget;
  const reserve = estimateAiReservationVnd(capability ?? 'standard');
  if (
    budget &&
    (budget.dayUsedVnd + reserve > budget.dayLimitVnd ||
      budget.monthUsedVnd + reserve > budget.monthLimitVnd)
  )
    return {
      ...base,
      canAnalyze: false,
      code: 'AI_BUDGET_EXHAUSTED',
      message: english
        ? 'The AI operating limit has been reached. Please try later; the profit/loss calculator remains available.'
        : 'Hạn mức vận hành AI đã chạm trần. Vui lòng thử lại sau; công cụ tính lãi/lỗ vẫn dùng được.',
    };
  return {
    ...base,
    message: entitlement.unlimited
      ? english ? 'AI access is available.' : 'Có quyền sử dụng AI.'
      : entitlement.accessSource === 'community' && entitlement.community
        ? english
          ? `${entitlement.community.remaining}/${entitlement.community.limit} community analyses remain this month.`
          : `Còn ${entitlement.community.remaining}/${entitlement.community.limit} lượt AI cộng đồng trong tháng này.`
        : english
          ? `${entitlement.remaining} AI requests remain this period.`
          : `Còn ${entitlement.remaining} lượt AI trong kỳ này.`,
  };
}

export async function readAnalysisAccess(
  session: Session | null,
  capability?: AiCapability,
  locale: Locale = 'vi',
) {
  const access = analysisAccess(session, 2, locale);
  if (!access.canAnalyze || access.isAdmin) return access;
  const { ensureSessionUser, getEntitlement } =
    await import('@/lib/billing/server');
  try {
    const user = await ensureSessionUser(session!);
    return accessWithEntitlement(
      access,
      await getEntitlement(user),
      capability,
      locale,
    );
  } catch (error) {
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'AI_IDENTITY_CONFLICT'
        ? 'AI_IDENTITY_CONFLICT'
        : 'AI_ACCESS_UNAVAILABLE';
    const details =
      error &&
      typeof error === 'object' &&
      'details' in error &&
      (error as { details?: unknown }).details &&
      typeof (error as { details?: unknown }).details === 'object'
        ? ((error as { details: Record<string, unknown> }).details ?? {})
        : {};
    throw new AnalysisAccessError(
      code,
      locale === 'en'
        ? code === 'AI_IDENTITY_CONFLICT'
          ? 'This Google account is linked to a different account. Sign out and choose the correct Google account.'
          : 'AI access could not be checked right now. Select Check again; no AI request has been used.'
        : code === 'AI_IDENTITY_CONFLICT'
          ? 'Tài khoản Google này đang liên kết với tài khoản khác. Hãy đăng xuất và chọn đúng tài khoản Google.'
          : 'Chưa thể kiểm tra quyền AI lúc này. Bấm Kiểm tra lại; chưa có lượt AI nào được sử dụng.',
      503,
      details,
    );
  }
}
