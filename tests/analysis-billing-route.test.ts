import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class BillingErrorMock extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: number,
      public readonly details: Record<string, unknown> = {},
    ) {
      super(message);
    }
  }
  return {
    BillingErrorMock,
    auth: vi.fn(),
    enabled: vi.fn(),
    databaseConfigured: vi.fn(),
    ensureSessionUser: vi.fn(),
    getEntitlement: vi.fn(),
    reserveAiUsage: vi.fn(),
    extendAiUsageReservation: vi.fn(),
    completeAiUsage: vi.fn(),
    refundAiUsage: vi.fn(),
    recordProductEvent: vi.fn().mockResolvedValue(undefined),
    classifyIntent: vi.fn(),
    loadMarketContext: vi.fn(),
    createAnalysisProvider: vi.fn(),
    requiredCapability: vi.fn(),
    checkRateLimit: vi.fn(),
    rateLimitKey: vi.fn(),
  };
});

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/billing/config', () => ({
  subscriptionSalesEnabled: () => false,
  subscriptionsEnabled: mocks.enabled,
  databaseConfigured: mocks.databaseConfigured,
}));
vi.mock('@/lib/billing/server', () => ({
  BillingError: mocks.BillingErrorMock,
  ensureSessionUser: mocks.ensureSessionUser,
  getEntitlement: mocks.getEntitlement,
  reserveAiUsage: mocks.reserveAiUsage,
  extendAiUsageReservation: mocks.extendAiUsageReservation,
  completeAiUsage: mocks.completeAiUsage,
  refundAiUsage: mocks.refundAiUsage,
  recordProductEvent: mocks.recordProductEvent,
}));
vi.mock('@/lib/billing/plans', () => ({
  requiredCapability: mocks.requiredCapability,
}));
vi.mock('@/lib/analysis/market-context', () => ({
  loadMarketContext: mocks.loadMarketContext,
}));
vi.mock('@/lib/analysis/provider', () => ({
  classifyIntent: mocks.classifyIntent,
  createAnalysisProvider: mocks.createAnalysisProvider,
}));
vi.mock('@/lib/server/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitKey: mocks.rateLimitKey,
  tooManyRequests: vi.fn(),
}));

import { POST } from '@/app/api/analysis/route';
import { resolveIntent } from '@/lib/analysis/intent';

const entitlement = {
  billingEnabled: true,
  plan: 'trial' as const,
  planName: 'Dùng thử',
  hasAccess: true,
  unlimited: false,
  used: 0,
  limit: 3,
  remaining: 3,
  capabilities: ['standard' as const],
  periodId: null,
  periodStart: null,
  periodEnd: null,
  nextPeriodEnd: null,
};

const body = {
  question: 'Giá vàng hôm nay?',
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  companyId: 'sjc',
  productId: 'bar-1l',
  range: '7N',
  messages: [],
};

function request(payload: Record<string, unknown> = body) {
  return new Request('http://localhost:3000/api/analysis', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

function configure() {
  mocks.enabled.mockReturnValue(true);
  mocks.databaseConfigured.mockReturnValue(true);
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 1_000 });
  mocks.rateLimitKey.mockReturnValue('test-key');
  mocks.auth.mockResolvedValue({
    user: {
      id: 'google-subject',
      email: 'user@example.com',
      isAdmin: false,
      canUseAi: true,
    },
  });
  mocks.ensureSessionUser.mockResolvedValue({
    id: 'user-1',
    email: 'user@example.com',
    role: 'user',
  });
  mocks.getEntitlement.mockResolvedValue(entitlement);
  mocks.classifyIntent.mockResolvedValue(resolveIntent(body.question));
  mocks.requiredCapability.mockReturnValue('standard');
  mocks.reserveAiUsage.mockResolvedValue({
    id: 'usage-1',
    userId: 'user-1',
    entitlement: { ...entitlement, used: 1, remaining: 2 },
  });
  mocks.loadMarketContext.mockResolvedValue({
    context: {
      today: '2026-09-05',
      scope: 'Sản phẩm được chọn',
      eligible: 0,
      requested: 0,
      rows: [],
      missing: [],
    },
    markets: [],
  });
  mocks.createAnalysisProvider.mockReturnValue({
    name: 'hermes',
    analyze: async function* () {
      yield { type: 'delta', delta: 'Kết quả' };
      yield {
        type: 'done',
        model: 'gpt-5.4-mini',
        usage: null,
        completion: 'complete',
      };
    },
  });
}

