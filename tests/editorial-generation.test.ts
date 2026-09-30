import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = {
  geminiCreate: vi.fn(),
  geminiInteractionCreate: vi.fn(),
};

// @ts-expect-error server-only is a Next.js virtual module, not a test dependency.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.geminiCreate };
    interactions = { create: mocks.geminiInteractionCreate };
  },
}));

import {
  DEFAULT_EDITORIAL_GEMINI_MODEL,
  classifyEditorialProviderError,
  getEditorialProviderAvailability,
  parseRetryAfterMs,
  resolveEditorialProviderConfigs,
} from '@/lib/editorial/provider';
import {
  EditorialGenerationError,
  generateEditorialDraft,
  generateEditorialTranslation,
  parseEditorialDraft,
  validateEditorialTranslation,
} from '@/lib/editorial/generation';

const providerEnvironment = [
  'EDITORIAL_GEMINI_API_KEY',
  'EDITORIAL_GEMINI_MODEL',
  'GEMINI_API_KEY',
];

function clearProviderEnvironment() {
  for (const key of providerEnvironment) vi.stubEnv(key, '');
}

afterEach(() => {
  mocks.geminiCreate.mockReset();
  mocks.geminiInteractionCreate.mockReset();
  vi.unstubAllEnvs();
});

describe('editorial provider configuration', () => {
  it('uses only the isolated editorial Gemini key and model', () => {
    const configs = resolveEditorialProviderConfigs({
      EDITORIAL_GEMINI_API_KEY: 'editorial-key',
      EDITORIAL_GEMINI_MODEL: 'gemini-custom',
      GEMINI_API_KEY: 'chatbot-key',
    });

    expect(configs).toEqual([
      expect.objectContaining({
        provider: 'gemini',
        baseUrl: null,
        apiKey: 'editorial-key',
        model: 'gemini-custom',
        configured: true,
      }),
    ]);
  });

  it('does not fall back to the chatbot key and exposes a secret-free summary', () => {
    const env = {
      GEMINI_API_KEY: 'secret-chatbot-key',
    };

    const configs = resolveEditorialProviderConfigs(env);
    expect(configs[0]).toMatchObject({
      provider: 'gemini',
      model: DEFAULT_EDITORIAL_GEMINI_MODEL,
      configured: false,
      missing: ['apiKey'],
    });

    expect(getEditorialProviderAvailability(env)).toEqual([
      {
        provider: 'gemini',
        model: DEFAULT_EDITORIAL_GEMINI_MODEL,
        configured: false,
        missing: ['apiKey'],
        hasBaseUrl: false,
      },
    ]);
    expect(JSON.stringify(getEditorialProviderAvailability(env))).not.toContain(
      'secret-',
    );
  });

  it('reports the missing editorial key instead of treating the provider as ready', () => {
    const [gemini] = getEditorialProviderAvailability({
      GEMINI_API_KEY: 'chatbot-key',
    });

    expect(gemini).toEqual({
      provider: 'gemini',
      model: DEFAULT_EDITORIAL_GEMINI_MODEL,
      configured: false,
      missing: ['apiKey'],
      hasBaseUrl: false,
    });
  });
});

