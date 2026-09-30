import type { Metadata } from 'next';
import { GoldToolsPageContent } from '@/components/market/gold-tools-page-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(
  '/cong-cu-vang',
  'So sánh giá vàng, tính lãi lỗ và hòa vốn',
  'So sánh giá mua bán vàng theo thương hiệu, quy đổi lượng/chỉ/gram, tính giá vốn, lãi lỗ và hòa vốn sau phí.',
);

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function GoldToolsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const explicitTool = firstParam(params.tool);
  const hasCalculatorParams = ['company', 'product', 'cost', 'buyback', 'intent'].some((key) => params[key] !== undefined);
  const hasComparisonParams = ['set', 'direction', 'products'].some((key) => params[key] !== undefined);
  const tool = explicitTool === 'lai-lo' || explicitTool === 'so-sanh'
    ? explicitTool
    : hasCalculatorParams
      ? 'lai-lo'
      : hasComparisonParams
        ? 'so-sanh'
        : undefined;
  const queryKey = Object.keys(params)
    .sort()
    .map((key) => `${key}=${firstParam(params[key]) ?? ''}`)
    .join('&');

  return <GoldToolsPageContent tool={tool} queryKey={queryKey} />;
}
