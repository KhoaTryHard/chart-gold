import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { useLocale } from '@/components/locale-provider';
import type { MarketCompanyId } from '@/lib/market-sources';
import type { PriceChartRange } from '@/lib/price-chart';

export type AnalysisPreset = 'today' | 'buy' | 'hold';

export function analysisHref(companyId: MarketCompanyId, productId: string, range: PriceChartRange, preset?: AnalysisPreset) {
  const params = new URLSearchParams({ company: companyId, product: productId, range });
  if (preset) params.set('preset', preset);
  return `/phan-tich?${params.toString()}`;
}

export function AnalysisRouteLink({ companyId, productId, range, preset, className = 'glass-action rounded-full border-primary/20 px-3 sm:px-4', compact = false }: { companyId: MarketCompanyId; productId: string; range: PriceChartRange; preset?: AnalysisPreset; className?: string; compact?: boolean }) {
  const { locale } = useLocale();
  const label = locale === 'en' ? 'Ask AI' : 'Hỏi AI';
  return (
    <Link href={analysisHref(companyId, productId, range, preset)} className={className} aria-label={preset === 'today' ? (locale === 'en' ? 'Ask AI about today’s price' : 'Hỏi AI về giá hôm nay') : (locale === 'en' ? 'Ask AI about gold prices' : 'Hỏi AI về giá vàng')}>
      <Sparkles className="size-3.5" aria-hidden="true" />
      <span className={compact ? 'hidden sm:inline' : undefined}>{label}</span>
    </Link>
  );
}
