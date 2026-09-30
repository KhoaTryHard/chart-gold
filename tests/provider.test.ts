import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateContentStream: vi.fn(),
}));

// @ts-expect-error server-only is a Next.js virtual module, not a test dependency.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContentStream: mocks.generateContentStream };
  },
  ThinkingLevel: { HIGH: 'HIGH' },
}));

import {
  GeminiAnalysisProvider,
  type AnalysisRequest,
} from '@/lib/analysis/provider';
import { calculateAnalysisMetrics } from '@/lib/analysis/metrics';
import type { PricePoint } from '@/lib/server/sjc';
import { SJC_PRODUCTS } from '@/lib/sjc-products';

const records: PricePoint[] = [
  { date: '2026-01-01', buy: 99, sell: 100, spread: 1, eventId: null },
];
const request: AnalysisRequest = {
  question: 'Giá hiện tại là bao nhiêu?',
  messages: [],
  product: SJC_PRODUCTS[0],
  range: '7N',
  metrics: calculateAnalysisMetrics(records, '7N'),
  records,
  observedAt: '2026-01-01T00:00:00.000Z',
};

async function* chunks(...texts: string[]) {
  for (const text of texts) yield { text };
}

async function collectEvents() {
  const events = [];
  for await (const event of new GeminiAnalysisProvider().analyze(
    request,
    new AbortController().signal,
  )) {
    events.push(event);
  }
  return events;
}

describe('Gemini analysis provider', () => {
  afterEach(() => {
    mocks.generateContentStream.mockReset();
    vi.unstubAllEnvs();
  });

  it('falls back without tools when grounding quota is exhausted before output', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const error = Object.assign(
      new Error('429 RESOURCE_EXHAUSTED: You exceeded your current quota'),
      { status: 429 },
    );
    mocks.generateContentStream
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(chunks('fallback response'));

    await expect(collectEvents()).resolves.toEqual([
      { type: 'delta', delta: 'fallback response' },
      { type: 'done', model: 'gemini-3.6-flash', usage: null },
    ]);
    expect(mocks.generateContentStream).toHaveBeenCalledTimes(2);
    expect(mocks.generateContentStream.mock.calls[0][0].config.tools).toEqual([
      { googleSearch: {} },
    ]);
    expect(
      mocks.generateContentStream.mock.calls[1][0].config.tools,
    ).toBeUndefined();
    expect(
      mocks.generateContentStream.mock.calls[1][0].config.abortSignal,
    ).toBeInstanceOf(AbortSignal);
  });

  it('does not retry a non-grounding error', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    mocks.generateContentStream.mockRejectedValueOnce(
      Object.assign(new Error('400 invalid argument'), { status: 400 }),
    );

    await expect(collectEvents()).rejects.toThrow('400 invalid argument');
    expect(mocks.generateContentStream).toHaveBeenCalledTimes(1);
  });

  it('falls back when the grounded stream rejects on its first read', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const error = Object.assign(new Error('You exceeded your current quota'), {
      status: 429,
    });
    const rejectedStream = {
      [Symbol.asyncIterator]() {
        return {
          next: vi.fn().mockRejectedValue(error),
        };
      },
    };
    mocks.generateContentStream
      .mockResolvedValueOnce(rejectedStream)
      .mockResolvedValueOnce(chunks('fallback response'));

    await expect(collectEvents()).resolves.toEqual([
      { type: 'delta', delta: 'fallback response' },
      { type: 'done', model: 'gemini-3.6-flash', usage: null },
    ]);
    expect(mocks.generateContentStream).toHaveBeenCalledTimes(2);
  });

  it('does not retry after the first chunk has been opened', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const error = Object.assign(
      new Error('429 RESOURCE_EXHAUSTED: You exceeded your current quota'),
      { status: 429 },
    );
    async function* partialStream() {
      yield { text: 'partial response' };
      throw error;
    }
    mocks.generateContentStream.mockResolvedValueOnce(partialStream());

    const iterator = new GeminiAnalysisProvider().analyze(
      request,
      new AbortController().signal,
    );
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: 'delta', delta: 'partial response' },
    });
    await expect(iterator.next()).rejects.toThrow('429 RESOURCE_EXHAUSTED');
    expect(mocks.generateContentStream).toHaveBeenCalledTimes(1);
  });
});
