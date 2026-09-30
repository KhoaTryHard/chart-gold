import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { analysisEvaluation } from './fixtures/analysis-evaluation';
import { buildUserHistory, resolveIntent } from '@/lib/analysis/intent';
import { calculateAnalysisMetrics } from '@/lib/analysis/metrics';
import { shiftDate, vietnamDate } from '@/lib/analysis/dates';
import {
  calculateInvestment,
  investmentInputs,
  investorProfileSchema,
} from '@/lib/analysis/investor-profile';
import {
  buildMarketContext,
  selectQuoteGroups,
} from '@/lib/analysis/market-context';
import { analysisRequestSchema } from '@/lib/analysis/request';
import { resolveScenario } from '@/lib/analysis/input';
import { byteOffsetToIndex, withCitations } from '@/lib/analysis/citations';
import {
  getMarketCompany,
  getMarketProductCategory,
} from '@/lib/market-sources';
import type { MarketData, PricePoint } from '@/lib/server/sjc';

const point = (date: string, buy: number, sell = buy + 2): PricePoint => ({
  date,
  buy,
  sell,
  spread: sell - buy,
  eventId: null,
});

describe('Vietnamese routing evaluation (40 questions)', () => {
  it.each(analysisEvaluation)(
    '$question',
    ({ question, kind, scope, history }) => {
      const intent = resolveIntent(
        question,
        history ? [{ role: 'user', content: history }] : [],
      );
      expect(intent.kind).toBe(kind);
      expect(intent.scope).toBe(scope);
      expect(intent.needsResearch).toBe(kind === 'macro');
    },
  );
});

