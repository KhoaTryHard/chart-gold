import 'server-only';

import { GoogleGenAI } from '@google/genai';
import {
  classifyEditorialProviderError,
  resolveEditorialProviderConfigs,
  type EditorialProvider,
  type EditorialProviderConfig,
} from './provider';
import type { EditorialEvidence, EditorialSource } from './types';

export const EDITORIAL_PROMPT_VERSION = 'nhip-vang-editorial-v2';
export const EDITORIAL_PROVIDER_TIMEOUT_MS = 30_000;

export type EditorialGenerationAttempt = {
  provider: EditorialProvider;
  model: string | null;
  status: 'skipped' | 'succeeded' | 'failed';
  retryable: boolean;
  statusCode: number | null;
  retryAfterMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorMessage?: string;
};

export type GeneratedDraft = {
  title: string;
  excerpt: string;
  contentMarkdown: string;
  seoTitle?: string;
  seoDescription?: string;
  coverAlt?: string;
  imagePrompt?: string;
  /** Existing callers persist this as a provider label. */
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  attempts: readonly EditorialGenerationAttempt[];
};

export type GeneratedTranslation = Omit<GeneratedDraft, 'imagePrompt'>;

type ParsedDraft = Omit<
  GeneratedDraft,
  'provider' | 'model' | 'inputTokens' | 'outputTokens' | 'attempts'
>;

type ProviderResponse = {
  raw: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

export class EditorialGenerationError extends Error {
  readonly attempts: readonly EditorialGenerationAttempt[];
  readonly cause: unknown;

  constructor(
    message: string,
    attempts: readonly EditorialGenerationAttempt[],
    cause?: unknown,
  ) {
    super(message);
    this.name = 'EditorialGenerationError';
    this.attempts = [...attempts];
    this.cause = cause;
  }
}

function sourceLines(sources: EditorialSource[]) {
  return sources.length
    ? sources
        .slice(0, 12)
        .map((source, index) => `${index + 1}. ${source.title} — ${source.url}`)
        .join('\n')
    : 'Chưa có nguồn ngoài; chỉ dùng dữ kiện được cung cấp trong chủ đề.';
}

function editorialSystemInstruction() {
  return [
    `Bạn là biên tập viên Nhịp vàng của Kim Tuyến. ${EDITORIAL_PROMPT_VERSION}.`,
    'Viết tiếng Việt, ưu tiên dữ kiện có nguồn. Không sao chép bài nguồn, không bịa số liệu, không khẳng định nguyên nhân nếu bằng chứng chưa đủ.',
    'Bài phải phân biệt dữ kiện, suy luận và điểm cần kiểm chứng. Không dùng HTML, không đưa thông tin cá nhân.',
    'Trả một JSON object duy nhất. Các trường bắt buộc: title, excerpt, contentMarkdown. Các trường tùy chọn: seoTitle, seoDescription, coverAlt, imagePrompt.',
    'contentMarkdown có thể dùng tiêu đề Markdown, danh sách và bảng. imagePrompt chỉ mô tả ảnh minh họa tối giản, không mô tả ảnh chụp sự kiện hay biểu đồ có số liệu.',
  ].join(' ');
}

function editorialTranslationSystemInstruction() {
  return [
    `You translate published Vietnamese gold-market articles for Kim Tuyến. ${EDITORIAL_PROMPT_VERSION}.`,
    'Write natural, factual English. Preserve every number, date, monetary unit, source URL, uncertainty, and Markdown structure. Do not add market claims, advice, sources, or image prompts. Keep Vietnamese brand and product names when translating them would make the item harder to identify.',
    'Use “dealer sell price” for the price a user pays and “dealer buy price” for the price a dealer pays a seller. Keep “lượng” with a brief 37.5g explanation only where it is useful to the reader.',
    'Return exactly one JSON object with title, excerpt, contentMarkdown, seoTitle, seoDescription, coverAlt. Do not return HTML or a Markdown fence.',
  ].join(' ');
}

function evidenceLines(evidence: EditorialEvidence[]) {
  return evidence.length
    ? evidence
        .slice(0, 16)
        .map(
          (item, index) =>
            `${index + 1}. ${item.label}: ${item.value.slice(0, 1_500)}${item.sourceUrl ? ` (${item.sourceUrl})` : ''}`,
        )
        .join('\n')
    : 'Chưa có gói dữ kiện bổ sung.';
}

function editorialUserPrompt(
  topic: string,
  sources: EditorialSource[],
  evidence: EditorialEvidence[],
) {
  return `Chủ đề: ${topic.trim().slice(0, 4_000)}\n\nNguồn được phép tham khảo:\n${sourceLines(sources)}\n\nDữ kiện/trích đoạn đã thu thập (chỉ dùng khi phù hợp với nguồn):\n${evidenceLines(evidence)}`;
}

function editorialTranslationPrompt(source: {
  title: string;
  excerpt: string;
  contentMarkdown: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  coverAlt?: string | null;
}) {
  return [
    'Translate this Vietnamese article into English. Preserve source links and Markdown exactly where possible.',
    `TITLE:\n${source.title}`,
    `EXCERPT:\n${source.excerpt}`,
    `SEO TITLE:\n${source.seoTitle ?? ''}`,
    `SEO DESCRIPTION:\n${source.seoDescription ?? ''}`,
    `COVER ALT:\n${source.coverAlt ?? ''}`,
    `MARKDOWN:\n${source.contentMarkdown}`,
  ].join('\n\n');
}

function sourceUrls(value: string) {
  return [...value.matchAll(/https?:\/\/[^\s)\]]+/gi)].map((match) =>
    match[0].replace(/[.,;!?]+$/g, ''),
  );
}

