import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  answerFocus,
  comparisonRows,
  usesAccountLedger,
} from '@/lib/analysis/focus';
import { buildPromptContext, formatInstructions } from '@/lib/analysis/prompt';
import {
  buildAnalysisFacts,
  selectQuestionFacts,
} from '@/lib/analysis/response';
import { prepareAnalysisInput } from '@/lib/analysis/input';
import { analysisRequestSchema } from '@/lib/analysis/request';
import { resolveIntent } from '@/lib/analysis/intent';
import { calculateAnalysisMetrics } from '@/lib/analysis/metrics';
import { calculateInvestment } from '@/lib/analysis/investor-profile';
import { SJC_PRODUCTS } from '@/lib/sjc-products';
import type { MarketContext } from '@/lib/analysis/market-context';
import type { AnalysisRequest } from '@/lib/analysis/provider';

const records = [
  { date: '2026-10-16', buy: 140, sell: 142, spread: 2, eventId: null },
  { date: '2026-10-17', buy: 141, sell: 143, spread: 2, eventId: null },
];
const metrics = calculateAnalysisMetrics(records, '1T');
const context: MarketContext = {
  today: '2026-10-17',
  yesterday: '2026-10-16',
  scope: 'Sản phẩm được chọn',
  unit: 'triệu đồng/lượng',
  eligible: 1,
  requested: 1,
  rows: [
    {
      key: 'sjc:bar',
      companyId: 'sjc',
      productId: 'bar-1l',
      label: 'SJC',
      aliases: [],
      unit: 'triệu đồng/lượng',
      mode: 'live',
      observedAt: '2026-10-17',
      generatedAt: '2026-10-17',
      timestampKind: 'source',
      source: { provider: 'SJC', url: 'https://sjc.com.vn', official: true },
      historySource: { provider: 'SJC', url: 'https://sjc.com.vn' },
      metrics,
      comparison: { today: 141, yesterday: 140, change: 1, percent: 0.7143 },
      exclusion: null,
    },
  ],
  ranking: [
    {
      key: 'sjc:bar',
      label: 'SJC',
      rank: 1,
      value: 141,
      change: 1,
      percent: 0.7143,
    },
  ],
  missing: [],
  investments: [
    {
      productId: 'bar-1l',
      label: 'SJC',
      ...calculateInvestment(141, 143, 0.2, 140e6, 100_000),
    },
  ],
};
const request = (question: string): AnalysisRequest => ({
  question,
  responseVersion: 2,
  locale: 'vi',
  messages: [],
  product: SJC_PRODUCTS[0],
  range: '1T',
  observedAt: '2026-10-17',
  records,
  metrics,
  marketContext: context,
  intent: resolveIntent(question),
});

