import { describe, expect, it } from 'vitest';

import { analysisRequestSchema } from '@/lib/analysis/request';

const baseRequest = {
  question: 'Tóm tắt xu hướng hiện tại',
  productId: 'bar-1l',
  range: '1T',
  messages: [],
};

describe('analysis request validation', () => {
  it('accepts the supported request shape', () => {
    expect(analysisRequestSchema.safeParse(baseRequest).success).toBe(true);
  });

  it('enforces question, message count, per-message, and total history limits', () => {
    expect(
      analysisRequestSchema.safeParse({
        ...baseRequest,
        question: ' '.repeat(1_501),
      }).success,
    ).toBe(false);
    expect(
      analysisRequestSchema.safeParse({
        ...baseRequest,
        messages: Array.from({ length: 9 }, () => ({
          role: 'user',
          content: 'x',
        })),
      }).success,
    ).toBe(false);
    expect(
      analysisRequestSchema.safeParse({
        ...baseRequest,
        messages: [{ role: 'user', content: 'x'.repeat(4_001) }],
      }).success,
    ).toBe(false);

    const exactlyTwelveThousand = Array.from({ length: 3 }, () => ({
      role: 'user' as const,
      content: 'x'.repeat(4_000),
    }));
    expect(
      analysisRequestSchema.safeParse({
        ...baseRequest,
        messages: exactlyTwelveThousand,
      }).success,
    ).toBe(true);
    expect(
      analysisRequestSchema.safeParse({
        ...baseRequest,
        messages: [
          ...exactlyTwelveThousand,
          { role: 'user' as const, content: 'x' },
        ],
      }).success,
    ).toBe(false);
  });
});
