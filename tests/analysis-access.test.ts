import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import {
  analysisAccess,
  accessWithEntitlement,
  readAnalysisAccess,
} from '@/lib/analysis/access';
import {
  prepareAnalysisInput,
  parseVietnameseNumber,
} from '@/lib/analysis/input';
import { analysisRequestSchema } from '@/lib/analysis/request';
import type { EntitlementView } from '@/lib/billing/plans';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  ensure: vi.fn(),
  entitlement: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/billing/server', () => ({
  ensureSessionUser: mocks.ensure,
  getEntitlement: mocks.entitlement,
}));
import { GET, POST } from '@/app/api/analysis/prepare/route';

const session = (admin = false): Session => ({
  expires: '2030-01-01',
  user: { email: 'person@example.com', isAdmin: admin, canUseAi: admin },
});
const input = {
  responseVersion: 2,
  analysisDepth: 'standard',
  goal: 'hold',
  question: 'Vàng tôi đang giữ lãi bao nhiêu?',
  companyId: 'sjc',
  productId: 'bar-1l',
  range: '1T',
  messages: [],
  scenarioInputs: { quantityLuong: 0.2, costPerLuongVnd: 145_500_000 },
};
const req = (data: unknown = input) =>
  new Request('http://localhost/api/analysis/prepare', {
    method: 'POST',
    headers: { origin: 'http://localhost', 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('AI access and input preparation', () => {
  it('does not equate a normal signed-in account with permission, while admins bypass pilot flags', () => {
    vi.stubEnv('B2C_AI_ENABLED', 'false');
    vi.stubEnv('AI_EXPERIENCE_V2_ENABLED', 'false');
    expect(analysisAccess(session()).code).toBe('AI_ACCESS_DISABLED');
    expect(analysisAccess(session(true))).toMatchObject({
      canAnalyze: true,
      isAdmin: true,
      account: { email: 'person@example.com' },
    });
    expect(analysisAccess(null)).toMatchObject({
      code: 'AUTH_REQUIRED',
      account: null,
    });
  });
  it('localizes access messages for the selected locale', () => {
    vi.stubEnv('B2C_AI_ENABLED', 'false');
    expect(analysisAccess(session(), 2, 'en').message).toContain('testing group');
    expect(analysisAccess(null, 2, 'en').message).toContain('Sign in with Google');
  });
  it('separates disabled v2 from missing Google login', () => {
    vi.stubEnv('B2C_AI_ENABLED', 'true');
    vi.stubEnv('AI_EXPERIENCE_V2_ENABLED', 'false');
    expect(analysisAccess(session())).toMatchObject({
      authenticated: true,
      code: 'AI_V2_DISABLED',
    });
  });
  it('opens every analysis capability to an authenticated community account', () => {
    vi.stubEnv('B2C_AI_ENABLED', 'true');
    vi.stubEnv('AI_EXPERIENCE_V2_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://test.example/community');
    const base = analysisAccess(session());
    const access = accessWithEntitlement(
      base,
      {
        billingEnabled: true,
        salesEnabled: false,
        plan: 'none',
        planName: 'Cộng đồng',
        hasAccess: true,
        unlimited: false,
        used: 0,
        limit: 3,
        remaining: 3,
        capabilities: ['standard', 'portfolio', 'research', 'deep'],
        periodId: null,
        periodStart: null,
        periodEnd: null,
        nextPeriodEnd: null,
        community: {
          limit: 3,
          used: 0,
          remaining: 3,
          resetAt: '2026-09-30T17:00:00.000Z',
          capabilities: ['standard', 'portfolio', 'research', 'deep'],
        },
        subscription: null,
        accessSource: 'community',
        budget: null,
      },
      'deep',
    );
    expect(access).toMatchObject({
      canAnalyze: true,
      isAdmin: false,
      accessSource: 'community',
      remaining: 3,
      capabilities: ['standard', 'portfolio', 'research', 'deep'],
    });
  });
  it('checks capability and quota without promising an unavailable paid checkout', () => {
    const entitlement = {
      capabilities: ['standard'],
      hasAccess: true,
      remaining: 2,
      unlimited: false,
      salesEnabled: false,
      budget: null,
    } as EntitlementView;
    const access = { ...analysisAccess(session(true)), isAdmin: false };
    expect(
      accessWithEntitlement(access, entitlement, 'research'),
    ).toMatchObject({ canAnalyze: false, code: 'PLAN_REQUIRED' });
    const exhausted = accessWithEntitlement(
      access,
      { ...entitlement, remaining: 0 },
      'standard',
    );
    expect(exhausted.code).toBe('QUOTA_EXHAUSTED');
    expect(exhausted.message).not.toContain('chọn gói');
  });
  it('uses deterministic input and explicit standard depth, including portfolio language', () => {
    const prepared = prepareAnalysisInput(
      analysisRequestSchema.parse({
        ...input,
        question: 'Lập kịch bản cho danh mục đang giữ',
      }),
    );
    expect(prepared.intent.depth).toBe('standard');
    expect(prepared.capability).toBe('standard');
    expect(prepared.needs).toHaveLength(0);
  });
  it('does not ask for holdings or transmit saved context for a general price question', () => {
    const prepared = prepareAnalysisInput(
      analysisRequestSchema.parse({
        ...input,
        question: 'Giá vàng hôm nay?',
        scenarioInputs: {},
        useInvestorProfile: true,
        investorProfile: { capitalVnd: 1e8, holdings: [] },
      }),
    );
    expect(prepared.needs).toHaveLength(0);
    expect(prepared.payload.investorProfile).toBeUndefined();
  });
  it('accepts Vietnamese decimals, keeps missing fees unknown and rejects invalid numbers', () => {
    expect(parseVietnameseNumber('145,5')).toBe(145.5);
    expect(parseVietnameseNumber('1.000,5')).toBe(1000.5);
    expect(parseVietnameseNumber('0,2')).toBe(0.2);
    expect(parseVietnameseNumber('')).toBeUndefined();
    expect(() => parseVietnameseNumber('-2')).toThrow();
    expect(() => parseVietnameseNumber('abc')).toThrow();
  });
  it('requires real holdings instead of accepting an empty profile and detects conflicting numbers', () => {
    const empty = prepareAnalysisInput(
      analysisRequestSchema.parse({
        ...input,
        scenarioInputs: {},
        useInvestorProfile: true,
        investorProfile: { holdings: [] },
      }),
    );
    expect(empty.needs.map((item) => item.key)).toEqual([
      'quantityLuong',
      'costPerLuongVnd',
    ]);
    const conflict = prepareAnalysisInput(
      analysisRequestSchema.parse({
        ...input,
        question: 'Tôi giữ 2 lượng, lãi bao nhiêu?',
      }),
    );
    expect(conflict.needs[0].reason).toContain('khác ô nhập');
  });
  it('returns a service error instead of unauthenticated when the session reader fails', async () => {
    mocks.auth.mockRejectedValue(new Error('session read failed'));
    const response = await POST(req());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'SESSION_UNAVAILABLE',
    });
    expect(mocks.ensure).not.toHaveBeenCalled();
  });
  it('returns a distinct AI access error when billing cannot be read', async () => {
    vi.stubEnv('B2C_AI_ENABLED', 'true');
    vi.stubEnv('AI_EXPERIENCE_V2_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://test.example/access-error');
    mocks.auth.mockResolvedValue(session());
    mocks.ensure.mockRejectedValue(new Error('database unavailable'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'AI_ACCESS_UNAVAILABLE',
    });
    await expect(readAnalysisAccess(session())).rejects.toMatchObject({
      code: 'AI_ACCESS_UNAVAILABLE',
    });
  });
  it('returns admin readiness even when the global pilot is closed', async () => {
    vi.stubEnv('AI_EXPERIENCE_V2_ENABLED', 'false');
    mocks.auth.mockResolvedValue(session(true));
    const response = await POST(
      req({ ...input, goal: 'market', question: 'Giá vàng hôm nay?', scenarioInputs: {} }),
    );
    expect(await response.json()).toMatchObject({
      ready: true,
      authenticated: true,
      featureEnabled: true,
    });
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect((await GET()).headers.get('cache-control')).toContain('no-store');
  });
  it('rejects a cross-origin preparation request before checking session', async () => {
    const response = await POST(
      new Request('http://localhost/api/analysis/prepare', {
        method: 'POST',
        headers: { origin: 'https://foreign.example' },
        body: JSON.stringify(input),
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});
