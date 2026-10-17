import 'server-only';
import { formatInstructions } from './prompt';
import { focusedFactualAnswer } from './fallback';

import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import OpenAI from 'openai';
import {
  resolveIntent,
  outputBudget,
  buildUserHistory,
  type AnalysisIntent,
} from './intent';
import type { InvestorProfile } from './investor-profile';
import type { AnalysisDecision, AnalysisFacts } from './response';
import type { AnalysisDepth, AnalysisGoal, ScenarioInputs } from './experience';
import type { ResolvedScenario } from './input';
import type { ForecastResult } from './forecast';
import type { PortfolioLedger } from '@/lib/portfolio-ledger';
import type { EntitlementView } from '@/lib/billing/plans';
import { factualAnswer, type MarketContext } from './market-context';
import { abortable } from '@/lib/server/market-fetch';
import { byteOffsetToIndex } from './citations';

import type { AnalysisMetrics, AnalysisRange } from '@/lib/analysis/metrics';
import type { PricePoint } from '@/lib/server/sjc';
import type { MarketProduct } from '@/lib/market-sources';
import type { Locale } from '@/lib/i18n';
import {
  DEEP_ANALYSIS_MODEL,
  routeAnalysisModel,
} from '@/lib/analysis/model-routing';

export {
  DEFAULT_ANALYSIS_MODEL,
  DEEP_ANALYSIS_MODEL,
  OPENAI_DEFAULT_ANALYSIS_MODEL,
  OPENAI_DEEP_ANALYSIS_MODEL,
  buildGeminiContents,
  routeAnalysisModel,
  routeOpenAIModel,
} from '@/lib/analysis/model-routing';

export type AnalysisSource = {
  title: string;
  url: string;
};

export type AnalysisDoneUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type AnalysisEvent =
  | {
      type: 'conversation';
      conversationId: string;
      turnId: string;
      conversationVersion?: number;
    }
  | { type: 'status'; message: string; provider?: string; model?: string }
  | { type: 'warning'; message: string }
  | { type: 'entitlement'; entitlement: EntitlementView }
  | {
      type: 'metadata';
      context: MarketContext;
      entitlement?: EntitlementView;
    }
  | {
      type: 'grounding';
      citations: Array<{
        start: number;
        end: number;
        url: string;
        title: string;
      }>;
      suggestions?: string;
    }
  | { type: 'delta'; delta: string }
  | { type: 'reset'; provider?: string; attempt: number; message: string }
  | { type: 'sources'; sources: AnalysisSource[] }
  | {
      type: 'facts';
      payload: AnalysisFacts;
    }
  | {
      type: 'decision';
      payload: AnalysisDecision;
    }
  | { type: 'forecast'; forecast: ForecastResult }
  | {
      type: 'clarification';
      needs: Array<{ key: string; label: string; reason: string }>;
    }
  | {
      type: 'done';
      model: string;
      usage: AnalysisDoneUsage | null;
      requestId?: string;
      asOf?: string;
      provider?: string;
      grounded?: boolean;
      completion?: 'complete' | 'truncated' | 'limited';
      responseVersion?: 1 | 2;
      schemaVersion?: 1 | 2;
      promptVersion?: string;
      conversationId?: string;
      turnId?: string;
      conversationVersion?: number;
      answerStatus?: 'complete' | 'insufficient-data' | 'limited' | 'error';
    }
  | {
      type: 'error';
      message: string;
      code?: string;
      provider?: string;
      retryable?: boolean;
      finishReason?: string;
      requestId?: string;
      refunded?: boolean;
      conversationId?: string;
      turnId?: string;
      conversationVersion?: number;
    };

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly provider?: string,
    public readonly status?: number,
    public readonly finishReason?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

function providerErrorDetails(error: unknown, provider: string) {
  if (error instanceof ProviderError) return error;
  const record =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : {};
  const status = typeof record.status === 'number' ? record.status : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const code =
    status === 429
      ? 'PROVIDER_RATE_LIMITED'
      : status && status >= 500
        ? 'PROVIDER_UNAVAILABLE'
        : /timeout|timed out|aborted/i.test(lower)
          ? 'PROVIDER_TIMEOUT'
          : /blocked|safety|prohibited|recitation|forbidden/i.test(lower)
            ? 'PROVIDER_BLOCKED'
            : /api.?key|authentication|unauthorized|permission|forbidden|invalid argument|bad request/i.test(
                  lower,
                )
              ? 'PROVIDER_CONFIGURATION'
              : 'PROVIDER_STREAM_FAILED';
  return new ProviderError(message, code, provider, status);
}

