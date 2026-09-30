'use client';

import {
  type ReactNode,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CartesianGrid,
  type DotItemDotProps,
  type LabelProps,
  LabelList,
  Line,
  LineChart,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
} from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  PRICE_CHART_RANGES,
  chooseResponsiveLabelLayout,
  getPriceRangeStats,
  type PriceChartRange,
  type PricePoint,
} from '@/lib/price-chart';
import type {
  MarketHistoryCapability,
  MarketHistoryResponse,
} from '@/lib/market-history';
import type { Locale } from '@/lib/i18n';

const shortDate = (value: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(`${value}T00:00:00`));

const fullDate = (value: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));

const annualHistoryErrorTranslations: Record<
  string,
  { en: string; vi: string }
> = {
  'Không thể tải lịch sử năm.': {
    en: 'Unable to load annual history.',
    vi: 'Không thể tải lịch sử năm.',
  },
  'Failed to fetch': {
    en: 'Unable to load annual history.',
    vi: 'Không thể tải lịch sử năm.',
  },
};

const annualHistoryProviderTranslations: Record<string, string> = {
  'Bản lịch sử dự phòng': 'Fallback history',
  'Chưa có dữ liệu lịch sử khả dụng': 'No history data available',
};

function localizeAnnualHistoryError(error: string, english: boolean) {
  const translation = annualHistoryErrorTranslations[error.trim()];
  return translation?.[english ? 'en' : 'vi'] ??
    (english ? 'Unable to load annual history.' : 'Không thể tải lịch sử năm.');
}

function localizeAnnualHistoryProvider(provider: string, english: boolean) {
  return english
    ? (annualHistoryProviderTranslations[provider] ?? provider)
    : provider;
}

type ChartPoint = Omit<PricePoint, 'buy' | 'sell' | 'spread'> & {
  buy: number | null;
  sell: number | null;
  spread: number | null;
  sellLabel: string;
  buyLabel: string;
};

const chartMargins = { top: 28, right: 28, left: 28, bottom: 28 } as const;
const compactChartMargins = {
  top: 24,
  right: 16,
  left: 16,
  bottom: 24,
} as const;

