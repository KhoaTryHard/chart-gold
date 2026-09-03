import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AI_CHAT_MAX_BYTES,
  AI_CHAT_MAX_MESSAGES,
  AI_CHAT_STORAGE_TTL_MS,
  AI_CHAT_STORAGE_KEY,
  clearChatSnapshot,
  loadChatSnapshot,
  parseChatSnapshot,
  saveChatSnapshot,
  type StoredChatMessage,
} from '@/lib/ai-chat-storage';

function message(
  index: number,
  content = `message ${index}`,
): StoredChatMessage {
  return {
    id: String(index),
    role: index % 2 ? 'user' : 'assistant',
    content,
    sources: [],
    createdAt: '2026-09-03T00:00:00.000Z',
    productId: 'bar-1l',
    range: '1T',
    model: null,
  };
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
    } as Storage,
  };
}

describe('AI chat storage', () => {
  let values: Map<string, string>;

  beforeEach(() => {
    const fixture = createStorage();
    values = fixture.values;
    vi.stubGlobal('window', { localStorage: fixture.storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips valid data and expires it after 30 days', () => {
    saveChatSnapshot([message(1)]);
    const raw = values.get(AI_CHAT_STORAGE_KEY) ?? null;
    expect(loadChatSnapshot()?.messages).toHaveLength(1);
    expect(
      parseChatSnapshot(raw, Date.now() + AI_CHAT_STORAGE_TTL_MS + 1),
    ).toBe(null);
  });

  it('keeps at most 50 messages and clears invalid schemas', () => {
    saveChatSnapshot(Array.from({ length: 60 }, (_, index) => message(index)));
    expect(loadChatSnapshot()?.messages).toHaveLength(AI_CHAT_MAX_MESSAGES);

    values.set(
      AI_CHAT_STORAGE_KEY,
      JSON.stringify({ version: 1, messages: [] }),
    );
    expect(loadChatSnapshot()).toBe(null);
    expect(values.has(AI_CHAT_STORAGE_KEY)).toBe(false);
  });

  it('uses UTF-8 byte size when evicting oversized history', () => {
    saveChatSnapshot(
      Array.from({ length: 50 }, (_, index) =>
        message(index, '🙂'.repeat(1_500)),
      ),
    );
    const raw = values.get(AI_CHAT_STORAGE_KEY) ?? '';
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(
      AI_CHAT_MAX_BYTES,
    );
    expect(JSON.stringify(JSON.parse(raw)).length).toBeLessThan(200 * 1_024);
    expect(loadChatSnapshot()?.messages.length).toBeLessThan(50);
  });

  it('does not throw when browser storage is blocked', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('SecurityError');
        },
        removeItem: () => {
          throw new Error('SecurityError');
        },
      } as unknown as Storage,
    });
    expect(() => loadChatSnapshot()).not.toThrow();
    expect(() => saveChatSnapshot([message(1)])).not.toThrow();
    expect(() => clearChatSnapshot()).not.toThrow();
  });
});