function isRetryableProviderError(error: unknown) {
  const normalized = providerErrorDetails(error, 'provider');
  if (
    normalized.code === 'PROVIDER_BLOCKED' ||
    normalized.code === 'PROVIDER_CONFIGURATION'
  )
    return false;
  if (
    normalized.status === 408 ||
    normalized.status === 425 ||
    normalized.status === 429 ||
    (normalized.status ?? 0) >= 500
  )
    return true;
  return (
    normalized.code === 'PROVIDER_TIMEOUT' ||
    normalized.code === 'PROVIDER_UNAVAILABLE' ||
    normalized.code === 'PROVIDER_STREAM_FAILED'
  );
}

export type AnalysisRequest = {
  responseVersion?: 2;
  intent?: AnalysisIntent;
  goal?: AnalysisGoal;
  analysisDepth?: AnalysisDepth;
  scenarioInputs?: ScenarioInputs;
  resolvedScenario?: ResolvedScenario;
  forecast?: ForecastResult;
  investorProfile?: InvestorProfile;
  portfolioLedger?: PortfolioLedger;
  marketContext?: MarketContext;
  question: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  product: MarketProduct;
  range: AnalysisRange;
  metrics: AnalysisMetrics;
  records: readonly PricePoint[];
  observedAt: string;
  /** Absent requests are legacy Vietnamese requests. */
  locale?: Locale;
};

export { ANALYSIS_PROMPT_VERSION } from './experience';

export function buildModelInput(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  question: string,
  locale: Locale = 'vi',
) {
  const history = buildUserHistory(messages);
  if (!history.length) return [{ role: 'user' as const, content: question }];
  const copy =
    locale === 'en'
      ? {
          history:
            'EARLIER USER QUESTION CONTEXT (reference only; do not answer it again):',
          current: 'CURRENT QUESTION (answer this question only):',
        }
      : {
          history: 'NGỮ CẢNH CÂU HỎI TRƯỚC (chỉ tham khảo, không trả lời lại):',
          current: 'CÂU HỎI HIỆN TẠI (chỉ trả lời câu này):',
        };
  return [
    {
      role: 'user' as const,
      content: [
        copy.history,
        ...history.map((message, index) => `${index + 1}. ${message.content}`),
        '',
        copy.current,
        question,
      ].join('\n'),
    },
  ];
}

export interface AnalysisProvider {
  readonly name: string;
  analyze(
    request: AnalysisRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AnalysisEvent>;
}

function normalizeSource(value: unknown): AnalysisSource | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { url?: unknown; title?: unknown; type?: unknown };
  if (
    candidate.type &&
    candidate.type !== 'url_citation' &&
    candidate.type !== 'url'
  ) {
    return null;
  }
  if (typeof candidate.url !== 'string') return null;
  try {
    const url = new URL(candidate.url);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return {
      title:
        typeof candidate.title === 'string' && candidate.title.trim()
          ? candidate.title.trim().slice(0, 300)
          : url.hostname,
      url: url.toString(),
    };
  } catch {
    return null;
  }
}

function collectSources(value: unknown, sources: Map<string, AnalysisSource>) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectSources(item, sources);
    return;
  }
  const source = normalizeSource(value);
  if (source) sources.set(source.url, source);
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') collectSources(nested, sources);
  }
}

export class OpenAIAnalysisProvider implements AnalysisProvider {
  readonly name = 'openai';

