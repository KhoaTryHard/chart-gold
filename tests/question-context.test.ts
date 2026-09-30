import { describe, expect, it } from 'vitest';
import { inferQuestionContext } from '@/lib/analysis/question-context';
import { analysisRequestSchema } from '@/lib/analysis/request';

describe('question analysis context', () => {
  it('normalizes Vietnamese quantity, product, horizon, and range from the question', () => {
    const context = inferQuestionContext({
      question: 'Tôi muốn mua 0,1 lượng nhẫn SJC, dự định giữ 6 tháng, xem 7 ngày qua',
      goal: 'buy',
      companyId: 'sjc',
      productId: 'bar-1l',
      range: '1T',
      locale: 'vi',
    });
    expect(context.productId).toBe('ring-1c');
    expect(context.range).toBe('7N');
    expect(context.scenarioInputs).toMatchObject({ quantityLuong: 0.1, horizon: '6-12m' });
    expect(context.missing).toEqual([]);
  });

  it('asks for purchase size without silently using the SJC default', () => {
    const context = inferQuestionContext({
      question: 'Tôi nên mua vàng nào hôm nay?',
      goal: 'buy',
      companyId: 'sjc',
      productId: 'bar-1l',
      locale: 'vi',
    });
    expect(context.missing.map((item) => item.key)).toContain('product');
    expect(context.missing.map((item) => item.key)).toContain('quantityLuong');
  });

  it('accepts question mode without client form fields', () => {
    const parsed = analysisRequestSchema.safeParse({
      inputMode: 'question',
      responseVersion: 2,
      goal: 'market',
      question: 'Giá vàng hôm nay thế nào?',
      messages: [],
    });
    expect(parsed.success).toBe(true);
  });
});
