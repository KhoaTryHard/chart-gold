'use client';

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import {
  CircleAlert,
  Eraser,
  LoaderCircle,
  LogIn,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  clearChatSnapshot,
  loadChatSnapshot,
  saveChatSnapshot,
  trimChatMessages,
  type ChatSource,
  type StoredChatMessage,
} from '@/lib/ai-chat-storage';
import type { SjcProduct } from '@/lib/sjc-products';

type AnalysisRange = '7N' | '1T' | '1N';

type Props = {
  product: SjcProduct;
  productId: string;
  range: AnalysisRange;
  observedAt: string;
};

type StreamPayload = {
  type?: string;
  delta?: string;
  sources?: ChatSource[];
  model?: string;
  message?: string;
};

const rangeLabels: Record<AnalysisRange, string> = {
  '7N': '7 ngày',
  '1T': '1 tháng',
  '1N': '1 năm',
};

const quickPrompts = [
  'Tóm tắt xu hướng và các tín hiệu đáng chú ý hiện tại.',
  'Phân tích sâu các kịch bản tăng, cơ sở và giảm trong kỳ này.',
  'So sánh rủi ro mua mới với việc chờ thêm tín hiệu xác nhận.',
];

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function formatAsOf(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'chưa rõ';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function AnalysisPanel({
  product,
  productId,
  range,
  observedAt,
}: Props) {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<StoredChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState('');
  const [historyReady, setHistoryReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const restoredRef = useRef(false);
  const persistenceTimerRef = useRef<number | null>(null);
  const latestMessagesRef = useRef(messages);
  const persistenceDisabledRef = useRef(false);
  const isAdmin = status === 'authenticated' && session?.user?.isAdmin === true;

  useEffect(() => {
    if (!isAdmin || restoredRef.current) return;
    const snapshot = loadChatSnapshot();
    setMessages(snapshot?.messages ?? []);
    restoredRef.current = true;
    setHistoryReady(true);
  }, [isAdmin]);

  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!isAdmin || !historyReady || persistenceDisabledRef.current) return;
    if (persistenceTimerRef.current) {
      window.clearTimeout(persistenceTimerRef.current);
    }
    persistenceTimerRef.current = window.setTimeout(() => {
      persistenceTimerRef.current = null;
      if (!persistenceDisabledRef.current) {
        saveChatSnapshot(latestMessagesRef.current);
      }
    }, 500);
    return () => {
      if (persistenceTimerRef.current) {
        window.clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = null;
      }
    };
  }, [isAdmin, historyReady, messages]);

  useEffect(() => {
    if (busy || !isAdmin || !historyReady || persistenceDisabledRef.current) {
      return;
    }
    if (persistenceTimerRef.current) {
      window.clearTimeout(persistenceTimerRef.current);
      persistenceTimerRef.current = null;
    }
    saveChatSnapshot(latestMessagesRef.current);
  }, [busy, isAdmin, historyReady]);

  useEffect(
    () => () => {
      if (persistenceTimerRef.current) {
        window.clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = null;
      }
      if (isAdmin && historyReady && !persistenceDisabledRef.current) {
        saveChatSnapshot(latestMessagesRef.current);
      }
    },
    [isAdmin, historyReady],
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const updateAssistant = (
    assistantId: string,
    update: (message: StoredChatMessage) => StoredChatMessage,
  ) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId ? update(message) : message,
      ),
    );
  };

  const submitQuestion = async (question: string) => {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || busy || !isAdmin) return;
    const userMessage: StoredChatMessage = {
      id: makeId(),
      role: 'user',
      content: cleanQuestion,
      sources: [],
      createdAt: new Date().toISOString(),
      productId,
      range,
      model: null,
    };
    const assistantId = makeId();
    const assistantMessage: StoredChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      sources: [],
      createdAt: new Date().toISOString(),
      productId,
      range,
      model: null,
    };
    const context = messages
      .filter((message) => message.content.trim())
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));
    persistenceDisabledRef.current = false;
    setMessages((current) =>
      trimChatMessages([...current, userMessage, assistantMessage]),
    );
    setInput('');
    setError(null);
    setLastQuestion(cleanQuestion);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/analysis', {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          question: cleanQuestion,
          productId,
          range,
          messages: context,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? 'Không thể bắt đầu phân tích.');
      }
      if (!response.body)
        throw new Error('Máy chủ không trả về luồng dữ liệu.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const processBlock = (block: string) => {
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (!data) return;
        let payload: StreamPayload;
        try {
          payload = JSON.parse(data) as StreamPayload;
        } catch {
          return;
        }
        if (payload.type === 'delta' && payload.delta) {
          updateAssistant(assistantId, (message) => ({
            ...message,
            content: message.content + payload.delta,
          }));
        } else if (
          payload.type === 'sources' &&
          Array.isArray(payload.sources)
        ) {
          updateAssistant(assistantId, (message) => ({
            ...message,
            sources: payload.sources ?? [],
          }));
        } else if (payload.type === 'done' && payload.model) {
          updateAssistant(assistantId, (message) => ({
            ...message,
            model: payload.model ?? null,
          }));
        } else if (payload.type === 'error') {
          setError(payload.message ?? 'Phân tích không hoàn tất.');
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        blocks.forEach(processBlock);
        if (done) break;
      }
      if (buffer.trim()) processBlock(buffer);
    } catch (requestError) {
      if (!isAbortError(requestError)) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Không thể hoàn tất phân tích lúc này.',
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  const onSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitQuestion(input);
  };

  const stop = () => {
    abortRef.current?.abort();
    setBusy(false);
  };

  const clearHistory = () => {
    stop();
    persistenceDisabledRef.current = true;
    setMessages([]);
    setError(null);
    clearChatSnapshot();
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        className="rounded-full border-primary/20 bg-card px-3 sm:px-4"
        onClick={() => setOpen(true)}
        aria-label="Mở Phân tích AI"
      >
        <Sparkles className="size-3.5 text-[var(--gold)]" />
        <span className="hidden sm:inline">Phân tích AI</span>
        <span className="sm:hidden">AI</span>
      </Button>
      <SheetContent
        side="right"
        className="flex h-full w-full max-w-full flex-col gap-0 p-0 sm:w-[min(92vw,560px)] sm:max-w-[560px]"
      >
        <SheetHeader className="border-b border-border/70 px-5 py-5 pr-12">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4 text-[#e8c36a]" />
            </span>
            Phân tích AI
          </SheetTitle>
          <SheetDescription>
            Trợ lý đọc dữ liệu SJC đã chuẩn hóa trên máy chủ.
          </SheetDescription>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-medium">
            <span className="rounded-full bg-accent px-2.5 py-1 text-accent-foreground">
              {product.shortLabel}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
              {rangeLabels[range]}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
              As-of {formatAsOf(observedAt)}
            </span>
          </div>
        </SheetHeader>

        {status === 'loading' ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Đang kiểm tra
            quyền…
          </div>
        ) : !isAdmin ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 text-center shadow-sm">
              <div className="mx-auto grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground">
                {status === 'unauthenticated' ? (
                  <LogIn className="size-5" />
                ) : (
                  <CircleAlert className="size-5" />
                )}
              </div>
              <h3 className="mt-4 font-heading text-base font-semibold">
                {status === 'unauthenticated'
                  ? 'Đăng nhập để dùng Phân tích AI'
                  : 'Tài khoản chưa được cấp quyền'}
              </h3>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {status === 'unauthenticated'
                  ? 'Chỉ email quản trị trong allowlist mới có thể gửi câu hỏi phân tích.'
                  : 'Bạn đã đăng nhập nhưng email này không nằm trong allowlist quản trị.'}
              </p>
              {status === 'unauthenticated' ? (
                <Button
                  className="mt-5 w-full"
                  onClick={() =>
                    void signIn('google', {
                      redirectTo: window.location.href,
                    })
                  }
                >
                  <LogIn className="size-4" /> Tiếp tục với Google
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="mt-5 w-full"
                  onClick={() =>
                    void signOut({ redirectTo: window.location.href })
                  }
                >
                  Đăng xuất / đổi tài khoản
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {messages.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-muted/35 p-4">
                    <p className="text-sm font-medium">Bạn muốn xem góc nào?</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Câu trả lời sẽ phân biệt số liệu và suy luận, kèm nguồn
                      khi tra cứu web.
                    </p>
                    <div className="mt-4 space-y-2">
                      {quickPrompts.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-left text-xs leading-5 transition-colors hover:bg-accent"
                          onClick={() => setInput(prompt)}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={message.role === 'user' ? 'ml-8' : 'mr-3'}
                  >
                    <div
                      className={`rounded-2xl px-3.5 py-3 text-sm leading-6 ${
                        message.role === 'user'
                          ? 'rounded-br-md bg-primary text-primary-foreground'
                          : 'rounded-bl-md border border-border bg-card text-foreground'
                      }`}
                    >
                      {message.content ? (
                        <p className="whitespace-pre-wrap break-words">
                          {message.content}
                        </p>
                      ) : busy && message.role === 'assistant' ? (
                        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                          <LoaderCircle className="size-3.5 animate-spin" />{' '}
                          Đang phân tích…
                        </span>
                      ) : null}
                    </div>
                    {message.role === 'assistant' &&
                    message.sources.length > 0 ? (
                      <div className="mt-2 space-y-1 pl-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Nguồn tham khảo
                        </p>
                        {message.sources.map((source) => (
                          <a
                            key={source.url}
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-xs text-accent-foreground underline-offset-4 hover:underline"
                          >
                            {source.title}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                {error ? (
                  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : null}
              </div>
              <div className="border-t border-border/70 px-5 py-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Thông tin tham khảo, không đảm bảo lợi nhuận hay thực hiện
                    giao dịch.
                  </p>
                  <div className="flex shrink-0 gap-1">
                    {lastQuestion && !busy ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Thử lại"
                        aria-label="Thử lại câu hỏi gần nhất"
                        onClick={() => void submitQuestion(lastQuestion)}
                      >
                        <RotateCcw />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="Xóa lịch sử"
                      aria-label="Xóa lịch sử trò chuyện"
                      onClick={clearHistory}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <form onSubmit={onSubmit} className="flex items-end gap-2">
                  <Textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Hỏi về xu hướng, rủi ro, kịch bản…"
                    maxLength={1_500}
                    rows={2}
                    disabled={busy}
                    className="min-h-16 resize-none rounded-xl bg-background text-sm"
                    aria-label="Câu hỏi phân tích AI"
                  />
                  {busy ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-lg"
                      title="Dừng"
                      aria-label="Dừng phân tích"
                      onClick={stop}
                    >
                      <Square className="size-4 fill-current" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      size="icon-lg"
                      title="Gửi"
                      aria-label="Gửi câu hỏi"
                      disabled={!input.trim()}
                    >
                      <Send className="size-4" />
                    </Button>
                  )}
                </form>
                <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{input.length}/1.500</span>
                  {messages.length > 0 ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={clearHistory}
                    >
                      <Eraser className="size-3" /> Xóa lịch sử
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