  async *analyze(
    request: AnalysisRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AnalysisEvent> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');

    const intent = request.intent ?? resolveIntent(request.question);
    const model =
      intent.depth === 'deep' || intent.kind === 'investment'
        ? process.env.OPENAI_DEEP_MODEL?.trim() || 'gpt-5.4-2026-03-05'
        : process.env.OPENAI_MODEL?.trim() || 'gpt-5.4-mini-2026-03-17';
    const client = new OpenAI({ apiKey, maxRetries: 0 });
    const input = buildModelInput(
      request.messages,
      request.question,
      request.locale,
    );
    const stream = await client.responses.create(
      {
        model,
        instructions: formatInstructions(request, model, {
          webSearch: intent.needsResearch,
        }),
        input,
        reasoning: {
          effort:
            intent.depth === 'deep' || intent.kind === 'investment'
              ? 'medium'
              : 'none',
        },
        tools: intent.needsResearch
          ? [
              {
                type: 'web_search',
                search_context_size: 'medium',
                user_location: {
                  type: 'approximate',
                  country: 'VN',
                  timezone: 'Asia/Ho_Chi_Minh',
                },
              },
            ]
          : [],
        include: ['web_search_call.action.sources'],
        store: false,
        stream: true,
        max_output_tokens: outputBudget(intent),
      },
      { signal },
    );

    const sources = new Map<string, AnalysisSource>();
    let usage: AnalysisDoneUsage | null = null;
    let buffered = '';
    let finished = false;
    let truncated = false;
    const citations: Array<{
      start: number;
      end: number;
      url: string;
      title: string;
    }> = [];
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        if (intent.needsResearch) buffered += event.delta;
        else if (event.delta) yield { type: 'delta', delta: event.delta };
      } else if (event.type === 'response.output_text.annotation.added') {
        const source = normalizeSource(event.annotation);
        if (source) sources.set(source.url, source);
        if (source && event.annotation?.type === 'url_citation')
          citations.push({
            ...source,
            start: event.annotation.start_index,
            end: event.annotation.end_index,
          });
      } else if (
        event.type === 'response.completed' ||
        event.type === 'response.incomplete'
      ) {
        finished = true;
        truncated = event.type === 'response.incomplete';
        collectSources(event.response, sources);
        for (const item of event.response.output) {
          if (item.type !== 'message') continue;
          for (const part of item.content) {
            if (part.type !== 'output_text') continue;
            for (const annotation of part.annotations) {
              if (annotation.type === 'url_citation') {
                const source = normalizeSource(annotation);
                if (source)
                  citations.push({
                    ...source,
                    start: annotation.start_index,
                    end: annotation.end_index,
                  });
              }
            }
          }
        }
        const responseUsage = event.response.usage;
        usage = responseUsage
          ? {
              inputTokens: responseUsage.input_tokens ?? null,
              outputTokens: responseUsage.output_tokens ?? null,
              totalTokens: responseUsage.total_tokens ?? null,
            }
          : null;
      } else if (event.type === 'response.failed' || event.type === 'error')
        throw new Error('OpenAI response failed');
    }
    if (!finished) throw new Error('OpenAI stream ended without completion');
    if (intent.needsResearch && !citations.length)
      throw new Error('Research response has no supporting citations');
    if (buffered) yield { type: 'delta', delta: buffered };
    if (citations.length) yield { type: 'grounding', citations };
    if (sources.size > 0) {
      yield { type: 'sources', sources: [...sources.values()].slice(0, 12) };
    }
    if (truncated)
      yield {
        type: 'warning',
        message:
          request.locale === 'en'
            ? 'The response was cut off by the output limit. Narrow the question or ask to continue.'
            : 'Câu trả lời chưa hoàn tất do giới hạn đầu ra. Hãy thu hẹp câu hỏi hoặc yêu cầu tiếp tục.',
      };
    yield {
      type: 'done',
      model,
      usage,
      provider: 'openai',
      grounded: intent.needsResearch,
      completion: truncated ? 'truncated' : 'complete',
    };
  }
}

function collectGeminiSources(
  value: unknown,
  sources: Map<string, AnalysisSource>,
) {
  if (!value || typeof value !== 'object') return;
  const candidate = value as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: { uri?: string; title?: string };
        }>;
      };
    }>;
  };
  for (const responseCandidate of candidate.candidates ?? []) {
    for (const chunk of responseCandidate.groundingMetadata?.groundingChunks ??
      []) {
      const web = chunk.web;
      if (!web?.uri) continue;
      const source = normalizeSource({
        type: 'url',
        url: web.uri,
        title: web.title,
      });
      if (source) sources.set(source.url, source);
    }
  }
}

