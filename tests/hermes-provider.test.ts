import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

// @ts-expect-error server-only is a Next.js virtual module, not a test dependency.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {},
  ThinkingLevel: { HIGH: 'HIGH' },
}));
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.create } };
  },
}));

import {
  HermesAnalysisProvider,
  normalizeHermesBaseUrl,
  type AnalysisRequest,
} from '@/lib/analysis/provider';
import { calculateAnalysisMetrics } from '@/lib/analysis/metrics';
import type { PricePoint } from '@/lib/server/sjc';
import { SJC_PRODUCTS } from '@/lib/sjc-products';

const records: PricePoint[] = [
  { date: '2026-01-01', buy: 99, sell: 100, spread: 1, eventId: null },
];
const request: AnalysisRequest = {
  question: 'Giá đang có xu hướng gì?',
  messages: [{ role: 'assistant', content: 'Tóm tắt phiên trước.' }],
  product: SJC_PRODUCTS[0],
  range: '7N',
  metrics: calculateAnalysisMetrics(records, '7N'),
  records,
  observedAt: '2026-01-01T00:00:00.000Z',
};

async function* chunks(...values: unknown[]) {
  for (const value of values) yield value;
}

async function collectEvents(signal = new AbortController().signal) {
  const events = [];
  for await (const event of new HermesAnalysisProvider().analyze(
    request,
    signal,
  )) {
    events.push(event);
  }
  return events;
}

describe('Hermes analysis provider', () => {
  afterEach(() => {
    mocks.create.mockReset();
    vi.unstubAllEnvs();
  });

  it('normalizes gateway roots with or without /v1', () => {
    expect(normalizeHermesBaseUrl('https://hermes.example/gateway/')).toBe(
      'https://hermes.example/gateway/v1',
    );
    expect(normalizeHermesBaseUrl('https://hermes.example/gateway/v1/')).toBe(
      'https://hermes.example/gateway/v1',
    );
  });

  it('rejects non-HTTP gateway URLs and embedded credentials', () => {
    expect(() => normalizeHermesBaseUrl('ftp://hermes.example')).toThrow(
      'must use HTTPS',
    );
    expect(() => normalizeHermesBaseUrl('http://hermes.example')).toThrow(
      'HTTP is allowed only for localhost',
    );
    expect(normalizeHermesBaseUrl('http://localhost:8642')).toBe(
      'http://localhost:8642/v1',
    );
    expect(() =>
      normalizeHermesBaseUrl('https://user:pass@hermes.example'),
    ).toThrow('must not include credentials');
  });

  it('requires all gateway configuration without exposing a secret', async () => {
    vi.stubEnv('HERMES_BASE_URL', 'https://hermes.example');
    vi.stubEnv('HERMES_API_KEY', 'secret-key');

    await expect(collectEvents()).rejects.toThrow(
      'HERMES_BASE_URL, HERMES_API_KEY, and HERMES_MODEL',
    );
    await expect(collectEvents()).rejects.not.toThrow('secret-key');
  });

  it('maps OpenAI-compatible streaming deltas, citations, usage, and abort signal', async () => {
    vi.stubEnv('HERMES_BASE_URL', 'https://hermes.example/gateway/v1');
    vi.stubEnv('HERMES_API_KEY', 'secret-key');
    vi.stubEnv('HERMES_MODEL', 'hermes-model');
    const controller = new AbortController();
    mocks.create.mockResolvedValue(
      chunks(
        {
          id: 'req-123',
          model: 'hermes-model',
          choices: [
            {
              delta: {
                content: 'Xin ',
                annotations: [
                  {
                    type: 'url_citation',
                    title: 'Nguồn tham khảo',
                    url: 'https://example.com/gold',
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [{ delta: { content: [{ type: 'text', text: 'chào' }] } }],
        },
        {
          choices: [],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 7,
            total_tokens: 18,
          },
        },
      ),
    );

    await expect(collectEvents(controller.signal)).resolves.toEqual([
      { type: 'delta', delta: 'Xin ' },
      { type: 'delta', delta: 'chào' },
      {
        type: 'sources',
        sources: [
          { title: 'Nguồn tham khảo', url: 'https://example.com/gold' },
        ],
      },
      {
        type: 'done',
        model: 'hermes-model',
        usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
        requestId: 'req-123',
      },
    ]);

    expect(mocks.create).toHaveBeenCalledTimes(1);
    const [body, options] = mocks.create.mock.calls[0];
    expect(body.model).toBe('hermes-model');
    expect(body.messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'Giá đang có xu hướng gì?' },
    ]);
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(2000);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(options).toEqual({ signal: controller.signal });
  });

  it('addresses the reader as bạn and treats Kim Tuyến as the website brand', async () => {
    vi.stubEnv('HERMES_BASE_URL', 'https://hermes.example/gateway/v1');
    vi.stubEnv('HERMES_API_KEY', 'secret-key');
    vi.stubEnv('HERMES_MODEL', 'hermes-model');
    mocks.create.mockResolvedValue(
      chunks({
        choices: [{ delta: { content: 'Kết quả' } }],
        usage: null,
      }),
    );
    await collectEvents();
    const [body] = mocks.create.mock.calls[0];
    const system = body.messages[0].content as string;
    expect(system).toContain('Luôn xưng hô với người hỏi là “bạn”');
    expect(system).toContain('website/thương hiệu Kim Tuyến');
    expect(system).not.toContain('cho Kim Tuyến.');
  });
});
