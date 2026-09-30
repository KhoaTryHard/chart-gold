import { z } from 'zod';
import { supportedLocales } from '@/lib/i18n';
import { investorProfileSchema } from '@/lib/analysis/investor-profile';
import { portfolioLedgerSchema } from '@/lib/portfolio-ledger';
import {
  analysisDepthSchema,
  analysisGoalSchema,
  scenarioInputsSchema,
} from './experience';

import { ANALYSIS_RANGES, type AnalysisRange } from '@/lib/analysis/metrics';
import {
  MARKET_COMPANIES,
  MARKET_PRODUCTS,
  getMarketProducts,
} from '@/lib/market-sources';

const companyIds = MARKET_COMPANIES.map((company) => company.id) as [
  string,
  ...string[],
];
const productIds = MARKET_PRODUCTS.map((product) => product.id) as [
  string,
  ...string[],
];

export const analysisRequestSchema = z
  .object({
    clientRequestId: z.uuid().optional(),
    conversationId: z.uuid().optional(),
    conversationVersion: z.number().int().positive().optional(),
    inputMode: z.enum(['form', 'question']).default('form'),
    ledgerVersion: z.number().int().positive().optional(),
    locale: z.enum(supportedLocales).default('vi'),
    responseVersion: z.literal(2).optional(),
    goal: analysisGoalSchema.optional(),
    analysisDepth: analysisDepthSchema.optional(),
    scenarioInputs: scenarioInputsSchema.optional(),
    useInvestorProfile: z.boolean().optional(),
    usePortfolioLedger: z.boolean().optional(),
    investorProfile: investorProfileSchema.optional(),
    portfolioLedger: portfolioLedgerSchema.optional(),
    question: z.string().trim().min(1).max(1_500),
    companyId: z.enum(companyIds).optional().default('sjc'),
    productId: z.enum(productIds).optional().default('bar-1l'),
    range: z.enum(
      Object.keys(ANALYSIS_RANGES) as [AnalysisRange, ...AnalysisRange[]],
    ).optional().default('1T'),
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().min(1).max(4_000),
        }),
      )
      .max(8)
      .refine(
        (messages) =>
          messages.reduce(
            (total, message) => total + message.content.length,
            0,
          ) <= 12_000,
        { message: 'Tổng nội dung lịch sử tối đa là 12.000 ký tự.' },
      ),
  })
  .refine(
    (request) =>
      getMarketProducts(request.companyId).some(
        (product) => product.id === request.productId,
      ),
    'Cặp công ty/sản phẩm không hợp lệ.',
  );

export type AnalysisRequestPayload = z.infer<typeof analysisRequestSchema>;