function mapGeminiUsage(value: unknown): AnalysisDoneUsage | null {
  if (!value || typeof value !== 'object') return null;
  const usage = value as {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    totalTokenCount?: unknown;
  };
  const asNumber = (tokenCount: unknown) =>
    typeof tokenCount === 'number' && Number.isFinite(tokenCount)
      ? tokenCount
      : null;
  const mapped = {
    inputTokens: asNumber(usage.promptTokenCount),
    outputTokens: asNumber(usage.candidatesTokenCount),
    totalTokens: asNumber(usage.totalTokenCount),
  };
  return mapped.inputTokens !== null ||
    mapped.outputTokens !== null ||
    mapped.totalTokens !== null
    ? mapped
    : null;
}

function collectGeminiErrorDetails(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
): string[] {
  if (depth > 3 || value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number') {
    return [String(value)];
  }
  if (typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);

  const record = value as Record<string, unknown>;
  const details: string[] = [];
  for (const key of [
    'name',
    'message',
    'code',
    'status',
    'statusCode',
    'statusText',
    'reason',
    'body',
    'error',
    'details',
    'cause',
  ]) {
    const nested = record[key];
    if (typeof nested === 'string' || typeof nested === 'number') {
      details.push(String(nested));
    } else {
      details.push(...collectGeminiErrorDetails(nested, depth + 1, seen));
    }
  }
  return details;
}

function isGeminiGroundingQuotaError(error: unknown) {
  const details = collectGeminiErrorDetails(error).join(' ').toLowerCase();
  const hasRateLimitStatus = /\b429\b/.test(details);
  const hasResourceExhaustedCode = /\bresource[_\s-]*exhausted\b/.test(details);

  // This helper is only called after the Google Search grounded request. The
  // Gemini API commonly returns a generic quota message without identifying
  // grounding in the error body, so the HTTP/status signal is the reliable
  // discriminator here. Other failures must continue to surface unchanged.
  return hasRateLimitStatus || hasResourceExhaustedCode;
}

export class GeminiAnalysisProvider implements AnalysisProvider {
  readonly name = 'gemini';