function ResponsivePriceLines({
  data,
  labelData,
  animate,
  reduceMotion,
}: {
  data: ChartPoint[];
  labelData: PricePoint[];
  animate: boolean;
  reduceMotion: boolean;
}) {
  const plotArea = usePlotArea();
  const xScale = useXAxisScale();
  const yScale = useYAxisScale('price');
  const labelLayout = useMemo(() => {
    if (!plotArea || !xScale || !yScale || !labelData.length) return null;

    return chooseResponsiveLabelLayout(
      labelData,
      0,
      labelData.length - 1,
      plotArea,
      (index) => xScale(labelData[index]?.date),
      (series, index) => yScale(labelData[index]?.[series]),
    );
  }, [labelData, plotArea, xScale, yScale]);
  const labelDates = useMemo(
    () => ({
      sell: new Set(
        labelData
          .filter((_, index) => labelLayout?.sell.has(index))
          .map((point) => point.date),
      ),
      buy: new Set(
        labelData
          .filter((_, index) => labelLayout?.buy.has(index))
          .map((point) => point.date),
      ),
    }),
    [labelData, labelLayout],
  );
  const placements = useMemo(
    () => ({
      sell: new Map(
        labelData
          .map(
            (point, index) =>
              [point.date, labelLayout?.sellPlacement.get(index)] as const,
          )
          .filter(
            (entry): entry is readonly [string, 'top' | 'bottom'] =>
              entry[1] !== undefined,
          ),
      ),
      buy: new Map(
        labelData
          .map(
            (point, index) =>
              [point.date, labelLayout?.buyPlacement.get(index)] as const,
          )
          .filter(
            (entry): entry is readonly [string, 'top' | 'bottom'] =>
              entry[1] !== undefined,
          ),
      ),
    }),
    [labelData, labelLayout],
  );

  const dense = Boolean(
    plotArea && plotArea.width / Math.max(1, labelData.length - 1) < 16,
  );
  const renderDot = (series: 'sell' | 'buy') =>
    function PriceDot(props: DotItemDotProps) {
      const point = props.payload as ChartPoint | undefined;
      if (!point || point[series] === null) return null;
      if (dense && !labelDates[series].has(point.date)) return null;

      return (
        <circle
          cx={props.cx}
          cy={props.cy}
          r={3}
          fill="var(--surface-solid)"
          stroke={props.stroke ?? 'currentColor'}
          strokeWidth={2}
        />
      );
    };
  const renderLabel = (series: 'sell' | 'buy', color: string) =>
    function PriceLabel(props: LabelProps & { index?: number }) {
      const index = Number(props.index);
      const point = data[index];
      if (
        !point ||
        point[series] === null ||
        !labelDates[series].has(point.date)
      )
        return null;
      const placement = placements[series].get(point.date);
      const pointX = xScale?.(point.date) ?? props.x;
      const pointY = yScale?.(point[series]) ?? props.y;
      const safePointY = Number(pointY ?? 0);

      return (
        <text
          x={pointX}
          y={placement === 'top' ? safePointY - 8 : safePointY + 8}
          textAnchor="middle"
          dominantBaseline={placement === 'top' ? 'auto' : 'hanging'}
          fill={color}
          fontSize={12}
          fontWeight={600}
        >
          {point[series].toFixed(1)}
        </text>
      );
    };

  return (
    <>
      <Line
        yAxisId="price"
        type="linear"
        dataKey="sell"
        stroke="var(--color-sell)"
        strokeWidth={2.5}
        dot={renderDot('sell')}
        activeDot={{ r: 5, strokeWidth: 3 }}
        isAnimationActive={animate && !reduceMotion}
        animationDuration={reduceMotion ? 0 : 200}
        animationEasing="ease-out"
      >
        <LabelList
          dataKey="sell"
          content={renderLabel('sell', 'var(--color-sell)')}
          position="top"
          offset={8}
          fill="var(--color-sell)"
          fontSize={12}
          fontWeight={600}
        />
      </Line>
      <Line
        yAxisId="price"
        type="linear"
        dataKey="buy"
        stroke="var(--color-buy)"
        strokeWidth={2}
        dot={renderDot('buy')}
        activeDot={{ r: 5, strokeWidth: 3 }}
        isAnimationActive={animate && !reduceMotion}
        animationDuration={reduceMotion ? 0 : 200}
        animationEasing="ease-out"
      >
        <LabelList
          dataKey="buy"
          content={renderLabel('buy', 'var(--color-buy)')}
          position="bottom"
          offset={8}
          fill="var(--color-buy)"
          fontSize={12}
          fontWeight={600}
        />
      </Line>
    </>
  );
}

ResponsivePriceLines.displayName = 'ResponsivePriceLines';

