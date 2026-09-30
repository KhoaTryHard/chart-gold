import { z } from 'zod';
import type { AnalysisIntent } from './intent';
import type { Locale } from '@/lib/i18n';

export const ANALYSIS_PROMPT_VERSION = '2026-09-v3';

/** Feature flag for the new analysis workspace. It is deliberately opt-in. */
export function analysisExperienceV2Enabled() {
  return process.env.AI_EXPERIENCE_V2_ENABLED === 'true';
}

export const analysisGoalSchema = z.enum(['buy', 'hold', 'compare', 'market']);
export type AnalysisGoal = z.infer<typeof analysisGoalSchema>;

export const analysisDepthSchema = z.enum(['standard', 'deep']);
export type AnalysisDepth = z.infer<typeof analysisDepthSchema>;

export const scenarioInputsSchema = z
  .object({
    quantityLuong: z.number().positive().max(1e6).optional(),
    capitalVnd: z.number().positive().max(1e15).optional(),
    costPerLuongVnd: z.number().positive().max(1e12).optional(),
    buyPriceVndPerLuong: z.number().positive().max(1e12).optional(),
    sellPriceVndPerLuong: z.number().positive().max(1e12).optional(),
    feeVnd: z.number().nonnegative().max(1e15).optional(),
    horizon: z.enum(['1-4w', '1-3m', '6-12m', '12m+']).optional(),
  })
  .strict();

export type ScenarioInputs = z.infer<typeof scenarioInputsSchema>;

export function missingAnalysisInputs({
  goal,
  intent,
  scenario,
  investorProfile,
  question,
  portfolioLedger,
  locale = 'vi',
}: {
  goal?: AnalysisGoal;
  intent: AnalysisIntent;
  scenario?: ScenarioInputs;
  investorProfile?: {
    horizon?: string;
    cashNeededVnd?: number;
    holdings?: unknown[];
  };
  portfolioLedger?: { transactions: unknown[] };
  question?: string;
  locale?: Locale;
}) {
  const missing: Array<{
    key:
      | 'quantityLuong'
      | 'capitalVnd'
      | 'costPerLuongVnd'
      | 'horizon'
      | 'cashNeededVnd'
      | 'feeVnd'
      | 'personalContext';
    label: string;
    reason: string;
  }> = [];
  const effectiveGoal = goal;
  // General questions must not be blocked by fields belonging to an old tab.
  if (!effectiveGoal || intent.kind === 'out-of-scope') return missing;
  if (
    effectiveGoal === 'buy' &&
    !scenario?.quantityLuong &&
    !scenario?.capitalVnd
  ) {
    missing.push({
      key: 'quantityLuong',
      label: locale === 'en' ? 'Planned quantity or budget' : 'Số lượng hoặc số tiền dự kiến',
      reason: locale === 'en' ? 'Purchase size is needed to calculate spread and break-even.' : 'Cần biết quy mô mua để tính spread và hòa vốn.',
    });
  }
  const hasSavedPositions = Boolean(
    investorProfile?.holdings?.length || portfolioLedger?.transactions.length,
  );
  if (
    effectiveGoal === 'hold' &&
    !hasSavedPositions &&
    !scenario?.quantityLuong
  ) {
    missing.push({
      key: 'quantityLuong',
      label: locale === 'en' ? 'Quantity held (lượng)' : 'Số lượng đang giữ (lượng)',
      reason: locale === 'en' ? 'Your quantity is needed to calculate profit or loss.' : 'Cần số lượng để tính lãi/lỗ của bạn.',
    });
  }
  if (
    effectiveGoal === 'hold' &&
    !scenario?.costPerLuongVnd &&
    !hasSavedPositions
  ) {
    missing.push({
      key: 'costPerLuongVnd',
      label: locale === 'en' ? 'Cost basis per lượng' : 'Giá vốn mỗi lượng',
      reason: locale === 'en' ? 'Your cost basis is needed to calculate profit or loss on holdings.' : 'Cần giá vốn để tính lãi/lỗ đang giữ.',
    });
  }
  if (
    effectiveGoal === 'buy' &&
    scenario?.horizon === undefined &&
    investorProfile?.horizon === undefined &&
    /nen mua|mua ngay|mua khong|giai ngan|tich luy|should i buy|buy now|invest now|start investing/.test(
      (question ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase(),
    )
  ) {
    missing.push({
      key: 'horizon',
      label: locale === 'en' ? 'Planned holding period' : 'Thời gian dự định giữ',
      reason: locale === 'en' ? 'Holding period changes how spread and volatility should be considered.' : 'Thời gian giữ thay đổi cách cân nhắc spread và biến động.',
    });
  }
  if (missing.length > 2) return missing.slice(0, 2);
  return missing;
}
