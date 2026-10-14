'use client';

/* eslint-disable jsx-a11y/prefer-tag-over-role -- The keyboard-operable canvas timeline is a custom slider; a native input cannot host the chart. */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  CandlestickChart,
  ChartNoAxesCombined,
  ExternalLink,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react';
import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import { useTheme } from '@/components/theme-provider';
import { vietnamDate } from '@/lib/analysis/dates';
import { enumerateCalendarDates } from '@/lib/market-history';
import type {
  CandleRange,
  MarketCandlesResponse,
  Ohlc,
} from '@/lib/market-candles';
import type { PricePoint } from '@/lib/price-chart';
import type { Locale } from '@/lib/i18n';
import styles from './price-chart.module.css';

type Props = {
  data: PricePoint[];
  companyId: string;
  productId: string;
  productLabel: string;
  rangeLabel: string;
  range: CandleRange;
  locale: Locale;
  displayUnit?: 'luong' | 'chi';
  onRangeChange: (range: CandleRange) => void;
  historySource?: { provider: string; url: string | null };
};

export function PriceChart({
  data,
  companyId,
  productId,
  productLabel,
  rangeLabel,
  range,
  locale,
  displayUnit = 'luong',
  onRangeChange,
  historySource,
}: Props) {
  const english = locale === 'en';
  const t = (vi: string, en: string) => (english ? en : vi);
  const { resolvedTheme } = useTheme();
  const [mode, setMode] = useState<'candles' | 'line'>('candles');
  const [side, setSide] = useState<'sell' | 'buy'>('sell');
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [result, setResult] = useState<{
    key: string;
    value: MarketCandlesResponse | null;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const requestKey = `${companyId}:${productId}:${range}`;
  const response = result?.key === requestKey ? result.value : null;
  const loading = result?.key !== requestKey;
  const candles = response?.records;
  const hasCandles = Boolean(candles?.length);
  const effectiveMode = hasCandles ? mode : 'line';
  const divisor = displayUnit === 'chi' ? 10 : 1;
  const unit = `${t('triệu đồng', 'million VND')} / ${displayUnit === 'chi' ? 'chỉ' : 'lượng'}`;
  const number = (value: number) =>
    value.toLocaleString(english ? 'en-US' : 'vi-VN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const dateLabel = useCallback(
    (date: string) =>
      new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(`${date}T00:00:00+07:00`)),
    [locale],
  );

  useEffect(() => {
    const controller = new AbortController();
    let sequence = 0;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      const current = ++sequence;
      try {
        const res = await fetch(
          `/api/market-candles?${new URLSearchParams({ company: companyId, product: productId, range })}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error('Candle request failed');
        const value = (await res.json()) as MarketCandlesResponse;
        if (
          value.companyId !== companyId ||
          value.productId !== productId ||
          value.range !== range ||
          !Array.isArray(value.records)
        )
          throw new Error('Mismatched candle response');
        if (!controller.signal.aborted && current === sequence)
          setResult({ key: requestKey, value });
      } catch {
        if (!controller.signal.aborted && current === sequence)
          setResult({ key: requestKey, value: null });
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 240_000);
    const visible = () => void refresh();
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', visible);
    };
  }, [companyId, productId, range, requestKey, retry]);

  const displayed = useMemo(
    () =>
      hasCandles
        ? candles!.map((row) => ({
            date: row.date,
            buy: row.buy.close / divisor,
            sell: row.sell.close / divisor,
          }))
        : data.map((row) => ({
            date: row.date,
            buy: row.buy / divisor,
            sell: row.sell / divisor,
          })),
    [candles, hasCandles, data, divisor],
  );
  const displayCandles = useMemo(
    () =>
      (candles ?? []).map((row) => ({
        time: row.date,
        open: row[side].open / divisor,
        high: row[side].high / divisor,
        low: row[side].low / divisor,
        close: row[side].close / divisor,
      })),
    [candles, side, divisor],
  );
  const selected =
    displayed.find((row) => row.date === activeDate) ?? displayed.at(-1);
  const selectedCandle = displayCandles.find(
    (row) => row.time === selected?.date,
  );
  const statsSide = effectiveMode === 'candles' ? side : 'sell';
  const values = displayed.map((row) => row[statsSide]);
  const first = values[0];
  const last = values.at(-1);
  const change =
    first === undefined || last === undefined ? null : last - first;
  const percent = change === null || !first ? null : (change / first) * 100;
  const average = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
  const high = values.length
    ? Math.max(
        ...(effectiveMode === 'candles'
          ? displayCandles.map((row) => row.high)
          : values),
      )
    : null;
  const low = values.length
    ? Math.min(
        ...(effectiveMode === 'candles'
          ? displayCandles.map((row) => row.low)
          : values),
      )
    : null;
  const source = hasCandles ? response?.source : historySource;
  const mount = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const sellSeries = useRef<ISeriesApi<'Line'> | null>(null);
  const buySeries = useRef<ISeriesApi<'Line'> | null>(null);
  const fittedKey = useRef('');
  const keyboardSelection = useRef(false);

  useEffect(() => {
    if (!mount.current) return;
    const api = createChart(mount.current, {
      autoSize: true,
      layout: { attributionLogo: true },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        rightOffset: 1,
        lockVisibleTimeRangeOnResize: true,
      },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: false,
        pinch: true,
        axisPressedMouseMove: true,
      },
    });
    chart.current = api;
    candleSeries.current = api.addSeries(CandlestickSeries, {
      upColor: '#159b80',
      downColor: '#e45260',
      borderVisible: false,
      wickUpColor: '#159b80',
      wickDownColor: '#e45260',
    });
    sellSeries.current = api.addSeries(LineSeries, {
      lineWidth: 2,
      pointMarkersVisible: true,
      pointMarkersRadius: 2,
    });
    buySeries.current = api.addSeries(LineSeries, {
      lineWidth: 2,
      pointMarkersVisible: true,
      pointMarkersRadius: 2,
    });
    const select = (event: { time?: Time }) => {
      // Library redraws can emit crosshair events without a new pointer action.
      // Keep keyboard-selected dates stable until the user uses the pointer.
      if (keyboardSelection.current) return;
      const time = event.time;
      setActiveDate(
        typeof time === 'string'
          ? time
          : time && typeof time === 'object'
            ? `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`
            : null,
      );
    };
    api.subscribeCrosshairMove(select);
    api.subscribeClick(select);
    return () => {
      api.unsubscribeCrosshairMove(select);
      api.unsubscribeClick(select);
      api.remove();
      chart.current = null;
      fittedKey.current = '';
    };
  }, []);

  useEffect(() => {
    if (!chart.current || !mount.current) return;
    const css = getComputedStyle(mount.current);
    const color = (name: string) => css.getPropertyValue(name).trim();
    chart.current.applyOptions({
      layout: {
        background: {
          type: ColorType.Solid,
          color: resolvedTheme === 'dark' ? '#10130f' : '#ffffff',
        },
        textColor: color('--muted-foreground'),
        fontFamily: css.fontFamily,
      },
      grid: {
        vertLines: { color: color('--border'), style: 1 },
        horzLines: { color: color('--border'), style: 1 },
      },
      localization: {
        locale: english ? 'en-GB' : 'vi-VN',
        priceFormatter: (price: number) =>
          price.toLocaleString(english ? 'en-US' : 'vi-VN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
        timeFormatter: (time: Time) =>
          typeof time === 'string'
            ? dateLabel(time)
            : typeof time === 'object'
              ? dateLabel(
                  `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`,
                )
              : String(time),
      },
    });
    sellSeries.current?.applyOptions({ color: color('--chart-1') });
    buySeries.current?.applyOptions({ color: color('--chart-2') });
  }, [resolvedTheme, english, dateLabel]);

  useEffect(() => {
    const start = hasCandles ? response!.requestedStart : displayed[0]?.date;
    const end = hasCandles ? response!.requestedEnd : displayed.at(-1)?.date;
    const dates = start && end ? enumerateCalendarDates(start, end) : [];
    const candleMap = new Map(displayCandles.map((row) => [row.time, row]));
    const lineMap = new Map(displayed.map((row) => [row.date, row]));
    candleSeries.current?.setData(
      dates.map((time) => candleMap.get(time) ?? { time }),
    );
    sellSeries.current?.setData(
      dates.map((time) =>
        lineMap.has(time) ? { time, value: lineMap.get(time)!.sell } : { time },
      ),
    );
    buySeries.current?.setData(
      dates.map((time) =>
        lineMap.has(time) ? { time, value: lineMap.get(time)!.buy } : { time },
      ),
    );
    candleSeries.current?.applyOptions({
      visible: effectiveMode === 'candles',
    });
    sellSeries.current?.applyOptions({ visible: effectiveMode === 'line' });
    buySeries.current?.applyOptions({ visible: effectiveMode === 'line' });
    const key = `${requestKey}:${hasCandles}:${displayed.length > 0}`;
    if (fittedKey.current !== key) {
      chart.current?.timeScale().fitContent();
      fittedKey.current = key;
    }
  }, [
    displayCandles,
    displayed,
    effectiveMode,
    requestKey,
    hasCandles,
    response,
  ]);

  const zoom = (factor: number) => {
    const scale = chart.current?.timeScale();
    const current = scale?.getVisibleLogicalRange();
    if (!current) return;
    const center = (current.from + current.to) / 2;
    const half = Math.max(1, ((current.to - current.from) * factor) / 2);
    scale?.setVisibleLogicalRange({ from: center - half, to: center + half });
  };
  const inspect = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      keyboardSelection.current = true;
      setActiveDate(null);
      setAnnouncement('');
      chart.current?.clearCrosshairPosition();
      return;
    }
    if (!displayed.length) return;
    const current = Math.max(
      0,
      displayed.findIndex((row) => row.date === selected?.date),
    );
    const index =
      event.key === 'ArrowLeft'
        ? Math.max(0, current - 1)
        : event.key === 'ArrowRight'
          ? Math.min(displayed.length - 1, current + 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? displayed.length - 1
              : null;
    if (index === null) return;
    event.preventDefault();
    keyboardSelection.current = true;
    const row = displayed[index];
    const series =
      effectiveMode === 'candles' ? candleSeries.current : sellSeries.current;
    if (series)
      chart.current?.setCrosshairPosition(row[statsSide], row.date, series);
    setActiveDate(row.date);
    setAnnouncement(
      `${dateLabel(row.date)} · ${t('Bán ra', 'Sell')} ${number(row.sell)} · ${t('Mua vào', 'Buy')} ${number(row.buy)} · ${unit}`,
    );
  };
  const chooseRange = (next: CandleRange) => {
    keyboardSelection.current = false;
    setActiveDate(null);
    setAnnouncement('');
    onRangeChange(next);
  };
  const priceName =
    statsSide === 'sell'
      ? t('Bán ra', 'Dealer sell')
      : t('Mua vào', 'Dealer buy');
  const heading = english
    ? `${productLabel} price chart`
    : `Biểu đồ giá ${productLabel.toLowerCase()}`;
  const ohlcNames: Record<keyof Ohlc, string> = english
    ? { open: 'Open', high: 'High', low: 'Low', close: 'Close' }
    : { open: 'Mở', high: 'Cao', low: 'Thấp', close: 'Đóng' };

  return (
    <article
      className={styles.section}
      aria-label={
        english
          ? `${productLabel} price chart for ${rangeLabel}`
          : `Biểu đồ giá ${productLabel.toLowerCase()} trong ${rangeLabel}`
      }
      data-testid="domestic-chart"
      data-chart-mode={effectiveMode}
    >
      <header className={styles.header}>
        <div>
          <p className="tool-eyebrow">
            <span aria-hidden="true" />
            {t('Thị trường trong nước', 'Domestic market')}
          </p>
          <h2 className="mt-3 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            {heading}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t(
              'Theo dõi diễn biến giá mua vào và bán ra theo ngày.',
              'Follow daily dealer buy and sell prices.',
            )}
          </p>
        </div>
        <div className={styles.source}>
          <span>
            {source?.provider ?? t('Lịch sử hiện có', 'Available history')} ·{' '}
            {unit}
          </span>
          {source?.url && (
            <a href={source.url} target="_blank" rel="noreferrer">
              <ExternalLink size={14} aria-hidden="true" />
              {t('Xem nguồn dữ liệu', 'View source')}
            </a>
          )}
        </div>
      </header>
      {hasCandles && response?.source?.referenceGroup && (
        <p className={styles.reference}>
          {t('Chuỗi tham chiếu nhóm ', 'Reference series for the SJC ')}
          {response.source.referenceGroup === 'bar'
            ? t('vàng miếng SJC', 'gold bar group')
            : t('nhẫn SJC', 'ring group')}
          {t(
            '; giá niêm yết từng kích cỡ có thể khác nhau.',
            '; individual sizes may have different quoted prices.',
          )}
        </p>
      )}
      <div className={styles.frame}>
        <div className={styles.toolbar}>
          <div
            className={styles.group}
            aria-label={t('Kiểu biểu đồ', 'Chart type')}
          >
            <button
              type="button"
              disabled={!hasCandles}
              aria-pressed={effectiveMode === 'candles'}
              onClick={() => setMode('candles')}
            >
              <CandlestickChart size={16} aria-hidden="true" />
              {t('Nến', 'Candles')}
            </button>
            <button
              type="button"
              aria-pressed={effectiveMode === 'line'}
              onClick={() => setMode('line')}
            >
              <ChartNoAxesCombined size={16} aria-hidden="true" />
              {t('Đường', 'Line')}
            </button>
          </div>
          {effectiveMode === 'candles' && (
            <div
              className={styles.group}
              aria-label={t('Loại giá', 'Price side')}
            >
              {(['sell', 'buy'] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={side === value}
                  onClick={() => setSide(value)}
                >
                  {value === 'sell' ? t('Bán ra', 'Sell') : t('Mua vào', 'Buy')}
                </button>
              ))}
            </div>
          )}
          <div
            className={styles.group}
            aria-label={t('Khoảng thời gian biểu đồ', 'Chart period')}
          >
            {(['7N', '1T'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={range === value}
                onClick={() => chooseRange(value)}
              >
                {value === '7N'
                  ? t('7 ngày', '7 days')
                  : t('1 tháng', '1 month')}
              </button>
            ))}
          </div>
          <div className={`${styles.group} ${styles.zoom}`}>
            <button
              type="button"
              aria-label={t('Thu nhỏ', 'Zoom out')}
              onClick={() => zoom(1.4)}
            >
              <Minus size={16} />
            </button>
            <button
              type="button"
              aria-label={t('Phóng to', 'Zoom in')}
              onClick={() => zoom(0.7)}
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              aria-label={t('Đặt lại biểu đồ', 'Reset chart')}
              onClick={() => chart.current?.timeScale().fitContent()}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>
        <div className={styles.readout} data-testid="chart-readout">
          <span className={styles.date}>
            {selected ? dateLabel(selected.date) : '—'}
            {selected?.date === vietnamDate() && (
              <small>{t('Đang cập nhật', 'Updating')}</small>
            )}
          </span>
          {effectiveMode === 'candles' && selectedCandle ? (
            (Object.keys(ohlcNames) as Array<keyof Ohlc>).map((field) => (
              <span key={field}>
                {ohlcNames[field]} <b>{number(selectedCandle[field])}</b>
              </span>
            ))
          ) : (
            <>
              <span>
                <i className={styles.sellDot} />
                {t('Bán ra', 'Dealer sell')}{' '}
                <b>{selected ? number(selected.sell) : '—'}</b>
              </span>
              <span>
                <i className={styles.buyDot} />
                {t('Mua vào', 'Dealer buy')}{' '}
                <b>{selected ? number(selected.buy) : '—'}</b>
              </span>
            </>
          )}
        </div>
        <div className={styles.plotWrap}>
          <div
            className={styles.plot}
            tabIndex={0}
            role="slider"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, displayed.length - 1)}
            aria-valuenow={Math.max(
              0,
              displayed.findIndex((row) => row.date === selected?.date),
            )}
            aria-valuetext={
              selected
                ? `${dateLabel(selected.date)} · ${priceName} ${number(selected[statsSide])} · ${unit}`
                : t('Chưa có dữ liệu', 'No data')
            }
            aria-label={t(
              'Biểu đồ giá. Dùng phím mũi tên, Home và End để xem giá.',
              'Price chart. Use arrow keys, Home and End to inspect prices.',
            )}
            onKeyDown={inspect}
            onPointerMoveCapture={() => {
              keyboardSelection.current = false;
            }}
            onPointerDownCapture={() => {
              keyboardSelection.current = false;
            }}
          >
            <div ref={mount} className={styles.canvas} aria-hidden="true" />
          </div>
          {!displayed.length && (
            <output className={styles.empty}>
              {loading
                ? t('Đang tải lịch sử giá…', 'Loading price history…')
                : t(
                    'Chưa có dữ liệu giá trong khoảng thời gian này.',
                    'No price data in this period.',
                  )}
            </output>
          )}
        </div>
        <div className={styles.footer}>
          <span>
            {displayed.length
              ? `${dateLabel(displayed[0].date)} – ${dateLabel(displayed.at(-1)!.date)} · `
              : ''}
            {displayed.length} {t('phiên đang xem', 'sessions shown')}
          </span>
          <span>
            {t('Theo ngày', 'Daily')} · UTC+7 · {unit}
            {hasCandles &&
              response?.updatedAt &&
              ` · ${t('Cập nhật', 'Updated')} ${new Date(response.updatedAt).toLocaleTimeString(english ? 'en-GB' : 'vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })}`}
          </span>
        </div>
      </div>
      <div className={styles.guide}>
        <p>
          {t(
            'Rê chuột hoặc chạm để xem giá. Dùng ← →, Home / End trên biểu đồ. Kéo ngang để di chuyển; chụm ngón tay hoặc dùng + / − để thu phóng.',
            'Hover or tap to inspect prices. Use ← →, Home / End on the chart. Drag to pan; pinch or use + / − to zoom.',
          )}
        </p>
        <p>
          {t(
            'Giá mở và đóng là mức ghi nhận đầu và cuối ngày của nguồn. Nến hôm nay vẫn đang cập nhật.',
            'Open and close are the first and last quotes recorded by the source each day. Today’s candle is still updating.',
          )}
        </p>
      </div>
      <output className={styles.status}>
        {loading ? (
          t('Đang tải dữ liệu nến…', 'Loading candlestick data…')
        ) : response?.status === 'partial' ? (
          t(
            `Lịch sử chưa đầy đủ: ${response.records.length}/${range === '7N' ? 7 : 30} ngày. Ngày thiếu dữ liệu được để trống.`,
            `Incomplete history: ${response.records.length}/${range === '7N' ? 7 : 30} days. Missing days are left blank.`,
          )
        ) : !hasCandles ? (
          <>
            {t(
              'Chưa có dữ liệu nến cho lựa chọn này. Đang hiển thị giá mua/bán theo ngày hiện có.',
              'Candlestick data is unavailable for this selection. Showing available daily buy/sell prices.',
            )}
            {response?.status !== 'unsupported' && (
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                {t('Thử lại', 'Try again')}
              </button>
            )}
          </>
        ) : null}
      </output>
      <section
        className={styles.summary}
        aria-label={t('Tóm tắt xu hướng', 'Trend summary')}
      >
        <div>
          <p className={styles.eyebrow}>
            {t('Tóm tắt xu hướng', 'Trend summary')}
          </p>
          <h3>
            {last === undefined || average === null
              ? '—'
              : last === average
                ? t(
                    'Giá đang bằng mức bình quân kỳ này.',
                    'Price is at the period average.',
                  )
                : last > average
                  ? t(
                      'Giá đang trên mức bình quân kỳ này.',
                      'Price is above the period average.',
                    )
                  : t(
                      'Giá đang dưới mức bình quân kỳ này.',
                      'Price is below the period average.',
                    )}
          </h3>
          <small>
            {priceName} · {rangeLabel}
          </small>
        </div>
        <div>
          <p>{t('Biến động trong kỳ', 'Period change')}</p>
          <strong
            className={change !== null && change < 0 ? styles.down : styles.up}
          >
            {change === null
              ? '—'
              : `${change >= 0 ? '+' : ''}${number(change)} (${percent! >= 0 ? '+' : ''}${number(percent!)}%)`}
          </strong>
          <small>{unit}</small>
        </div>
        <div>
          <p>{t('Giá bình quân', 'Average price')}</p>
          <strong>{average === null ? '—' : number(average)}</strong>
          <small>{unit}</small>
        </div>
        <div>
          <p>{t('Cao nhất / Thấp nhất', 'High / Low')}</p>
          <strong>
            {high === null || low === null
              ? '—'
              : `${number(high)} / ${number(low)}`}
          </strong>
          <small>{unit}</small>
        </div>
      </section>
      <details className={styles.tableDetails}>
        <summary>{t('Xem dữ liệu', 'View data')}</summary>
        <div className={styles.tableScroll}>
          <table>
            <caption>
              {heading} · {unit}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('Ngày', 'Date')}</th>
                {effectiveMode === 'candles' ? (
                  Object.values(ohlcNames).map((name) => (
                    <th scope="col" key={name}>
                      {name} · {priceName}
                    </th>
                  ))
                ) : (
                  <>
                    <th scope="col">{t('Bán ra', 'Sell')}</th>
                    <th scope="col">{t('Mua vào', 'Buy')}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {displayed.map((row, index) => (
                <tr key={row.date}>
                  <th scope="row">{dateLabel(row.date)}</th>
                  {effectiveMode === 'candles' ? (
                    (['open', 'high', 'low', 'close'] as const).map((field) => (
                      <td key={field}>
                        {number(displayCandles[index][field])}
                      </td>
                    ))
                  ) : (
                    <>
                      <td>{number(row.sell)}</td>
                      <td>{number(row.buy)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className={styles.attribution}>
        TradingView Lightweight Charts™ Copyright (с) 2025 TradingView, Inc. ·{' '}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView
        </a>
      </p>
      <output className="sr-only" aria-live="polite">
        {announcement}
      </output>
    </article>
  );
}