  async *analyze(
    request: AnalysisRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AnalysisEvent> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini provider requires GEMINI_API_KEY.');

    const intent = request.intent ?? resolveIntent(request.question);
    const model = request.intent
      ? 'gemini-3.6-flash'
      : routeAnalysisModel(request.question);
    const deep = request.intent
      ? intent.depth === 'deep'
      : shouldUseDeepModel(request.question);
    const configuredModel = deep
      ? process.env.GEMINI_DEEP_MODEL?.trim()
      : process.env.GEMINI_MODEL?.trim();
    const selectedModel = configuredModel || model;
    const useDeepReasoning = deep && selectedModel.startsWith('gemini-3.');
    const client = new GoogleGenAI({ apiKey });
    const contents = buildModelInput(
      request.messages,
      request.question,
      request.locale,
    ).map((message) => ({
      role: 'user' as const,
      parts: [{ text: message.content }] as [{ text: string }],
    }));
    const baseConfig = {
      systemInstruction: formatInstructions(request, selectedModel),
      maxOutputTokens: outputBudget(intent),
      thinkingConfig: {
        thinkingLevel: useDeepReasoning
          ? ThinkingLevel.HIGH
          : ThinkingLevel.LOW,
      },
      abortSignal: signal,
    };
    const openStream = (withGrounding: boolean) =>
      client.models.generateContentStream({
        model: selectedModel,
        contents,
        config: {
          ...baseConfig,
          ...(withGrounding ? { tools: [{ googleSearch: {} }] } : {}),
        },
      });

    // The SDK may reject either while creating the stream or on its first
    // iterator read. Open and read the first chunk before yielding anything
    // so a grounding-only quota failure can be retried without duplicate SSE
    // deltas. Once that first read succeeds, later failures are surfaced as-is.
    const openStreamWithFirstChunk = async (withGrounding: boolean) => {
      const stream = await openStream(withGrounding);
      const iterator = stream[Symbol.asyncIterator]();
      const first = await iterator.next();
      return { iterator, first };
    };
    const openGroundedStream = async () => {
      try {
        return await openStreamWithFirstChunk(
          intent.needsResearch || !request.intent,
        );
      } catch (error) {
        if (!signal.aborted && isGeminiGroundingQuotaError(error)) {
          return null;
        }
        throw error;
      }
    };

    let grounded = intent.needsResearch || !request.intent;
    let active = await openGroundedStream();
    if (!active) {
      grounded = false;
      active = await openStreamWithFirstChunk(false);
    }

    const sources = new Map<string, AnalysisSource>();
    let usage: AnalysisDoneUsage | null = null;
    let current = active.first;
    let buffered = '';
    let finishReason: string | undefined;
    const citations: Array<{
      start: number;
      end: number;
      url: string;
      title: string;
    }> = [];
    let suggestions: string | undefined;
    while (!current.done) {
      const chunk = current.value;
      collectGeminiSources(chunk, sources);
      usage = mapGeminiUsage(chunk.usageMetadata) ?? usage;
      const text = chunk.text;
      if (intent.needsResearch) buffered += text ?? '';
      else if (text) yield { type: 'delta', delta: text };
      for (const candidate of chunk.candidates ?? []) {
        finishReason = candidate.finishReason ?? finishReason;
        const metadata = candidate.groundingMetadata;
        suggestions =
          metadata?.searchEntryPoint?.renderedContent ?? suggestions;
        for (const support of metadata?.groundingSupports ?? []) {
          for (const index of support.groundingChunkIndices ?? []) {
            const web = metadata?.groundingChunks?.[index]?.web;
            if (web?.uri && support.segment?.endIndex !== undefined) {
              const source = normalizeSource({
                url: web.uri,
                title: web.title,
              });
              if (source)
                citations.push({
                  ...source,
                  start: support.segment.startIndex ?? 0,
                  end: support.segment.endIndex,
                });
            }
          }
        }
      }
      current = await active.iterator.next();
    }
    if (
      (request.intent && !finishReason) ||
      (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS')
    )
      throw new ProviderError(
        `Gemini response blocked or incomplete${finishReason ? ` (${finishReason})` : ''}`,
        finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS'
          ? 'PROVIDER_BLOCKED'
          : 'PROVIDER_STREAM_FAILED',
        'gemini',
        undefined,
        finishReason,
      );
    if (
      intent.needsResearch &&
      grounded &&
      (!buffered.trim() || !citations.length)
    )
      throw new Error('Research response has no supporting citations');
    if (buffered) yield { type: 'delta', delta: buffered };
    if (citations.length || suggestions)
      yield {
        type: 'grounding',
        citations: citations.map((citation) => ({
          ...citation,
          start: byteOffsetToIndex(buffered, citation.start),
          end: byteOffsetToIndex(buffered, citation.end),
        })),
        suggestions,
      };
    if (sources.size > 0) {
      yield { type: 'sources', sources: [...sources.values()].slice(0, 12) };
    }
    if (!grounded && intent.needsResearch)
      yield {
        type: 'warning',
        message:
          request.locale === 'en'
            ? 'Gemini could not search the web on this request. The response uses server data and background knowledge only; it is not verified current reporting.'
            : 'Gemini chưa tra cứu web được trong lượt này; nội dung dưới đây chỉ dựa trên dữ liệu máy chủ và kiến thức nền, chưa phải cập nhật thời sự đã xác minh.',
      };
    if (finishReason === 'MAX_TOKENS')
      yield {
        type: 'warning',
        message:
          request.locale === 'en'
            ? 'The response reached its length limit. Ask for the part you need to continue.'
            : 'Câu trả lời bị giới hạn độ dài; hãy yêu cầu phân tích tiếp phần cần thiết.',
      };
    yield {
      type: 'done',
      model: selectedModel,
      usage,
      ...(request.intent
        ? {
            provider: 'gemini',
            grounded,
            completion:
              finishReason === 'MAX_TOKENS'
                ? ('truncated' as const)
                : ('complete' as const),
          }
        : {}),
    };
  }
}

function shouldUseDeepModel(question: string) {
  return routeAnalysisModel(question) === DEEP_ANALYSIS_MODEL;
}

export class HermesAnalysisProvider implements AnalysisProvider {
  readonly name = 'hermes';

  /**
   * Hermes' API server implements the OpenAI chat-completions contract. The
   * OpenAI SDK accepts a base URL and appends `/chat/completions`, so normalize
   * the configured gateway to the `/v1` root here. Keeping this function
   * exported also makes the URL contract easy to test without making a
   * network request.
   */
  static normalizeBaseUrl(value: string) {
    return normalizeHermesBaseUrl(value);
  }

