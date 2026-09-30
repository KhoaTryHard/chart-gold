'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type SyntheticEvent,
} from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  History,
  LoaderCircle,
  MessageCircle,
  Sparkles,
  Trash2,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import {
  getMarketProducts,
  isMarketCompanyId,
  isMarketProductId,
  type MarketCompanyId,
} from '@/lib/market-sources';
import { ANALYSIS_RANGES, type AnalysisRange } from '@/lib/analysis/metrics';
import type { AnalysisDecision, AnalysisFacts } from '@/lib/analysis/response';
import type { AnalysisGoal, AnalysisDepth } from '@/lib/analysis/experience';
import type { ForecastResult } from '@/lib/analysis/forecast';
import {
  calculateLedgerSummary,
  inspectLedgerIntegrity,
  ledgerProductKeys,
  type PortfolioLedger,
} from '@/lib/portfolio-ledger';
import { AnswerMarkdown } from './answer-markdown';
import type { AnalysisAccess } from '@/lib/analysis/access';
import type { Locale } from '@/lib/i18n';
import {
  analysisRequestSchema,
  type AnalysisRequestPayload,
} from '@/lib/analysis/request';
import {
  analysisDecisionSchema,
  analysisFactsSchema,
} from '@/lib/analysis/response';
import { SearchSuggestions } from './search-suggestions';
import { useLocale } from '@/components/locale-provider';
import { useAccountMenuState } from '@/components/account-menu-context';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  /** Legacy history without this field is treated as Vietnamese. */
  locale?: 'vi' | 'en';
};
type Source = { title: string; url: string };
type Citation = { start: number; end: number; url: string; title: string };
type StreamEvent = { type: string; [key: string]: unknown };
type ConversationSummary = {
  id: string;
  title: string;
  version: number;
  turnCount: number;
  updatedAt: string;
  expiresAt: string;
};
type ConversationTurn = {
  id: string;
  sequence: number;
  question: string;
  answer: string | null;
  locale: string;
  companyId: string;
  productId: string;
  range: string;
  goal: AnalysisGoal | null;
  analysisDepth: AnalysisDepth | null;
  scenarioInputs: Record<string, unknown> | null;
  ledgerVersion: number | null;
  facts: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  forecast: ForecastResult | null;
  sources: Source[] | null;
  citations: Citation[] | null;
  coverage: string | null;
  warning: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
};
type ConversationDetail = ConversationSummary & { turns: ConversationTurn[] };

const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;

function defaultAnalysisQuestion(locale: Locale, goal: AnalysisGoal = 'hold') {
  const questions: Record<AnalysisGoal, Record<Locale, string>> = {
    buy: {
      vi: 'Nếu mua vàng hôm nay, cần giá tăng bao nhiêu để hòa vốn?',
      en: 'If I buy gold today, how much must the price rise for me to break even?',
    },
    hold: {
      vi: 'Vàng tôi đang giữ lãi bao nhiêu, đã hòa vốn chưa?',
      en: 'How much profit or loss would I have if I sold my gold today?',
    },
    compare: {
      vi: 'So sánh giá bán ra các loại vàng nhẫn 9999 hôm nay',
      en: 'Compare today’s dealer sell prices for 9999 gold rings',
    },
    market: {
      vi: 'Giá vàng hôm nay biến động thế nào?',
      en: 'How has gold moved today?',
    },
  };
  return questions[goal][locale];
}