function normalizedNumbers(value: string) {
  return [...value.matchAll(/\d[\d.,]*/g)]
    .map((match) => match[0].replace(/[^\d]/g, ''))
    .filter(Boolean);
}

/**
 * A translation must not silently lose traceability or an amount. This is a
 * deliberately mechanical guard; fluency is the provider's job, while links
 * and numbers are facts that must remain reviewable.
 */
export function validateEditorialTranslation(
  source: {
    title: string;
    excerpt: string;
    contentMarkdown: string;
  },
  translation: Pick<GeneratedTranslation, 'title' | 'excerpt' | 'contentMarkdown'>,
) {
  const sourceText = `${source.title}\n${source.excerpt}\n${source.contentMarkdown}`;
  const translatedText = `${translation.title}\n${translation.excerpt}\n${translation.contentMarkdown}`;
  const missingUrls = sourceUrls(sourceText).filter(
    (url) => !translatedText.includes(url),
  );
  if (missingUrls.length)
    throw new Error('Bản dịch thiếu liên kết nguồn từ bài gốc.');
  const translatedNumbers = new Set(normalizedNumbers(translatedText));
  const missingNumbers = normalizedNumbers(sourceText).filter(
    (value) => !translatedNumbers.has(value),
  );
  if (missingNumbers.length)
    throw new Error('Bản dịch thiếu số liệu từ bài gốc.');
}

function stringField(
  record: Record<string, unknown>,
  field: string,
  maxLength: number,
) {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`AI trả về bản nháp không đủ trường ${field}.`);
  }
  return value.trim().slice(0, maxLength);
}

function optionalStringField(
  record: Record<string, unknown>,
  field: string,
  maxLength: number,
) {
  if (!(field in record) || record[field] === null) return undefined;
  const value = record[field];
  if (typeof value !== 'string') {
    throw new Error(`AI trả về trường ${field} không hợp lệ.`);
  }
  const normalized = value.trim().slice(0, maxLength);
  return normalized || undefined;
}