  async *analyze(
    request: AnalysisRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AnalysisEvent> {
    const baseUrl = process.env.HERMES_BASE_URL?.trim();
    const apiKey = process.env.HERMES_API_KEY?.trim();
    const model = process.env.HERMES_MODEL?.trim();
    if (!baseUrl || !apiKey || !model) {
      throw new Error(
        'Hermes provider requires HERMES_BASE_URL, HERMES_API_KEY, and HERMES_MODEL.',
      );
    }

    const client = new OpenAI({
      apiKey,
      baseURL: normalizeHermesBaseUrl(baseUrl),
    });
    const messages = [
      {
        role: 'system' as const,
        content: formatInstructions(request, model, { webSearch: false }),
      },
      ...buildModelInput(request.messages, request.question, request.locale),
    ];
    const stream = await client.chat.completions.create(
      {
        model,
        messages,
        // Hermes' OpenAI-compatible server accepts the established
        // `max_tokens` chat-completions field. The OpenAI SDK marks it
        // deprecated only for its own newer models.
        // oxlint-disable-next-line typescript/no-deprecated
        max_tokens: outputBudget(request.intent),
        stream: true,
        // Hermes follows the OpenAI streaming shape. Gateways that support
        // this option include token usage on the final, empty chunk.
        stream_options: { include_usage: true },
      },
      { signal },
    );

    const sources = new Map<string, AnalysisSource>();
    let usage: AnalysisDoneUsage | null = null;
    let requestId: string | undefined;
    for await (const chunk of stream) {
      requestId ??= typeof chunk.id === 'string' ? chunk.id : undefined;
      collectSources(chunk, sources);
      usage = mapHermesUsage(chunk.usage) ?? usage;

      for (const choice of chunk.choices ?? []) {
        const text = extractChatDeltaText(choice.delta?.content);
        if (text) yield { type: 'delta', delta: text };
      }
    }

    if (sources.size > 0) {
      yield { type: 'sources', sources: [...sources.values()].slice(0, 12) };
    }
    yield { type: 'done', model, usage, requestId };
  }
}

/** Normalize a Hermes gateway URL to the OpenAI-compatible `/v1` root. */
export function normalizeHermesBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('HERMES_BASE_URL must not be empty.');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('HERMES_BASE_URL must be a valid HTTP(S) URL.');
  }
  const hostname = url.hostname.toLowerCase();
  const isLoopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error(
      'HERMES_BASE_URL must use HTTPS; HTTP is allowed only for localhost.',
    );
  }
  if (url.username || url.password) {
    throw new Error('HERMES_BASE_URL must not include credentials.');
  }
  if (url.search || url.hash) {
    throw new Error('HERMES_BASE_URL must not include a query string or hash.');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname.toLowerCase().endsWith('/v1')
    ? pathname || '/v1'
    : `${pathname || ''}/v1`;
  return url.toString().replace(/\/$/, '');
}

function extractChatDeltaText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractChatDeltaText).join('');
  if (!value || typeof value !== 'object') return '';

  const candidate = value as { text?: unknown; content?: unknown };
  if (typeof candidate.text === 'string') return candidate.text;
  return extractChatDeltaText(candidate.content);
}

function mapHermesUsage(value: unknown): AnalysisDoneUsage | null {
  if (!value || typeof value !== 'object') return null;
  const usage = value as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    input_tokens?: unknown;
    output_tokens?: unknown;
  };
  const asNumber = (tokenCount: unknown) =>
    typeof tokenCount === 'number' && Number.isFinite(tokenCount)
      ? tokenCount
      : null;
  const mapped = {
    inputTokens: asNumber(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: asNumber(usage.completion_tokens ?? usage.output_tokens),
    totalTokens: asNumber(usage.total_tokens),
  };
  return mapped.inputTokens !== null ||
    mapped.outputTokens !== null ||
    mapped.totalTokens !== null
    ? mapped
    : null;
}

export function createAnalysisProvider(): AnalysisProvider {
  const provider = (process.env.AI_PROVIDER ?? 'auto').trim().toLowerCase();
  if (provider === 'auto') return new AutoAnalysisProvider();
  if (provider === 'gemini') return new GeminiAnalysisProvider();
  if (provider === 'openai') return new OpenAIAnalysisProvider();
  if (provider === 'hermes') return new HermesAnalysisProvider();
  throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
}

