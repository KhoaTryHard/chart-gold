import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { buildConversationMessages } from '@/lib/server/ai-conversations';

const turn = (sequence: number, question: string, answer: string | null, status = 'completed') => ({
  id: `turn-${sequence}`,
  sequence,
  question,
  answer,
  locale: 'vi',
  companyId: 'sjc',
  productId: 'ring-1c',
  range: '1T',
  goal: 'market',
  analysisDepth: 'standard',
  scenarioInputs: null,
  ledgerVersion: null,
  facts: null,
  decision: null,
  forecast: null,
  sources: null,
  citations: null,
  coverage: null,
  warning: null,
  status,
  createdAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
});

describe('AI conversation context', () => {
  it('keeps complete question and answer pairs, excluding failed turns', () => {
    expect(buildConversationMessages([
      turn(1, 'Câu hỏi cũ', 'Trả lời cũ'),
      turn(2, 'Câu hỏi lỗi', 'Nội dung dở', 'failed'),
      turn(3, 'Giải thích phương án hai', 'Phương án hai là…'),
    ] as never)).toEqual([
      { role: 'user', content: 'Câu hỏi cũ' },
      { role: 'assistant', content: 'Trả lời cũ' },
      { role: 'user', content: 'Giải thích phương án hai' },
      { role: 'assistant', content: 'Phương án hai là…' },
    ]);
  });

  it('prioritizes the newest pairs within the character budget', () => {
    const result = buildConversationMessages([
      turn(1, 'a'.repeat(100), 'b'.repeat(100)),
      turn(2, 'c'.repeat(100), 'd'.repeat(100)),
    ] as never, 220);
    expect(result).toEqual([
      { role: 'user', content: 'c'.repeat(100) },
      { role: 'assistant', content: 'd'.repeat(100) },
    ]);
  });
});

