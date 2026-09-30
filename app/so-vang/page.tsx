import type { Metadata } from 'next';

import { PortfolioPageContent } from '@/components/portfolio/portfolio-page-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(
  '/so-vang',
  'Sổ vàng tích sản',
  'Ghi giao dịch mua bán vàng, theo dõi tài sản, vốn và lãi lỗ theo tài khoản Google trên các thiết bị của bạn.',
);

export default function PortfolioPage() {
  return <PortfolioPageContent />;
}
