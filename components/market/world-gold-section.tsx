'use client';

import { ExternalLink } from 'lucide-react';

import { WorldGoldChart } from '@/components/market/world-gold-chart';
import { useLocale } from '@/components/locale-provider';

const TRADINGVIEW_URL =
  'https://www.tradingview.com/symbols/XAUUSD/?exchange=OANDA';

export function WorldGoldSection() {
  const { locale } = useLocale();
  const english = locale === 'en';
  return (
    <section
      id="vang-the-gioi"
      className="world-gold-section"
      aria-labelledby="world-gold-title"
    >
      <div className="world-gold-section__header">
        <div>
          <p className="tool-eyebrow">
            <span aria-hidden="true" />
            {english ? 'International market' : 'Thị trường quốc tế'}
          </p>
          <h2
            id="world-gold-title"
            className="mt-3 font-heading text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            {english ? 'World gold' : 'Vàng thế giới'}
          </h2>

        </div>
        <div className="world-gold-section__source">
          <span>OANDA · TradingView · USD/ounce troy</span>
          <a href={TRADINGVIEW_URL} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" aria-hidden="true" />
            {english ? 'Open in TradingView' : 'Mở trên TradingView'}
          </a>
        </div>
      </div>
      <WorldGoldChart />
    
    </section>
  );
}
