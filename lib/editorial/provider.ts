export const DEFAULT_EDITORIAL_GEMINI_MODEL = 'gemini-3.6-flash';

/** Editorial has its own Gemini credential and never consumes chatbot quota. */
export const EDITORIAL_PROVIDER_ORDER = ['gemini'] as const;

export type EditorialProvider = (typeof EDITORIAL_PROVIDER_ORDER)[number];

type EditorialEnvironment = Record<string, string | undefined>;

export type EditorialProviderConfig = {
  provider: EditorialProvider;
  model: string | null;
  apiKey: string | null;
  baseUrl: string | null;
  missing: readonly string[];
  configured: boolean;
};

export type EditorialProviderAvailability = {
  provider: EditorialProvider;
  model: string | null;
  configured: boolean;
  missing: readonly string[];
  hasBaseUrl: boolean;
};

export type EditorialProviderFailureKind =
  | 'http'
  | 'network'
  | 'timeout'
  | 'unknown';

export type EditorialProviderFailure = {
  kind: EditorialProviderFailureKind;
  statusCode: number | null;
  retryable: boolean;
  retryAfterMs: number | null;
  message: string;
};

function valueFrom(env: EditorialEnvironment, name: string) {
  const value = env[name]?.trim();
  return value || null;
}

function firstValue(...values: Array<string | null>) {
  return values.find((value): value is string => Boolean(value)) ?? null;
}

function makeConfig(input: Omit<EditorialProviderConfig, 'configured'>) {
  return {
    ...input,
    configured: input.missing.length === 0,
  } satisfies EditorialProviderConfig;
}

/**
 * Resolves editorial provider settings without contacting a provider. The
 * returned runtime config intentionally includes secrets for the server-side
 * caller, so expose `getEditorialProviderAvailability` to an Admin response
 * instead of this helper.
 */
export function resolveEditorialProviderConfigs(
  env: EditorialEnvironment = process.env,
): readonly EditorialProviderConfig[] {
  // Deliberately do not fall back to GEMINI_API_KEY: the editorial account
  // must remain isolated from the customer chatbot account.
  const geminiApiKey = valueFrom(env, 'EDITORIAL_GEMINI_API_KEY');
  const geminiModel = firstValue(
    valueFrom(env, 'EDITORIAL_GEMINI_MODEL'),
    DEFAULT_EDITORIAL_GEMINI_MODEL,
  );

  return [
    makeConfig({
      provider: 'gemini',
      model: geminiModel,
      apiKey: geminiApiKey,
      baseUrl: null,
      missing: geminiApiKey ? [] : ['apiKey'],
    }),
  ];
}

/**
 * Produces an Admin-safe configuration summary. This helper is pure and does
 * not probe the configured endpoint; a complete configuration is only ready
 * for a separate health check, not proof that a provider is reachable.
 */
export function getEditorialProviderAvailability(
  env: EditorialEnvironment = process.env,
): readonly EditorialProviderAvailability[] {
  return resolveEditorialProviderConfigs(env).map((config) => ({
    provider: config.provider,
    model: config.model,
    configured: config.configured,
    missing: config.missing,
    hasBaseUrl: Boolean(config.baseUrl),
  }));
}

/** Alias for callers that want a side-effect-free preflight configuration. */
export const getEditorialProviderTestConfig = getEditorialProviderAvailability;

function asStatusCode(value: unknown) {
  const numeric =
    typeof value === 'string' && /^\d{3}$/.test(value) ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric)) return null;
  return numeric >= 100 && numeric <= 599 ? numeric : null;
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function readStatusCode(error: unknown) {
  const candidate = recordFrom(error);
  if (!candidate) return null;
  return (
    asStatusCode(candidate.status) ??
    asStatusCode(candidate.statusCode) ??
    asStatusCode(recordFrom(candidate.response)?.status) ??
    asStatusCode(recordFrom(candidate.response)?.statusCode)
  );
}