function ForecastCard({
  forecast,
  locale,
}: {
  forecast: ForecastResult;
  locale: Locale;
}) {
  const english = locale === 'en';
  const labels = english
    ? { downside: 'Downside', base: 'Base', upside: 'Upside' }
    : { downside: 'Kịch bản giảm', base: 'Kịch bản cơ sở', upside: 'Kịch bản tăng' };
  const formatPrice = (value: number | null) =>
    value === null
      ? (english ? 'Unavailable' : 'Chưa có')
      : `${new Intl.NumberFormat(english ? 'en-US' : 'vi-VN').format(value)} ${english ? 'VND/lượng' : 'VNĐ/lượng'}`;
  return (
    <section
      aria-live="polite"
      aria-labelledby="forecast-result-title"
      className="mt-5 rounded-2xl border border-primary/30 bg-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            {english ? 'Forecast estimate' : 'Ước tính dự báo'}
          </p>
          <h2 id="forecast-result-title" className="mt-2 text-xl font-semibold">
            {english ? `Target date: ${forecast.targetDate}` : `Ngày đích: ${forecast.targetDate}`}
          </h2>
        </div>
        <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground">
          {forecast.status === 'experimental'
            ? (english ? 'Experimental range' : 'Khoảng thực nghiệm')
            : (english ? 'Insufficient data' : 'Chưa đủ dữ liệu')}
        </span>
      </div>
      {forecast.status === 'experimental' ? (
        <>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {english
              ? `${forecast.observationCount} observations · ${forecast.pairCount} seven-day pairs · source: ${forecast.source.provider}`
              : `${forecast.observationCount} ngày quan sát · ${forecast.pairCount} cặp cách 7 ngày · nguồn: ${forecast.source.provider}`}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {forecast.ranges.map((range) => (
              <div key={range.label} className="rounded-xl border border-border bg-muted/40 p-3">
                <p className="text-sm font-semibold">{labels[range.label]}</p>
                <p className="mt-2 text-xs text-muted-foreground">{english ? 'Dealer buy' : 'Mua vào'}</p>
                <p className="mt-1 text-sm font-semibold tabular-nums">{formatPrice(range.buyVndPerLuong)}</p>
                <p className="mt-2 text-xs text-muted-foreground">{english ? 'Dealer sell' : 'Bán ra'}</p>
                <p className="mt-1 text-sm font-semibold tabular-nums">{formatPrice(range.sellVndPerLuong)}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {forecast.reason ?? (english ? 'A numeric range is unavailable.' : 'Chưa thể tạo khoảng giá định lượng.')}
        </p>
      )}
      <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
        {english
          ? 'This is a historical reference estimate, not a guaranteed price or probability. Check the dealer quote again on the target date.'
          : 'Đây là ước tính tham chiếu từ lịch sử, không phải giá bảo đảm hay xác suất. Hãy kiểm tra lại bảng giá của cửa hàng vào ngày đích.'}
      </p>
    </section>
  );
}

function inputLocale(value: unknown, fallback: Locale): Locale {
  return value === 'vi' || value === 'en' ? value : fallback;
}

function analysisRangeLabel(range: AnalysisRange, locale: 'vi' | 'en') {
  return locale === 'en'
    ? { '7N': '7 days', '1T': '1 month', '1N': '1 year' }[range]
    : { '7N': '7 ngày', '1T': '1 tháng', '1N': '1 năm' }[range];
}

function analysisGoals(locale: 'vi' | 'en'): Array<{
  value: AnalysisGoal;
  label: string;
  description: string;
}> {
  return locale === 'en'
    ? [
        { value: 'market', label: 'Understand the market', description: 'News, drivers, and context' },
        { value: 'buy', label: 'I plan to buy', description: 'Cost, break-even, buy or wait' },
        { value: 'hold', label: 'I hold gold', description: 'Profit or loss if sold today' },
        { value: 'compare', label: 'Compare gold', description: 'Prices you pay and prices you receive' },
      ]
    : [
  {
    value: 'market',
    label: 'Hiểu thị trường',
    description: 'Tin, nguyên nhân, bối cảnh',
  },
  {
    value: 'buy',
    label: 'Tôi định mua',
    description: 'Chi phí, hòa vốn, mua hay chờ',
  },
  {
    value: 'hold',
    label: 'Tôi đang giữ vàng',
    description: 'Lãi/lỗ nếu bán hôm nay',
  },
  {
    value: 'compare',
    label: 'So sánh loại vàng',
    description: 'Giá bạn phải trả và khoản có thể nhận',
  },
      ];
}

function readSseChunk(buffer: string) {
  const blocks = buffer.split(/\r?\n\r?\n/);
  return { blocks: blocks.slice(0, -1), rest: blocks.at(-1) ?? '' };
}

function formatValue(
  value: string | number | null,
  unit: string | null,
  locale: 'vi' | 'en',
) {
  if (value === null) return locale === 'en' ? 'Unavailable' : 'Chưa có';
  if (typeof value === 'number') {
    const suffix = unit === 'VNĐ' || unit === 'VNĐ/lượng' ? 'đ' : '';
    return `${new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'vi-VN').format(value)}${suffix}`;
  }
  return value;
}

function localizedAnalysisMessage(message: string, locale: 'vi' | 'en') {
  if (locale === 'vi') return message;
  const translations: Record<string, string> = {
    'Không kiểm tra được phiên đăng nhập. Bấm Kiểm tra lại.': 'Unable to check your sign-in session. Select Check again.',
    'Chưa thể kiểm tra quyền AI lúc này. Bấm Kiểm tra lại; chưa có lượt AI nào được sử dụng.': 'AI access could not be checked right now. Select Check again; no AI request has been used.',
    'Tài khoản Google này đang liên kết với tài khoản khác. Hãy đăng xuất và chọn đúng tài khoản Google.': 'This Google account is linked to a different account. Sign out and choose the correct Google account.',
    'Phiên tài khoản đang được đồng bộ lại.': 'Your account session is syncing.',
    'Không kiểm tra được quyền AI.': 'Unable to check AI access.',
    'Kiểm tra số lượng lớn hơn 0, giá vốn và đơn vị ghi bên cạnh ô nhập.': 'Check that quantity is greater than zero and review the cost basis and units shown beside each field.',
    'Không thể kiểm tra thông tin lượt này.': 'Unable to check this analysis request.',
    'Không thể bắt đầu đăng nhập Google. Vui lòng thử lại.': 'Unable to start Google sign-in. Please try again.',
    'Máy chủ không nhận được phiên đăng nhập. Bấm Kiểm tra lại; nếu vẫn lỗi, đăng nhập lại bằng nút bên dưới.': 'The server did not receive your sign-in session. Select Check again; if the issue remains, sign in again below.',
    'Đăng nhập bằng nút bên dưới để gửi câu hỏi. Bản nháp sẽ được giữ lại.': 'Sign in below to send your question. Your draft will be kept.',
    'Tài khoản chưa có quyền dùng AI.': 'This account does not have AI access.',
    'Bổ sung thông tin cho lượt này.': 'Add information for this analysis.',
    'Đã dừng phân tích. Bạn có thể gửi lại.': 'Analysis stopped. You can send it again.',
    'Không thể hoàn tất phân tích.': 'Unable to complete the analysis.',
    'Không thể bắt đầu phân tích.': 'Unable to start the analysis.',
    'Máy chủ không trả về luồng dữ liệu.': 'The server did not return a data stream.',
  };
  return translations[message] ?? (/[\u00c0-\u024f]/.test(message)
    ? 'The request could not be completed. Please try again.'
    : message);
}

export function AnalysisWorkspace() {
  const { data: session } = useSession();
  const { locale } = useLocale();
  return <AccountAnalysisWorkspace key={session?.user?.email ?? 'guest'} locale={locale} />;
}

function AccountAnalysisWorkspace({ locale }: { locale: 'vi' | 'en' }) {
  const english = locale === 'en';
  const { status, data: session, update } = useSession();
  const { setState: setAccountMenuState } = useAccountMenuState();
  const [goal, setGoal] = useState<AnalysisGoal>('hold');
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getServerHydratedSnapshot,
  );
  const [depth, setDepth] = useState<AnalysisDepth>('standard');
  const [companyId, setCompanyId] = useState<MarketCompanyId>('sjc');
  const products = useMemo(() => getMarketProducts(companyId), [companyId]);
  const [productId, setProductId] = useState('bar-1l');
  const [range, setRange] = useState<AnalysisRange>('1T');
  const product = products.find((item) => item.id === productId) ?? products[0];
  const [question, setQuestion] = useState(() => defaultAnalysisQuestion(locale, goal));
  const questionEditedRef = useRef(false);
  const [savedLedger, setSavedLedger] = useState<PortfolioLedger | undefined>();
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState('');
  const [ledgerVersion, setLedgerVersion] = useState<number | null>(null);
  const holdSummary = useMemo(
    () => savedLedger ? calculateLedgerSummary(savedLedger.transactions, new Map()) : null,
    [savedLedger],
  );
  const holdProducts = useMemo(
    () => savedLedger ? ledgerProductKeys(savedLedger) : [],
    [savedLedger],
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationVersion, setConversationVersion] = useState<number | null>(null);
  const [conversationTurns, setConversationTurns] = useState<ConversationTurn[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [questionContext, setQuestionContext] = useState<{
    companyLabel: string;
    productLabel: string;
    range: AnalysisRange;
    rangeSource: 'question' | 'link' | 'default';
  } | null>(null);
  const [missingQuestionNeeds, setMissingQuestionNeeds] = useState<Array<{ label: string; reason: string }>>([]);
  const [answer, setAnswer] = useState('');
  const [answerLocale, setAnswerLocale] = useState<'vi' | 'en'>(locale);
  const [facts, setFacts] = useState<AnalysisFacts | null>(null);
  const [decision, setDecision] = useState<AnalysisDecision | null>(null);
  const [decisionNotesOpen, setDecisionNotesOpen] = useState(false);
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [coverage, setCoverage] = useState('');
  const [warning, setWarning] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<'yes' | 'no' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [access, setAccess] = useState<AnalysisAccess | null>(null);
  const [accessError, setAccessError] = useState('');
  const [showAccessHint, setShowAccessHint] = useState(false);
  const [accessRevision, setAccessRevision] = useState(0);
  const [progress, setProgress] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [suggestions, setSuggestions] = useState('');
  const [retryAvailable, setRetryAvailable] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const sessionSyncRef = useRef(false);
  const accountActionsRef = useRef<{
    login: () => void;
    refresh: () => void;
    signOut: () => void;
  }>({ login: () => undefined, refresh: () => undefined, signOut: () => undefined });

  const hydrateConversation = (detail: ConversationDetail) => {
    setConversationId(detail.id);
    setConversationVersion(detail.version);
    setConversationTurns(detail.turns);
    const nextMessages: ChatMessage[] = detail.turns.flatMap((item) => [
      { role: 'user' as const, content: item.question, locale: inputLocale(item.locale, locale) },
      ...(item.answer && item.status === 'completed'
        ? [{ role: 'assistant' as const, content: item.answer, locale: inputLocale(item.locale, locale) }]
        : []),
    ]);
    setMessages(nextMessages);
    const last = [...detail.turns].reverse().find((item) => item.status === 'completed' && item.answer);
    if (last) {
      setAnswer(last.answer ?? '');
      setAnswerLocale(inputLocale(last.locale, locale));
      setFacts(last.facts ? analysisFactsSchema.safeParse(last.facts).data ?? null : null);
      setDecision(last.decision ? analysisDecisionSchema.safeParse(last.decision).data ?? null : null);
      setForecast(last.forecast);
      setSources(last.sources ?? []);
      setCitations(last.citations ?? []);
      setCoverage(last.coverage ?? '');
      setWarning(last.warning ?? '');
      setCompanyId(isMarketCompanyId(last.companyId) ? last.companyId : 'sjc');
      setProductId(last.productId);
      if (last.range in ANALYSIS_RANGES) setRange(last.range as AnalysisRange);
      if (last.goal) setGoal(last.goal);
      if (last.analysisDepth === 'deep' || last.analysisDepth === 'standard') setDepth(last.analysisDepth);
    } else {
      setAnswer('');
      setFacts(null);
      setDecision(null);
      setForecast(null);
      setSources([]);
      setCitations([]);
      setCoverage('');
      setWarning('');
    }
    questionEditedRef.current = true;
    setQuestion('');
  };

  const loadConversation = async (id: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/analysis/conversations/${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
    const body = (await response.json().catch(() => ({}))) as { conversation?: ConversationDetail; error?: string };
    if (!response.ok || !body.conversation) throw new Error(body.error ?? (english ? 'Unable to load this conversation.' : 'Không thể tải hội thoại này.'));
    hydrateConversation(body.conversation);
    window.history.pushState({}, '', `/phan-tich?conversation=${encodeURIComponent(id)}`);
    setHistoryOpen(false);
  };

  const loadConversationList = async (signal?: AbortSignal) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await fetch('/api/analysis/conversations', { credentials: 'same-origin', cache: 'no-store', signal });
      const body = (await response.json().catch(() => ({}))) as { conversations?: ConversationSummary[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? (english ? 'Unable to load history.' : 'Không thể tải lịch sử hội thoại.'));
      if (signal?.aborted) return;
      setConversations(body.conversations ?? []);
      const requestedId = new URLSearchParams(window.location.search).get('conversation');
      if (requestedId) {
        const detailResponse = await fetch(`/api/analysis/conversations/${encodeURIComponent(requestedId)}`, { credentials: 'same-origin', cache: 'no-store', signal });
        const detailBody = (await detailResponse.json().catch(() => ({}))) as { conversation?: ConversationDetail; error?: string };
        if (detailResponse.ok && detailBody.conversation) hydrateConversation(detailBody.conversation);
        else if (!signal?.aborted) setHistoryError(detailBody.error ?? (english ? 'This conversation is unavailable.' : 'Hội thoại này không còn khả dụng.'));
      }
    } catch (cause) {
      if (!signal?.aborted) setHistoryError(cause instanceof Error ? cause.message : (english ? 'Unable to load history.' : 'Không thể tải lịch sử hội thoại.'));
    } finally {
      if (!signal?.aborted) setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.email) {
      queueMicrotask(() => {
        setConversations([]);
        setConversationId(null);
        setConversationVersion(null);
        setConversationTurns([]);
      });
      return;
    }
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void loadConversationList(controller.signal);
    });
    return () => controller.abort();
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session?.user?.email, locale]);

  useEffect(() => {
    const handlePopState = () => {
      const id = new URLSearchParams(window.location.search).get('conversation');
      if (!id) {
        setConversationId(null);
        setConversationVersion(null);
        setConversationTurns([]);
        setMessages([]);
        setAnswer('');
        return;
      }
      void loadConversation(id).catch((cause) => setHistoryError(cause instanceof Error ? cause.message : 'Unable to load conversation.'));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!questionEditedRef.current)
      setQuestion(defaultAnalysisQuestion(locale, goal));
  }, [goal, locale]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const requestedCompany = params.get('company');
      const nextCompany = isMarketCompanyId(requestedCompany)
        ? requestedCompany
        : 'sjc';
      const requestedProduct = params.get('product');
      const nextProduct = isMarketProductId(nextCompany, requestedProduct)
        ? requestedProduct!
        : getMarketProducts(nextCompany)[0]?.id;
      const requestedRange = params.get('range');
      const nextRange: AnalysisRange =
        requestedRange && requestedRange in ANALYSIS_RANGES
          ? (requestedRange as AnalysisRange)
          : '1T';
      const preset = params.get('preset');
      const presetGoal: AnalysisGoal | null =
        preset === 'today'
          ? 'market'
          : preset === 'buy'
            ? 'buy'
            : preset === 'hold'
              ? 'hold'
              : null;
      if (nextCompany !== 'sjc') setCompanyId(nextCompany);
      if (nextProduct) setProductId(nextProduct);
      setRange(nextRange);
      if (presetGoal) {
        setGoal(presetGoal);
        questionEditedRef.current = true;
        setQuestion(defaultAnalysisQuestion(locale, presetGoal));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [locale]);

  useEffect(() => {
    if (status === 'loading') return;
    const controller = new AbortController();
    void fetch(`/api/analysis/prepare?locale=${locale}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            localizedAnalysisMessage(
              body?.error ?? 'Không kiểm tra được phiên đăng nhập. Bấm Kiểm tra lại.',
              locale,
            ),
          );
        }
        const result = (await response.json()) as { access: AnalysisAccess };
        if (controller.signal.aborted) return;
        setAccess(result.access);
        setAccessError('');
        const serverEmail = result.access.account?.email;
        const clientEmail = session?.user?.email?.trim().toLowerCase();
        if (
          serverEmail &&
          clientEmail &&
          serverEmail !== clientEmail &&
          !sessionSyncRef.current
        ) {
          sessionSyncRef.current = true;
          void update().catch(() => undefined);
          setAccessError(locale === 'en' ? 'Your account session is syncing.' : 'Phiên tài khoản đang được đồng bộ lại.');
        } else if (
          result.access.authenticated &&
          status !== 'authenticated' &&
          !sessionSyncRef.current
        ) {
          sessionSyncRef.current = true;
          void update().catch(() => undefined);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setAccessError(
            localizedAnalysisMessage(
              cause instanceof Error ? cause.message : 'Không kiểm tra được quyền AI.',
              locale,
            ),
          );
      });
    return () => controller.abort();
  }, [status, accessRevision, session?.user?.email, update, locale]);
  useEffect(() => () => operation.current?.abort(), []);

  useEffect(() => {
    const account = session?.user?.email;
    if (!account) return;
    if (goal !== 'hold') {
      queueMicrotask(() => setLedgerLoading(false));
      return;
    }
    queueMicrotask(() => {
      setLedgerLoading(true);
      setLedgerError('');
      void fetch('/api/portfolio/ledger', { credentials: 'same-origin', cache: 'no-store' })
          .then(async (response) => {
            const body = await response.json().catch(() => ({})) as { ledger?: PortfolioLedger; version?: number; error?: string };
            if (!response.ok || !body.ledger || typeof body.version !== 'number')
              throw new Error(body.error ?? 'Không thể tải Sổ vàng.');
            setLedgerVersion(body.version);
            return body.ledger;
          })
          .then((serverLedger) => {
            setSavedLedger(serverLedger);
            setLedgerLoading(false);
          })
          .catch((error) => {
            setLedgerError(error instanceof Error ? error.message : 'Không thể tải Sổ vàng.');
            setSavedLedger(undefined);
            setLedgerLoading(false);
          });
      if (!window.location.search.includes('ai=resume')) return;
      try {
        const draft = JSON.parse(
          sessionStorage.getItem('kim-tuyen:ai-draft') ?? 'null',
        ) as Partial<{
          goal: AnalysisGoal;
          depth: AnalysisDepth;
          companyId: MarketCompanyId;
          productId: string;
          range: AnalysisRange;
          question: string;
        }> | null;
        if (draft?.question) {
          if (draft.goal) setGoal(draft.goal);
          if (draft.depth) setDepth(draft.depth);
          if (draft.companyId) setCompanyId(draft.companyId);
          if (draft.productId) setProductId(draft.productId);
          if (draft.range && draft.range in ANALYSIS_RANGES)
            setRange(draft.range);
          questionEditedRef.current = true;
          setQuestion(draft.question);
        }
        sessionStorage.removeItem('kim-tuyen:ai-draft');
      } catch {
        // Ignore malformed or blocked draft storage.
      }
    });
  }, [goal, locale, session?.user?.email]);

  const buildPayload = () => {
    const usingAccountLedger = goal === 'hold';
    if (usingAccountLedger && (!savedLedger || !ledgerVersion))
      throw new Error(ledgerError || (english ? 'Your Gold Ledger is empty.' : 'Sổ vàng của bạn chưa có giao dịch.'));
    if (usingAccountLedger && savedLedger) {
      const integrity = inspectLedgerIntegrity(savedLedger.transactions);
      if (!integrity.valid)
        throw new Error(
          english
            ? 'Fix the ledger issues before asking AI to analyze it.'
            : 'Hãy sửa các lỗi trong sổ trước khi yêu cầu AI phân tích.',
        );
    }
    const result = analysisRequestSchema.safeParse({
      responseVersion: 2,
      inputMode: 'question',
      locale,
      goal,
      analysisDepth: depth,
      question: question.trim(),
      companyId,
      productId: product?.id,
      range,
      scenarioInputs: {},
      conversationId: conversationId ?? undefined,
      conversationVersion: conversationVersion ?? undefined,
      // Server conversation history is authoritative. Legacy localStorage is never uploaded.
      messages: [],
      portfolioLedger: usingAccountLedger ? savedLedger : undefined,
      usePortfolioLedger: usingAccountLedger,
      ledgerVersion: usingAccountLedger ? ledgerVersion ?? undefined : undefined,
    });
    if (!result.success)
      throw new Error(
        locale === 'en'
          ? 'Add the missing details directly to your question.'
          : 'Hãy bổ sung thông tin còn thiếu trực tiếp vào câu hỏi.',
      );
    return result.data;
  };

  const prepare = async (
    input: AnalysisRequestPayload,
    signal: AbortSignal,
  ) => {
    const response = await fetch('/api/analysis/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(
        localizedAnalysisMessage(
          body?.error ?? 'Không thể kiểm tra thông tin lượt này.',
          input.locale,
        ),
      );
    }
    return (await response.json()) as {
      ready: boolean;
      authenticated: boolean;
      access: AnalysisAccess;
      status?: string;
      code?: string;
      ledgerVersion?: number;
      needs?: Array<{ label: string; reason: string }>;
      intent?: { needsResearch?: boolean };
      questionContext?: {
        companyLabel: string;
        productLabel: string;
        range: AnalysisRange;
        rangeSource: 'question' | 'link' | 'default';
      } | null;
    };
  };

  const login = async () => {
    if (signingIn) return;
    setSigningIn(true);
    setError('');
    try {
      sessionStorage.setItem(
        'kim-tuyen:ai-draft',
        JSON.stringify({
          goal,
          depth,
          companyId,
          productId: product?.id,
          range,
          question,
        }),
      );
    } catch {
      /* Storage is optional. */
    }
    try {
      await signIn('google', {
        redirectTo: `${window.location.origin}/phan-tich?ai=resume`,
      });
    } catch {
      setSigningIn(false);
      setError(english ? 'Unable to start Google sign-in. Please try again.' : 'Không thể bắt đầu đăng nhập Google. Vui lòng thử lại.');
    }
  };

  const submit = async (event?: SyntheticEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (operation.current || busy || status === 'loading' || !question.trim())
      return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setRetryAvailable(false);
    setProgress(english ? 'Checking your session and details' : 'Đang kiểm tra phiên và thông tin');
    setError('');
    setShowAccessHint(true);
    setWarning('');
    setMissingQuestionNeeds([]);
    setQuestionContext(null);
    setSources([]);
    setCitations([]);
    setSuggestions('');
    setFeedback(null);
    setRequestId(null);
    try {
      if (goal === 'hold') {
        if (ledgerLoading) {
          setError(english ? 'Your Gold Ledger is still loading.' : 'Sổ vàng đang được tải.');
          return;
        }
        if (ledgerError) {
          setError(ledgerError);
          return;
        }
        if (!savedLedger?.transactions.length) {
          setError(english ? 'Your Gold Ledger is empty. Open Gold Ledger to add a transaction.' : 'Sổ vàng của bạn chưa có giao dịch. Hãy mở Sổ vàng để thêm giao dịch.');
          return;
        }
      }
      const input = buildPayload();
      const prepared = await prepare(input, controller.signal);
      setAccess(prepared.access);
      setQuestionContext(prepared.questionContext ?? null);
      if (!prepared.authenticated) {
        // A stale client session is not permission to automatically restart OAuth.
        setError(
          status === 'authenticated'
            ? english
              ? 'The server did not receive your sign-in session. Select Check again; if the issue remains, sign in again below.'
              : 'Máy chủ không nhận được phiên đăng nhập. Bấm Kiểm tra lại; nếu vẫn lỗi, đăng nhập lại bằng nút bên dưới.'
            : english
              ? 'Sign in below to send your question. Your draft will be kept.'
              : 'Đăng nhập Google ngay cạnh nút gửi để phân tích. Bản nháp sẽ được giữ lại.',
        );
        return;
      }
      if (!prepared.access?.canAnalyze) {
        setError(
          prepared.access?.message ?? (english ? 'This account does not have AI access.' : 'Tài khoản chưa có quyền dùng AI.'),
        );
        return;
      }
      if (prepared.status === 'empty' || prepared.code === 'LEDGER_EMPTY') {
        setError(english ? 'Your Gold Ledger is empty. Open Gold Ledger to add a transaction.' : 'Sổ vàng của bạn chưa có giao dịch. Hãy mở Sổ vàng để thêm giao dịch.');
        return;
      }
      if (!prepared.ready) {
        if (prepared.needs?.length) {
          setMissingQuestionNeeds(prepared.needs);
          setError('');
        } else {
          setError(english ? 'Add information for this analysis.' : 'Bổ sung thông tin cho lượt này.');
        }
        return;
      }
      setProgress(english ? 'Loading data and analyzing' : 'Đang lấy dữ liệu và phân tích');
      await analyze(input, controller.signal);
    } catch (cause) {
      setRetryAvailable(!controller.signal.aborted);
      setError(
        controller.signal.aborted
          ? (english ? 'Analysis stopped. You can send it again.' : 'Đã dừng phân tích. Bạn có thể gửi lại.')
          : cause instanceof Error
            ? localizedAnalysisMessage(cause.message, locale)
            : (english ? 'Unable to complete the analysis.' : 'Không thể hoàn tất phân tích.'),
      );
    } finally {
      operation.current = null;
      setBusy(false);
      setProgress('');
    }
  };

  const analyze = async (
    input: AnalysisRequestPayload,
    signal: AbortSignal,
  ) => {
    const currentQuestion = input.question;
    const requestLocale = input.locale ?? 'vi';
    setAnswerLocale(requestLocale);
    setAnswer('');
    setRetryAvailable(false);
    setFacts(null);
    setDecision(null);
    setDecisionNotesOpen(false);
    setForecast(null);
    setSources([]);
    setCitations([]);
    setCoverage('');
    setMessages((current) => [
      ...current,
      { role: 'user', content: currentQuestion, locale: requestLocale },
    ]);
    try {
      const response = await fetch('/api/analysis', {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        signal,
        body: JSON.stringify({
          ...input,
          clientRequestId: crypto.randomUUID(),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(localizedAnalysisMessage(body?.error ?? 'Không thể bắt đầu phân tích.', requestLocale));
      }
      if (!response.body)
        throw new Error(requestLocale === 'en' ? 'The server did not return a data stream.' : 'Máy chủ không trả về luồng dữ liệu.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalAnswer = '';
      let finished = false;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const parsed = readSseChunk(buffer);
        buffer = parsed.rest;
        for (const block of parsed.blocks) {
          const line = block
            .split(/\r?\n/)
            .find((item) => item.startsWith('data: '));
          if (!line) continue;
          let payload: StreamEvent;
          try {
            payload = JSON.parse(line.slice(6)) as StreamEvent;
          } catch {
            continue;
          }
          if (payload.type === 'reset') {
            finalAnswer = '';
            setAnswer('');
            setCitations([]);
            setSuggestions('');
            setWarning('');
            setError('');
            if (typeof payload.message === 'string') setProgress(payload.message);
          } else if (payload.type === 'conversation') {
            if (typeof payload.conversationId === 'string') {
              setConversationId(payload.conversationId);
              window.history.replaceState({}, '', `/phan-tich?conversation=${encodeURIComponent(payload.conversationId)}`);
            }
            if (typeof payload.conversationVersion === 'number') setConversationVersion(payload.conversationVersion);
          } else if (payload.type === 'delta' && typeof payload.delta === 'string') {
            finalAnswer += payload.delta;
            setAnswer(finalAnswer);
          } else if (payload.type === 'forecast' && payload.forecast) {
            setForecast(payload.forecast as ForecastResult);
          } else if (payload.type === 'facts' && payload.payload) {
            setFacts(analysisFactsSchema.parse(payload.payload));
          } else if (payload.type === 'decision' && payload.payload) {
            setDecision(analysisDecisionSchema.parse(payload.payload));
          } else if (payload.type === 'metadata' && payload.context) {
            const context = payload.context as {
              eligible?: number;
              requested?: number;
              today?: string;
            };
            setCoverage(
              requestLocale === 'en'
                ? `${context.eligible ?? 0}/${context.requested ?? 0} groups with sufficient data · ${context.today ?? ''}`
                : `${context.eligible ?? 0}/${context.requested ?? 0} nhóm đủ dữ liệu · ${context.today ?? ''}`,
            );
          } else if (payload.type === 'done') {
            finished = true;
            if (typeof payload.requestId === 'string')
              setRequestId(payload.requestId);
            if (typeof payload.conversationId === 'string') setConversationId(payload.conversationId);
            if (typeof payload.conversationVersion === 'number') setConversationVersion(payload.conversationVersion);
            if (payload.completion === 'limited')
              setWarning(
                requestLocale === 'en'
                  ? 'Only reference data is available; the AI response did not complete. This request is not counted against your quota.'
                  : 'Chỉ có số liệu tham khảo; AI chưa hoàn tất. Lượt này không tính vào hạn mức.',
              );
          } else if (
            payload.type === 'status' &&
            typeof payload.message === 'string'
          )
            setProgress(payload.message);
          else if (
            payload.type === 'sources' &&
            Array.isArray(payload.sources)
          ) {
            setSources(
              payload.sources.filter((item): item is Source =>
                Boolean(
                  item &&
                  typeof item === 'object' &&
                  typeof (item as Source).url === 'string',
                ),
              ),
            );
          } else if (
            payload.type === 'grounding' &&
            Array.isArray(payload.citations)
          ) {
            setCitations(payload.citations as Citation[]);
            if (typeof payload.suggestions === 'string')
              setSuggestions(payload.suggestions);
          } else if (
            payload.type === 'clarification' &&
            Array.isArray(payload.needs)
          ) {
            const labels = (payload.needs as Array<{ label?: unknown }>)
              .map((item) => (typeof item.label === 'string' ? item.label : ''))
              .filter(Boolean);
            setError(requestLocale === 'en'
              ? `More information is needed: ${labels.join(', ')}.`
              : `Cần bổ sung: ${labels.join(' và ')}.`);
          } else if (
            payload.type === 'warning' &&
            typeof payload.message === 'string'
          )
            setWarning(payload.message);
          else if (
            payload.type === 'error' &&
            typeof payload.message === 'string'
          ) {
            if (payload.refunded === true)
              setWarning(
                requestLocale === 'en'
                  ? 'The failed request was returned to your allowance.'
                  : 'Lượt lỗi đã được hoàn lại vào hạn mức của bạn.',
              );
            const requestSuffix =
              typeof payload.requestId === 'string'
                ? ` (${requestLocale === 'en' ? 'Reference' : 'Mã đối chiếu'}: ${payload.requestId.slice(0, 8)})`
                : '';
            throw new Error(
              localizedAnalysisMessage(payload.message, requestLocale) + requestSuffix,
            );
          }
        }
      }
      if (!finished)
        throw new Error(
          requestLocale === 'en'
            ? 'The connection ended before the AI finished. Try again; the text above is not a complete result.'
            : 'Kết nối kết thúc trước khi AI hoàn tất. Hãy thử lại; nội dung trên chưa phải kết quả đầy đủ.',
        );
      const nextMessages = finalAnswer
        ? [
            ...messages,
            { role: 'user' as const, content: currentQuestion, locale: requestLocale },
            { role: 'assistant' as const, content: finalAnswer, locale: requestLocale },
          ]
        : messages;
      setMessages(nextMessages);
      void loadConversationList().catch(() => undefined);
    } finally {
      setAccessRevision((value) => value + 1);
    }
  };

  const submitFeedback = async (value: 'yes' | 'no') => {
    setFeedback(value);
    if (!requestId) return;
    // The endpoint is deliberately best-effort: rating must never block the next question.
    await fetch('/api/analysis/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ requestId, rating: value === 'yes' ? 1 : 0 }),
    }).catch(() => undefined);
  };

  const startNewConversation = () => {
    if (busy) return;
    setConversationId(null);
    setConversationVersion(null);
    setConversationTurns([]);
    setMessages([]);
    setAnswer('');
    setFacts(null);
    setDecision(null);
    setForecast(null);
    setSources([]);
    setCitations([]);
    setCoverage('');
    setWarning('');
    setError('');
    questionEditedRef.current = false;
    setQuestion(defaultAnalysisQuestion(locale, goal));
    window.history.pushState({}, '', '/phan-tich');
    setHistoryOpen(false);
  };

  const deleteAllHistory = async () => {
    if (busy || !window.confirm(english ? 'Delete all saved conversations?' : 'Xóa toàn bộ lịch sử hội thoại?')) return;
    const response = await fetch('/api/analysis/conversations', { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
    if (!response?.ok) {
      setHistoryError(english ? 'Unable to delete history.' : 'Không thể xóa lịch sử hội thoại.');
      return;
    }
    startNewConversation();
    setConversations([]);
  };

  const deleteConversationById = async (id: string) => {
    if (busy || !window.confirm(english ? 'Delete this conversation?' : 'Xóa cuộc trò chuyện này?')) return;
    const response = await fetch(`/api/analysis/conversations/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
    if (!response?.ok) {
      setHistoryError(english ? 'Unable to delete this conversation.' : 'Không thể xóa cuộc trò chuyện này.');
      return;
    }
    setConversations((items) => items.filter((item) => item.id !== id));
    if (conversationId === id) startNewConversation();
  };

  const chooseGoal = (value: AnalysisGoal) => {
    setGoal(value);
    setError('');
    setMissingQuestionNeeds([]);
    questionEditedRef.current = false;
    setQuestion(defaultAnalysisQuestion(locale, value));
  };

  const refreshAccess = () => {
    void update().catch(() => undefined);
    setAccessRevision((value) => value + 1);
  };

  useEffect(() => {
    accountActionsRef.current = {
      login: () => void login(),
      refresh: refreshAccess,
      signOut: () => void signOut({ redirectTo: '/phan-tich' }),
    };
  });

  useEffect(() => {
    setAccountMenuState({
      context: 'ai',
      access,
      accessError,
      signingIn,
      busy,
      onLogin: () => accountActionsRef.current.login(),
      onRefresh: () => accountActionsRef.current.refresh(),
      onSignOut: () => accountActionsRef.current.signOut(),
    });
    return () => setAccountMenuState(null);
  }, [access, accessError, signingIn, busy, status, session?.user?.email, locale, setAccountMenuState]);
  const completedConversationTurns = conversationTurns.filter((item) => item.status === 'completed' && item.answer);
  const displayedPreviousTurns = answer && completedConversationTurns.at(-1)?.answer === answer
    ? completedConversationTurns.slice(0, -1)
    : completedConversationTurns;

  return (
    <main id="main-content" tabIndex={-1} data-hydrated={hydrated ? 'true' : 'false'} className="ai-workspace mx-auto w-full max-w-[1280px] px-4 pb-28 pt-8 sm:px-6 lg:px-8">
      <div className="ai-page-heading mb-6 flex items-start justify-between gap-5">
        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles className="size-4" /> {english ? 'AI Analysis' : 'Phân tích AI'}
          </p>
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            {english ? 'AI Analysis' : 'Phân tích AI'}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            {english ? 'Ask a plain-language question about the gold you are viewing.' : 'Đặt câu hỏi dễ hiểu về đúng loại vàng bạn đang xem.'}
          </p>
        </div>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || status !== 'authenticated'}
          onClick={() => {
            setHistoryOpen(true);
            void loadConversationList().catch(() => undefined);
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <History className="size-4" /> {english ? 'History' : 'Lịch sử'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={startNewConversation}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm hover:bg-accent disabled:opacity-50"
        >
          {english ? 'New conversation' : 'Cuộc trò chuyện mới'}
        </button>
      </div>
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{english ? 'AI conversation history' : 'Lịch sử Hỏi AI'}</SheetTitle>
            <SheetDescription>
              {english ? 'Saved on the server for 30 days after your last question.' : 'Lưu trên máy chủ trong 30 ngày kể từ câu hỏi gần nhất.'}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-5 flex items-center justify-between gap-2">
            <button type="button" disabled={busy || historyLoading || !conversations.length} onClick={() => void deleteAllHistory()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-destructive/30 px-3 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50">
              <Trash2 className="size-3.5" /> {english ? 'Delete all' : 'Xóa toàn bộ'}
            </button>
            <button type="button" disabled={busy || historyLoading} onClick={() => void loadConversationList()} className="text-xs text-muted-foreground underline underline-offset-2">
              {english ? 'Refresh' : 'Tải lại'}
            </button>
          </div>
          {historyError ? <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{historyError}</p> : null}
          {historyLoading ? <p className="mt-5 text-sm text-muted-foreground">{english ? 'Loading…' : 'Đang tải…'}</p> : null}
          {!historyLoading && !conversations.length ? <p className="mt-5 text-sm text-muted-foreground">{english ? 'No saved conversations yet.' : 'Chưa có cuộc trò chuyện nào được lưu.'}</p> : null}
          <div className="mt-4 space-y-2">
            {conversations.map((item) => (
              <div key={item.id} className={`rounded-xl border p-3 ${conversationId === item.id ? 'border-primary bg-accent/40' : 'border-border bg-card'}`}>
                <button type="button" disabled={busy} onClick={() => void loadConversation(item.id).catch((cause) => setHistoryError(cause instanceof Error ? cause.message : 'Unable to load conversation.'))} className="block min-h-11 w-full text-left disabled:opacity-50">
                  <span className="block line-clamp-2 text-sm font-medium">{item.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{item.turnCount} {english ? 'turns' : 'lượt'} · {new Intl.DateTimeFormat(english ? 'en-US' : 'vi-VN', { dateStyle: 'medium' }).format(new Date(item.updatedAt))}</span>
                </button>
                <button type="button" disabled={busy} onClick={() => void deleteConversationById(item.id)} className="mt-2 inline-flex min-h-9 items-center gap-1 text-xs text-destructive underline underline-offset-2 disabled:opacity-50"><Trash2 className="size-3" /> {english ? 'Delete' : 'Xóa'}</button>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
      <div
        className="ai-goals mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
        role="tablist"
        aria-label={english ? 'Analysis goal' : 'Nhu cầu phân tích'}
      >
        {analysisGoals(locale).map((item) => (
          <button
            key={item.value}
            type="button"
            disabled={busy}
            role="tab"
            aria-selected={goal === item.value}
            onClick={() => chooseGoal(item.value)}
            className={`rounded-2xl border p-4 text-left transition-colors ${goal === item.value ? 'border-primary bg-accent text-accent-foreground' : 'border-border bg-card hover:bg-accent/60'}`}
          >
            <span className="block text-sm font-semibold">{item.label}</span>
            <span className="mt-1 block text-xs leading-5 opacity-75">
              {item.description}
            </span>
          </button>
        ))}
      </div>
      <div className="ai-content-grid mx-auto w-full max-w-[1040px]">

        <section className="min-w-0">
          <div className="ai-question-panel glass-panel p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {english ? 'Analysis depth' : 'Độ sâu phân tích'}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {english ? 'Data' : 'Dữ liệu'}: {analysisRangeLabel(range, locale)}
                </p>
                <div className="mt-1 flex gap-1 rounded-xl bg-muted p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setDepth('standard');
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs ${depth === 'standard' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
                  >
                    {english ? 'Standard' : 'Thông thường'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDepth('deep');
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs ${depth === 'deep' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
                  >
                    {english ? 'Deep' : 'Chuyên sâu'}
                  </button>
                </div>
              </div>
              <div />
            </div>
            {goal === 'hold' ? (
              <div className="mb-4 rounded-xl border border-accent bg-accent/30 px-3 py-2 text-xs" aria-live="polite">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{english ? 'Your Gold Ledger' : 'Sổ vàng của bạn'}</span>
                  <Link href="/so-vang" className="font-medium text-primary underline underline-offset-2">{english ? 'Open Gold Ledger' : 'Mở Sổ vàng'}</Link>
                </div>
                {ledgerLoading ? <p className="mt-1 text-muted-foreground">{english ? 'Loading your ledger…' : 'Đang tải Sổ vàng…'}</p> : ledgerError ? <p className="mt-1 text-destructive">{ledgerError}</p> : holdSummary && holdProducts.length ? <p className="mt-1 text-muted-foreground">{english ? `${holdSummary.openQuantityLuong.toFixed(4)} lượng currently held · ${holdProducts.length} products` : `Đang giữ ${holdSummary.openQuantityLuong.toFixed(4)} lượng · ${holdProducts.length} nhóm sản phẩm`}</p> : <p className="mt-1 text-muted-foreground">{english ? 'Your Gold Ledger is empty.' : 'Sổ vàng của bạn chưa có giao dịch.'}</p>}
              </div>
            ) : null}
            <form onSubmit={submit}>
              <label className="sr-only" htmlFor="analysis-question">
                {english ? 'Analysis question' : 'Câu hỏi phân tích'}
              </label>
              <textarea
                id="analysis-question"
                value={question}
                onChange={(event) => {
                  const value = event.target.value;
                  questionEditedRef.current = true;
                  setQuestion(value);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    window.matchMedia('(pointer: fine)').matches
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                maxLength={1500}
                rows={4}
                disabled={busy}
                className="min-h-24 w-full resize-y rounded-2xl border border-input bg-background p-4 text-base leading-6 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={conversationId ? (english ? 'Ask a follow-up in this conversation' : 'Hỏi tiếp trong phiên này') : (english ? 'What would you like to know?' : 'Bạn muốn biết điều gì?')}
              />
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {goal === 'buy'
                  ? (english ? 'Example: I want to buy one SJC gold chi and hold it for 6 months.' : 'Ví dụ: Tôi muốn mua 1 chỉ nhẫn SJC, dự định giữ 6 tháng.')
                  : (english ? 'Describe the product, amount, budget, and timeframe you want to analyze.' : 'Hãy nêu loại vàng, số lượng, ngân sách và khoảng thời gian bạn muốn phân tích.')}
              </p>
              {questionContext ? (
                <p className="mt-2 text-xs leading-5 text-muted-foreground" aria-live="polite">
                  {english
                    ? `Scope: ${questionContext.companyLabel} · ${questionContext.productLabel} · ${analysisRangeLabel(questionContext.range, locale)}`
                    : `Phạm vi: ${questionContext.companyLabel} · ${questionContext.productLabel} · ${analysisRangeLabel(questionContext.range, locale)}`}
                </p>
              ) : null}
              {missingQuestionNeeds.length > 0 ? (
                <div className="mt-3 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground" aria-live="polite">
                  <p className="font-medium text-foreground">{english ? 'Please add:' : 'Hãy bổ sung:'}</p>
                  {missingQuestionNeeds.map((item) => <p key={`${item.label}-${item.reason}`}><span className="font-medium">{item.label}:</span> {item.reason}</p>)}
                </div>
              ) : null}
              {status !== 'authenticated' && !busy ? (
                <button
                  type="button"
                  onClick={() => void login()}
                  disabled={signingIn}
                  className="ai-inline-login mt-3 min-h-12 w-full rounded-xl border border-primary/30 bg-primary/5 px-4 text-left text-sm font-semibold text-primary hover:bg-primary/10 sm:w-auto"
                >
                  {signingIn ? (english ? 'Opening Google…' : 'Đang chuyển tới Google…') : (english ? 'Sign in with Google to analyze' : 'Đăng nhập Google để phân tích')}
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {english ? 'Your question will stay here until you choose Send.' : 'Câu hỏi sẽ được giữ lại; bạn vẫn chủ động bấm Gửi câu hỏi.'}
                  </span>
                </button>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {question.length}/1,500 · {english ? 'Press Enter to send on desktop' : 'Enter để gửi trên máy tính'}
                </span>
                <button
                  type="submit"
                  disabled={busy || status === 'loading' || !question.trim()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {busy ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ArrowRight className="size-4" />
                  )}{' '}
                  {busy ? (english ? 'Analyzing' : 'Đang phân tích') : (english ? 'Analyze' : 'Phân tích')}
                </button>
              </div>
            </form>
          </div>
          {error && (
            <div
              role="alert"
              className="mt-4 flex gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
              {retryAvailable && !busy ? (
                <button
                  type="button"
                  className="min-h-9 shrink-0 rounded-lg border border-destructive/30 px-3 text-xs font-medium hover:bg-destructive/10"
                  onClick={() => void submit()}
                >
                  {english ? 'Try again' : 'Thử lại'}
                </button>
              ) : null}
            </div>
          )}
          {!busy && showAccessHint && (accessError || access?.code) ? (
            <p
              className="ai-access-hint mt-3 text-xs leading-5 text-muted-foreground"
              aria-live="polite"
            >
              {accessError || access?.message}
            </p>
          ) : null}
          {busy && (
            <output className="mt-3 flex items-center justify-between gap-3 text-sm">
              <span>{progress}…</span>
              <button
                type="button"
                className="min-h-11 rounded-xl border px-4"
                onClick={() => operation.current?.abort()}
              >
                {english ? 'Stop analysis' : 'Dừng phân tích'}
              </button>
            </output>
          )}
          {suggestions && <SearchSuggestions html={suggestions} />}
          {forecast ? <ForecastCard forecast={forecast} locale={locale} /> : null}
          {facts?.facts.length ? (
            <div lang={answerLocale} className="mt-5 grid gap-3 sm:grid-cols-3">
              {facts.facts.slice(0, 3).map((item) => (
                <div key={item.key} className="metric-card p-4">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="mt-2 text-xl font-semibold tabular-nums">
                    {formatValue(item.value, item.unit, locale)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.assumption ?? item.unit ?? (english ? 'Calculated from data' : 'Đã tính từ dữ liệu')}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          {displayedPreviousTurns.length > 0 && (
            <section className="mt-5 space-y-4" aria-label={english ? 'Earlier turns' : 'Các lượt trước'}>
              {displayedPreviousTurns.map((item) => (
                <article key={item.id} className="rounded-2xl border border-border bg-card/70 p-5">
                  <p className="text-sm font-medium leading-6"><span className="mr-2 text-xs font-medium text-primary">{english ? 'You' : 'Bạn'}</span>{item.question}</p>
                  <div className="mt-4 border-t border-border/70 pt-4" lang={inputLocale(item.locale, locale)}>
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><MessageCircle className="size-4 text-primary" /> AI</div>
                    <AnswerMarkdown content={item.answer ?? ''} citations={item.citations ?? []} />
                  </div>
                </article>
              ))}
            </section>
          )}
          {answer && (
            <div className="mt-5 rounded-2xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <MessageCircle className="size-4 text-primary" /> {english ? 'Explanation' : 'Giải thích'}
              </div>
              <div lang={answerLocale}>
                <AnswerMarkdown content={answer} citations={citations} />
              </div>
              {coverage && (
                <p lang={answerLocale} className="mt-4 text-xs text-muted-foreground">{coverage}</p>
              )}
              {warning && (
                <p lang={answerLocale} className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  {warning}
                </p>
              )}
              <details className="mt-4 text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {english ? 'Data and limits' : 'Số liệu và giới hạn'}
                </summary>
                <p className="mt-2">
                  {english ? 'The figures in the cards come from server data and this analysis. Fallback, stale, or incompletely dated data is not treated as a current price.' : 'Các con số trong thẻ lấy từ dữ liệu server và phép tính của lượt này. Giá dự phòng, dữ liệu cũ hoặc thiếu ngày đối chiếu không được xem là giá mới.'}
                </p>
              </details>
              {sources.length > 0 && (
                <details className="mt-3 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    {english ? 'Sources' : 'Nguồn tham khảo'} ({sources.length})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {sources.slice(0, 12).map((source) => (
                      <li key={source.url}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-foreground underline underline-offset-2"
                        >
                          {source.title || source.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {answer && decision && (
            <details
              open={decisionNotesOpen}
              onToggle={(event) =>
                setDecisionNotesOpen(event.currentTarget.open)
              }
              className="group mt-4 rounded-2xl border border-border bg-card/60 px-4 text-sm text-muted-foreground"
              lang={answerLocale}
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                <span>{english ? 'Data notes' : 'Lưu ý theo dữ liệu'}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={`size-4 shrink-0 transition-transform ${decisionNotesOpen ? 'rotate-180' : ''}`}
                />
              </summary>
              <div className="space-y-2 border-t border-border/70 pb-4 pt-3 leading-6">
                <p className="font-medium text-foreground">{decision.headline}</p>
                <p>{decision.summary}</p>
                {decision.conditions.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">
                      {english ? 'Conditions' : 'Điều kiện'}
                    </p>
                    <ul className="list-disc space-y-1 pl-5">
                      {decision.conditions.map((condition) => (
                        <li key={condition}>{condition}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          )}
          {decision && (
            <div className="mt-4 flex flex-wrap gap-2">
              {decision.nextSteps.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    questionEditedRef.current = true;
                    setQuestion(item);
                  }}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs hover:bg-accent"
                >
                  {item}
                  <ArrowRight className="size-3.5" />
                </button>
              ))}
            </div>
          )}
          {answer && (
            <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span>{english ? 'Did this result help your decision?' : 'Kết quả này có giúp bạn quyết định?'}</span>
              <button
                type="button"
                aria-pressed={feedback === 'yes'}
                onClick={() => void submitFeedback('yes')}
                className="inline-flex min-h-9 items-center gap-1 hover:text-foreground"
              >
                <ThumbsUp className="size-3.5" /> {english ? 'Helpful' : 'Hữu ích'}{' '}
                {feedback === 'yes' && <Check className="size-3.5" />}
              </button>
              <button
                type="button"
                aria-pressed={feedback === 'no'}
                onClick={() => void submitFeedback('no')}
                className="inline-flex min-h-9 items-center gap-1 hover:text-foreground"
              >
                <ThumbsDown className="size-3.5" /> {english ? 'Not helpful' : 'Chưa hữu ích'}{' '}
                {feedback === 'no' && <Check className="size-3.5" />}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
