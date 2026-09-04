import { createHash } from 'node:crypto';

import { auth, isAdminEmail } from '@/auth';
import {
  calculateAnalysisMetrics,
  type AnalysisRange,
} from '@/lib/analysis/metrics';
import {
  createAnalysisProvider,
  type AnalysisDoneUsage,
  type AnalysisEvent,
} from '@/lib/analysis/provider';
import { analysisRequestSchema } from '@/lib/analysis/request';
import { getMarketData } from '@/lib/server/sjc';

export const runtime = 'nodejs';

const activeAnalyses = new Set<string>();

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    {
      status,
      headers: { 'X-Content-Type-Options': 'nosniff' },
    },
  );
}

function hasTrustedOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function sseHeaders() {
  return {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  };
}

function encodeSse(event: AnalysisEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function hashIdentity(email: string) {
  return createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
}

function errorClass(error: unknown) {
  return error instanceof Error ? error.constructor.name : typeof error;
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return jsonError('Yêu cầu không hợp lệ.', 403);
  }

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return jsonError('Vui lòng đăng nhập bằng Google.', 401);
  if (!isAdminEmail(email) || session.user.isAdmin !== true) {
    return jsonError('Tài khoản không có quyền sử dụng phân tích AI.', 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError('Nội dung yêu cầu không hợp lệ.', 400);
  }
  const parsed = analysisRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonError('Câu hỏi hoặc ngữ cảnh không hợp lệ.', 400);
  }

  let market;
  try {
    market = await getMarketData(
      parsed.data.companyId,
      parsed.data.productId,
    );
  } catch {
    return jsonError('Không thể tải dữ liệu giá tin cậy lúc này.', 503);
  }
  if (market.records.length === 0 || market.availability === 'unavailable') {
    return jsonError('Chưa có dữ liệu giá để phân tích.', 503);
  }

  const metrics = calculateAnalysisMetrics(
    market.records,
    parsed.data.range as AnalysisRange,
  );
  const identity = email.trim().toLowerCase();
  if (activeAnalyses.has(identity)) {
    return jsonError('Đang có một phiên phân tích khác đang chạy.', 409);
  }
  activeAnalyses.add(identity);

  const requestId = globalThis.crypto.randomUUID();
  const startedAt = Date.now();
  let providerName = (process.env.AI_PROVIDER ?? 'gemini').trim().toLowerCase();
  let selectedModel: string | null = null;
  let usage: AnalysisDoneUsage | null = null;
  let sourceCount = 0;
  let completed = false;
  let failureClass: string | null = null;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 45_000);
  const abortFromRequest = () => abortController.abort();
  request.signal.addEventListener('abort', abortFromRequest, { once: true });

  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const push = (event: AnalysisEvent) => {
        if (!closed && !request.signal.aborted) {
          controller.enqueue(encoder.encode(encodeSse(event)));
        }
      };
      try {
        const provider = createAnalysisProvider();
        providerName = provider.name;
        for await (const event of provider.analyze(
          {
            question: parsed.data.question,
            messages: parsed.data.messages,
            product: market.product,
            range: parsed.data.range as AnalysisRange,
            metrics,
            records: market.records,
            observedAt: market.observedAt,
          },
          abortController.signal,
        )) {
          if (event.type === 'sources') {
            sourceCount = event.sources.length;
            push(event);
          } else if (event.type === 'done') {
            selectedModel = event.model;
            usage = event.usage;
            completed = true;
            push({
              ...event,
              requestId,
              asOf: market.observedAt,
            });
          } else {
            push(event);
          }
        }
      } catch (error) {
        failureClass = errorClass(error);
        if (!request.signal.aborted) {
          const message =
            error instanceof Error && error.message.includes('provider')
              ? error.message
              : abortController.signal.aborted
                ? 'Yêu cầu đã hết thời gian hoặc bị dừng.'
                : 'Không thể hoàn tất phân tích lúc này. Vui lòng thử lại.';
          push({ type: 'error', message });
        }
      } finally {
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', abortFromRequest);
        activeAnalyses.delete(identity);
        console.info('AI analysis request', {
          requestId,
          user: hashIdentity(email),
          provider: providerName,
          model: selectedModel,
          durationMs: Date.now() - startedAt,
          usage,
          sourceCount,
          outcome: completed
            ? 'completed'
            : request.signal.aborted || abortController.signal.aborted
              ? 'aborted'
              : 'failed',
          errorClass: failureClass,
        });
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      abortController.abort();
      activeAnalyses.delete(identity);
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
