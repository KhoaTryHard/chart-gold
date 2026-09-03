import { z } from 'zod';

import { ANALYSIS_RANGES, type AnalysisRange } from '@/lib/analysis/metrics';
import { SJC_PRODUCTS } from '@/lib/sjc-products';

const productIds = SJC_PRODUCTS.map((product) => product.id) as [
  string,
  ...string[],
];

export const analysisRequestSchema = z.object({
  question: z.string().trim().min(1).max(1_500),
  productId: z.enum(productIds),
  range: z.enum(
    Object.keys(ANALYSIS_RANGES) as [AnalysisRange, ...AnalysisRange[]],
  ),
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
});

export type AnalysisRequestPayload = z.infer<typeof analysisRequestSchema>;
