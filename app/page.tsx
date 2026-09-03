'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  ExternalLink,
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
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart';
import fallbackDataset from '@/lib/sjc-data.json';

type Range = '7N' | '1T' | '1N';
type DataMode = 'connecting' | 'live' | 'delayed' | 'fallback';
type PricePoint = {
  date: string;
  buy: number;
  sell: number;
  spread: number;
  eventId: null;
};
type MarketResponse = {
  mode: Exclude<DataMode, 'connecting'>;
  records: PricePoint[];
  observedAt: string;
  source: { provider: string; url: string | null; official: boolean };
  historySource: { provider: string; url: string | null };
};

const chartConfig = {
  sell: { label: 'Giá bán', color: '#b7791f' },
  buy: { label: 'Giá mua', color: '#173f36' },
} satisfies ChartConfig;

const ranges: { value: Range; label: string; days: number }[] = [
  { value: '7N', label: '7 ngày', days: 7 },
  { value: '1T', label: '1 tháng', days: 30 },
  { value: '1N', label: '1 năm', days: 365 },
];

const fallbackRecords = fallbackDataset.records as PricePoint[];
const compactPrice = (value: number) => `${value.toFixed(1)} tr`;

export default function Home() {
  const [range, setRange] = useState<Range>('1T');
  const [records, setRecords] = useState<PricePoint[]>(fallbackRecords);
  const [mode, setMode] = useState<DataMode>('connecting');
  const [observedAt, setObservedAt] = useState(
    fallbackDataset.metadata.snapshotTakenAt,
  );
  const [source, setSource] = useState({
    provider: 'Bản lịch sử dự phòng',
    url: fallbackDataset.metadata.sourceUrl as string | null,
    official: false,
  });
  const [historySource, setHistorySource] = useState({
    provider: 'SJC-price dataset',
    url: fallbackDataset.metadata.sourceUrl as string | null,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshPrices = useCallback(async (manual = false) => {
    if (manual) setIsRefreshing(true);
    try {
      const response = await fetch('/api/sjc', {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Không thể tải bảng giá');
      const payload = (await response.json()) as MarketResponse;
      if (!Array.isArray(payload.records) || payload.records.length === 0) {
        throw new Error('Bảng giá không hợp lệ');
      }
      setRecords(payload.records);
      setMode(payload.mode);
      setObservedAt(payload.observedAt);
      setSource(payload.source);
      setHistorySource(payload.historySource);
    } catch {
      setMode('fallback');
    } finally {
      if (manual) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshPrices();
    const timer = window.setInterval(
      () => void refreshPrices(),
      4 * 60 * 1_000,
    );
    return () => window.clearInterval(timer);
  }, [refreshPrices]);

  const selectedRange =
    ranges.find((item) => item.value === range) ?? ranges[1];
  const data = useMemo(
    () => records.slice(-selectedRange.days),
    [records, selectedRange.days],
  );
  const first = data[0];
  const latestPoint = data.at(-1) ?? first;
  const previousPoint = data.at(-2) ?? latestPoint;
  const change = latestPoint.sell - first.sell;
  const percent = first.sell ? (change / first.sell) * 100 : 0;
  const daySellChange = latestPoint.sell - previousPoint.sell;
  const dayBuyChange = latestPoint.buy - previousPoint.buy;
  const average =
    data.reduce((total, point) => total + point.sell, 0) / data.length;
  const isUptrend = latestPoint.sell >= average;
  const observedDate = new Date(observedAt);
  const isStale =
    Number.isFinite(observedDate.getTime()) &&
    Date.now() - observedDate.getTime() > 30 * 60 * 1_000;

  const formatDate = (date: string) =>
    new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: range === '1N' ? '2-digit' : undefined,
    }).format(new Date(`${date}T00:00:00`));
  const formatObservedAt = () =>
    new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    }).format(observedDate);

  const status =
    mode === 'connecting'
      ? { label: 'Đang kết nối', tone: 'bg-amber-500' }
      : mode === 'live' && !isStale
        ? { label: 'Đang cập nhật', tone: 'bg-emerald-500' }
        : mode === 'live' || mode === 'delayed'
          ? { label: 'Nguồn đang trễ', tone: 'bg-amber-500' }
          : { label: 'Bản dự phòng', tone: 'bg-red-500' };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/80 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(30,74,62,.18)]">
              <Landmark className="size-[18px]" strokeWidth={1.8} />
            </div>
            <div>
              <p className="font-heading text-[17px] font-semibold tracking-[-0.03em]">
                Kim Tuyến
              </p>
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                SJC Market View
              </p>
            </div>
          </div>
          <div
            className="hidden items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground sm:flex"
            role="status"
          >
            <span className={`size-1.5 rounded-full ${status.tone}`} />
            {status.label}
            {mode !== 'connecting' && <> · {formatObservedAt()}</>}
          </div>
          <Button
            variant="outline"
            className="rounded-full px-3 sm:px-4"
            onClick={() => void refreshPrices(true)}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            <span className="hidden sm:inline">
              {isRefreshing ? 'Đang cập nhật' : 'Làm mới'}
            </span>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-6 lg:px-10 lg:py-10">
        <section className="mb-7 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent-foreground">
              <Sparkles className="size-3.5 text-[var(--gold)]" />
              Góc nhìn thị trường
            </div>
            <h1 className="max-w-3xl font-heading text-[clamp(2rem,4vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.055em]">
              Giá vàng SJC,
              <span className="text-muted-foreground"> thấy cả xu hướng.</span>
            </h1>
          </div>
          <div
            className="flex w-fit rounded-xl border border-border bg-muted/55 p-1"
            role="group"
            aria-label="Khoảng thời gian"
          >
            {ranges.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setRange(item.value)}
                aria-pressed={range === item.value}
                className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4 ${
                  range === item.value
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        {mode !== 'live' || isStale ? (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-900">
            <WifiOff className="mt-0.5 size-3.5 shrink-0" />
            {mode === 'connecting'
              ? 'Đang kết nối tới nguồn giá thị trường…'
              : mode === 'fallback'
                ? 'Nguồn trực tiếp tạm thời không phản hồi. Đang hiển thị snapshot lịch sử gần nhất và không coi đây là giá hiện tại.'
                : 'Nguồn giá đang cập nhật chậm hơn bình thường. Hãy đối chiếu lại trước khi giao dịch.'}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <article className="metric-card metric-card--gold sm:col-span-2 xl:col-span-1">
            <div className="flex items-start justify-between">
              <p className="metric-label">SJC bán ra</p>
              <ChangeBadge value={daySellChange} />
            </div>
            <p className="metric-value">{latestPoint.sell.toFixed(1)}</p>
            <p className="metric-unit">triệu đồng / lượng · bán ra</p>
          </article>
          <article className="metric-card">
            <div className="flex items-start justify-between">
              <p className="metric-label">SJC mua vào</p>
              <ChangeBadge value={dayBuyChange} />
            </div>
            <p className="metric-value">{latestPoint.buy.toFixed(1)}</p>
            <p className="metric-unit">triệu đồng / lượng · mua vào</p>
          </article>
          <article className="metric-card">
            <div className="flex items-start justify-between">
              <p className="metric-label">Chênh lệch</p>
              <span className="status-badge">Hiện tại</span>
            </div>
            <p className="metric-value">{latestPoint.spread.toFixed(1)}</p>
            <p className="metric-unit">triệu · biên mua — bán</p>
          </article>
          <article className="metric-card metric-card--signal">
            <div className="flex items-start justify-between">
              <p className="metric-label">Tín hiệu xu hướng</p>
              {isUptrend ? (
                <TrendingUp className="size-5 text-emerald-700" />
              ) : (
                <TrendingDown className="size-5 text-red-700" />
              )}
            </div>
            <p
              className={`mt-7 text-xl font-semibold tracking-[-0.03em] ${isUptrend ? 'text-emerald-900' : 'text-red-900'}`}
            >
              {isUptrend ? 'Trên đường trung bình' : 'Dưới đường trung bình'}
            </p>
            <p className="metric-unit">Giá hiện tại so với bình quân kỳ</p>
          </article>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <article className="rounded-[22px] border border-border bg-card p-4 shadow-[0_18px_60px_rgba(28,46,40,.06)] sm:p-6">
            <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">
                    Diễn biến giá SJC
                  </h2>
                  <Info className="size-3.5 text-muted-foreground" />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Đơn vị: triệu đồng / lượng · {data.length} phiên
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <i className="size-2 rounded-full bg-[var(--gold)]" /> Giá bán
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="size-2 rounded-full bg-primary" /> Giá mua
                </span>
              </div>
            </div>

            <ChartContainer
              config={chartConfig}
              className="h-[310px] w-full sm:h-[390px]"
              initialDimension={{ width: 800, height: 390 }}
              aria-label={`Biểu đồ giá vàng SJC trong ${selectedRange.label}`}
            >
              <AreaChart
                data={data}
                margin={{ top: 10, right: 4, left: -18, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="sellFill" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--color-sell)"
                      stopOpacity={0.2}
                    />
                    <stop
                      offset="90%"
                      stopColor="var(--color-sell)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 6" />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={36}
                  tickMargin={12}
                  tickFormatter={formatDate}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  domain={['dataMin - 2', 'dataMax + 2']}
                  tickFormatter={(value) => `${value}`}
                />
                <ChartTooltip
                  cursor={{ stroke: '#c9b991', strokeDasharray: '4 4' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const point = payload[0].payload as PricePoint;
                    return (
                      <div className="min-w-44 rounded-xl border border-border bg-popover p-3 shadow-xl">
                        <p className="mb-2 text-xs font-semibold">
                          {formatDate(point.date)}
                        </p>
                        <div className="space-y-1.5 text-xs">
                          <p className="flex justify-between gap-6 text-muted-foreground">
                            <span>Giá bán</span>
                            <b className="text-foreground">
                              {point.sell.toFixed(2)} tr
                            </b>
                          </p>
                          <p className="flex justify-between gap-6 text-muted-foreground">
                            <span>Giá mua</span>
                            <b className="text-foreground">
                              {point.buy.toFixed(2)} tr
                            </b>
                          </p>
                        </div>
                      </div>
                    );
                  }}
                />
                <ReferenceLine
                  y={average}
                  stroke="#71857e"
                  strokeDasharray="3 5"
                  strokeOpacity={0.6}
                />
                <ReferenceDot
                  x={latestPoint.date}
                  y={latestPoint.sell}
                  r={4}
                  fill="#fffdf8"
                  stroke="#b7791f"
                  strokeWidth={2.5}
                />
                <Area
                  type="monotone"
                  dataKey="sell"
                  stroke="var(--color-sell)"
                  strokeWidth={2.5}
                  fill="url(#sellFill)"
                  activeDot={{ r: 5, strokeWidth: 3 }}
                />
                <Area
                  type="monotone"
                  dataKey="buy"
                  stroke="var(--color-buy)"
                  strokeWidth={1.8}
                  fill="transparent"
                  activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ChartContainer>

            <div className="mt-3 flex flex-col gap-2 border-t border-border/70 pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                Biến động {range}:{' '}
                <b
                  className={change >= 0 ? 'text-emerald-700' : 'text-red-700'}
                >
                  {change >= 0 ? '+' : ''}
                  {change.toFixed(1)} triệu ({percent >= 0 ? '+' : ''}
                  {percent.toFixed(1)}%)
                </b>
              </span>
              <span>
                Cao nhất{' '}
                {compactPrice(Math.max(...data.map((point) => point.sell)))} ·
                Thấp nhất{' '}
                {compactPrice(Math.min(...data.map((point) => point.sell)))}
              </span>
            </div>
          </article>

          <aside className="rounded-[22px] border border-primary/10 bg-primary p-5 text-primary-foreground sm:p-6">
            <div className="flex size-10 items-center justify-center rounded-xl bg-white/10">
              <Sparkles className="size-[18px] text-[#e8c36a]" />
            </div>
            <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
              Điểm cần chú ý
            </p>
            <h2 className="mt-2 font-heading text-2xl font-semibold leading-tight tracking-[-0.04em]">
              Giá đang ở {isUptrend ? 'trên' : 'dưới'} mức bình quân{' '}
              {selectedRange.label}.
            </h2>
            <p className="mt-3 text-sm leading-6 text-white/65">
              {change >= 0
                ? 'Đà tăng đang chiếm ưu thế. Theo dõi thêm biên mua — bán và tránh quyết định chỉ dựa trên một nhịp giá.'
                : 'Giá đang điều chỉnh trong kỳ đã chọn. Ưu tiên quan sát vùng cân bằng trước quyết định mới.'}
            </p>
            <div className="mt-8 space-y-3 border-t border-white/10 pt-5 text-xs">
              <div className="flex justify-between">
                <span className="text-white/55">Hiệu suất kỳ</span>
                <b>
                  {percent >= 0 ? '+' : ''}
                  {percent.toFixed(1)}%
                </b>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <span
                  className="block h-full rounded-full bg-[#e8c36a]"
                  style={{
                    width: `${Math.min(100, Math.max(12, 50 + percent * 2))}%`,
                  }}
                />
              </div>
              <div className="flex justify-between pt-1">
                <span className="text-white/55">Giá bình quân</span>
                <b>{average.toFixed(1)} tr</b>
              </div>
            </div>
            <p className="mt-8 flex items-start gap-2 text-[10px] leading-4 text-white/40">
              <Info className="mt-0.5 size-3 shrink-0" />
              Dữ liệu tham khảo, không phải khuyến nghị đầu tư. Hãy đối chiếu
              bảng niêm yết trước giao dịch.
            </p>
          </aside>
        </section>

        <footer className="mt-5 flex flex-col gap-2 border-t border-border/70 pt-5 text-[11px] leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-700" />
            Giá hiện tại: {source.provider}. Lịch sử: {historySource.provider}.
            Tự động làm mới mỗi 4 phút.
          </p>
          {source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-foreground underline-offset-4 hover:underline"
            >
              Xem nguồn dữ liệu <ExternalLink className="size-3" />
            </a>
          ) : null}
        </footer>
      </div>
    </main>
  );
}

function ChangeBadge({ value }: { value: number }) {
  return (
    <span
      className={`status-badge ${value >= 0 ? 'status-badge--up' : 'status-badge--down'}`}
    >
      {value >= 0 ? <ArrowUpRight /> : <ArrowDownRight />}
      {value >= 0 ? '+' : ''}
      {value.toFixed(2)}
    </span>
  );
}
