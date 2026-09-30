import MarketDashboard from '@/components/market/market-dashboard';
import { LatestEditorialSection } from '@/components/editorial/editorial-section';
import { WorldGoldSection } from '@/components/market/world-gold-section';
import { pageMetadata, siteUrl } from '@/lib/seo';

export const metadata = pageMetadata(
  '/',
  'Giá vàng hôm nay, biểu đồ giá vàng Việt Nam',
  'Theo dõi giá mua vào, bán ra của SJC, DOJI, PNJ và các thương hiệu vàng Việt Nam; xem biểu đồ nến vàng thế giới, so sánh giá và tính hòa vốn miễn phí.',
);

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'Kim Tuyến',
            url: siteUrl,
            inLanguage: 'vi-VN',
            description:
              'Theo dõi giá vàng Việt Nam và biểu đồ nến XAU/USD, đọc góc nhìn thị trường, quy đổi đơn vị và tính hòa vốn.',
          }).replace(/</g, '\\u003c'),
        }}
      />
      <MarketDashboard
        worldGoldSection={<WorldGoldSection />}
        editorialSection={<LatestEditorialSection />}
      />
    </>
  );
}
