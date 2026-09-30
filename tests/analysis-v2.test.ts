import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  classify: vi.fn(),
  auth: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/analysis/provider', () => ({ classifyIntent: mocks.classify }));

import { POST as prepare } from '@/app/api/analysis/prepare/route';
import { resolveIntent } from '@/lib/analysis/intent';
import {
  buildAnalysisDecision,
  buildAnalysisFacts,
} from '@/lib/analysis/response';
import {
  analysisRequestSchema,
  type AnalysisRequestPayload,
} from '@/lib/analysis/request';
import type { MarketContext } from '@/lib/analysis/market-context';
import { factualAnswer } from '@/lib/analysis/market-context';
import { prepareAnalysisInput } from '@/lib/analysis/input';

const base = {
  responseVersion: 2 as const,
  goal: 'hold' as const,
  analysisDepth: 'standard' as const,
  question: 'Vàng tôi đang giữ lãi bao nhiêu?',
  companyId: 'sjc',
  productId: 'bar-1l',
  range: '1T' as const,
  scenarioInputs: { quantityLuong: 1, costPerLuongVnd: 145_000_000, feeVnd: 0 },
  messages: [],
};

function request(payload: unknown) {
  return new Request('http://localhost:3000/api/analysis/prepare', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

afterEach(() => vi.clearAllMocks());

describe('analysis v2 contract', () => {
  it('uses a saved ledger without asking for manual hold quantity or cost', () => {
    const parsed = analysisRequestSchema.parse({
      ...base,
      scenarioInputs: {},
      usePortfolioLedger: true,
      portfolioLedger: {
        version: 1,
        transactions: [{
          id: 'buy-1',
          date: '2026-09-25',
          side: 'buy',
          companyId: 'sjc',
          productId: 'bar-1l',
          quantityLuong: 0.1,
          unitPriceVnd: 145_000_000,
          feesVnd: 0,
          note: '',
        }],
      },
    });
    const prepared = prepareAnalysisInput(parsed);
    expect(prepared.needs).toHaveLength(0);
    expect(prepared.payload.portfolioLedger?.transactions).toHaveLength(1);
  });
  it('accepts explicit goal, depth and scenario inputs without changing v1 defaults', () => {
    const parsed = analysisRequestSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect((parsed.data as AnalysisRequestPayload).responseVersion).toBe(2);
    expect(
      analysisRequestSchema.safeParse({ ...base, responseVersion: 3 }).success,
    ).toBe(false);
  });

  it('builds facts and a cautious decision from server calculations', () => {
    const context: MarketContext = {
      today: '2026-09-09',
      yesterday: '2026-09-08',
      scope: 'Sản phẩm được chọn',
      unit: 'triệu đồng/lượng',
      requested: 1,
      eligible: 1,
      rows: [
        {
          key: 'sjc:bar-1l:',
          companyId: 'sjc',
          productId: 'bar-1l',
          label: 'Vàng miếng SJC',
          aliases: [],
          unit: 'triệu đồng/lượng',
          mode: 'live',
          source: {
            provider: 'SJC',
            url: 'https://sjc.com.vn',
            official: true,
          },
          historySource: { provider: 'SJC', url: 'https://sjc.com.vn' },
          observedAt: '2026-09-09',
          timestampKind: 'source',
          generatedAt: '2026-09-09',
          metrics: {} as never,
          comparison: { today: 147, yesterday: 146, change: 1, percent: 0.68 },
          exclusion: null,
        },
      ],
      ranking: [],
      missing: [],
      investments: [
        {
          productId: 'bar-1l',
          label: 'Vàng miếng SJC',
          quantityLuong: 1,
          spreadVndPerLuong: 3_000_000,
          immediateLossVnd: 0,
          profitLossVnd: 2_000_000,
          breakEvenBuyVndPerLuong: 145_000_000,
          feesVnd: 0,
          feesAssumption: null,
        },
      ],
      deployableCapitalVnd: undefined,
      portfolioSummary: undefined,
    };
    const intent = resolveIntent(base.question);
    const facts = buildAnalysisFacts(context, intent, 'hold');
    const decision = buildAnalysisDecision(context, intent, 'hold');
    expect(facts.responseVersion).toBe(2);
    expect(facts.facts.map((item) => item.key)).toContain('estimated-pnl');
    expect(decision.stance).toBe('review');
    expect(decision.factKeys).toContain('break-even');

    const englishFacts = buildAnalysisFacts(context, intent, 'hold', 'en');
    const englishDecision = buildAnalysisDecision(context, intent, 'hold', 'en');
    expect(englishFacts.facts.find((item) => item.key === 'estimated-pnl')?.label)
      .toBe('Profit/loss at dealer buy price');
    expect(englishDecision.headline).toContain('above break-even');
    const englishFallback = factualAnswer(context, intent, 'en');
    expect(englishFallback).toContain('There is not enough data');
    expect(englishFallback).not.toContain('Chưa có đủ dữ liệu');
  });

  it('reports authentication separately from valid input without reserving quota', async () => {
    mocks.classify.mockResolvedValue(resolveIntent(base.question));
    mocks.auth.mockResolvedValue(null);
    const response = await prepare(request(base));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.ready).toBe(false);
    expect(result.access.code).toBe('AUTH_REQUIRED');
    expect(result.authenticated).toBe(false);
    expect(result.capability).toBe('standard');
  });

  it('returns at most two missing fields before a paid analysis starts', async () => {
    mocks.auth.mockResolvedValue({
      user: { email: 'admin@example.com', isAdmin: true },
    });
    mocks.classify.mockResolvedValue(
      resolveIntent('Tôi định mua vàng, nên mua không?'),
    );
    const response = await prepare(
      request({
        ...base,
        goal: 'buy',
        question: 'Tôi định mua vàng, nên mua không?',
        scenarioInputs: {},
      }),
    );
    const result = await response.json();
    expect(result.ready).toBe(false);
    expect(result.needs.length).toBeLessThanOrEqual(2);
    expect(result.needs[0].label).toContain('Số lượng');
  });
});