/** At most one classification call; it receives user text, never grounded answers. */
export async function classifyIntent(
  question: string,
  messages: AnalysisRequest['messages'],
  signal: AbortSignal,
  locale: Locale = 'vi',
) {
  const intent = resolveIntent(question, buildUserHistory(messages));
  const gatewayBaseUrl = process.env.HERMES_BASE_URL?.trim();
  const gatewayApiKey = process.env.HERMES_API_KEY?.trim();
  if (!intent.ambiguous || !gatewayBaseUrl || !gatewayApiKey) return intent;
  try {
    const client = new OpenAI({
      apiKey: gatewayApiKey,
      baseURL: normalizeHermesBaseUrl(gatewayBaseUrl),
      maxRetries: 0,
    });
    const result = await client.chat.completions.create(
      {
        model: process.env.HERMES_MODEL || 'gpt-5.4-mini',
        messages: [
          {
            role: 'system',
            content:
              locale === 'en'
                ? 'Classify a question for a Vietnam gold assistant. Current news, causes, forecasts, and macroeconomics are macro. Anything outside gold investing or related macroeconomics is out-of-scope. Return only JSON: {"kind":"lookup|investment|macro|out-of-scope"}.'
                : 'Phân loại câu hỏi cho trợ lý vàng Việt Nam. Tin mới, nguyên nhân, dự báo, vĩ mô là macro. Ngoài đầu tư vàng/vĩ mô là out-of-scope. Chỉ trả JSON dạng {"kind":"lookup|investment|macro|out-of-scope"}.',
          },
          ...buildModelInput(buildUserHistory(messages), question, locale),
        ],
        response_format: { type: 'json_object' },
        // Hermes gateway accepts the established Chat Completions field.
        // oxlint-disable-next-line typescript/no-deprecated
        max_tokens: 128,
      },
      { signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]) },
    );
    const raw = result.choices[0]?.message?.content;
    const parsed = JSON.parse(typeof raw === 'string' ? raw : '') as {
      kind?: AnalysisIntent['kind'];
    };
    if (
      ['lookup', 'investment', 'macro', 'out-of-scope'].includes(
        parsed.kind ?? '',
      )
    ) {
      intent.kind = parsed.kind!;
      intent.needsResearch = intent.kind === 'macro';
      intent.depth =
        intent.kind === 'investment' || intent.kind === 'macro'
          ? 'standard'
          : 'short';
    }
  } catch {
    signal.throwIfAborted();
  }
  return intent;
}

export class AutoAnalysisProvider implements AnalysisProvider {
  readonly name = 'auto';
  constructor(
    private readonly providers: {
      hermes: AnalysisProvider;
      gemini: AnalysisProvider;
    } = {
      hermes: new HermesAnalysisProvider(),
      gemini: new GeminiAnalysisProvider(),
    },
  ) {}