afterEach(() => vi.clearAllMocks());

describe('analysis billing enforcement', () => {
  it('reserves before market loading and commits only a completed response', async () => {
    configure();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('event: entitlement');
    expect(text).toContain('event: done');
    expect(mocks.reserveAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRequestId: body.clientRequestId,
        capability: 'standard',
      }),
    );
    expect(mocks.loadMarketContext).toHaveBeenCalled();
    expect(mocks.completeAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'usage-1', provider: 'hermes' }),
    );
    expect(mocks.refundAiUsage).not.toHaveBeenCalled();
  });

  it('extends the same reservation before a provider retry', async () => {
    configure();
    mocks.createAnalysisProvider.mockReturnValue({
      name: 'hermes',
      analyze: async function* () {
        yield { type: 'reset', attempt: 1, message: 'retry' };
        yield { type: 'delta', delta: 'Kết quả sau retry' };
        yield { type: 'done', model: 'retry-model', usage: null, completion: 'complete' };
      },
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.extendAiUsageReservation).toHaveBeenCalledWith({
      id: 'usage-1',
      capability: 'standard',
    });
    expect(mocks.completeAiUsage).toHaveBeenCalled();
    expect(mocks.refundAiUsage).not.toHaveBeenCalled();
  });

  it('returns a paywall before classification or market requests when quota is exhausted', async () => {
    configure();
    mocks.getEntitlement.mockResolvedValue({
      ...entitlement,
      hasAccess: false,
      used: 3,
      remaining: 0,
    });
    const response = await POST(request());
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: 'QUOTA_EXHAUSTED' });
    expect(mocks.classifyIntent).not.toHaveBeenCalled();
    expect(mocks.loadMarketContext).not.toHaveBeenCalled();
  });

  it('returns plan required without spending a trial credit for research', async () => {
    configure();
    mocks.classifyIntent.mockResolvedValue(resolveIntent('Tin mới về Fed?'));
    mocks.requiredCapability.mockReturnValue('research');
    mocks.reserveAiUsage.mockRejectedValue(
      new mocks.BillingErrorMock('PLAN_REQUIRED', 'Cần Plus.', 403, {
        requiredPlan: 'plus',
      }),
    );
    const response = await POST(
      request({ ...body, question: 'Tin mới về Fed?' }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'PLAN_REQUIRED',
      requiredPlan: 'plus',
    });
    expect(mocks.loadMarketContext).not.toHaveBeenCalled();
  });

  it('refunds a server-limited result instead of counting it', async () => {
    configure();
    mocks.createAnalysisProvider.mockReturnValue({
      name: 'server',
      analyze: async function* () {
        yield {
          type: 'done',
          model: 'server-calculations',
          usage: null,
          completion: 'limited',
        };
      },
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.refundAiUsage).toHaveBeenCalledWith('usage-1', {
      providerStarted: false,
    });
    expect(mocks.completeAiUsage).not.toHaveBeenCalled();
  });

  it('filters portfolio data at the server for a standard-only plan', async () => {
    configure();
    mocks.getEntitlement.mockResolvedValue({
      ...entitlement,
      plan: 'basic',
      planName: 'Basic',
      capabilities: ['standard'],
      limit: 30,
      remaining: 30,
    });
    const investorProfile = {
      capitalVnd: 1_000_000,
      holdings: [],
    };
    const portfolioLedger = { version: 1 as const, transactions: [] };
    const response = await POST(
      request({ ...body, investorProfile, portfolioLedger }),
    );
    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.loadMarketContext).toHaveBeenCalledWith(
      expect.anything(),
      'sjc',
      'bar-1l',
      '7N',
      expect.anything(),
      undefined,
      body.question,
      undefined,
      undefined,
    );
  });
});
