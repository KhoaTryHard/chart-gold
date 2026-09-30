'use client';

import { ExternalLink, RotateCw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useTheme } from '@/components/theme-provider';
import { useLocale } from '@/components/locale-provider';

const WIDGET_SCRIPT =
  'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
const TRADINGVIEW_URL =
  'https://www.tradingview.com/symbols/XAUUSD/?exchange=OANDA';

type WidgetStatus = 'idle' | 'loading' | 'ready' | 'slow' | 'error';

function widgetConfig(theme: 'light' | 'dark', locale: 'vi' | 'en') {
  return {
    autosize: true,
    symbol: 'OANDA:XAUUSD',
    interval: 'D',
    range: '6M',
    timezone: 'Asia/Ho_Chi_Minh',
    theme,
    style: '1',
    locale: locale === 'en' ? 'en' : 'vi_VN',
    withdateranges: true,
    enable_publishing: false,
    allow_symbol_change: false,
    hide_volume: true,
    hide_side_toolbar: true,
    hide_legend: false,
    details: false,
    hotlist: false,
    news: [],
    studies: [],
    show_popup_button: false,
    save_image: false,
    calendar: false,
    support_host: 'https://www.tradingview.com',
  };
}

export function WorldGoldChart() {
  const { resolvedTheme } = useTheme();
  const { locale } = useLocale();
  const english = locale === 'en';
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<WidgetStatus>('idle');
  const [isNearViewport, setIsNearViewport] = useState(
    () => typeof IntersectionObserver === 'undefined',
  );
  const [retryKey, setRetryKey] = useState(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isNearViewport) return;
    const mount = mountRef.current;
    if (!mount) return;

    clearTimer();
    mount.replaceChildren();
    setStatus('loading');

    const observer = new MutationObserver(() => {
      if (mount.querySelector('iframe')) {
        clearTimer();
        setStatus('ready');
      }
    });
    observer.observe(mount, { childList: true, subtree: true });

    const script = document.createElement('script');
    script.src = WIDGET_SCRIPT;
    script.async = true;
    script.type = 'text/javascript';
    script.text = JSON.stringify(widgetConfig(resolvedTheme, locale));
    script.addEventListener('error', () => {
      clearTimer();
      setStatus('error');
    });
    mount.appendChild(script);

    timerRef.current = window.setTimeout(() => {
      if (!mount.querySelector('iframe')) setStatus('slow');
    }, 15_000);

    return () => {
      clearTimer();
      observer.disconnect();
      mount.replaceChildren();
    };
  }, [clearTimer, isNearViewport, locale, resolvedTheme, retryKey]);

  useEffect(() => clearTimer, [clearTimer]);

  const retry = () => {
    setRetryKey((value) => value + 1);
  };

  return (
    <div
      ref={rootRef}
      className="world-gold-widget"
      data-widget-status={status}
      data-widget-symbol="OANDA:XAUUSD"
      data-widget-interval="D"
      data-widget-range="6M"
    >
      <div ref={mountRef} className="world-gold-widget__mount" />
      {status === 'idle' || status === 'loading' ? (
        <div className="world-gold-widget__state" aria-live="polite">
          <span className="ui-skeleton h-4 w-52" aria-hidden="true" />
          <span className="ui-skeleton mt-3 h-3 w-72" aria-hidden="true" />
          <span className="ui-skeleton mt-7 h-64 w-full" aria-hidden="true" />
          <span className="sr-only">{english ? 'Loading the world gold chart…' : 'Đang tải biểu đồ vàng thế giới…'}</span>
        </div>
      ) : null}
      {status === 'slow' || status === 'error' ? (
        <div
          className="world-gold-widget__state world-gold-widget__state--message"
          aria-live="polite"
        >
          <TriangleAlert className="size-5 text-amber-500" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold">
            {status === 'slow'
              ? (english ? 'The chart is taking longer than expected' : 'Biểu đồ tải lâu hơn dự kiến')
              : (english ? 'The chart could not be loaded' : 'Không tải được biểu đồ')}
          </p>
          <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">
            {english
              ? 'Try again or open the XAU/USD chart directly in TradingView.'
              : 'Bạn có thể thử lại hoặc mở biểu đồ XAU/USD trực tiếp trên TradingView.'}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className="world-gold-widget__retry"
              onClick={retry}
            >
              <RotateCw className="size-3.5" aria-hidden="true" />
              {english ? 'Try again' : 'Thử lại'}
            </button>
            <a
              href={TRADINGVIEW_URL}
              target="_blank"
              rel="noreferrer"
              className="world-gold-widget__external"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              {english ? 'Open in TradingView' : 'Mở trên TradingView'}
            </a>
          </div>
        </div>
      ) : null}
      <div className="world-gold-widget__attribution">
        <span>{english ? 'Chart supplied by TradingView · OANDA:XAUUSD' : 'Biểu đồ cung cấp bởi TradingView · OANDA:XAUUSD'}</span>
        <a href={TRADINGVIEW_URL} target="_blank" rel="noreferrer">
          {english ? 'Open in TradingView' : 'Mở trên TradingView'}
        </a>
      </div>
    </div>
  );
}
