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
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {english
              ? 'Follow gold price movement with the XAU/USD candlestick chart.'
              : 'Theo dõi diễn biến vàng bằng biểu đồ nến XAU/USD.'}
          </p>
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
      <div className="world-gold-section__guide">
        <p>
          {english
            ? 'Each candle shows the opening, high, low, and closing price in the selected period. Hover or tap a candle for detail.'
            : 'Mỗi nến thể hiện giá mở cửa, cao nhất, thấp nhất và đóng cửa trong khung thời gian được chọn. Rê chuột hoặc chạm vào nến để xem chi tiết.'}
        </p>
        <p>
          {english
            ? 'This is the OANDA XAU/USD price, not a Vietnam physical-gold dealer quote. The chart shows update time and market status; data can vary across providers.'
            : 'Đây là giá XAU/USD theo nguồn OANDA, không phải giá mua bán vàng vật chất tại Việt Nam. Thời điểm cập nhật và trạng thái thị trường được hiển thị trong biểu đồ; dữ liệu có thể khác giữa các nhà cung cấp.'}
        </p>
      </div>
    </section>
  );
}
