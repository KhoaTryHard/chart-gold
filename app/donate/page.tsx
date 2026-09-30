import type { Metadata } from 'next';
import { DonationPageContent } from '@/components/billing/donation-page-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(
  '/donate',
  'Ủng hộ dự án',
  'Ủng hộ tự nguyện để duy trì dữ liệu giá vàng và các công cụ miễn phí của Kim Tuyến.',
);

export default function DonatePage() {
  return <DonationPageContent />;
}