function removeJsonFence(value: string) {
  const trimmed = value.trim();
  const fenced = /^```json\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

/** Parses the strict JSON contract accepted from every editorial provider. */
export function parseEditorialDraft(value: string): ParsedDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(removeJsonFence(value));
  } catch {
    throw new Error('AI không trả về JSON hợp lệ cho bản nháp.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI trả về bản nháp không đúng định dạng JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  return {
    title: stringField(record, 'title', 180),
    excerpt: stringField(record, 'excerpt', 360),
    contentMarkdown: stringField(record, 'contentMarkdown', 40_000),
    seoTitle: optionalStringField(record, 'seoTitle', 180),
    seoDescription: optionalStringField(record, 'seoDescription', 360),
    coverAlt: optionalStringField(record, 'coverAlt', 240),
    imagePrompt: optionalStringField(record, 'imagePrompt', 2_000),
  };
}

function tokenCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null;
}

function requestSignal(signal?: AbortSignal) {
  return signal ?? AbortSignal.timeout(EDITORIAL_PROVIDER_TIMEOUT_MS);
}

async function requestGemini(
  config: EditorialProviderConfig,
  userPrompt: string,
  systemInstruction: string,
  maxOutputTokens = 2_000,
  signal?: AbortSignal,
): Promise<ProviderResponse> {
  if (!config.apiKey || !config.model)
    throw new Error('Thiếu cấu hình AI provider.');
  const client = new GoogleGenAI({ apiKey: config.apiKey });
  const response = await client.models.generateContent({
    model: config.model,
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      maxOutputTokens,
      abortSignal: requestSignal(signal),
    },
  });
  const raw = response.text;
  if (typeof raw !== 'string')
    throw new Error('AI không trả về nội dung bản nháp.');
  return {
    raw,
    inputTokens: tokenCount(response.usageMetadata?.promptTokenCount),
    outputTokens: tokenCount(response.usageMetadata?.candidatesTokenCount),
  };
}

async function requestProvider(
  config: EditorialProviderConfig,
  userPrompt: string,
  systemInstruction: string,
  maxOutputTokens: number,
  signal?: AbortSignal,
) {
  if (config.provider !== 'gemini')
    throw new Error('Editorial chỉ hỗ trợ Gemini bằng key riêng.');
  return requestGemini(config, userPrompt, systemInstruction, maxOutputTokens, signal);
}

function providerStorageName(provider: EditorialProvider): string {
  return provider === 'gemini' ? 'gemini-editorial' : 'unknown-editorial';
}

function skippedAttempt(
  config: EditorialProviderConfig,
): EditorialGenerationAttempt {
  return {
    provider: config.provider,
    model: config.model,
    status: 'skipped',
    retryable: false,
    statusCode: null,
    retryAfterMs: null,
    inputTokens: null,
    outputTokens: null,
    errorMessage: `Thiếu cấu hình: ${config.missing.join(', ')}.`,
  };
}

function abortedError(
  attempts: readonly EditorialGenerationAttempt[],
  cause?: unknown,
) {
  return new EditorialGenerationError(
    'Tác vụ tạo bản nháp đã bị hủy.',
    attempts,
    cause,
  );
}

/**
 * Generates one editorial draft through the isolated Gemini account.
 * Temporary errors are returned to the queue for a later attempt; the
 * chatbot credential and other providers are never consumed here.
 */
export async function generateEditorialDraft(
  topic: string,
  sources: EditorialSource[] = [],
  signal?: AbortSignal,
  evidence: EditorialEvidence[] = [],
): Promise<GeneratedDraft> {
  const attempts: EditorialGenerationAttempt[] = [];
  const userPrompt = editorialUserPrompt(topic, sources, evidence);

  if (signal?.aborted) throw abortedError(attempts);

  for (const config of resolveEditorialProviderConfigs()) {
    if (!config.configured) {
      attempts.push(skippedAttempt(config));
      continue;
    }

    try {
      const response = await requestProvider(
        config,
        userPrompt,
        editorialSystemInstruction(),
        2_000,
        signal,
      );
      const parsed = parseEditorialDraft(response.raw);
      const attempt: EditorialGenerationAttempt = {
        provider: config.provider,
        model: config.model,
        status: 'succeeded',
        retryable: false,
        statusCode: null,
        retryAfterMs: null,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
      };
      attempts.push(attempt);
      return {
        ...parsed,
        provider: providerStorageName(config.provider),
        model: config.model ?? 'unknown',
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        attempts,
      };
    } catch (error) {
      if (signal?.aborted) throw abortedError(attempts, error);
      const failure = classifyEditorialProviderError(error);
      attempts.push({
        provider: config.provider,
        model: config.model,
        status: 'failed',
        retryable: failure.retryable,
        statusCode: failure.statusCode,
        retryAfterMs: failure.retryAfterMs,
        inputTokens: null,
        outputTokens: null,
        errorMessage: failure.message,
      });
      if (!failure.retryable) {
        throw new EditorialGenerationError(
          `Không thể tạo bản nháp với ${config.provider}: ${failure.message}`,
          attempts,
          error,
        );
      }
    }
  }

  throw new EditorialGenerationError(
    'Không có nhà cung cấp AI nào khả dụng để tạo bản nháp. Bài viết chưa được tạo.',
    attempts,
  );
}

export async function generateEditorialTranslation(
  source: {
    title: string;
    excerpt: string;
    contentMarkdown: string;
    seoTitle?: string | null;
    seoDescription?: string | null;
    coverAlt?: string | null;
  },
  signal?: AbortSignal,
): Promise<GeneratedTranslation> {
  const maxChunkCharacters = 6_000;
  if (source.contentMarkdown.length > maxChunkCharacters) {
    const chunks: string[] = [];
    const separators: string[] = [];
    let current = '';
    const segments = source.contentMarkdown.match(/.*(?:\n|$)/g) ?? [];
    const appendSegment = (segment: string) => {
      if (!segment) return;
      if (current && current.length + segment.length > maxChunkCharacters) {
        separators.push(current.endsWith('\n\n') ? '\n\n' : '\n');
        chunks.push(current);
        current = '';
      }
      current += segment;
    };
    for (const segment of segments) {
      if (segment.length <= maxChunkCharacters) {
        appendSegment(segment);
        continue;
      }
      const words = segment.match(/\S+\s*/g) ?? [segment];
      for (const word of words) {
        if (word.length > maxChunkCharacters)
          throw new EditorialGenerationError(
            'A Markdown token is too long to translate safely.',
            [],
          );
        appendSegment(word);
      }
    }
    if (current) chunks.push(current);
    const translations: GeneratedTranslation[] = [];
    const attempts: EditorialGenerationAttempt[] = [];
    try {
      for (const chunk of chunks) {
        signal?.throwIfAborted();
        const translation = await generateEditorialTranslation(
          { ...source, contentMarkdown: chunk },
          signal,
        );
        translations.push(translation);
        attempts.push(...translation.attempts);
      }
    } catch (error) {
      const failedAttempts =
        error instanceof EditorialGenerationError ? error.attempts : [];
      throw new EditorialGenerationError(
        error instanceof Error ? error.message : 'Unable to translate article section.',
        [...attempts, ...failedAttempts],
        error,
      );
    }
    const first = translations[0];
    if (!first)
      throw new EditorialGenerationError('Article has no translatable content.', []);
    const contentParts = translations.map((item) =>
      item.contentMarkdown.replace(/\n+$/g, ''),
    );
    const contentMarkdown = contentParts.reduce(
      (joined, part, index) =>
        index === 0
          ? part
          : `${joined}${separators[index - 1] ?? '\n'}${part}`,
      '',
    );
    const tokenTotal = (key: 'inputTokens' | 'outputTokens') => {
      const values = translations.map((item) => item[key]);
      return values.some((value) => value === null)
        ? null
        : values.reduce<number>((total, value) => total + (value ?? 0), 0);
    };
    return {
      ...first,
      contentMarkdown,
      inputTokens: tokenTotal('inputTokens'),
      outputTokens: tokenTotal('outputTokens'),
      attempts,
    };
  }
  const attempts: EditorialGenerationAttempt[] = [];
  const userPrompt = editorialTranslationPrompt(source);
  const maxOutputTokens = Math.min(
    8_000,
    Math.max(1_000, Math.ceil(source.contentMarkdown.length / 3)),
  );
  if (signal?.aborted) throw abortedError(attempts);

  for (const config of resolveEditorialProviderConfigs()) {
    if (!config.configured) {
      attempts.push(skippedAttempt(config));
      continue;
    }
    try {
      const response = await requestProvider(
        config,
        userPrompt,
        editorialTranslationSystemInstruction(),
        maxOutputTokens,
        signal,
      );
      const parsed = parseEditorialDraft(response.raw);
      attempts.push({
        provider: config.provider,
        model: config.model,
        status: 'succeeded',
        retryable: false,
        statusCode: null,
        retryAfterMs: null,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
      });
      const { imagePrompt: _imagePrompt, ...parsedTranslation } = parsed;
      const translation = {
        ...parsedTranslation,
        provider: providerStorageName(config.provider),
        model: config.model ?? 'unknown',
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        attempts,
      };
      validateEditorialTranslation(source, translation);
      return translation;
    } catch (error) {
      if (signal?.aborted) throw abortedError(attempts, error);
      const failure = classifyEditorialProviderError(error);
      attempts.push({
        provider: config.provider,
        model: config.model,
        status: 'failed',
        retryable: failure.retryable,
        statusCode: failure.statusCode,
        retryAfterMs: failure.retryAfterMs,
        inputTokens: null,
        outputTokens: null,
        errorMessage: failure.message,
      });
      if (!failure.retryable)
        throw new EditorialGenerationError(
          `Unable to translate with ${config.provider}: ${failure.message}`,
          attempts,
          error,
        );
    }
  }
  throw new EditorialGenerationError(
    'No editorial AI provider is available to translate this article.',
    attempts,
  );
}
