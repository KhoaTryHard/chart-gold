'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  ArrowDownRight,
  ArrowUpRight,
  Gem,
  Info,
  Landmark,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  WifiOff,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useHeaderActions } from '@/components/app-shell';
import { useLocale } from '@/components/locale-provider';
import { PageTransition } from '@/components/page-transition';
import { ChartEntryViewport } from '@/components/market/chart-entry-viewport';
import {
  AnalysisRouteLink,
  analysisHref,
} from '@/components/analysis/analysis-route-link';
const PriceChart = dynamic(
  () =>
    import('@/components/market/price-chart').then(
      (module) => module.PriceChart,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="mb-6 min-h-[480px] space-y-4"
        aria-label="Đang tải biểu đồ"
      >
        <span className="ui-skeleton block h-5 w-48" />
        <span className="ui-skeleton mt-4 block h-[360px] w-full rounded-[20px] sm:h-[480px] lg:h-[560px]" />
      </div>
    ),
  },
);
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import fallbackDataset from '@/lib/sjc-data.json';
import { createLatestRequestGuard } from '@/lib/latest-request';
import { formatMarketAge, getMarketFreshness } from '@/lib/market-freshness';
import {
  PRICE_CHART_RANGES,
  type PriceChartRange,
  type PricePoint,
} from '@/lib/price-chart';
import {
  filterRecordsByCalendarWindow,
  mergeRecordsByDate,
} from '@/lib/market-history';
import { DEFAULT_SJC_PRODUCT_ID, getSjcProduct } from '@/lib/sjc-products';
import { COMPARISON_SETS } from '@/lib/comparison-catalog';
import {
  getMarketCompany,
  getMarketProductCategory,
  getMarketProduct,
  getMarketProducts,
  isMarketProductSelectable,
  isMarketCompanyId,
  isMarketProductId,
  MARKET_COMPANIES,
  presentMarketCatalogText,
  presentMarketCompany,
  presentMarketProduct,
  type MarketCompanyId,
  type MarketProduct,
  type MarketProductId,
} from '@/lib/market-sources';

type Range = Exclude<PriceChartRange, '1N'>;
type DataMode = 'connecting' | 'live' | 'delayed' | 'fallback' | 'unavailable';
type MarketResponse = {
  mode: Exclude<DataMode, 'connecting'>;
  product: MarketProduct;
  company: ReturnType<typeof getMarketCompany>;
  availability: 'available' | 'unavailable';
  unavailableReason: string | null;
  records: PricePoint[];
  latest: PricePoint | null;
  observedAt: string;
  timestampKind?: 'source' | 'retrieval-or-date';
  source: { provider: string; url: string | null; official: boolean };
  historySource: { provider: string; url: string | null };
  fetchedAt?: string;
  generatedAt?: string;
  sourcePublishedAt?: string;
  expiresAt?: string;
  stale?: boolean;
};

type DisplayUnit = 'luong' | 'chi';

function formatVnd(
  value: number | null | undefined,
  unit: DisplayUnit = 'luong',
) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const converted = unit === 'chi' ? value / 10 : value;
  return Math.round(converted * 1_000_000).toLocaleString('vi-VN');
}

function displayUnitLabel(unit: DisplayUnit, english: boolean) {
  if (unit === 'chi') return english ? 'VND / chỉ' : 'đ / chỉ';
  return english ? 'VND / lượng' : 'đ / lượng';
}

const ranges = PRICE_CHART_RANGES.filter((item) => item.value !== '1N');
const fallbackRecords = fallbackDataset.records as PricePoint[];
const MARKET_CLIENT_TTL_MS = 4 * 60 * 1_000;
const marketResponseCache = new Map<
  string,
  { expiresAt: number; payload: MarketResponse }
>();

function marketCacheKey(
  companyId: MarketCompanyId,
  productId: MarketProductId,
) {
  return `${companyId}:${productId}`;
}