describe('financial correctness and context', () => {
  it('routes BTMH questions to the independent official source', () => {
    const btmh = resolveIntent('Giá vàng Bảo Tín Mạnh Hải hôm nay?');
    expect(btmh.companyIds).toEqual(['btmh']);
    expect(btmh.companyIds).not.toContain('baotin');
    expect(
      resolveIntent('Giá vàng Bảo Tín Minh Châu hôm nay?').companyIds,
    ).toEqual(['btmc']);
  });
  it('resolves named BTMH products and their shared categories without picking another brand', () => {
    const gift = resolveIntent(
      'Giá vàng Bảo Tín Mạnh Hải Kim Gia Bảo Gift hôm nay?',
    );
    expect(gift.companyIds).toEqual(['btmh']);
    expect(gift.productIds).toEqual(['btmh-kgbg']);
    expect(gift.category).toBe('gift');

    const accumulation = resolveIntent('Giá KGB Bảo Tín Mạnh Hải hôm nay?');
    expect(accumulation.companyIds).toEqual(['btmh']);
    expect(accumulation.productIds).toEqual(['btmh-kgb']);
    expect(accumulation.category).toBe('investment-gold');

    const ringQuestion = resolveIntent('So sánh giá vàng nhẫn hôm nay');
    expect(ringQuestion.category).toBe('ring');
    expect(
      selectQuoteGroups(ringQuestion, 'btmh', 'btmh-kgb').every(
        (group) => getMarketProductCategory(group.product) === 'ring',
      ),
    ).toBe(true);
  });
  it('does not mistake a causal question for a gold-ring product filter', () => {
    const intent = resolveIntent('Nguyên nhân giá vàng tăng hôm nay là gì?');
    expect(intent.kind).toBe('macro');
    expect(intent.category).toBeNull();
    expect(intent.scope).toBe('selected');
    expect(resolveIntent('Nguyên nhân vàng nhẫn tăng?').category).toBe('ring');
  });
  it('keeps a standalone hypothetical investment question in the selected scope', () => {
    const intent = resolveIntent('Nếu mua 2 lượng thì lãi lỗ bao nhiêu?', [
      { role: 'user', content: 'So với hôm qua loại nào biến động nhất?' },
    ]);
    expect(intent.kind).toBe('investment');
    expect(intent.scope).toBe('selected');
  });
  it('prioritizes explicit follow-up side and company and resolves a category without the selected bar', () => {
    const intent = resolveIntent('Còn giá bán ra PNJ?', [
      { role: 'user', content: 'So sánh giá mua vào SJC hôm qua' },
    ]);
    expect(intent.side).toBe('sell');
    expect(intent.companyIds).toEqual(['pnj']);
    const groups = selectQuoteGroups(
      resolveIntent('Giá vàng nhẫn?'),
      'sjc',
      'bar-1l',
    );
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((group) => group.product.seriesId === 'ring')).toBe(
      true,
    );
  });
  it('parses explicit units without treating an unknown percentage fee as VND', () => {
    expect(
      investmentInputs('Mua 2 chỉ giá vốn 145,5 triệu đồng, phí 200 nghìn'),
    ).toEqual({
      quantityLuong: 0.2,
      costPerLuongVnd: 145_500_000,
      feesVnd: 200_000,
    });
    expect(investmentInputs('Mua 2 lượng, phí 2%').feesVnd).toBeUndefined();
  });
  it('extracts explicitly labeled investment inputs from an English gold question', () => {
    expect(
      investmentInputs(
        'I hold 2 taels at cost basis of 145.5 million VND, fees 200 thousand VND',
      ),
    ).toEqual({
      quantityLuong: 2,
      costPerLuongVnd: 145_500_000,
      feesVnd: 200_000,
    });
    expect(resolveIntent('Should I buy 2 taels of gold now?').kind).toBe(
      'investment',
    );
  });
  it('normalizes a Vietnamese price quoted per chỉ to the server unit per lượng', () => {
    expect(
      investmentInputs('Tôi đang giữ 2 chỉ, giá vốn 14,5 triệu đồng/chỉ'),
    ).toEqual({
      quantityLuong: 0.2,
      costPerLuongVnd: 145_000_000,
      feesVnd: undefined,
    });
  });
  it('exposes one canonical scenario for form and chat values', () => {
    expect(
      resolveScenario(
        { quantityLuong: 0.2, costPerLuongVnd: 145_000_000 },
        'Tôi giữ 2 chỉ, giá vốn 14,5 triệu đồng/chỉ',
        'sjc',
        'bar-1l',
        'form',
      ),
    ).toMatchObject({
      quantity: 0.2,
      unit: 'luong',
      priceBasis: 'per-luong',
      costVnd: 29_000_000,
      source: 'form',
      confidence: 'confirmed',
    });
  });
  it('uses Vietnam dates and handles year/leap-day transitions', () => {
    expect(vietnamDate(new Date('2026-01-01T18:00:00Z'))).toBe('2026-01-02');
    expect(shiftDate('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('does not bridge missing days or manufacture moving averages', () => {
    const metrics = calculateAnalysisMetrics(
      [point('2026-01-01', 100), point('2026-01-03', 110)],
      '7N',
    );
    expect(metrics.dailyChange.buy).toBeNull();
    expect(metrics.dailyReturnVolatilityPercent).toBeNull();
    expect(metrics.movingAverage.ma7).toBeNull();
  });
  it('uses calendar windows, ignores inverted prices, and requires seven consecutive days for MA7', () => {
    const records = Array.from({ length: 7 }, (_, i) =>
      point(shiftDate('2026-01-01', i), 100),
    );
    const metrics = calculateAnalysisMetrics(
      [point('2025-12-01', 999), ...records, point('2026-01-08', 150, 140)],
      '7N',
    );
    expect(metrics.sampleSize).toBe(7);
    expect(metrics.movingAverage.ma7).toBe(102);
    expect(metrics.movingAverage.ma30).toBeNull();
  });
  it('calculates investor buy/sell spread, fees and break-even in VND', () => {
    expect(calculateInvestment(144, 146, 2, 145e6, 200_000)).toMatchObject({
      spreadVndPerLuong: 2e6,
      immediateLossVnd: 4_200_000,
      profitLossVnd: -2_200_000,
      breakEvenBuyVndPerLuong: 145_100_000,
    });
    expect(calculateInvestment(144, 146, 1).feesAssumption).not.toBeNull();
    expect(
      investorProfileSchema.safeParse({ capitalVnd: 10, cashNeededVnd: 11 })
        .success,
    ).toBe(false);
  });
  it('rejects company/product mismatch and unknown holding companies', () => {
    expect(
      analysisRequestSchema.safeParse({
        question: 'Giá?',
        companyId: 'pnj',
        productId: 'bar-1l',
        range: '7N',
        messages: [],
      }).success,
    ).toBe(false);
    expect(
      investorProfileSchema.safeParse({
        holdings: [
          {
            companyId: 'fake',
            productId: 'bar-1l',
            quantityLuong: 1,
            costPerLuongVnd: 100,
          },
        ],
      }).success,
    ).toBe(false);
  });
  it('bounds history and never forwards grounded assistant text', () => {
    const history = buildUserHistory(
      Array.from({ length: 20 }, () => ({
        role: 'user',
        content: 'a'.repeat(8000),
      })).concat({ role: 'assistant', content: 'Grounded result' }),
    );
    expect(history.length).toBeLessThanOrEqual(8);
    expect(
      history.reduce((n, row) => n + row.content.length, 0),
    ).toBeLessThanOrEqual(12000);
    expect(
      history.every((row) => row.role === 'user' && row.content.length <= 4000),
    ).toBe(true);
  });
  it('groups shared SJC series but preserves distinct PNJ regions', () => {
    const sjc = selectQuoteGroups(
      resolveIntent('So sánh SJC hôm qua'),
      'sjc',
      'bar-1l',
    );
    expect(
      sjc.find((group) => group.product.id === 'bar-1l')?.aliases.length,
    ).toBeGreaterThan(1);
    const pnj = selectQuoteGroups(
      resolveIntent('So sánh PNJ hôm qua'),
      'sjc',
      'bar-1l',
    );
    expect(pnj.some((group) => group.product.id === 'pnj-hcm')).toBe(true);
    expect(pnj.some((group) => group.product.id === 'pnj-hanoi')).toBe(true);
  });
  it('ranks by absolute change, includes ties, excludes stale/missing days', () => {
    const intent = resolveIntent('So sánh các loại vàng hôm qua');
    const groups = selectQuoteGroups(intent, 'sjc', 'bar-1l').slice(0, 3);
    const markets = groups.map(
      (group, index): MarketData => ({
        company: getMarketCompany(group.companyId),
        product: group.product,
        products: [],
        mode: 'live',
        availability: 'available',
        unavailableReason: null,
        records: [
          point('2026-09-04', 100),
          point(
            index === 2 ? '2026-09-03' : '2026-09-05',
            index === 0 ? 105 : 95,
          ),
        ],
        latest: point('2026-09-05', 105),
        observedAt: '2026-09-05T01:00:00Z',
        generatedAt: '2026-09-05T01:00:00Z',
        source: {
          provider: 'fixture',
          url: 'https://example.com',
          official: false,
        },
        historySource: { provider: 'fixture', url: 'https://example.com' },
      }),
    );
    const context = buildMarketContext(
      groups,
      markets,
      intent,
      '7N',
      new Date('2026-09-05T01:00:00Z'),
    );
    expect(context.ranking.map((r) => r.rank)).toEqual([1, 1]);
    expect(context.eligible).toBe(2);
    expect(context.missing).toHaveLength(1);
  });
  it('does not turn a fallback quote into a current portfolio profit', () => {
    const intent = resolveIntent(
      'Hôm nay danh mục của tôi có chốt lời được chưa?',
    );
    const groups = selectQuoteGroups(intent, 'sjc', 'bar-1l').slice(0, 1);
    const market: MarketData = {
      company: getMarketCompany('sjc'),
      product: groups[0].product,
      products: [],
      mode: 'fallback',
      availability: 'available',
      unavailableReason: null,
      records: [point('2026-09-05', 150, 153)],
      latest: point('2026-09-05', 150, 153),
      observedAt: '2026-09-05T00:00:00Z',
      generatedAt: '2026-09-05T00:00:00Z',
      source: {
        provider: 'snapshot',
        url: 'https://example.com',
        official: false,
      },
      historySource: { provider: 'snapshot', url: 'https://example.com' },
    };
    const context = buildMarketContext(
      groups,
      [market],
      intent,
      '7N',
      new Date('2026-09-05T01:00:00Z'),
      undefined,
      '',
      {
        version: 1,
        transactions: [
          {
            id: 'fallback-ledger',
            date: '2026-09-01',
            side: 'buy',
            companyId: 'sjc',
            productId: 'bar-1l',
            quantityLuong: 1,
            unitPriceVnd: 140_000_000,
            feesVnd: 0,
            note: '',
          },
        ],
      },
    );
    expect(context.portfolioSummary?.unrealizedPnlVnd).toBeNull();
    expect(context.portfolioSummary?.canLockProfitToday).toBeNull();
  });
  it('converts byte offsets for Vietnamese citations and blocks non-http links', () => {
    const content = 'Giá vàng tăng.';
    expect(
      byteOffsetToIndex(content, new TextEncoder().encode(content).length),
    ).toBe(content.length);
    expect(
      withCitations(content, [
        {
          start: 0,
          end: content.length,
          title: 'Nguồn',
          url: 'javascript:alert(1)',
        },
      ]),
    ).toBe(content);
    expect(
      withCitations(content, [
        {
          start: 0,
          end: content.length,
          title: 'Nguồn',
          url: 'https://example.com',
        },
      ]),
    ).toContain('[1]');
  });
});
