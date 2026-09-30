import { auth } from '@/auth';
import { randomUUID } from 'node:crypto';
import { analysisRequestSchema } from '@/lib/analysis/request';
import { inspectLedgerIntegrity } from '@/lib/portfolio-ledger';
import { prepareAnalysisInput } from '@/lib/analysis/input';
import {
  AnalysisAccessError,
  readAnalysisAccess,
} from '@/lib/analysis/access';
import { analysisExperienceV2Enabled } from '@/lib/analysis/experience';
import { abortable } from '@/lib/server/market-fetch';
import { readJsonBody, RequestBodyTooLargeError } from '@/lib/server/body';
import { isTrustedOrigin } from '@/lib/server/origin';
import { readPortfolioLedgerForSession } from '@/lib/server/portfolio-ledger';
import { localeFromCookieHeader, type Locale } from '@/lib/i18n';
import { ensureSessionUser } from '@/lib/billing/server';
import { inferQuestionContext, type QuestionContext } from '@/lib/analysis/question-context';

export const runtime = 'nodejs';
export const maxDuration = 15;
export const dynamic = 'force-dynamic';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};
function respond(body: unknown, status = 200) {
  return Response.json(body, { status, headers });
}

function logAccessFailure(
  requestId: string,
  stage: 'session' | 'access',
  error: unknown,
) {
  console.error('AI access check failed', {
    requestId,
    stage,
    code:
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : 'UNKNOWN',
    databaseCode:
      error &&
      typeof error === 'object' &&
      'details' in error &&
      (error as { details?: unknown }).details &&
      typeof (error as { details?: unknown }).details === 'object' &&
      'databaseCode' in (error as { details: Record<string, unknown> }).details
        ? String(
            (error as { details: { databaseCode?: unknown } }).details
              .databaseCode,
          )
        : undefined,
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
}

export async function GET(request?: Request) {
  const locale = request && new URL(request.url).searchParams.get('locale') === 'en' ? 'en' : 'vi';
  const requestId = randomUUID();
  try {
    let session;
    try {
      session = await abortable(auth(), AbortSignal.timeout(12_000));
    } catch (error) {
      logAccessFailure(requestId, 'session', error);
      throw error;
    }
    let access;
    try {
      access = await abortable(
        readAnalysisAccess(session, undefined, locale),
        AbortSignal.timeout(12_000),
      );
    } catch (error) {
      logAccessFailure(requestId, 'access', error);
      if (error instanceof AnalysisAccessError) throw error;
      throw new AnalysisAccessError(
        'AI_ACCESS_UNAVAILABLE',
        locale === 'en'
          ? 'AI access could not be checked right now. Select Check again; no AI request has been used.'
          : 'Chưa thể kiểm tra quyền AI lúc này. Bấm Kiểm tra lại; chưa có lượt AI nào được sử dụng.',
      );
    }
    return respond({ access });
  } catch (error) {
    if (error instanceof AnalysisAccessError)
      return respond(
        {
          code: error.code,
          error: error.message,
          requestId,
        },
        error.status,
      );
    return respond(
      {
        code: 'SESSION_UNAVAILABLE',
        error: locale === 'en'
          ? 'Unable to check your sign-in session. Please try again; no AI request has been used.'
          : 'Không kiểm tra được phiên đăng nhập. Hãy thử lại; chưa có lượt AI nào được sử dụng.',
        requestId,
      },
      503,
    );
  }
}

export async function POST(request: Request) {
  let locale: Locale = localeFromCookieHeader(request.headers.get('cookie'));
  const requestId = randomUUID();
  try {
    if (!isTrustedOrigin(request))
      return respond(
        { code: 'INVALID_ORIGIN', error: locale === 'en' ? 'Invalid request.' : 'Yêu cầu không hợp lệ.' },
        403,
      );
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(12_000),
    ]);
    const parsed = analysisRequestSchema.safeParse(
      await abortable(readJsonBody(request, 256 * 1024, signal), signal),
    );
    if (parsed.success) locale = parsed.data.locale;
    if (!parsed.success)
      return respond(
        {
          code: 'INVALID_INPUT',
          error: locale === 'en'
            ? 'Check the quantity, currency units, and selected product.'
            : 'Kiểm tra số lượng, đơn vị tiền và sản phẩm đã chọn.',
          fields: parsed.error.issues.map((item) => ({
            path: item.path.join('.'),
            message: item.message,
          })),
        },
        400,
      );
    // Preparing input is deterministic: no provider call and no quota reservation.
    let questionContext: QuestionContext | null = null;
    let requestData = parsed.data;
    if (parsed.data.inputMode === 'question') {
      questionContext = inferQuestionContext(parsed.data);
      requestData = {
        ...parsed.data,
        companyId: questionContext.companyId,
        productId: questionContext.productId,
        range: questionContext.range,
        scenarioInputs: {
          ...parsed.data.scenarioInputs,
          ...questionContext.scenarioInputs,
        },
      };
    }
    let prepared = prepareAnalysisInput(requestData);
    if (requestData.goal !== 'hold' && requestData.usePortfolioLedger !== false && requestData.portfolioLedger) {
      const ledgerIntegrity = inspectLedgerIntegrity(requestData.portfolioLedger.transactions);
      if (!ledgerIntegrity.valid)
        return respond({
          code: 'INVALID_LEDGER',
          error: requestData.locale === 'en'
            ? 'Fix the ledger issues before asking AI to analyze it.'
            : 'Hãy sửa các lỗi trong sổ trước khi yêu cầu AI phân tích.',
          issues: ledgerIntegrity.issues,
        }, 400);
    }
    let session;
    try {
      session = await abortable(auth(), signal);
    } catch (error) {
      logAccessFailure(requestId, 'session', error);
      throw error;
    }
    let ledgerVersion: number | null = null;
    let ledgerEmpty = false;
    let conversationVersion: number | null = null;
    if (requestData.conversationId && session) {
      const { getConversation } = await import('@/lib/server/ai-conversations');
      const owner = await ensureSessionUser(session);
      const conversation = await getConversation(owner.id, requestData.conversationId);
      conversationVersion = conversation.version;
      if (requestData.conversationVersion !== undefined && requestData.conversationVersion !== conversation.version)
        return respond({ code: 'CONVERSATION_VERSION_CONFLICT', error: requestData.locale === 'en' ? 'This conversation changed on another device. Reload it before asking a new question.' : 'Cuộc trò chuyện đã thay đổi trên thiết bị khác. Hãy tải lại trước khi hỏi tiếp.', conversationVersion }, 409);
    }
    if (requestData.goal === 'hold' && session) {
      const portfolio = await abortable(readPortfolioLedgerForSession(session), signal);
      ledgerVersion = portfolio.version;
      ledgerEmpty = portfolio.ledger.transactions.length === 0;
      if (requestData.ledgerVersion !== undefined && requestData.ledgerVersion !== ledgerVersion)
        return respond({ code: 'LEDGER_VERSION_CONFLICT', error: requestData.locale === 'en' ? 'Your ledger changed. Refresh it before analyzing.' : 'Sổ vàng đã thay đổi. Hãy tải lại trước khi phân tích.', ledgerVersion }, 409);
      prepared = prepareAnalysisInput({
        ...requestData,
        portfolioLedger: portfolio.ledger,
        usePortfolioLedger: true,
        useInvestorProfile: false,
      });
    }
    let access;
    try {
      access = await abortable(
        readAnalysisAccess(session, prepared.capability, requestData.locale),
        signal,
      );
    } catch (error) {
      logAccessFailure(requestId, 'access', error);
      if (error instanceof AnalysisAccessError) throw error;
      throw new AnalysisAccessError(
        'AI_ACCESS_UNAVAILABLE',
        parsed.data.locale === 'en'
          ? 'AI access could not be checked right now. Select Check again; no AI request has been used.'
          : 'Chưa thể kiểm tra quyền AI lúc này. Bấm Kiểm tra lại; chưa có lượt AI nào được sử dụng.',
      );
    }
    const needs = [...(questionContext?.missing ?? []), ...prepared.needs].slice(0, 2);
    const ready = access.canAnalyze && needs.length === 0;
    console.info('AI prepare', {
      requestId,
      authenticated: access.authenticated,
      code: access.code,
      needsCount: prepared.needs.length,
    });
    return respond({
      responseVersion: 2,
      featureEnabled: analysisExperienceV2Enabled() || access.isAdmin,
      authenticated: access.authenticated,
      access,
      ready,
      ledgerVersion,
      conversationVersion,
      questionContext,
      ...(ledgerEmpty ? {
        ready: false,
        status: 'empty',
        code: 'LEDGER_EMPTY',
        needs: [],
        capability: 'portfolio',
      } : {}),
      status: !access.canAnalyze
        ? 'unavailable'
        : needs.length
          ? 'needs-input'
          : 'ready',
      needs,
      capability: prepared.capability,
      intent: {
        kind: prepared.intent.kind,
        needsResearch: prepared.intent.needsResearch,
        depth: prepared.intent.depth,
        scope: prepared.intent.scope,
      },
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return respond({ code: 'INVALID_INPUT', error: locale === 'en' ? 'The request is too large.' : 'Payload quá lớn.' }, 413);
    if (error instanceof SyntaxError)
      return respond(
        { code: 'INVALID_INPUT', error: locale === 'en' ? 'The request is invalid.' : 'Nội dung yêu cầu không hợp lệ.' },
        400,
      );
    if (error instanceof AnalysisAccessError)
      return respond(
        { code: error.code, error: error.message, requestId },
        error.status,
      );
    if (error && typeof error === 'object' && 'code' in error && String((error as { code?: unknown }).code).startsWith('CONVERSATION_'))
      return respond(
        { code: String((error as { code?: unknown }).code), error: error instanceof Error ? error.message : 'Conversation unavailable.' },
        'status' in error && typeof (error as { status?: unknown }).status === 'number' ? Number((error as { status: number }).status) : 503,
      );
    return respond(
      {
        code: 'SESSION_UNAVAILABLE',
        error: locale === 'en'
          ? 'Unable to check your session or AI access. Please try again; no AI request has been used.'
          : 'Không kiểm tra được phiên đăng nhập hoặc quyền AI. Hãy thử lại; chưa có lượt AI nào được sử dụng.',
        requestId,
      },
      503,
    );
  }
}
