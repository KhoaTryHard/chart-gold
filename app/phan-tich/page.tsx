import { AnalysisWorkspace } from '@/components/analysis/analysis-workspace';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata(
  '/phan-tich',
  'Phân tích AI giá vàng',
  'Phân tích chi phí, lãi lỗ, hòa vốn, so sánh và bối cảnh giá vàng Việt Nam theo tình huống của bạn.',
);

export default function AnalysisPage() {
  return <AnalysisWorkspace />;
}

