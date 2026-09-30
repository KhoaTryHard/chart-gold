export const AI_CHAT_STORAGE_KEY = 'kim-tuyen:ai-chat:v1';
export const AI_CHAT_STORAGE_VERSION = 1 as const;
export const AI_CHAT_STORAGE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const AI_CHAT_MAX_MESSAGES = 50;
export const AI_CHAT_MAX_BYTES = 200 * 1_024;

export type ChatSource = {
  title: string;
  url: string;
};

export type StoredChatMessage = {
  provider?: string;
  grounded?: boolean;
  completion?: string;
  asOf?: string;
  coverage?: string;
  warnings?: string[];
  citations?: Array<{ start: number; end: number; url: string; title: string }>;
  /** Search suggestions are display-only and are never persisted. */
  suggestions?: string;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: ChatSource[];
  createdAt: string;
  /** Locale used for this turn; absent messages were created before i18n. */
  locale?: 'vi' | 'en';
  /** Added after v1 shipped; old messages default to SJC when read. */
  companyId?: string;
  productId: string;
  range: string;
  model: string | null;
};

export type ChatSnapshot = {
  version: typeof AI_CHAT_STORAGE_VERSION;
  updatedAt: number;
  messages: StoredChatMessage[];
};

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cleanSource(value: unknown): ChatSource | null {
  if (
    !isObject(value) ||
    typeof value.title !== 'string' ||
    typeof value.url !== 'string'
  ) {
    return null;
  }
  try {
    const url = new URL(value.url);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return { title: value.title.slice(0, 300), url: url.toString() };
  } catch {
    return null;
  }
}

function cleanMessage(value: unknown): StoredChatMessage | null {
  if (!isObject(value)) return null;
  if (
    typeof value.id !== 'string' ||
    !['user', 'assistant'].includes(String(value.role)) ||
    typeof value.content !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.productId !== 'string' ||
    typeof value.range !== 'string' ||
    !Array.isArray(value.sources) ||
    !(typeof value.model === 'string' || value.model === null)
  ) {
    return null;
  }
  const createdAt = new Date(value.createdAt);
  if (!Number.isFinite(createdAt.getTime())) return null;
  const sources = value.sources.flatMap((source) => {
    const cleaned = cleanSource(source);
    return cleaned ? [cleaned] : [];
  });
  if (sources.length !== value.sources.length) return null;
  return {
    provider:
      typeof value.provider === 'string'
        ? value.provider.slice(0, 40)
        : undefined,
    grounded: value.grounded === true,
    completion:
      typeof value.completion === 'string'
        ? value.completion.slice(0, 40)
        : undefined,
    asOf: typeof value.asOf === 'string' ? value.asOf.slice(0, 100) : undefined,
    coverage:
      typeof value.coverage === 'string'
        ? value.coverage.slice(0, 500)
        : undefined,
    warnings: Array.isArray(value.warnings)
      ? value.warnings
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 20)
          .map((item) => item.slice(0, 1000))
      : undefined,
    citations: Array.isArray(value.citations)
      ? value.citations
          .flatMap((item) => {
            if (
              !isObject(item) ||
              typeof item.start !== 'number' ||
              typeof item.end !== 'number'
            )
              return [];
            const source = cleanSource(item);
            return source &&
              item.start >= 0 &&
              item.end > item.start &&
              item.end <= String(value.content).length
              ? [{ ...source, start: item.start, end: item.end }]
              : [];
          })
          .slice(0, 200)
      : undefined,
    id: value.id.slice(0, 100),
    role: value.role as 'user' | 'assistant',
    content: value.content.slice(0, 80_000),
    sources,
    createdAt: createdAt.toISOString(),
    locale: value.locale === 'en' ? 'en' : value.locale === 'vi' ? 'vi' : undefined,
    companyId:
      typeof value.companyId === 'string'
        ? value.companyId.slice(0, 50)
        : 'sjc',
    productId: value.productId.slice(0, 100),
    range: value.range.slice(0, 20),
    model: typeof value.model === 'string' ? value.model.slice(0, 100) : null,
  };
}

export function parseChatSnapshot(raw: string | null, now = Date.now()) {
  if (!raw) return null;
  try {
    if (utf8ByteLength(raw) > AI_CHAT_MAX_BYTES) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !isObject(value) ||
      value.version !== AI_CHAT_STORAGE_VERSION ||
      typeof value.updatedAt !== 'number' ||
      !Number.isFinite(value.updatedAt) ||
      now - value.updatedAt > AI_CHAT_STORAGE_TTL_MS ||
      now - value.updatedAt < -5 * 60 * 1_000 ||
      !Array.isArray(value.messages) ||
      value.messages.length > AI_CHAT_MAX_MESSAGES
    ) {
      return null;
    }
    const messages = value.messages.map((message) => cleanMessage(message));
    if (messages.some((message) => message === null)) return null;
    return {
      version: AI_CHAT_STORAGE_VERSION,
      updatedAt: value.updatedAt,
      messages: messages as StoredChatMessage[],
    } satisfies ChatSnapshot;
  } catch {
    return null;
  }
}

export function trimChatMessages(messages: readonly StoredChatMessage[]) {
  let trimmed = [...messages].slice(-AI_CHAT_MAX_MESSAGES);
  while (trimmed.length > 0) {
    const snapshot: ChatSnapshot = {
      version: AI_CHAT_STORAGE_VERSION,
      updatedAt: Date.now(),
      messages: trimmed,
    };
    if (utf8ByteLength(JSON.stringify(snapshot)) <= AI_CHAT_MAX_BYTES) break;
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

export function chatStorageKey(account?: string) {
  return account
    ? `${AI_CHAT_STORAGE_KEY}:${encodeURIComponent(account.trim().toLowerCase())}`
    : AI_CHAT_STORAGE_KEY;
}

export function loadChatSnapshot(account?: string) {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(chatStorageKey(account));
  } catch {
    return null;
  }
  const snapshot = parseChatSnapshot(raw);
  if (!snapshot && raw !== null) {
    try {
      window.localStorage.removeItem(chatStorageKey(account));
    } catch {
      // Ignore storage access errors.
    }
  }
  return snapshot;
}

export function saveChatSnapshot(
  messages: readonly StoredChatMessage[],
  account?: string,
) {
  if (typeof window === 'undefined') return;
  const snapshot: ChatSnapshot = {
    version: AI_CHAT_STORAGE_VERSION,
    updatedAt: Date.now(),
    messages: trimChatMessages(
      messages.map(({ suggestions: _suggestions, ...message }) => message),
    ),
  };
  try {
    window.localStorage.setItem(
      chatStorageKey(account),
      JSON.stringify(snapshot),
    );
  } catch {
    // A full or blocked localStorage should not prevent chatting.
  }
}

export function clearChatSnapshot(account?: string) {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(chatStorageKey(account));
    } catch {
      // Ignore storage access errors.
    }
  }
}