export function PriceChart({
  data,
  productLabel,
  rangeLabel,
  range,
  locale,
  displayUnit = 'luong',
  onRangeChange,
  filterControls,
  annualHistory,
  annualCapability = 'annual',
  annualLoading = false,
  annualError = null,
  animate = false,
}: {
  data: PricePoint[];
  productLabel: string;
  rangeLabel: string;
  range: PriceChartRange;
  locale: Locale;
  displayUnit?: 'luong' | 'chi';
  onRangeChange: (range: PriceChartRange) => void;
  filterControls?: ReactNode;
  annualHistory?: MarketHistoryResponse | null;
  annualCapability?: MarketHistoryCapability;
  annualLoading?: boolean;
  annualError?: string | null;
  animate?: boolean;
}) {
  const english = locale === 'en';
  const displayDivisor = displayUnit === 'chi' ? 10 : 1;
  const chartUnit = displayUnit === 'chi'
    ? (english ? 'million VND / chỉ' : 'triệu đồng / chỉ')
    : (english ? 'million VND / lượng' : 'triệu đồng / lượng');
  const chartConfig = {
    sell: {
      label: english ? 'Dealer sell price' : 'Cửa hàng bán ra',
      color: 'var(--chart-1)',
    },
    buy: {
      label: english ? 'Dealer buy price' : 'Cửa hàng mua vào',
      color: 'var(--chart-2)',
    },
  } satisfies ChartConfig;
  const [keyboardIndex, setKeyboardIndex] = useState<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [touchTooltipDismissed, setTouchTooltipDismissed] = useState(false);
  const chartSurfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reset = window.setTimeout(() => {
      setKeyboardIndex(null);
      setTouchTooltipDismissed(false);
    }, 0);
    return () => window.clearTimeout(reset);
  }, [data, productLabel, range]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(hover: none) and (pointer: coarse)');
    const sync = () => setIsTouchDevice(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 419px)');
    const sync = () => setIsNarrowViewport(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!isTouchDevice) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!chartSurfaceRef.current?.contains(event.target as Node)) {
        setTouchTooltipDismissed(true);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setTouchTooltipDismissed(true);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isTouchDevice]);

  const visibleData = useMemo(
    () => data.map((point) => ({
      ...point,
      buy: point.buy / displayDivisor,
      sell: point.sell / displayDivisor,
      spread: point.spread / displayDivisor,
    })),
    [data, displayDivisor],
  );
  const safeStartIndex = 0;
  const safeEndIndex = Math.max(0, visibleData.length - 1);
  const stats = getPriceRangeStats(visibleData, safeStartIndex, safeEndIndex);
  const chartData = useMemo(() => {
    const actualDates = new Set(visibleData.map((point) => point.date));
    return [
      ...visibleData.map<ChartPoint>((point) => ({
        ...point,
        sellLabel: '',
        buyLabel: '',
      })),
      ...(annualHistory?.missingDates ?? [])
        .filter((date) => !actualDates.has(date))
        .map<ChartPoint>((date) => ({
          date,
          buy: null,
          sell: null,
          spread: null,
          eventId: null,
          sellLabel: '',
          buyLabel: '',
        })),
    ].sort((left, right) => left.date.localeCompare(right.date));
  }, [annualHistory?.missingDates, visibleData]);

  const firstDate = visibleData[0]?.date;
  const lastDate = visibleData.at(-1)?.date;
  const dateRange =
    firstDate && lastDate
      ? `${fullDate(firstDate, locale)} – ${fullDate(lastDate, locale)}`
      : english ? 'No available dates' : 'Chưa có ngày dữ liệu';
  const annualDisabled = annualCapability !== 'annual';
  const annualMessage =
    range !== '1N'
      ? null
      : annualLoading
        ? english ? 'Loading stored annual history.' : 'Đang tải lịch sử năm đã lưu.'
        : annualError
          ? `${localizeAnnualHistoryError(annualError, english)} ${english ? 'Showing available source data.' : 'Đang hiển thị dữ liệu nguồn hiện có.'}`
          : annualHistory?.status === 'partial'
            ? english
              ? `Incomplete history: ${annualHistory.availableDays}/${annualHistory.expectedDays} days have prices.`
              : `Lịch sử chưa đầy đủ: ${annualHistory.availableDays}/${annualHistory.expectedDays} ngày có giá.`
            : annualHistory?.status === 'unavailable'
              ? english ? 'Annual history is not ready; showing available source data.' : 'Lịch sử năm chưa sẵn sàng; đang hiển thị dữ liệu nguồn hiện có.'
              : annualHistory
                ? english
                  ? `Annual history: ${annualHistory.availableDays}/${annualHistory.expectedDays} days have prices${annualHistory.source ? ` · ${localizeAnnualHistoryProvider(annualHistory.source.provider, english)}` : ''}.`
                  : `Lịch sử năm: ${annualHistory.availableDays}/${annualHistory.expectedDays} ngày có giá${annualHistory.source ? ` · ${annualHistory.source.provider}` : ''}.`
                : null;

  const handleChartKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!data.length) return;
    const currentIndex = keyboardIndex ?? safeStartIndex;
    const nextIndex =
      event.key === 'ArrowLeft'
        ? Math.max(safeStartIndex, currentIndex - 1)
        : event.key === 'ArrowRight'
          ? Math.min(safeEndIndex, currentIndex + 1)
          : event.key === 'Home'
            ? safeStartIndex
            : event.key === 'End'
              ? safeEndIndex
              : null;
    if (nextIndex === null) return;
    event.preventDefault();
    setKeyboardIndex(nextIndex);
  };

  if (!data.length) {
    return (
      <article className="glass-panel min-w-0 p-4 sm:p-6">
        <h2 className="font-heading text-lg font-semibold">
          {english ? `${productLabel} price chart` : `Biểu đồ giá ${productLabel.toLowerCase()}`}
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          {english ? 'No data is available for this period.' : 'Chưa có dữ liệu trong khoảng thời gian này.'}
        </p>
      </article>
    );
  }

  return (
    <article
      className="glass-panel min-w-0 p-4 sm:p-6"
      aria-label={english ? `${productLabel} price chart for ${rangeLabel}` : `Biểu đồ giá ${productLabel} trong ${rangeLabel}`}
    >
      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">
            {english ? `${productLabel} price chart` : `Biểu đồ giá ${productLabel.toLowerCase()}`}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
          {dateRange} · {chartUnit} · {visibleData.length} {english ? 'sessions shown' : 'phiên đang xem'}
          </p>
          <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">
            {english ? 'Dealer sell is what you pay when buying; dealer buy is what the dealer pays when buying back from you.' : 'Giá bán ra là số tiền bạn trả khi mua; giá mua vào là số tiền cửa hàng trả khi bạn bán.'}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-medium text-muted-foreground lg:mt-6">
            <span className="flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-[var(--chart-1)]" /> {english ? 'Dealer sell price' : 'Cửa hàng bán ra'}
            </span>
            <span className="flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-[var(--chart-2)]" /> {english ? 'Dealer buy price' : 'Cửa hàng mua vào'}
            </span>
          </div>
        </div>
        <div className="flex w-full min-w-0 flex-col items-stretch gap-2 lg:items-end">
          {filterControls}
          <fieldset className="flex w-fit self-end rounded-full border border-border bg-muted/55 p-1">
            <legend className="sr-only">{english ? 'Chart period' : 'Khoảng thời gian biểu đồ'}</legend>
            {PRICE_CHART_RANGES.map((item) => (
              <button
                key={item.value}
                type="button"
                disabled={item.value === '1N' && annualDisabled}
                onClick={() => onRangeChange(item.value)}
                aria-pressed={range === item.value}
                title={
                  item.value === '1N' && annualDisabled
                    ? annualCapability === 'snapshot'
                      ? (english ? 'This source has only a current price.' : 'Nguồn này chỉ có giá hiện tại.')
                      : (english ? `This source has only ${annualCapability.replace('rolling-', '')} days of history.` : `Nguồn này chỉ có lịch sử ${annualCapability.replace('rolling-', '')} ngày.`)
                    : undefined
                }
                className={`min-h-11 rounded-full px-3.5 py-2 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4 ${
                  range === item.value
                    ? 'bg-[var(--surface-solid)] text-foreground shadow-[var(--glass-shadow-active)]'
                    : 'text-muted-foreground hover:text-foreground'
                } disabled:cursor-not-allowed disabled:opacity-45`}
              >
                {english
                  ? { '7N': '7 days', '1T': '1 month', '1N': '1 year' }[item.value]
                  : item.label}
              </button>
            ))}
          </fieldset>
          {annualMessage ? (
            <p className="max-w-[360px] text-right text-[11px] leading-4 text-muted-foreground">
              {annualMessage}
            </p>
          ) : null}
        </div>
      </div>

      <div
        ref={chartSurfaceRef}
        className="min-w-0"
        onPointerDown={() => setTouchTooltipDismissed(false)}
      >
        {data.length < 2 ? (
          <output className="flex h-[288px] flex-col items-center justify-center rounded-[18px] border border-dashed border-border bg-muted/30 px-6 text-center sm:h-[378px]">
            <p className="text-sm font-semibold">
              {english ? 'Not enough data to draw a price line' : 'Chưa đủ dữ liệu để vẽ đường giá'}
            </p>
            <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
              {english ? 'Waiting for more price sessions in the selected period. The latest price remains visible in the metrics above.' : 'Đang chờ thêm phiên giá trong khoảng thời gian đã chọn. Giá gần nhất vẫn hiển thị ở phần chỉ số phía trên.'}
            </p>
          </output>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="h-[288px] w-full min-w-0 sm:h-[378px]"
            initialDimension={{ width: 800, height: 378 }}
          >
            <LineChart
              data={chartData}
              margin={isNarrowViewport ? compactChartMargins : chartMargins}
            >
              <CartesianGrid
                vertical={false}
                stroke="var(--border)"
                strokeOpacity={0.7}
              />
              <XAxis
                dataKey="date"
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                minTickGap={isNarrowViewport ? 24 : 38}
                tickMargin={isNarrowViewport ? 8 : 12}
                tick={{
                  fontSize: isNarrowViewport ? 11 : 13,
                  fill: 'var(--muted-foreground)',
                }}
                tickFormatter={(value) => shortDate(String(value), locale)}
              />
              <YAxis
                yAxisId="price"
                orientation="right"
                axisLine={false}
                tickLine={false}
                width={isNarrowViewport ? 44 : 52}
                tickMargin={isNarrowViewport ? 5 : 8}
                tickCount={isNarrowViewport ? 4 : 5}
                domain={['dataMin - 1', 'dataMax + 1']}
                tick={{ fontSize: 13, fill: 'var(--muted-foreground)' }}
                tickFormatter={(value) => Number(value).toFixed(1)}
              />
              <ChartTooltip
                active={isTouchDevice ? !touchTooltipDismissed : undefined}
                trigger={isTouchDevice ? 'click' : 'hover'}
                cursor={{ stroke: 'var(--primary)', strokeDasharray: '4 4' }}
                allowEscapeViewBox={{ x: false, y: false }}
                offset={{ x: 8, y: 8 }}
                wrapperStyle={{ maxWidth: 'calc(100% - 16px)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0].payload as ChartPoint;
                  if (point.buy === null || point.sell === null) return null;
                  return (
                    <div className="glass-menu w-max max-w-[min(220px,calc(100vw-32px))] min-w-48 p-3">
                      <p className="mb-2 text-xs font-semibold">
                        {fullDate(point.date, locale)}
                      </p>
                      <div className="space-y-1.5 text-xs">
                        <p className="flex justify-between gap-6 text-muted-foreground">
                          <span>{english ? 'Dealer sell' : 'Cửa hàng bán ra'}</span>
                          <b className="text-foreground">
                            {point.sell.toFixed(2)} {english ? 'm' : 'tr'}
                          </b>
                        </p>
                        <p className="flex justify-between gap-6 text-muted-foreground">
                          <span>{english ? 'Dealer buy' : 'Cửa hàng mua vào'}</span>
                          <b className="text-foreground">
                            {point.buy.toFixed(2)} {english ? 'm' : 'tr'}
                          </b>
                        </p>
                      </div>
                    </div>
                  );
                }}
              />
              <ResponsivePriceLines
                data={chartData}
                labelData={visibleData}
                animate={animate}
                reduceMotion={reduceMotion}
              />
            </LineChart>
          </ChartContainer>
        )}
      </div>

      {data.length > 1 ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{english ? 'Tap the chart to view prices.' : 'Chạm vào biểu đồ để xem giá.'}</span>
          <button
            type="button"
            className="min-h-11 rounded-full border border-transparent px-3 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onKeyDown={handleChartKeyDown}
            aria-label={english ? 'Use ← → to inspect points on the chart' : 'Dùng phím ← → để xem từng điểm trên biểu đồ'}
          >
            {english ? 'Use ← → to inspect points' : 'Dùng phím ← → để xem từng điểm'}
          </button>
        </div>
      ) : null}

      {keyboardIndex !== null && data[keyboardIndex] ? (
        <output className="mt-2 block text-xs text-muted-foreground">
          {fullDate(data[keyboardIndex].date, locale)} · {english ? 'Dealer sell' : 'Bán ra'}{' '}
          {visibleData[keyboardIndex].sell.toFixed(2)} {english ? 'm' : 'tr'} · {english ? 'Dealer buy' : 'Mua vào'}{' '}
          {visibleData[keyboardIndex].buy.toFixed(2)} {english ? 'm' : 'tr'} · {chartUnit}
        </output>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 border-t border-border/70 pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          {english ? `Change over ${rangeLabel}` : `Biến động ${rangeLabel}`}
          {annualHistory?.status === 'partial' ? (english ? ' using available data' : ' trên dữ liệu hiện có') : ''}:{' '}
          <b
            className={stats.change >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}
          >
            {stats.change >= 0 ? '+' : ''}
            {stats.change.toFixed(1)} {english ? 'million' : 'triệu'} / {displayUnit === 'chi' ? 'chỉ' : 'lượng'} ({stats.percent >= 0 ? '+' : ''}
            {stats.percent.toFixed(1)}%)
          </b>
        </span>
        <span>
          {english ? 'Highest dealer sell' : 'Giá bán cao nhất'} {stats.highestSell?.toFixed(1) ?? '—'} {english ? 'm' : 'tr'} · {english ? 'lowest' : 'thấp nhất'}{' '}
          {stats.lowestSell?.toFixed(1) ?? '—'} {english ? 'm' : 'tr'} / {displayUnit === 'chi' ? 'chỉ' : 'lượng'}
        </span>
      </div>
    </article>
  );
}