describe('editorial generation pipeline', () => {
  const validDraft = JSON.stringify({
    title: 'Giá vàng trong nước cần theo dõi gì?',
    excerpt: 'Bản tóm tắt dựa trên nguồn đã được cung cấp.',
    contentMarkdown: '## Dữ kiện\n\nNội dung có nguồn.',
    seoTitle: 'Giá vàng hôm nay',
    seoDescription: 'Mô tả kết quả tìm kiếm.',
    coverAlt: 'Hình minh họa vàng và biểu đồ tối giản',
    imagePrompt: 'Minh họa vàng tối giản, không có chữ hay biểu đồ số liệu.',
  });

  it('uses the editorial Gemini key once and records usage', async () => {
    clearProviderEnvironment();
    vi.stubEnv('EDITORIAL_GEMINI_API_KEY', 'editorial-gemini-key');
    mocks.geminiCreate.mockResolvedValueOnce({
      text: validDraft,
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 },
    });

    const draft = await generateEditorialDraft('Chủ đề thử nghiệm');

    expect(draft).toMatchObject({
      provider: 'gemini-editorial',
      model: DEFAULT_EDITORIAL_GEMINI_MODEL,
      inputTokens: 11,
      outputTokens: 7,
      seoTitle: 'Giá vàng hôm nay',
      coverAlt: 'Hình minh họa vàng và biểu đồ tối giản',
    });
    expect(draft.attempts).toEqual([
      expect.objectContaining({
        provider: 'gemini',
        status: 'succeeded',
        inputTokens: 11,
        outputTokens: 7,
      }),
    ]);
    expect(mocks.geminiCreate).toHaveBeenCalledTimes(1);
  });

  it('does not use the chatbot key when the editorial key is absent', async () => {
    clearProviderEnvironment();
    vi.stubEnv('GEMINI_API_KEY', 'gemini-key');

    await expect(
      generateEditorialDraft('Chủ đề thử nghiệm'),
    ).rejects.toMatchObject({
      name: 'EditorialGenerationError',
      attempts: [
        expect.objectContaining({
          provider: 'gemini',
          status: 'skipped',
        }),
      ],
    } satisfies Partial<EditorialGenerationError>);
    expect(mocks.geminiCreate).not.toHaveBeenCalled();
  });

  it('uses the isolated editorial provider for an English translation and preserves the JSON contract', async () => {
    clearProviderEnvironment();
    vi.stubEnv('EDITORIAL_GEMINI_API_KEY', 'editorial-gemini-key');
    mocks.geminiCreate.mockResolvedValueOnce({
      text: JSON.stringify({
        title: 'What to watch in domestic gold prices',
        excerpt: 'A sourced English summary.',
        contentMarkdown: '## Facts\n\nEnglish content with [a source](https://example.com).',
        seoTitle: 'Vietnam gold prices',
        seoDescription: 'An English description.',
        coverAlt: 'A simple gold illustration',
      }),
      usageMetadata: { promptTokenCount: 13, candidatesTokenCount: 9 },
    });

    const translation = await generateEditorialTranslation({
      title: 'Giá vàng trong nước cần theo dõi gì?',
      excerpt: 'Bản tóm tắt.',
      contentMarkdown: '## Dữ kiện',
    });

    expect(translation).toMatchObject({
      title: 'What to watch in domestic gold prices',
      provider: 'gemini-editorial',
      inputTokens: 13,
      outputTokens: 9,
    });
    expect(translation).not.toHaveProperty('imagePrompt');
    expect(mocks.geminiCreate.mock.calls[0][0].config.systemInstruction).toContain(
      'translate published Vietnamese gold-market articles',
    );
  });

  it('splits long Markdown into bounded translations and rejoins every section', async () => {
    clearProviderEnvironment();
    vi.stubEnv('EDITORIAL_GEMINI_API_KEY', 'editorial-gemini-key');
    mocks.geminiCreate.mockImplementation(async () => ({
      text: JSON.stringify({
        title: 'Gold prices in 2026',
        excerpt: 'A sourced article for 2026.',
        contentMarkdown: 'Price 145 million VND.',
        seoTitle: 'Gold prices 2026',
        seoDescription: 'Vietnam gold prices in 2026.',
        coverAlt: 'Gold in 2026',
      }),
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
    }));
    const source = {
      title: 'Giá vàng năm 2026',
      excerpt: 'Tổng quan giá vàng năm 2026.',
      contentMarkdown: `${'Giá tham khảo 145 triệu đồng/lượng trong năm 2026.\n'.repeat(180)}`,
    };

    const translated = await generateEditorialTranslation(source);

    expect(mocks.geminiCreate.mock.calls.length).toBeGreaterThan(1);
    expect(translated.contentMarkdown.split('Price 145 million VND.').length - 1)
      .toBe(mocks.geminiCreate.mock.calls.length);
    expect(translated.inputTokens).toBe(20 * mocks.geminiCreate.mock.calls.length);
    expect(translated.outputTokens).toBe(10 * mocks.geminiCreate.mock.calls.length);
  });

  it('rejects an English translation that drops a factual number or source URL', () => {
    expect(() =>
      validateEditorialTranslation(
        {
          title: 'Bài 2026',
          excerpt: 'Giá 1.000 đồng',
          contentMarkdown: '[Nguồn](https://example.com/source)',
        },
        {
          title: 'Article',
          excerpt: 'Price is described.',
          contentMarkdown: 'No source is retained.',
        },
      ),
    ).toThrow('thiếu liên kết nguồn');
  });

  it('keeps a retryable Gemini error as a structured failure', async () => {
    clearProviderEnvironment();
    vi.stubEnv('EDITORIAL_GEMINI_API_KEY', 'editorial-gemini-key');
    mocks.geminiCreate.mockRejectedValueOnce({ status: 429 });

    await expect(
      generateEditorialDraft('Chủ đề thử nghiệm'),
    ).rejects.toMatchObject({
      name: 'EditorialGenerationError',
      attempts: [
        expect.objectContaining({
          provider: 'gemini',
          status: 'failed',
          retryable: true,
          statusCode: 429,
        }),
      ],
    } satisfies Partial<EditorialGenerationError>);
    expect(mocks.geminiCreate).toHaveBeenCalledTimes(1);
  });

  it('accepts previous JSON payloads while safely validating optional SEO fields', () => {
    expect(
      parseEditorialDraft('```json\n' + validDraft + '\n```'),
    ).toMatchObject({
      title: 'Giá vàng trong nước cần theo dõi gì?',
      imagePrompt: 'Minh họa vàng tối giản, không có chữ hay biểu đồ số liệu.',
    });
    expect(() =>
      parseEditorialDraft(
        JSON.stringify({
          title: 'A',
          excerpt: 'B',
          contentMarkdown: 'C',
          coverAlt: 1,
        }),
      ),
    ).toThrow('coverAlt không hợp lệ');
  });
});