function MarketSkeleton() {
  return (
    <div className="space-y-6" aria-label="Đang tải dữ liệu thị trường">
      <div
        className="space-y-3"
        data-testid="domestic-chart-loading"
        aria-busy="true"
      >
        <span className="ui-skeleton block h-6 w-56" />
        <div className="rounded-[20px] border border-border bg-[var(--surface-solid)] p-3">
          <span className="ui-skeleton block h-11 w-64 max-w-full" />
          <span className="ui-skeleton mt-4 block h-[360px] w-full sm:h-[480px] lg:h-[560px]" />
        </div>
      </div>
      <div
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-hidden="true"
      >
        <div className="metric-card metric-card--quote min-h-[248px] sm:col-span-2">
          <span className="ui-skeleton block h-4 w-36" />
          <span className="ui-skeleton mt-4 block h-9 w-56 max-w-full" />
          <span className="ui-skeleton mt-7 block h-4 w-36" />
          <span className="ui-skeleton mt-4 block h-9 w-56 max-w-full" />
        </div>
        {[0, 1].map((index) => (
          <div key={index} className="metric-card min-h-[176px]">
            <span className="ui-skeleton block h-4 w-32" />
            <span className="ui-skeleton mt-7 block h-9 w-36" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MarketDashboard({
  editorialSection,
  worldGoldSection,
}: { editorialSection?: ReactNode; worldGoldSection?: ReactNode } = {}) {
  const { locale } = useLocale();
  const english = locale === 'en';
  const [range, setRange] = useState<Range>('1T');
  const [companyId, setCompanyId] = useState<MarketCompanyId>('sjc');
  const [productId, setProductId] = useState<MarketProductId>(
    DEFAULT_SJC_PRODUCT_ID,
  );
  const [product, setProduct] = useState<MarketProduct>(
    getSjcProduct(DEFAULT_SJC_PRODUCT_ID),
  );
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>('luong');
  const [latestQuote, setLatestQuote] = useState<PricePoint | null>(null);
  const [timestampKind, setTimestampKind] = useState<
    'source' | 'retrieval-or-date'
  >('retrieval-or-date');
  const activeCompanyId = useRef<MarketCompanyId>('sjc');
  const activeProductId = useRef<MarketProductId>(DEFAULT_SJC_PRODUCT_ID);
  const [records, setRecords] = useState<PricePoint[]>(fallbackRecords);
  const [mode, setMode] = useState<DataMode>('connecting');
  const [observedAt, setObservedAt] = useState(
    fallbackDataset.metadata.snapshotTakenAt,
  );
  const [fetchedAt, setFetchedAt] = useState<string | undefined>();
  const [source, setSource] = useState({
    provider: 'Bản lịch sử dự phòng',
    url: fallbackDataset.metadata.sourceUrl as string | null,
    official: false,
  });
  const [historySource, setHistorySource] = useState({
    provider: 'SJC-price dataset',
    url: fallbackDataset.metadata.sourceUrl as string | null,
  });
  const [unavailableReason, setUnavailableReason] = useState<string | null>(
    null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [requestGuard] = useState(() => createLatestRequestGuard());
  // Keep the first render deterministic for SSR; sync the clock after hydration.
  const [now, setNow] = useState(0);
  const router = useRouter();
  const requestControllerRef = useRef<AbortController | null>(null);
  const selectionHydratedRef = useRef(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('kim-tuyen-market-selection');
      const parsed = saved
        ? (JSON.parse(saved) as {
            companyId?: string;
            productId?: string;
            displayUnit?: string;
          })
        : null;
      queueMicrotask(() => {
        if (parsed?.displayUnit === 'luong' || parsed?.displayUnit === 'chi')
          setDisplayUnit(parsed.displayUnit);
        if (isMarketCompanyId(parsed?.companyId)) {
          const savedCompany = parsed.companyId;
          const savedProduct = isMarketProductId(savedCompany, parsed.productId)
            ? parsed.productId!
            : getMarketProduct(savedCompany, null).id;
          setCompanyId(savedCompany);
          setProductId(savedProduct);
          setProduct(getMarketProduct(savedCompany, savedProduct));
        }
        selectionHydratedRef.current = true;
      });
    } catch {
      // Storage is optional; the default remains lượng.
      selectionHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!selectionHydratedRef.current) return;
    try {
      window.localStorage.setItem(
        'kim-tuyen-market-selection',
        JSON.stringify({
          companyId,
          productId,
          displayUnit,
        }),
      );
    } catch {
      // Storage can be blocked by privacy mode.
    }
  }, [companyId, displayUnit, productId]);

  const invalidatePendingMarketRequest = useCallback(() => {
    requestGuard.begin();
    requestControllerRef.current?.abort();
  }, [requestGuard]);

  const refreshPrices = useCallback(
    async (
      requestedCompanyId: MarketCompanyId,
      requestedProductId: MarketProductId,
      manual = false,
    ) => {
      const requestId = requestGuard.begin();
      requestControllerRef.current?.abort();
      const controller = new AbortController();
      requestControllerRef.current = controller;
      if (manual) setIsRefreshing(true);
      else setIsRefreshing(false);
      try {
        const key = marketCacheKey(requestedCompanyId, requestedProductId);
        const cached = marketResponseCache.get(key);
        const applyPayload = (payload: MarketResponse) => {
          setRecords((current) =>
            payload.availability === 'available' && payload.records.length > 0
              ? mergeRecordsByDate(current, payload.records)
              : payload.records,
          );
          setLatestQuote(payload.latest ?? null);
          setProduct(payload.product);
          activeCompanyId.current = payload.company.id;
          activeProductId.current = payload.product.id;
          setCompanyId(payload.company.id);
          setMode(payload.mode);
          setObservedAt(
            payload.timestampKind === 'source'
              ? (payload.sourcePublishedAt ?? payload.observedAt)
              : payload.observedAt,
          );
          setFetchedAt(payload.fetchedAt ?? payload.generatedAt);
          setTimestampKind(payload.timestampKind ?? 'retrieval-or-date');
          setSource(payload.source);
          setHistorySource(payload.historySource);
          setUnavailableReason(payload.unavailableReason);
        };
        if (!manual && cached && cached.expiresAt > Date.now()) {
          if (requestGuard.isCurrent(requestId)) applyPayload(cached.payload);
          return;
        }
        const query = new URLSearchParams({
          company: requestedCompanyId,
          product: requestedProductId,
          view: 'quote',
        });
        const response = await fetch(`/api/sjc?${query}`, {
          cache: manual ? 'no-store' : 'default',
          headers: {
            Accept: 'application/json',
            ...(manual ? { 'Cache-Control': 'no-cache' } : {}),
          },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Không thể tải bảng giá');
        const payload = (await response.json()) as MarketResponse;
        if (!requestGuard.isCurrent(requestId)) return;
        if (!Array.isArray(payload.records)) {
          throw new Error('Bảng giá không hợp lệ');
        }
        const expiresAt = Date.parse(payload.expiresAt ?? '');
        marketResponseCache.set(key, {
          payload,
          expiresAt:
            Number.isFinite(expiresAt) && expiresAt > Date.now()
              ? expiresAt
              : Date.now() + MARKET_CLIENT_TTL_MS,
        });
        applyPayload(payload);
      } catch {
        if (controller.signal.aborted || !requestGuard.isCurrent(requestId)) {
          return;
        }
        if (
          requestedCompanyId !== activeCompanyId.current ||
          requestedProductId !== activeProductId.current
        ) {
          // Never show a previous company's/product's prices for a failed
          // selection. Keep the unavailable state explicit.
          const requestedProduct = getMarketProduct(
            requestedCompanyId,
            requestedProductId,
          );
          setRecords([]);
          setProduct(requestedProduct);
          setMode('unavailable');
          setUnavailableReason(
            'Không thể tải dữ liệu cho lựa chọn này. Không có snapshot thay thế để tránh hiển thị giá không xác thực.',
          );
          setSource({
            provider: getMarketCompany(requestedCompanyId).provider,
            url: getMarketCompany(requestedCompanyId).sourceUrl,
            official: false,
          });
          setHistorySource({
            provider: 'Chưa có dữ liệu lịch sử khả dụng',
            url: null,
          });
          activeCompanyId.current = requestedCompanyId;
          activeProductId.current = requestedProductId;
        } else {
          if (
            requestedCompanyId === 'sjc' &&
            requestedProductId === DEFAULT_SJC_PRODUCT_ID
          ) {
            setLatestQuote(
              (current) => current ?? fallbackRecords.at(-1) ?? null,
            );
            setObservedAt(fallbackDataset.metadata.snapshotTakenAt);
            setTimestampKind('retrieval-or-date');
            setFetchedAt(undefined);
          }
          setMode('fallback');
        }
      } finally {
        if (manual && requestGuard.isCurrent(requestId)) {
          setIsRefreshing(false);
        }
        if (requestGuard.isCurrent(requestId)) setNow(Date.now());
      }
    },
    [requestGuard],
  );

  useEffect(() => {
    const clockSync = window.setTimeout(() => setNow(Date.now()), 0);
    const clockTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    }, 60_000);
    const params = new URLSearchParams(window.location.search);
    if (params.get('ai') === 'open') {
      const requestedCompany = params.get('company');
      const nextCompany: MarketCompanyId = isMarketCompanyId(requestedCompany)
        ? requestedCompany
        : companyId;
      const nextProduct = isMarketProductId(nextCompany, params.get('product'))
        ? params.get('product')!
        : getMarketProduct(nextCompany, null).id;
      const nextRange =
        params.get('range') === '7N' ||
        params.get('range') === '1N' ||
        params.get('range') === '1T'
          ? (params.get('range') as PriceChartRange)
          : range;
      router.replace(analysisHref(nextCompany, nextProduct, nextRange));
    }
    return () => {
      window.clearTimeout(clockSync);
      window.clearInterval(clockTimer);
    };
  }, [companyId, range, router]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine)
        void refreshPrices(companyId, productId);
    };
    const initialLoad = window.setTimeout(refreshWhenVisible, 0);
    const timer = window.setInterval(refreshWhenVisible, 4 * 60 * 1_000);
    const onVisible = () => refreshWhenVisible();
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
      window.removeEventListener('online', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [companyId, productId, refreshPrices]);

  useEffect(
    () => () => {
      requestControllerRef.current?.abort();
    },
    [],
  );

  const selectedRange =
    ranges.find((item) => item.value === range) ?? ranges[1];
  const selectedCompany = getMarketCompany(companyId);
  const displayedCompany = presentMarketCompany(selectedCompany, locale);
  const displayedProduct = presentMarketProduct(product, locale);
  const displayedUnavailableReason = unavailableReason
    ? presentMarketCatalogText(unavailableReason, locale)
    : null;
  const currentProducts = getMarketProducts(companyId);
  const productCategory = getMarketProductCategory(product);
  const comparisonSet =
    productCategory === 'ring'
      ? 'ring-9999'
      : productCategory === 'bar'
        ? 'sjc-bar'
        : null;
  const calculatorSupported = comparisonSet
    ? COMPARISON_SETS[comparisonSet].products.some(
        (candidate) =>
          candidate.companyId === companyId &&
          candidate.productId === productId &&
          candidate.eligibility === 'eligible',
      )
    : false;
  const productGroups = [...new Set(currentProducts.map((item) => item.group))];
  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/api/sjc?${new URLSearchParams({
        company: companyId,
        product: productId,
        view: 'history',
        range: range === '7N' ? '7N' : '1T',
      })}`,
      { cache: 'default', signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('Không thể tải lịch sử giá.');
        return (await response.json()) as MarketResponse;
      })
      .then((history) => {
        if (controller.signal.aborted) return;
        if (Array.isArray(history.records) && history.records.length) {
          setRecords((current) => mergeRecordsByDate(history.records, current));
          setHistorySource(history.historySource);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [companyId, productId, range]);

  const rollingData = useMemo(
    () => filterRecordsByCalendarWindow(records, selectedRange.days),
    [records, selectedRange.days],
  );
  const data = rollingData;
  const displayedHistorySource = historySource;
  const first = data[0] ?? null;
  const latestPoint = data.at(-1) ?? null;
  const previousPoint = data.at(-2) ?? latestPoint;
  const change = latestPoint && first ? latestPoint.sell - first.sell : 0;
  const percent = first?.sell ? (change / first.sell) * 100 : 0;
  const daySellChange =
    latestPoint && previousPoint ? latestPoint.sell - previousPoint.sell : 0;
  const dayBuyChange =
    latestPoint && previousPoint ? latestPoint.buy - previousPoint.buy : 0;
  const average =
    data.length > 0
      ? data.reduce((total, point) => total + point.sell, 0) / data.length
      : null;
  const isUptrend =
    average !== null && latestPoint !== null
      ? latestPoint.sell >= average
      : false;
  const currentQuote = latestQuote;
  const hasMarketData = Boolean(currentQuote && mode !== 'connecting');
  // Recalculate from timestamps on the browser clock: a CDN response may be old.
  const freshness = getMarketFreshness(
    { fetchedAt, observedAt, timestampKind },
    now,
  );
  const olderPublication =
    freshness.sourceAgeSeconds !== null && freshness.sourceAgeSeconds > 30 * 60;
  const sourceAge =
    freshness.sourceAgeSeconds !== null
      ? formatMarketAge(freshness.sourceAgeSeconds, english)
      : null;
  const formatTiming = (timestamp: string) => {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return '—';
    return new Intl.DateTimeFormat(english ? 'en-US' : 'vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    }).format(date);
  };

  const status =
    mode === 'connecting'
      ? { label: english ? 'Connecting' : 'Đang kết nối', tone: 'bg-amber-500' }
      : mode === 'live'
        ? {
            label: olderPublication
              ? english
                ? 'Latest published quote'
                : 'Giá công bố gần nhất'
              : english
                ? 'Data retrieved'
                : 'Đã lấy dữ liệu',
            tone: olderPublication ? 'bg-amber-500' : 'bg-emerald-500',
          }
        : mode === 'unavailable'
          ? {
              label: english ? 'No data' : 'Chưa có dữ liệu',
              tone: 'bg-red-500',
            }
          : mode === 'delayed'
            ? {
                label: english ? 'Historical data' : 'Dữ liệu lịch sử',
                tone: 'bg-amber-500',
              }
            : {
                label: english ? 'Fallback data' : 'Bản dự phòng',
                tone: 'bg-red-500',
              };
  const handleManualRefresh = useCallback(
    () => void refreshPrices(companyId, productId, true),
    [companyId, productId, refreshPrices],
  );

  const marketFilterControls = (
    <div className="market-filter-controls flex w-full min-w-0 flex-row gap-2 lg:max-w-[360px]">
      <label className="min-w-0 flex-1 text-xs font-semibold text-muted-foreground">
        {english ? 'Brand' : 'Thương hiệu'}
        <Select
          value={companyId}
          onValueChange={(value) => {
            if (!value) return;
            const nextCompanyId = value as MarketCompanyId;
            const nextProduct = getMarketProduct(nextCompanyId, null);
            invalidatePendingMarketRequest();
            setRecords([]);
            setLatestQuote(null);
            setTimestampKind('retrieval-or-date');
            setMode('connecting');
            setUnavailableReason(null);
            setCompanyId(nextCompanyId);
            setProductId(nextProduct.id);
            setProduct(nextProduct);
          }}
        >
          <SelectTrigger
            className="h-10 w-full"
            aria-label={english ? 'Select dealer' : 'Chọn công ty'}
          >
            <Landmark className="size-4 text-[var(--gold)]" />
            <SelectValue className="min-w-0 truncate">
              {displayedCompany.shortName}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end" className="min-w-[180px]">
            {MARKET_COMPANIES.filter(
              (company) => company.adapter !== 'unavailable',
            ).map((company) => (
              <SelectItem key={company.id} value={company.id}>
                {presentMarketCompany(company, locale).name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="min-w-0 flex-1 text-xs font-semibold text-muted-foreground">
        {english ? 'Gold type' : 'Loại vàng'}
        <Select
          value={productId}
          onValueChange={(value) => {
            if (!value) return;
            const nextProductId = value as MarketProductId;
            invalidatePendingMarketRequest();
            setRecords([]);
            setLatestQuote(null);
            setTimestampKind('retrieval-or-date');
            setMode('connecting');
            setUnavailableReason(null);
            setProductId(nextProductId);
            setProduct(getMarketProduct(companyId, nextProductId));
          }}
        >
          <SelectTrigger
            className="h-10 w-full"
            aria-label={
              english
                ? `Select a gold product from ${displayedCompany.name}`
                : `Chọn loại vàng ${displayedCompany.name}`
            }
          >
            <Gem className="size-4 text-[var(--gold)]" />
            <SelectValue className="min-w-0 truncate">
              {
                presentMarketProduct(
                  getMarketProduct(companyId, productId),
                  locale,
                ).label
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end" className="max-w-[calc(100vw-2rem)]">
            {productGroups.map((group) => (
              <SelectGroup key={group}>
                <SelectLabel>
                  {presentMarketCatalogText(group, locale)}
                </SelectLabel>
                {currentProducts
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <SelectItem
                      key={item.id}
                      value={item.id}
                      disabled={!isMarketProductSelectable(item)}
                    >
                      {presentMarketProduct(item, locale).label}
                    </SelectItem>
                  ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );

  const priceStatus = (
    <div
      className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      aria-live="polite"
      aria-label={english ? 'Price source status' : 'Trạng thái nguồn giá'}
    >
      <span
        className={`size-2 rounded-full ${status.tone}`}
        aria-hidden="true"
      />
      <span className="font-semibold text-foreground">{status.label}</span>
      {mode !== 'connecting' ? (
        <>
          <span aria-hidden="true">·</span>
          <span>
            {timestampKind === 'source'
              ? english
                ? 'Source published'
                : 'Công bố'
              : english
                ? 'Observed'
                : 'Ghi nhận'}
            : {formatTiming(observedAt)}
            {sourceAge ? ` (${sourceAge})` : ''}
          </span>
        </>
      ) : null}
    </div>
  );

  const quickTools = (
    <section
      className="my-6 grid gap-3 sm:grid-cols-3"
      aria-label={english ? 'Quick gold tools' : 'Làm gì tiếp theo'}
    >
      <Link
        href={`/so-vang?company=${companyId}&product=${productId}&side=buy#so-vang-entry`}
        className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-4 text-base font-semibold hover:border-primary/50"
      >
        {english ? 'Record a transaction' : 'Ghi giao dịch mua hoặc bán'}
      </Link>
      <Link
        href={`/cong-cu-vang?tool=so-sanh&set=${comparisonSet}&direction=buy&products=${companyId}%3A${productId}#so-sanh`}
        className="rounded-2xl border border-border bg-[var(--surface-solid)] px-4 py-4 text-base font-semibold hover:border-primary/40"
      >
        {english ? 'Compare dealer prices' : 'So sánh giá các hãng'}
      </Link>
      {calculatorSupported ? (
        <Link
          href={`/cong-cu-vang?tool=lai-lo&company=${companyId}&product=${productId}#hoa-von`}
          className="rounded-2xl border border-border bg-[var(--surface-solid)] px-4 py-4 text-base font-semibold hover:border-primary/40"
        >
          {english ? 'Estimate profit or loss' : 'Ước tính lãi hoặc lỗ'}
        </Link>
      ) : (
        <div className="rounded-2xl border border-amber-300/60 bg-amber-50/60 px-4 py-4 text-base font-semibold text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/20 dark:text-amber-100">
          {english
            ? 'Calculator not available for this product'
            : 'Chưa tính được sản phẩm này'}
          <span className="mt-1 block text-sm font-normal text-amber-900/75 dark:text-amber-100/75">
            {english
              ? 'Choose a supported plain ring or gold bar to continue.'
              : 'Chọn nhẫn trơn hoặc vàng miếng thuộc nhóm được hỗ trợ.'}
          </span>
        </div>
      )}
    </section>
  );

  return (
    <div className="min-h-screen">
      <DashboardHeaderControls
        companyId={companyId}
        productId={productId}
        range={range}
        isRefreshing={isRefreshing}
        onRefresh={handleManualRefresh}
        locale={locale}
      />
      <PageTransition>
        <main
          id="main-content"
          tabIndex={-1}
          className="market-main mx-auto max-w-[1280px] px-4 py-5 sm:px-6 lg:px-10 lg:py-7"
        >
          <section className="market-intro mb-4" aria-labelledby="market-title">
            <h1
              id="market-title"
              className="max-w-3xl font-heading text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl"
            >
              {english ? 'Vietnam gold prices today' : 'Giá vàng hôm nay'}
            </h1>
          </section>
          <section
            className="market-selection mb-4 rounded-2xl border border-border bg-[var(--surface-solid)] p-3 shadow-sm sm:p-4"
            aria-label={english ? 'Choose gold price' : 'Chọn giá vàng'}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <p className="sr-only">
                  {english
                    ? 'Choose a brand and gold type'
                    : 'Chọn thương hiệu và loại vàng'}
                </p>
                {marketFilterControls}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <fieldset className="flex rounded-xl border border-border bg-muted/50 p-1">
                  <legend className="sr-only">
                    {english ? 'Display unit' : 'Đơn vị hiển thị'}
                  </legend>
                  {(['luong', 'chi'] as const).map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      aria-pressed={displayUnit === unit}
                      onClick={() => setDisplayUnit(unit)}
                      className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${displayUnit === unit ? 'bg-[var(--surface-solid)] text-primary shadow-sm' : 'text-muted-foreground'}`}
                    >
                      {unit === 'luong'
                        ? english
                          ? 'Lượng'
                          : 'Lượng'
                        : english
                          ? 'Chỉ'
                          : 'Chỉ'}
                    </button>
                  ))}
                </fieldset>
                <Button
                  variant="outline"
                  className="min-h-11 gap-2 px-3"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  aria-label={english ? 'Update price' : 'Cập nhật giá'}
                >
                  {isRefreshing ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  <span>{english ? 'Update price' : 'Cập nhật giá'}</span>
                </Button>
              </div>
            </div>
          </section>
          <ChartEntryViewport>
            {mode !== 'live' || olderPublication ? (
              <div className="mb-3 flex items-start gap-2 rounded-[16px] border border-amber-400/35 bg-amber-100/55 px-3 py-2 text-xs leading-5 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
                {mode === 'live' ? (
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                ) : (
                  <WifiOff className="mt-0.5 size-3.5 shrink-0" />
                )}
                {mode === 'connecting'
                  ? english
                    ? 'Connecting to the market-price source…'
                    : 'Đang kết nối tới nguồn giá thị trường…'
                  : mode === 'unavailable'
                    ? (displayedUnavailableReason ??
                      (english
                        ? `${displayedCompany.name} has no available price data.`
                        : `${selectedCompany.name} chưa có dữ liệu giá khả dụng.`))
                    : mode === 'fallback'
                      ? english
                        ? 'The latest historical snapshot is shown and is not treated as a current price.'
                        : 'Đang hiển thị dữ liệu lưu gần nhất; hãy đối chiếu lại trước khi giao dịch.'
                      : mode === 'delayed'
                        ? english
                          ? 'Showing the latest available historical data.'
                          : 'Đang hiển thị dữ liệu lịch sử gần nhất.'
                        : english
                          ? `Check the publication time before trading.`
                          : `Hãy đối chiếu thời điểm công bố trước khi giao dịch.`}
              </div>
            ) : null}

            {hasMarketData ? (
              <>
                <PriceChart
                  key={`${companyId}-${productId}`}
                  companyId={companyId}
                  productId={productId}
                  data={data}
                  productLabel={displayedProduct.shortLabel}
                  rangeLabel={
                    english
                      ? range === '7N'
                        ? '7 days'
                        : '1 month'
                      : selectedRange.label
                  }
                  range={range}
                  locale={locale}
                  displayUnit={displayUnit}
                  historySource={displayedHistorySource}
                  onRangeChange={setRange}
                />
                {priceStatus}
                <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <article className="metric-card metric-card--gold metric-card--quote sm:col-span-2 xl:col-span-2">
                    <div className="metric-quote-row">
                      <div className="flex items-start justify-between">
                        <p className="metric-label">
                          {english ? 'Dealer sells' : 'Cửa hàng bán ra'}
                        </p>
                        <ChangeBadge
                          value={daySellChange}
                          displayUnit={displayUnit}
                          english={english}
                        />
                      </div>
                      <p className="metric-value">
                        {formatVnd(currentQuote?.sell, displayUnit)}
                        <span className="metric-value__unit">
                          {displayUnitLabel(displayUnit, english)}
                        </span>
                      </p>
                    </div>
                    <div className="metric-quote-row mt-4 border-t border-border/70 pt-4">
                      <div className="flex items-start justify-between">
                        <p className="metric-label">
                          {english ? 'Dealer buys' : 'Cửa hàng mua vào'}
                        </p>
                        <ChangeBadge
                          value={dayBuyChange}
                          displayUnit={displayUnit}
                          english={english}
                        />
                      </div>
                      <p className="metric-value">
                        {formatVnd(currentQuote?.buy, displayUnit)}
                        <span className="metric-value__unit">
                          {displayUnitLabel(displayUnit, english)}
                        </span>
                      </p>
                    </div>
                  </article>
                  <article className="metric-card">
                    <div className="flex items-start justify-between">
                      <p className="metric-label">
                        {english
                          ? 'Buy–sell difference'
                          : 'Chênh lệch giá mua và bán'}
                      </p>
                      <span className="status-badge">
                        {english ? 'Current' : 'Hiện tại'}
                      </span>
                    </div>
                    <p className="metric-value">
                      {formatVnd(
                        currentQuote
                          ? currentQuote.sell - currentQuote.buy
                          : null,
                        displayUnit,
                      )}
                      <span className="metric-value__unit">
                        {displayUnitLabel(displayUnit, english)}
                      </span>
                    </p>
                    <p className="metric-unit">
                      {english
                        ? 'Before making charges'
                        : 'Chưa tính phí gia công'}
                    </p>
                  </article>
                  <article className="metric-card metric-card--signal">
                    <div className="flex items-start justify-between">
                      <p className="metric-label">
                        {english
                          ? 'Change in the period'
                          : 'Thay đổi trong thời gian đang xem'}
                      </p>
                      {isUptrend ? (
                        <TrendingUp className="size-5 text-emerald-700 dark:text-emerald-300" />
                      ) : (
                        <TrendingDown className="size-5 text-red-700 dark:text-red-300" />
                      )}
                    </div>
                    <p
                      className={`mt-7 text-xl font-semibold tracking-[-0.03em] ${isUptrend ? 'text-emerald-900 dark:text-emerald-200' : 'text-red-900 dark:text-red-200'}`}
                    >
                      {percent >= 0
                        ? english
                          ? `Up ${percent.toFixed(1)}%`
                          : `Tăng ${percent.toFixed(1)}%`
                        : english
                          ? `Down ${Math.abs(percent).toFixed(1)}%`
                          : `Giảm ${Math.abs(percent).toFixed(1)}%`}
                    </p>
                    <p className="metric-unit">
                      {english
                        ? 'Compared with the first price in this period'
                        : 'So với giá đầu kỳ đã chọn'}
                    </p>
                  </article>
                </section>

                {quickTools}
              </>
            ) : mode === 'connecting' ? (
              <MarketSkeleton />
            ) : (
              <UnavailablePanel
                companyName={displayedCompany.name}
                productName={displayedProduct.label}
                reason={displayedUnavailableReason}
                locale={locale}
              />
            )}
          </ChartEntryViewport>

          {!hasMarketData && priceStatus}

          <section
            className="ai-home-panel mb-6 mt-6 rounded-3xl border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_8%,var(--surface-solid))] p-5 shadow-sm sm:p-6"
            aria-labelledby="home-ai-title"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-primary">
                  <Sparkles className="size-4" aria-hidden="true" />
                  {english ? 'Phân tích AI' : 'Phân tích AI'}
                </p>
                <h2
                  id="home-ai-title"
                  className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em]"
                >
                  {english
                    ? 'Understand today’s gold price in plain language'
                    : 'Hiểu giá vàng hôm nay bằng lời dễ hiểu'}
                </h2>
              </div>
              <AnalysisRouteLink
                companyId={companyId}
                productId={productId}
                range={range}
                preset="today"
                className="glass-action min-h-13 shrink-0 justify-center rounded-2xl border-primary/30 bg-primary px-5 text-base font-semibold text-primary-foreground shadow-sm"
              />
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              <Link
                href={analysisHref(companyId, productId, range, 'today')}
                className="rounded-2xl border border-border bg-[var(--surface-solid)] px-4 py-3 text-sm font-semibold transition-colors hover:border-primary/40"
              >
                {english
                  ? 'How did today’s price move?'
                  : 'Giá vàng hôm nay biến động thế nào?'}
              </Link>
              <Link
                href={analysisHref(companyId, productId, range, 'buy')}
                className="rounded-2xl border border-border bg-[var(--surface-solid)] px-4 py-3 text-sm font-semibold transition-colors hover:border-primary/40"
              >
                {english
                  ? 'I want to buy gold'
                  : 'Tôi muốn mua vàng, cần tính những gì?'}
              </Link>
              <Link
                href={analysisHref(companyId, productId, range, 'hold')}
                className="rounded-2xl border border-border bg-[var(--surface-solid)] px-4 py-3 text-sm font-semibold transition-colors hover:border-primary/40"
              >
                {english
                  ? 'Is my gold holding up or down?'
                  : 'Vàng tôi đang giữ đang lãi hay lỗ?'}
              </Link>
            </div>
          </section>

          <div
            className="market-source-note"
            aria-label={
              english ? 'Price-data source' : 'Nguồn dữ liệu bảng giá'
            }
          >
            <p>
              <ShieldCheck className="size-3.5 shrink-0 text-emerald-700" />
              {mode === 'fallback'
                ? english
                  ? 'Latest saved data'
                  : 'Dữ liệu lưu gần nhất'
                : english
                  ? 'Price source'
                  : 'Nguồn giá'}
              : {presentMarketCatalogText(source.provider, locale)} ·{' '}
              {english ? 'History' : 'Lịch sử'}:{' '}
              {presentMarketCatalogText(
                displayedHistorySource.provider,
                locale,
              )}
              .{' '}
              {english
                ? 'Refreshes automatically every 4 minutes.'
                : 'Tự động làm mới mỗi 4 phút.'}
            </p>
            <div>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer">
                  {english ? 'Check source' : 'Đối chiếu nguồn'}
                </a>
              ) : null}
              <Link href="/terms#mien-tru-trach-nhiem" prefetch={false}>
                {english ? 'Informational use' : 'Tính chất tham khảo'}
              </Link>
            </div>
          </div>
          {worldGoldSection}
          {editorialSection}
        </main>
      </PageTransition>
    </div>
  );
}

type DashboardControlsProps = {
  companyId: MarketCompanyId;
  productId: MarketProductId;
  range: Range;
  isRefreshing: boolean;
  onRefresh: () => void;
  locale: 'vi' | 'en';
};

function DashboardHeaderControls(props: DashboardControlsProps) {
  const { setDashboardActions } = useHeaderActions();
  const { companyId, productId, range, isRefreshing, onRefresh, locale } =
    props;
  const refreshLabel =
    locale === 'en'
      ? isRefreshing
        ? 'Updating prices'
        : 'Refresh prices'
      : isRefreshing
        ? 'Đang cập nhật giá'
        : 'Làm mới giá';
  const actions = useMemo(
    () => ({
      analysis: (
        <AnalysisRouteLink
          companyId={companyId}
          productId={productId}
          range={range}
        />
      ),
      analysisHref: analysisHref(companyId, productId, range),
      refresh: (
        <Button
          variant="outline"
          size="icon"
          aria-label={refreshLabel}
          title={refreshLabel}
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </Button>
      ),
    }),
    [companyId, productId, range, isRefreshing, onRefresh, refreshLabel],
  );

  useEffect(() => {
    setDashboardActions(actions);
    return () => setDashboardActions(null);
  }, [actions, setDashboardActions]);

  return null;
}

function UnavailablePanel({
  companyName,
  productName,
  reason,
  locale,
}: {
  companyName: string;
  productName: string;
  reason: string | null;
  locale: 'vi' | 'en';
}) {
  const english = locale === 'en';
  return (
    <section className="rounded-[22px] border border-dashed border-border bg-card p-8 text-center shadow-sm sm:p-12">
      <WifiOff className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-4 font-heading text-xl font-semibold">
        {english ? `No ${companyName} data` : `Chưa có dữ liệu ${companyName}`}
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        {english
          ? `${productName} has no available price record from its registered source.`
          : `${productName} chưa có bản ghi giá khả dụng từ nguồn đã đăng ký.`}
        {reason ? ` ${reason}` : ''}
      </p>
      <p className="mt-4 text-xs text-muted-foreground">
        {english
          ? 'Try again later or choose another dealer or product.'
          : 'Hãy thử lại sau hoặc chọn một nguồn/sản phẩm khác.'}
      </p>
    </section>
  );
}

function ChangeBadge({
  value,
  displayUnit,
  english,
}: {
  value: number;
  displayUnit: DisplayUnit;
  english: boolean;
}) {
  const change = Math.abs(value) / (displayUnit === 'chi' ? 10 : 1);
  const label = new Intl.NumberFormat(english ? 'en-US' : 'vi-VN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(change);
  const unit =
    displayUnit === 'chi'
      ? english
        ? 'million / chỉ'
        : 'triệu / chỉ'
      : english
        ? 'million / lượng'
        : 'triệu / lượng';
  const direction =
    value >= 0 ? (english ? 'rose' : 'tăng') : english ? 'fell' : 'giảm';
  return (
    <span
      aria-label={
        english
          ? `Price ${direction} ${label} ${unit} compared with the previous session`
          : `Giá ${direction} ${label} ${unit} so với phiên trước`
      }
      className={`status-badge ${value >= 0 ? 'status-badge--up' : 'status-badge--down'}`}
    >
      {value >= 0 ? (
        <ArrowUpRight aria-hidden="true" />
      ) : (
        <ArrowDownRight aria-hidden="true" />
      )}
      <span>
        {label} {unit}
      </span>
    </span>
  );
}