function headerValue(headers: unknown, target: string) {
  if (!headers) return null;
  const candidate = headers as {
    get?: (name: string) => unknown;
    [key: string]: unknown;
  };
  if (typeof candidate.get === 'function') {
    try {
      const value = candidate.get(target);
      if (typeof value === 'string' && value.trim()) return value.trim();
    } catch {
      // A malformed third-party error must not hide its original failure.
    }
  }
  for (const [name, value] of Object.entries(candidate)) {
    if (name.toLowerCase() !== target.toLowerCase()) continue;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (
      Array.isArray(value) &&
      typeof value[0] === 'string' &&
      value[0].trim()
    ) {
      return value[0].trim();
    }
  }
  return null;
}

function readRetryAfterHeader(error: unknown) {
  const candidate = recordFrom(error);
  if (!candidate) return null;
  return (
    headerValue(candidate.headers, 'retry-after') ??
    headerValue(recordFrom(candidate.response)?.headers, 'retry-after')
  );
}

/** Converts a standard Retry-After header into a delay without waiting. */
export function parseRetryAfterMs(
  value: string | null | undefined,
  now = Date.now(),
) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.round(seconds * 1_000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function errorText(error: unknown) {
  if (error instanceof Error)
    return `${error.name} ${error.message}`.toLowerCase();
  const candidate = recordFrom(error);
  const name = typeof candidate?.name === 'string' ? candidate.name : '';
  const message =
    typeof candidate?.message === 'string' ? candidate.message : '';
  return `${name} ${message}`.toLowerCase();
}

function isTimeoutOrNetworkFailure(error: unknown) {
  const candidate = recordFrom(error);
  const code =
    typeof candidate?.code === 'string' ? candidate.code.toUpperCase() : '';
  if (
    [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'EAI_AGAIN',
      'ENOTFOUND',
    ].includes(code)
  ) {
    return true;
  }
  return /timeout|timed out|aborterror|operation was aborted|fetch failed|network|connection(?: error| refused| reset)?/.test(
    errorText(error),
  );
}

function isTimeoutFailure(error: unknown) {
  const candidate = recordFrom(error);
  const code =
    typeof candidate?.code === 'string' ? candidate.code.toUpperCase() : '';
  return (
    code === 'ETIMEDOUT' ||
    /timeout|timed out|aborterror|operation was aborted/.test(errorText(error))
  );
}

/**
 * Classifies a provider error without depending on a particular SDK error
 * class. It accepts the OpenAI error shape and the status/header shapes used
 * by fetch-based SDKs such as Gemini.
 */
export function classifyEditorialProviderError(
  error: unknown,
): EditorialProviderFailure {
  const statusCode = readStatusCode(error);
  const retryAfterMs = parseRetryAfterMs(readRetryAfterHeader(error));
  if (
    statusCode !== null &&
    (statusCode === 408 ||
      statusCode === 409 ||
      statusCode === 429 ||
      statusCode >= 500)
  ) {
    return {
      kind: 'http',
      statusCode,
      retryable: true,
      retryAfterMs,
      message:
        statusCode === 429
          ? 'Nhà cung cấp đã chạm giới hạn yêu cầu.'
          : 'Nhà cung cấp tạm thời không phản hồi được.',
    };
  }
  if (statusCode !== null) {
    return {
      kind: 'http',
      statusCode,
      retryable: false,
      retryAfterMs,
      message: 'Nhà cung cấp từ chối yêu cầu cần được kiểm tra.',
    };
  }
  if (isTimeoutOrNetworkFailure(error)) {
    return {
      kind: isTimeoutFailure(error) ? 'timeout' : 'network',
      statusCode: null,
      retryable: true,
      retryAfterMs,
      message: 'Kết nối tới nhà cung cấp bị gián đoạn hoặc hết thời gian chờ.',
    };
  }
  return {
    kind: 'unknown',
    statusCode: null,
    retryable: false,
    retryAfterMs,
    message: 'Nhà cung cấp trả về dữ liệu không hợp lệ cần được kiểm tra.',
  };
}