describe('editorial provider retry classification', () => {
  it('marks documented transient HTTP status codes retryable and preserves Retry-After', () => {
    expect(
      classifyEditorialProviderError({
        status: 429,
        headers: new Headers({ 'retry-after': '2.5' }),
      }),
    ).toMatchObject({
      kind: 'http',
      statusCode: 429,
      retryable: true,
      retryAfterMs: 2_500,
    });
    expect(classifyEditorialProviderError({ status: 408 }).retryable).toBe(
      true,
    );
    expect(classifyEditorialProviderError({ status: 409 }).retryable).toBe(
      true,
    );
    expect(classifyEditorialProviderError({ status: 503 }).retryable).toBe(
      true,
    );
    expect(
      classifyEditorialProviderError({ response: { status: '503' } }).retryable,
    ).toBe(true);
  });

  it('keeps permanent client errors local to the failing provider', () => {
    expect(classifyEditorialProviderError({ status: 400 })).toMatchObject({
      statusCode: 400,
      retryable: false,
    });
    expect(classifyEditorialProviderError({ status: 401 })).toMatchObject({
      statusCode: 401,
      retryable: false,
    });
  });

  it('recognizes timeout and network failures without depending on SDK classes', () => {
    expect(classifyEditorialProviderError({ code: 'ETIMEDOUT' })).toMatchObject(
      {
        kind: 'timeout',
        retryable: true,
      },
    );
    expect(
      classifyEditorialProviderError(new TypeError('fetch failed')),
    ).toMatchObject({
      kind: 'network',
      retryable: true,
    });
  });

  it('parses Retry-After seconds and dates without sleeping', () => {
    const now = Date.UTC(2026, 8, 10, 0, 0, 0);
    expect(parseRetryAfterMs('3', now)).toBe(3_000);
    expect(parseRetryAfterMs('Wed, 10 Sep 2026 00:00:05 GMT', now)).toBe(5_000);
    expect(parseRetryAfterMs('invalid', now)).toBeNull();
  });
});
