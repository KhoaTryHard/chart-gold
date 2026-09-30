import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ gemini: vi.fn(), openai: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContentStream: mocks.gemini };
  },
  ThinkingLevel: { HIGH: 'HIGH' },
}));
vi.mock('openai', () => ({
  default: class {
    responses = { create: mocks.openai };
  },
}));
import {
  GeminiAnalysisProvider,
  OpenAIAnalysisProvider,
  type AnalysisEvent,
  type AnalysisRequest,
} from '@/lib/analysis/provider';
import { resolveIntent } from '@/lib/analysis/intent';
import { calculateAnalysisMetrics } from '@/lib/analysis/metrics';
import { SJC_PRODUCTS } from '@/lib/sjc-products';
const request: AnalysisRequest = {
  question: 'Tin Fed mới nhất?',
  intent: resolveIntent('Tin Fed mới nhất?'),
  messages: [],
  product: SJC_PRODUCTS[0],
  range: '7N',
  records: [],
  metrics: calculateAnalysisMetrics([], '7N'),
  observedAt: '',
};
async function* chunks(...events: unknown[]) {
  for (const event of events) yield event;
}
async function collect(iterator: AsyncGenerator<AnalysisEvent>) {
  const events = [];
  for await (const event of iterator) events.push(event);
  return events;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe('grounded answers', () => {
  it('does not release unsourced Gemini research and falls back without search on 429', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    mocks.gemini.mockResolvedValueOnce(
      chunks({
        text: 'Unverified news',
        candidates: [{ finishReason: 'STOP' }],
      }),
    );
    await expect(
      collect(
        new GeminiAnalysisProvider().analyze(
          request,
          new AbortController().signal,
        ),
      ),
    ).rejects.toThrow('citations');
    mocks.gemini.mockRejectedValueOnce(
      Object.assign(new Error('429 RESOURCE_EXHAUSTED'), { status: 429 }),
    );
    mocks.gemini.mockResolvedValueOnce(
      chunks({ text: 'Nội dung nền', candidates: [{ finishReason: 'STOP' }] }),
    );
    const events = await collect(
      new GeminiAnalysisProvider().analyze(
        request,
        new AbortController().signal,
      ),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'warning' }));
    expect(events.at(-1)).toMatchObject({
      grounded: false,
      completion: 'complete',
    });
    expect(mocks.gemini).toHaveBeenCalledTimes(3);
  });
  it('preserves Gemini search metadata, UTF8 citation positions and truncated completion', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const text = 'Giá vàng tăng.';
    mocks.gemini.mockResolvedValueOnce(
      chunks({
        text,
        candidates: [
          {
            finishReason: 'MAX_TOKENS',
            groundingMetadata: {
              groundingChunks: [
                {
                  web: { uri: 'https://www.federalreserve.gov/', title: 'Fed' },
                },
              ],
              groundingSupports: [
                {
                  segment: {
                    startIndex: 0,
                    endIndex: new TextEncoder().encode(text).length,
                  },
                  groundingChunkIndices: [0],
                },
              ],
              searchEntryPoint: {
                renderedContent: '<div>Search suggestions</div>',
              },
            },
          },
        ],
      }),
    );
    const events = await collect(
      new GeminiAnalysisProvider().analyze(
        request,
        new AbortController().signal,
      ),
    );
    expect(events.find((e) => e.type === 'grounding')).toMatchObject({
      citations: [{ start: 0, end: text.length }],
      suggestions: '<div>Search suggestions</div>',
    });
    expect(events.at(-1)).toMatchObject({
      completion: 'truncated',
      grounded: true,
    });
  });
  it('keeps OpenAI web search enabled and extracts final citation annotations', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    mocks.openai.mockResolvedValueOnce(
      chunks(
        { type: 'response.output_text.delta', delta: 'A sourced claim.' },
        {
          type: 'response.completed',
          response: {
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    annotations: [
                      {
                        type: 'url_citation',
                        url: 'https://www.bls.gov/',
                        title: 'BLS',
                        start_index: 0,
                        end_index: 16,
                      },
                    ],
                  },
                ],
              },
            ],
            usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
          },
        },
      ),
    );
    const events = await collect(
      new OpenAIAnalysisProvider().analyze(
        request,
        new AbortController().signal,
      ),
    );
    expect(mocks.openai.mock.calls[0][0].tools[0].type).toBe('web_search');
    expect(events.find((e) => e.type === 'grounding')).toMatchObject({
      citations: [{ url: 'https://www.bls.gov/' }],
    });
    expect(events.at(-1)).toMatchObject({
      completion: 'complete',
      grounded: true,
    });
  });
  it('detects incomplete OpenAI responses instead of reporting success', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    mocks.openai.mockResolvedValueOnce(
      chunks(
        { type: 'response.output_text.delta', delta: 'Partial' },
        { type: 'response.incomplete', response: { output: [], usage: null } },
      ),
    );
    const events = await collect(
      new OpenAIAnalysisProvider().analyze(
        { ...request, intent: resolveIntent('Giá vàng?') },
        new AbortController().signal,
      ),
    );
    expect(events.at(-1)).toMatchObject({ completion: 'truncated' });
  });
  it('rejects an OpenAI stream that terminates without a terminal event', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    mocks.openai.mockResolvedValueOnce(
      chunks({ type: 'response.output_text.delta', delta: 'Unfinished' }),
    );
    await expect(
      collect(
        new OpenAIAnalysisProvider().analyze(
          request,
          new AbortController().signal,
        ),
      ),
    ).rejects.toThrow('without completion');
  });
});