  async *analyze(
    request: AnalysisRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AnalysisEvent> {
    const intent =
      request.intent ?? resolveIntent(request.question, request.messages);
    if (intent.kind === 'out-of-scope') {
      yield {
        type: 'delta',
        delta:
          request.locale === 'en'
            ? 'I can help with Vietnam gold investing and related macroeconomics. Would you like to compare prices, calculate profit and loss, or examine the gold outlook?'
            : 'Mình hỗ trợ đầu tư vàng Việt Nam và các yếu tố kinh tế vĩ mô liên quan. Bạn muốn so sánh giá, tính lãi/lỗ hay phân tích triển vọng vàng?',
      };
      yield {
        type: 'done',
        model: 'scope-check',
        provider: 'server',
        usage: null,
        completion: 'complete',
      };
      return;
    }
    const ordered = (
      intent.needsResearch
        ? [this.providers.gemini, this.providers.hermes]
        : [this.providers.hermes, this.providers.gemini]
    ).filter((provider) => isProviderConfigured(provider));
    let providerAttempts = 0;
    for (const [index, provider] of ordered.entries()) {
      let recovered = false;
      while (providerAttempts < 3) {
        signal.throwIfAborted();
        providerAttempts += 1;
        let emitted = false;
        yield {
          type: 'status',
          message:
            request.locale === 'en'
              ? intent.needsResearch
                ? 'Researching'
                : 'Analyzing'
              : intent.needsResearch
                ? 'Đang tra cứu'
                : 'Đang phân tích',
          provider: provider.name,
          model: providerModel(provider, intent, request.question),
        };
        const attemptSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(28_000),
        ]);
        const iterator = provider.analyze(
          { ...request, intent, messages: buildUserHistory(request.messages) },
          attemptSignal,
        );
        try {
          let done = false;
          while (true) {
            const next = await abortable(iterator.next(), attemptSignal);
            if (next.done) break;
            const event = next.value;
            if (event.type === 'delta' && event.delta) emitted = true;
            if (event.type === 'done') done = true;
            if (event.type === 'error')
              throw new ProviderError(
                event.message,
                event.code ?? 'PROVIDER_STREAM_FAILED',
                provider.name,
              );
            yield event;
          }
          if (!done)
            throw new ProviderError(
              'Provider stream ended unexpectedly',
              'PROVIDER_STREAM_FAILED',
              provider.name,
            );
          return;
        } catch (error) {
          signal.throwIfAborted();
          const normalized = providerErrorDetails(error, provider.name);
          if (
            emitted &&
            !recovered &&
            providerAttempts < 3 &&
            isRetryableProviderError(normalized)
          ) {
            recovered = true;
            yield {
              type: 'reset',
              provider: provider.name,
              attempt: providerAttempts,
              message:
                request.locale === 'en'
                  ? 'The AI connection was interrupted. Retrying…'
                  : 'Kết nối AI bị gián đoạn, đang thử lại…',
            };
            await abortable(
              new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
              signal,
            );
            continue;
          }
          if (emitted) throw normalized;
          if (index === 0 && providerAttempts < 3) {
            yield {
              type: 'status',
              message:
                request.locale === 'en'
                  ? 'Still working on your answer…'
                  : 'Đang tiếp tục xử lý câu hỏi…',
            };
          }
          break;
        } finally {
          void iterator.return(undefined).catch(() => {});
        }
      }
    }
    yield {
      type: 'warning',
      message:
        request.locale === 'en'
          ? 'No verifiable AI response was available. Only server calculations are shown; macro news is not current.'
          : 'Chưa có kết quả AI có thể xác minh. Chỉ hiển thị số liệu máy chủ; chưa cập nhật tin vĩ mô.',
    };
    yield {
      type: 'delta',
      delta: request.marketContext
        ? request.responseVersion === 2
          ? focusedFactualAnswer(request)
          : factualAnswer(
              request.marketContext,
              intent,
              request.locale,
              request.forecast,
            )
        : request.locale === 'en'
          ? 'There is not enough data to analyze.'
          : 'Chưa có đủ dữ liệu để phân tích.',
    };
    if (request.marketContext) {
      const sources = request.marketContext.rows
        .flatMap((row) => [row.source, row.historySource])
        .flatMap((source) =>
          source.url ? [{ url: source.url, title: source.provider }] : [],
        );
      yield {
        type: 'sources',
        sources: [
          ...new Map(sources.map((source) => [source.url, source])).values(),
        ],
      };
    }
    yield {
      type: 'done',
      model: 'server-calculations',
      provider: 'server',
      usage: null,
      completion: 'limited',
      grounded: false,
    };
  }
}

function isProviderConfigured(provider: AnalysisProvider) {
  if (provider instanceof HermesAnalysisProvider) {
    return Boolean(
      process.env.HERMES_BASE_URL?.trim() &&
      process.env.HERMES_API_KEY?.trim() &&
      process.env.HERMES_MODEL?.trim(),
    );
  }
  if (provider instanceof GeminiAnalysisProvider) {
    return Boolean(process.env.GEMINI_API_KEY?.trim());
  }
  return true;
}

function providerModel(
  provider: AnalysisProvider,
  intent: AnalysisIntent,
  question: string,
) {
  if (provider instanceof GeminiAnalysisProvider) {
    const deep = intent.depth === 'deep';
    return deep
      ? process.env.GEMINI_DEEP_MODEL?.trim() || DEEP_ANALYSIS_MODEL
      : process.env.GEMINI_MODEL?.trim() || routeAnalysisModel(question);
  }
  if (provider instanceof HermesAnalysisProvider)
    return process.env.HERMES_MODEL?.trim() || 'unknown';
  return provider.name;
}
