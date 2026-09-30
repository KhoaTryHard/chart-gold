import { createHash } from 'node:crypto';
import { auth } from '@/auth';
import { calculateAnalysisMetrics } from '@/lib/analysis/metrics';
import {
  classifyIntent,
  createAnalysisProvider,
  type AnalysisDoneUsage,
  type AnalysisEvent,
} from '@/lib/analysis/provider';
import { analysisRequestSchema } from '@/lib/analysis/request';
import { loadMarketContext } from '@/lib/analysis/market-context';
import {
  calculateForecast,
  resolveForecastTargetDate,
  type ForecastResult,
} from '@/lib/analysis/forecast';
import { getMarketProduct } from '@/lib/market-sources';
import { abortable } from '@/lib/server/market-fetch';
import { normalizeQuestion } from '@/lib/analysis/intent';
import { prepareAnalysisInput } from '@/lib/analysis/input';
import { analysisAccess } from '@/lib/analysis/access';
import {
  BillingError,
  ensureSessionUser,
  getEntitlement,
  reserveAiUsage,
  extendAiUsageReservation,
  completeAiUsage,
  refundAiUsage,
  recordProductEvent,
  type BillingUser,
  type UserEntitlement,
} from '@/lib/billing/server';
import { subscriptionsEnabled } from '@/lib/billing/config';
import { requiredCapability, type AiCapability } from '@/lib/billing/plans';
import {
  buildAnalysisDecision,
  buildAnalysisFacts,
} from '@/lib/analysis/response';
import type { AnalysisDecision, AnalysisFacts } from '@/lib/analysis/response';
import { ANALYSIS_PROMPT_VERSION } from '@/lib/analysis/experience';
import { investorProfileSchema } from '@/lib/analysis/investor-profile';
import { inspectLedgerIntegrity } from '@/lib/portfolio-ledger';
import { recordAnalysisRun } from '@/lib/analysis/telemetry';
import {
  checkRateLimit,
  rateLimitKey,
  tooManyRequests,
} from '@/lib/server/rate-limit';
import { readJsonBody, RequestBodyTooLargeError } from '@/lib/server/body';
import { isTrustedOrigin } from '@/lib/server/origin';
import { readPortfolioLedgerForSession } from '@/lib/server/portfolio-ledger';
import { localeFromCookieHeader, type Locale } from '@/lib/i18n';
import { inferQuestionContext, type QuestionContext } from '@/lib/analysis/question-context';

function isProviderFailure(error: unknown): error is {
  code: string;
  status?: number;
  finishReason?: string;
} {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string',
  );
}

function isConversationFailure(error: unknown): error is { code: string; status: number; message: string; details?: Record<string, unknown> } {
  return Boolean(error && typeof error === 'object' && 'code' in error && String((error as { code?: unknown }).code).startsWith('CONVERSATION_'));
}

export const runtime = 'nodejs';
export const maxDuration = 90;
const activeAnalyses = new Map<string, symbol>();
function jsonError(
  error: string,
  status: number,
  details: Record<string, unknown> = {},
  locale: Locale = 'vi',
) {
  const englishMessages: Record<string, string> = {
    'Yêu cầu không hợp lệ.': 'Invalid request.',
    'Vui lòng đăng nhập bằng Google.': 'Sign in with Google to continue.',
    'Câu hỏi, hồ sơ hoặc cặp công ty/sản phẩm không hợp lệ.': 'The question, profile, or dealer/product selection is invalid.',
    'Payload quá lớn.': 'The request is too large.',
    'Không thể đọc yêu cầu.': 'Unable to read the request.',
    'Đang có một phiên phân tích khác đang chạy.': 'Another analysis is already running.',
    'Tài khoản hiện chưa có lượt AI khả dụng.': 'This account has no AI requests available.',
    'Yêu cầu đã hết thời gian hoặc bị dừng.': 'The request timed out or was stopped.',
    'Không thể bắt đầu phân tích.': 'Unable to start the analysis.',
  };
  return Response.json(
    { error: locale === 'en' ? englishMessages[error] ?? 'The request could not be completed. Please try again.' : error, ...details },
    { status, headers: { 'X-Content-Type-Options': 'nosniff' } },
  );
}