describe('question-focused AI experience', () => {
  it('keeps ledger consent separate from holding intent and accepts legacy clients', () => {
    expect(usesAccountLedger({ goal: 'hold', usePortfolioLedger: false })).toBe(
      false,
    );
    expect(usesAccountLedger({ goal: 'hold' })).toBe(true);
    expect(usesAccountLedger({ usePortfolioLedger: true })).toBe(true);
    expect(usesAccountLedger({})).toBe(false);
  });

  it('uses a typed holding scenario without requiring an account ledger', () => {
    const prepared = prepareAnalysisInput(
      analysisRequestSchema.parse({
        responseVersion: 2,
        inputMode: 'question',
        usePortfolioLedger: false,
        question:
          'Tôi đang giữ 2 chỉ SJC, giá vốn 140 triệu/lượng, lãi bao nhiêu?',
        messages: [],
      }),
    );
    expect(prepared.payload.goal).toBe('hold');
    expect(prepared.intent.scope).toBe('selected');
    expect(prepared.payload.portfolioLedger).toBeUndefined();
    expect(prepared.resolvedScenario).toMatchObject({
      quantityLuong: 0.2,
      costPerLuongVnd: 140e6,
    });
    expect(prepared.needs).toEqual([]);
  });

  it('asks only for missing essentials for a holding calculation', () => {
    const prepared = prepareAnalysisInput(
      analysisRequestSchema.parse({
        responseVersion: 2,
        usePortfolioLedger: false,
        question: 'Tôi đang giữ vàng SJC, lãi bao nhiêu?',
        messages: [],
      }),
    );
    expect(prepared.needs.map((item) => item.key)).toEqual([
      'quantityLuong',
      'costPerLuongVnd',
    ]);
  });

  it('keeps a quick lookup short even when the default depth control is standard', () => {
    const prepared = prepareAnalysisInput(
      analysisRequestSchema.parse({
        responseVersion: 2,
        analysisDepth: 'standard',
        question: 'Giá mua vào SJC hôm nay?',
        messages: [],
      }),
    );
    expect(prepared.intent.depth).toBe('short');
    expect(
      formatInstructions(
        { ...request('Giá mua vào SJC hôm nay?'), intent: prepared.intent },
        'test',
      ),
    ).toContain('40–100');
  });

  it('does not send portfolio figures or raw history with a simple lookup', () => {
    const evidence = buildPromptContext(request('Giá mua vào SJC hôm nay?'));
    expect(evidence).not.toHaveProperty('recentSeries');
    if (!('marketContext' in evidence))
      throw new Error('Expected price evidence');
    expect(evidence.marketContext).not.toHaveProperty('investments');
    expect(evidence.marketContext?.rows?.[0]).not.toHaveProperty(
      'movingAverage',
    );
    expect(evidence.marketContext?.rows?.[0]).toHaveProperty('prices.buy', 141);
    expect(evidence.marketContext?.rows?.[0]).toHaveProperty(
      'source.url',
      'https://sjc.com.vn',
    );
  });

  it('retains time series when the question asks for a trend', () => {
    expect(
      buildPromptContext(request('Xu hướng giá vàng tháng qua?')),
    ).toHaveProperty('recentSeries');
  });

  it('prioritizes holding results over unrelated market metrics', () => {
    const q = 'Tôi đang giữ 2 chỉ SJC, giá vốn 140 triệu/lượng, lãi bao nhiêu?';
    const result = buildAnalysisFacts(
      context,
      resolveIntent(q),
      'hold',
      'vi',
      undefined,
      q,
    );
    expect(result.facts.map((item) => item.key)).toEqual([
      'estimated-pnl',
      'resale-value',
      'break-even',
    ]);
    expect(result.facts[0].value).toBe(100_000);
    expect(result.facts[1].value).toBe(28_200_000);
    expect(result.facts[2].value).toBe(140_500_000);
    expect(result.facts.every((item) => item.assumption === null)).toBe(true);
  });

  it('shows purchase cost including known fees and does not call it holding profit', () => {
    const q = 'Nếu mua 2 chỉ SJC thì cần bao nhiêu tiền?';
    const result = buildAnalysisFacts(
      context,
      resolveIntent(q),
      'buy',
      'vi',
      undefined,
      q,
    );
    expect(result.facts.map((item) => item.key)).toEqual([
      'purchase-cost',
      'immediate-loss',
      'break-even',
    ]);
    expect(result.facts[0].value).toBe(28_700_000);
    expect(result.facts[1].value).toBe(500_000);
  });

  it('does not show a weighted break-even across different products', () => {
    const q = 'Tôi đang giữ vàng, tính lãi/lỗ';
    const mixed = {
      ...context,
      investments: [
        ...context.investments,
        { ...context.investments[0], productId: 'ring-1c' },
      ],
    };
    const result = buildAnalysisFacts(
      mixed,
      resolveIntent(q),
      'hold',
      'vi',
      undefined,
      q,
    );
    expect(result.facts.some((item) => item.key === 'break-even')).toBe(false);
  });

  it.each([
    'Tại sao giá vàng tăng hôm nay?',
    'So sánh giá SJC và DOJI hôm nay',
    'Dự báo giá vàng tuần sau',
  ])('suppresses unrelated cards for %s', (q) => {
    const result = buildAnalysisFacts(
      context,
      resolveIntent(q),
      undefined,
      'vi',
      undefined,
      q,
    );
    expect(result.facts).toEqual([]);
  });

  it('does not add price cards to an explanation of a term', () => {
    const facts = buildAnalysisFacts(context, resolveIntent('Spread là gì?'));
    expect(selectQuestionFacts(facts, 'Spread là gì?')).toEqual([]);
  });

  it('keeps every tie at the fifth row', () => {
    expect(
      comparisonRows([1, 2, 3, 4, 5, 5, 7].map((rank) => ({ rank }))),
    ).toHaveLength(6);
  });

  it('does not block concept explanations on purchase size or a previous goal', () => {
    const prepared = prepareAnalysisInput(
      analysisRequestSchema.parse({
        responseVersion: 2,
        goal: 'buy',
        question: 'Điểm hòa vốn là gì?',
        messages: [],
      }),
    );
    expect(prepared.needs).toEqual([]);
    expect(buildPromptContext(request('Spread là gì?'))).not.toHaveProperty(
      'marketContext',
    );
  });

  it('treats an English dealer buy price as a lookup', () => {
    expect(answerFocus('What is the SJC dealer buy price today?')).toBe(
      'lookup',
    );
  });

  it('does not let stale goal selection override a new market question', () => {
    expect(answerFocus('Giá mua vào SJC hôm nay?', undefined, 'hold')).toBe(
      'lookup',
    );
    expect(answerFocus('Tại sao vàng tăng?', undefined, 'buy')).toBe('market');
  });

  it('keeps forecast numbers in one UI card while legacy clients receive them in prose', () => {
    const v2 = formatInstructions(request('Dự báo giá vàng tuần sau'), 'test');
    expect(v2).toContain('không chép lại các con số');
    const legacy = formatInstructions(
      { ...request('Dự báo giá vàng tuần sau'), responseVersion: undefined },
      'test',
    );
    expect(legacy).toContain('giữ nguyên số');
  });
});