export async function POST(request: Request) {
  const requestLocale = localeFromCookieHeader(request.headers.get('cookie'));
  const startedAt = Date.now();
  try {
    if (!isTrustedOrigin(request))
      return jsonError('Yêu cầu không hợp lệ.', 403, {}, requestLocale);
  } catch {
    return jsonError('Yêu cầu không hợp lệ.', 403, {}, requestLocale);
  }
  const controller = new AbortController();
  const deadline = setTimeout(
    () =>
      controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    75_000,
  );
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const clear = () => {
    clearTimeout(deadline);
    request.signal.removeEventListener('abort', abort);
  };
  let session;
  let parsed;
  try {
    session = await abortable(auth(), controller.signal);
    if (!session?.user?.email) {
      clear();
      return jsonError('Vui lòng đăng nhập bằng Google.', 401, {}, requestLocale);
    }
    const aiRate = await checkRateLimit(
      rateLimitKey('ai-start-minute', session.user.email.toLowerCase()),
      6,
      60_000,
    );
    if (!aiRate.allowed) {
      clear();
      return tooManyRequests(aiRate, requestLocale);
    }
    parsed = analysisRequestSchema.safeParse(
      await readJsonBody(request, 256 * 1024, controller.signal),
    );
    if (!parsed.success) {
      clear();
      return jsonError(
        'Câu hỏi, hồ sơ hoặc cặp công ty/sản phẩm không hợp lệ.',
        400,
        {},
        requestLocale,
      );
    }
  } catch (error) {
    clear();
    if (error instanceof RequestBodyTooLargeError)
      return jsonError('Payload quá lớn.', 413, {}, requestLocale);
    return jsonError(
      controller.signal.aborted
        ? 'Yêu cầu đã hết thời gian hoặc bị dừng.'
        : 'Không thể đọc yêu cầu.',
      controller.signal.aborted ? 408 : 400,
      {},
      requestLocale,
    );
  }
  const responseLocale = parsed.data.locale;
  const clientRequestId = parsed.data.clientRequestId ?? crypto.randomUUID();
  let analysisPayload = parsed.data;
  let questionContext: QuestionContext | null = null;
  let conversationMessages = parsed.data.messages;
  let conversationContext: { id: string; version: number; turns: Array<{ status: string; question: string; answer: string | null }> } | null = null;
  if (parsed.data.conversationId && process.env.DATABASE_URL) {
    try {
      const { getConversation, buildConversationMessages } = await import('@/lib/server/ai-conversations');
      const owner = await ensureSessionUser(session);
      conversationContext = await getConversation(owner.id, parsed.data.conversationId);
      if (parsed.data.conversationVersion !== undefined && parsed.data.conversationVersion !== conversationContext.version) {
        clear();
        return jsonError(
          responseLocale === 'en' ? 'This conversation changed on another device. Reload it before asking a new question.' : 'Cuộc trò chuyện đã thay đổi trên thiết bị khác. Hãy tải lại trước khi hỏi tiếp.',
          409,
          { code: 'CONVERSATION_VERSION_CONFLICT', conversationVersion: conversationContext.version },
          responseLocale,
        );
      }
      conversationMessages = buildConversationMessages(conversationContext.turns as never);
      analysisPayload = { ...analysisPayload, messages: conversationMessages };
    } catch (error) {
      clear();
      if (isConversationFailure(error))
        return jsonError(error.message, error.status, { code: error.code, ...error.details }, responseLocale);
      return jsonError('Không thể tải hội thoại.', 503, { code: 'CONVERSATION_UNAVAILABLE' }, responseLocale);
    }
  }
  if (parsed.data.inputMode === 'question') {
    questionContext = inferQuestionContext({
      question: parsed.data.question,
      goal: parsed.data.goal,
      companyId: parsed.data.companyId,
      productId: parsed.data.productId,
      range: parsed.data.range,
      locale: parsed.data.locale,
    });
    analysisPayload = {
      ...analysisPayload,
      companyId: questionContext.companyId,
      productId: questionContext.productId,
      range: questionContext.range,
      scenarioInputs: {
        ...analysisPayload.scenarioInputs,
        ...questionContext.scenarioInputs,
      },
    };
  }
  if (analysisPayload.goal === 'hold') {
    const portfolio = await abortable(readPortfolioLedgerForSession(session), controller.signal);
    if (!portfolio.ledger.transactions.length) {
      clear();
      return jsonError(
        responseLocale === 'en' ? 'Your Gold Ledger is empty.' : 'Sổ vàng của bạn chưa có giao dịch.',
        409,
        { code: 'LEDGER_EMPTY', ledgerVersion: portfolio.version },
        responseLocale,
      );
    }
    if (analysisPayload.ledgerVersion !== undefined && analysisPayload.ledgerVersion !== portfolio.version) {
      clear();
      return jsonError(
        responseLocale === 'en' ? 'Your ledger changed. Refresh it before analyzing.' : 'Sổ vàng đã thay đổi. Hãy tải lại trước khi phân tích.',
        409,
        { code: 'LEDGER_VERSION_CONFLICT', ledgerVersion: portfolio.version },
        responseLocale,
      );
    }
    analysisPayload = {
      ...analysisPayload,
      portfolioLedger: portfolio.ledger,
      usePortfolioLedger: true,
      useInvestorProfile: false,
    };
  }
  const prepared = prepareAnalysisInput(analysisPayload);
  const payload = prepared.payload;
  const analysisNeeds = [...(questionContext?.missing ?? []), ...prepared.needs].slice(0, 2);
  const resolvedScenario = prepared.resolvedScenario;
  if (payload.goal !== 'hold' && payload.usePortfolioLedger !== false && payload.portfolioLedger) {
    const ledgerIntegrity = inspectLedgerIntegrity(payload.portfolioLedger.transactions);
    if (!ledgerIntegrity.valid)
      clear();
    if (!ledgerIntegrity.valid)
      return jsonError(
        payload.locale === 'en'
          ? 'Fix the ledger issues before asking AI to analyze it.'
          : 'Hãy sửa các lỗi trong sổ trước khi yêu cầu AI phân tích.',
        400,
        { code: 'INVALID_LEDGER', issues: ledgerIntegrity.issues },
        payload.locale,
      );
  }
  const access = analysisAccess(session, payload.responseVersion ?? 1, payload.locale);
  if (!access.canAnalyze) {
    clear();
    return jsonError(access.message, 403, { code: access.code }, responseLocale);
  }
  const email = session.user.email!.trim().toLowerCase();
  if (activeAnalyses.has(email)) {
    clear();
    return jsonError('Đang có một phiên phân tích khác đang chạy.', 409, {}, responseLocale);
  }
  const owner = Symbol();
  activeAnalyses.set(email, owner);
  const release = () => {
    if (activeAnalyses.get(email) === owner) activeAnalyses.delete(email);
  };
  const requestId = crypto.randomUUID();
  let billingUser: BillingUser | undefined;
  let entitlement: UserEntitlement | undefined;
  let reservationId: string | null = null;
  let reservationCapability: AiCapability = 'standard';
  let reservationSettled = false;
  let conversationId: string | null = conversationContext?.id ?? parsed.data.conversationId ?? null;
  let conversationVersion: number | null = conversationContext?.version ?? parsed.data.conversationVersion ?? null;
  let conversationTurnId: string | null = null;
  let intent;
  let forecast: ForecastResult | undefined;
  let effectiveInvestorProfile = payload.investorProfile;
  let effectivePortfolioLedger = payload.portfolioLedger;
  const usesSavedPersonalContext =
    (payload.useInvestorProfile !== false &&
      Boolean(payload.investorProfile)) ||
    (payload.usePortfolioLedger !== false && Boolean(payload.portfolioLedger));
  if (payload.useInvestorProfile === false)
    effectiveInvestorProfile = undefined;
  if (payload.usePortfolioLedger === false)
    effectivePortfolioLedger = undefined;
  if (
    !effectiveInvestorProfile &&
    payload.goal === 'hold' &&
    payload.scenarioInputs?.costPerLuongVnd &&
    payload.scenarioInputs.quantityLuong
  ) {
    effectiveInvestorProfile = investorProfileSchema.parse({
      feesVnd: payload.scenarioInputs.feeVnd,
      horizon:
        payload.scenarioInputs.horizon === '12m+'
          ? '6-12m'
          : payload.scenarioInputs.horizon,
      holdings: [
        {
          companyId: payload.companyId,
          productId: payload.productId,
          quantityLuong: payload.scenarioInputs.quantityLuong,
          costPerLuongVnd: payload.scenarioInputs.costPerLuongVnd,
        },
      ],
    });
  }
  try {
    if (subscriptionsEnabled() && !session.user.isAdmin) {
      billingUser = await ensureSessionUser(session);
      entitlement = await getEntitlement(billingUser);
      if (!entitlement.hasAccess || entitlement.remaining === 0) {
        void recordProductEvent({
          userId: billingUser.id,
          eventType: 'ai_quota_reached',
          metadata: { source: entitlement.accessSource },
        }).catch(() => undefined);
        clear();
        release();
        return jsonError(
          entitlement.community
            ? responseLocale === 'en'
              ? 'You have used all community AI analyses for this month. Your quota resets at the next Vietnam calendar month.'
              : 'Bạn đã dùng hết lượt AI cộng đồng trong tháng này. Lượt mới sẽ có vào tháng lịch Việt Nam tiếp theo.'
            : responseLocale === 'en'
              ? 'This account has no AI requests available.'
              : 'Tài khoản hiện chưa có lượt AI khả dụng.',
          402,
          { code: 'QUOTA_EXHAUSTED', entitlement },
          responseLocale,
        );
      }
    }
    intent =
      payload.responseVersion === 2
        ? prepared.intent
        : await classifyIntent(
            payload.question,
            payload.messages,
            controller.signal,
            payload.locale,
          );
    if (
      payload.investorProfile?.horizon &&
      !/tuan|thang|nam|ngan han|dai han/.test(
        normalizeQuestion(payload.question),
      )
    ) {
      intent.horizon = payload.investorProfile.horizon;
    }
    if (payload.analysisDepth === 'deep') intent.depth = 'deep';
    if (payload.responseVersion === 2) {
      const needs = analysisNeeds;
      if (needs.length > 0) {
        clear();
        release();
        const body = [
          `event: clarification\ndata: ${JSON.stringify({ type: 'clarification', needs })}\n\n`,
          `event: done\ndata: ${JSON.stringify({ type: 'done', model: 'input-check', provider: 'server', usage: null, completion: 'limited', responseVersion: 2, schemaVersion: 2, promptVersion: ANALYSIS_PROMPT_VERSION, answerStatus: 'insufficient-data' })}\n\n`,
        ].join('');
        return new Response(body, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
    }
    if (process.env.DATABASE_URL) {
      const { beginConversationTurn } = await import('@/lib/server/ai-conversations');
      const owner = billingUser ?? await ensureSessionUser(session);
      const begun = await beginConversationTurn({
        userId: owner.id,
        conversationId: parsed.data.conversationId,
        conversationVersion: parsed.data.conversationVersion,
        clientRequestId,
        question: payload.question,
        locale: payload.locale,
        companyId: payload.companyId,
        productId: payload.productId,
        range: payload.range,
        goal: payload.goal,
        analysisDepth: payload.analysisDepth,
        scenarioInputs: payload.scenarioInputs,
        ledgerVersion: payload.ledgerVersion,
      });
      conversationId = begun.conversation.id;
      conversationVersion = begun.conversation.version;
      conversationTurnId = begun.turn.id;
      conversationMessages = begun.messages;
    }
    if (billingUser && intent.kind !== 'out-of-scope') {
      const capability =
        payload.responseVersion === 2
          ? prepared.capability!
          : requiredCapability({
              question: payload.question,
              needsResearch: intent.needsResearch,
              depth: intent.depth,
            });
      reservationCapability = capability;
      const reservation = await reserveAiUsage({
        user: billingUser,
        clientRequestId,
        capability,
      });
      reservationId = reservation.id;
      entitlement = reservation.entitlement;
      void recordProductEvent({
        userId: billingUser.id,
        eventType: 'analysis_started',
        metadata: {
          capability,
          goal: payload.goal ?? null,
          responseVersion: payload.responseVersion ?? 1,
        },
      }).catch(() => undefined);
    }
    if (
      subscriptionsEnabled() &&
      !session.user.isAdmin &&
      (payload.responseVersion !== 2 || usesSavedPersonalContext) &&
      !entitlement?.capabilities.includes('portfolio')
    ) {
      effectiveInvestorProfile = undefined;
      effectivePortfolioLedger = undefined;
    }
  } catch (error) {
    clear();
    release();
    if (conversationTurnId) {
      const { failConversationTurn } = await import('@/lib/server/ai-conversations');
      void failConversationTurn(conversationTurnId, 'failed').catch(() => undefined);
    }
    if (isConversationFailure(error))
      return jsonError(error.message, error.status, { code: error.code, ...error.details }, responseLocale);
    if (error instanceof BillingError)
      return jsonError(error.message, error.status, {
        code: error.code,
        ...error.details,
      }, responseLocale);
    return jsonError(
      controller.signal.aborted
        ? 'Yêu cầu đã hết thời gian hoặc bị dừng.'
        : 'Không thể bắt đầu phân tích.',
      controller.signal.aborted ? 408 : 503,
      {},
      responseLocale,
    );
  }
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      const encoder = new TextEncoder();
      const push = (event: AnalysisEvent) => {
        if (!closed && !request.signal.aborted)
          output.enqueue(
            encoder.encode(
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            ),
          );
      };
      let outcome = 'failed',
        providerName = '',
        model = '',
        sources = 0;
      let firstResponseMs: number | null = null,
        dataMs = 0;
      let providerStarted = false;
      let outputReceived = false;
      let retryCount = 0;
      let refundConfirmed = false;
      let failureError: unknown = null;
      let usage: AnalysisDoneUsage | null = null;
      let finalAnswer = '';
      let storedFacts: AnalysisFacts | null = null;
      let storedDecision: AnalysisDecision | null = null;
      let storedForecast: Record<string, unknown> | null = null;
      let storedCitations: Array<Record<string, unknown>> = [];
      let storedCoverage: string | null = null;
      let storedWarning: string | null = null;
      const sourceMap = new Map<string, { title: string; url: string }>();
      const settleUsage = async (complete: boolean) => {
        if (!reservationId || reservationSettled) return;
        if (complete) {
          await completeAiUsage({
            id: reservationId,
            provider: providerName || 'unknown',
            model: model || 'unknown',
            usage,
            durationMs: Date.now() - startedAt,
          });
        } else {
          await refundAiUsage(reservationId, {
            providerStarted: providerStarted && providerName !== 'server',
          });
          refundConfirmed = true;
        }
        reservationSettled = true;
      };
      try {
        if (conversationId && conversationTurnId)
          push({
            type: 'conversation',
            conversationId,
            turnId: conversationTurnId,
            conversationVersion: conversationVersion ?? undefined,
          });
        push({
          type: 'status',
          message: payload.locale === 'en' ? 'Loading prices' : 'Đang lấy giá',
        });
        const range = intent.range ?? payload.range;
        const dataStarted = Date.now();
        const { context, markets } =
          intent.kind === 'out-of-scope'
            ? { context: undefined, markets: [] }
            : await loadMarketContext(
                intent,
                payload.companyId,
                payload.productId,
                range,
                controller.signal,
                effectiveInvestorProfile,
                payload.question,
                effectivePortfolioLedger,
                resolvedScenario
                  ? {
                      quantityLuong: resolvedScenario.quantityLuong,
                      costPerLuongVnd: resolvedScenario.costPerLuongVnd,
                      feeVnd: resolvedScenario.feeVnd,
                    }
                  : payload.scenarioInputs,
              );
        dataMs = Date.now() - dataStarted;
        if (intent.forecast) {
          const targetDate =
            intent.targetDate ?? resolveForecastTargetDate(payload.question);
          if (targetDate) {
            const forecastMarket =
              markets.find(
                (entry) =>
                  entry?.company.id === payload.companyId &&
                  entry.product.id === payload.productId,
              ) ?? markets.find(Boolean);
            forecast = calculateForecast(forecastMarket, targetDate);
            push({ type: 'forecast', forecast });
          }
        }
        if (context) {
          push({ type: 'metadata', context, entitlement });
          storedCoverage = payload.locale === 'en'
            ? `${context.eligible ?? 0}/${context.requested ?? 0} groups with sufficient data · ${context.today ?? ''}`
            : `${context.eligible ?? 0}/${context.requested ?? 0} nhóm đủ dữ liệu · ${context.today ?? ''}`;
          if (payload.responseVersion === 2) {
            storedFacts = buildAnalysisFacts(context, intent, payload.goal, payload.locale, forecast);
            storedDecision = buildAnalysisDecision(context, intent, payload.goal, payload.locale, forecast);
            push({
              type: 'facts',
              payload: storedFacts,
            });
            push({
              type: 'decision',
              payload: storedDecision,
            });
          }
          for (const row of context.rows)
            for (const source of [row.source, row.historySource]) {
              if (source.url && /^https?:\/\//i.test(source.url))
                sourceMap.set(source.url, {
                  title: source.provider,
                  url: source.url,
                });
            }
          if (sourceMap.size)
            push({ type: 'sources', sources: [...sourceMap.values()] });
          sources = sourceMap.size;
        }
        if (entitlement) push({ type: 'entitlement', entitlement });
        const market =
          markets.find((entry) => entry?.product.id === payload.productId) ??
          markets.find(Boolean);
        const provider = createAnalysisProvider();
        providerName = provider.name;
        push({
          type: 'status',
          message: payload.locale === 'en'
            ? intent.needsResearch ? 'Researching' : 'Analyzing'
            : intent.needsResearch ? 'Đang tra cứu' : 'Đang phân tích',
          provider: provider.name,
        });
        providerStarted = true;
        const iterator = provider.analyze(
          {
            question: payload.question,
            messages: conversationMessages,
            goal: payload.goal,
            analysisDepth: payload.analysisDepth,
            scenarioInputs: payload.scenarioInputs,
            resolvedScenario,
            forecast,
            investorProfile: effectiveInvestorProfile,
            portfolioLedger: effectivePortfolioLedger,
            intent,
            marketContext: context,
            product:
              market?.product ??
              getMarketProduct(payload.companyId, payload.productId),
            range,
            metrics: market
              ? calculateAnalysisMetrics(market.records, range)
              : calculateAnalysisMetrics([], range),
            records: market?.records ?? [],
            observedAt: market?.observedAt ?? '',
            locale: payload.locale,
          },
          controller.signal,
        );
        try {
          while (true) {
            const next = await abortable(iterator.next(), controller.signal);
            if (next.done) break;
            const event = next.value;
            if (event.type === 'delta' && firstResponseMs === null)
              firstResponseMs = Date.now() - startedAt;
            if (event.type === 'sources') {
              for (const source of event.sources)
                sourceMap.set(source.url, source);
              sources = sourceMap.size;
              push({ type: 'sources', sources: [...sourceMap.values()] });
              continue;
            }
            if (event.type === 'delta' && event.delta) finalAnswer += event.delta;
            if (event.type === 'facts') storedFacts = event.payload;
            if (event.type === 'decision') storedDecision = event.payload;
            if (event.type === 'forecast' && event.forecast && typeof event.forecast === 'object') storedForecast = event.forecast as Record<string, unknown>;
            if (event.type === 'grounding' && Array.isArray(event.citations)) storedCitations = event.citations as Array<Record<string, unknown>>;
            if (event.type === 'warning' && typeof event.message === 'string') storedWarning = event.message;
            if (event.type === 'status' && event.provider)
              providerName = event.provider;
            if (event.type === 'status' && event.model)
              model = event.model;
            if (event.type === 'reset') {
              retryCount = Math.max(retryCount, event.attempt);
              await extendAiUsageReservation({
                id: reservationId,
                capability: reservationCapability,
              });
              push(event);
              continue;
            }
            if (event.type === 'delta' && event.delta) outputReceived = true;
            if (event.type === 'done') {
              model = event.model;
              providerName = event.provider ?? providerName;
              usage = event.usage;
              outcome = event.completion ?? 'complete';
              await settleUsage(
                event.completion === 'complete' ||
                  event.completion === 'truncated' ||
                  event.completion === undefined,
              );
              if (conversationTurnId) {
                const { completeConversationTurn } = await import('@/lib/server/ai-conversations');
                await completeConversationTurn({
                  turnId: conversationTurnId,
                  answer: finalAnswer,
                  facts: storedFacts as unknown as Record<string, unknown> | null,
                  decision: storedDecision as unknown as Record<string, unknown> | null,
                  forecast: storedForecast,
                  sources: [...sourceMap.values()].map((item) => ({ title: item.title, url: item.url })),
                  citations: storedCitations,
                  coverage: storedCoverage,
                  warning: storedWarning,
                }).catch((persistError) => {
                  console.error('AI conversation persistence failed', {
                    requestId,
                    conversationId,
                    turnId: conversationTurnId,
                    errorName: persistError instanceof Error ? persistError.name : 'UnknownError',
                  });
                });
              }
              if (billingUser) {
                const eventType =
                  intent.kind === 'comparison'
                    ? 'comparison_completed'
                    : intent.kind === 'lookup'
                      ? 'calculation_completed'
                      : 'ai_analysis_completed';
                void recordProductEvent({
                  userId: billingUser.id,
                  eventType,
                  metadata: {
                    capability: intent.depth,
                    provider: providerName,
                    model,
                  },
                }).catch(() => undefined);
              }
              push({
                ...event,
                requestId,
                asOf: market?.observedAt,
                responseVersion: payload.responseVersion ?? 1,
                schemaVersion: payload.responseVersion === 2 ? 2 : 1,
                promptVersion: ANALYSIS_PROMPT_VERSION,
                conversationId: conversationId ?? undefined,
                turnId: conversationTurnId ?? undefined,
                conversationVersion: conversationVersion ?? undefined,
                answerStatus:
                  payload.responseVersion === 2
                    ? event.completion === 'limited'
                      ? 'limited'
                      : 'complete'
                    : undefined,
              });
            } else push(event);
          }
        } finally {
          void iterator.return(undefined).catch(() => {});
        }
      } catch (error) {
        failureError = error;
        outcome = controller.signal.aborted ? 'aborted' : 'failed';
        if (conversationTurnId) {
          const { failConversationTurn } = await import('@/lib/server/ai-conversations');
          await failConversationTurn(conversationTurnId, controller.signal.aborted ? 'aborted' : 'failed').catch(() => undefined);
        }
        try {
          await settleUsage(false);
          if (billingUser && subscriptionsEnabled()) {
            entitlement = await getEntitlement(billingUser);
            if (entitlement) push({ type: 'entitlement', entitlement });
          }
        } catch {
          // Preserve the original provider/timeout error and release state below.
        }
        push({
          type: 'error',
          message: payload.locale === 'en'
            ? controller.signal.aborted
              ? 'The request timed out or was stopped.'
              : 'The analysis could not be completed. Please try again.'
            : controller.signal.aborted
              ? 'Yêu cầu đã hết thời gian hoặc bị dừng.'
              : 'Không thể hoàn tất phân tích. Vui lòng thử lại.',
          code:
            controller.signal.aborted
              ? 'ANALYSIS_ABORTED'
              : isProviderFailure(error)
                ? error.code
                : 'PROVIDER_STREAM_FAILED',
          provider: providerName || undefined,
          retryable: isProviderFailure(error)
            ? error.code === 'PROVIDER_TIMEOUT' ||
              error.code === 'PROVIDER_UNAVAILABLE' ||
              error.code === 'PROVIDER_RATE_LIMITED' ||
              error.code === 'PROVIDER_STREAM_FAILED'
            : false,
          finishReason: isProviderFailure(error) ? error.finishReason : undefined,
          requestId,
          refunded: refundConfirmed,
          conversationId: conversationId ?? undefined,
          turnId: conversationTurnId ?? undefined,
          conversationVersion: conversationVersion ?? undefined,
        });
      } finally {
        clear();
        release();
        console.info('AI analysis request', {
          requestId,
          user: createHash('sha256').update(email).digest('hex').slice(0, 16),
          provider: providerName,
          model,
          durationMs: Date.now() - startedAt,
          dataMs,
          firstResponseMs,
          usage,
          sourceCount: sources,
          outcome,
          outputReceived,
          retryCount,
          refundConfirmed,
          failureCode:
            outcome === 'failed' && isProviderFailure(failureError)
              ? failureError.code
              : undefined,
          failureStatus: isProviderFailure(failureError) ? failureError.status : undefined,
          finishReason: isProviderFailure(failureError) ? failureError.finishReason : undefined,
        });
        if (billingUser) {
          void recordAnalysisRun({
            requestId,
            userId: billingUser.id,
            goal: payload.goal,
            promptVersion: ANALYSIS_PROMPT_VERSION,
            provider: providerName,
            model,
            outcome,
          }).catch(() => undefined);
        }
        if (!closed) {
          closed = true;
          output.close();
        }
      }
    },
    cancel() {
      closed = true;
      controller.abort();
      clear();
      release();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
