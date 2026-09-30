'use client';

import Link from 'next/link';
import { Clock3 } from 'lucide-react';
import { EditorialCover } from './editorial-cover';
import type { EditorialCategory, PublicArticleCard } from '@/lib/editorial/types';
import { useLocale } from '@/components/locale-provider';

const categoryLabels: Record<'vi' | 'en', Record<EditorialCategory, string>> = {
  vi: {
    news: 'Bản tin vàng',
    explain: 'Giải mã thị trường',
    practice: 'Kinh nghiệm giao dịch',
  },
  en: {
    news: 'Gold briefing',
    explain: 'Market explained',
    practice: 'Trading practice',
  },
};

export function editorialCategoryLabel(category: EditorialCategory, locale: 'vi' | 'en') {
  return categoryLabels[locale][category];
}

export function ArticleCard({ article, featured = false }: { article: PublicArticleCard; featured?: boolean }) {
  const { locale } = useLocale();
  const formatDate = (value: string) => new Intl.DateTimeFormat(
    locale === 'en' ? 'en-US' : 'vi-VN',
    { dateStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' },
  ).format(new Date(value));
  const label = editorialCategoryLabel(article.category, locale);
  return (
    <article className={`editorial-card ${featured ? 'editorial-card--featured' : ''}`}>
      <Link href={`/nhip-vang/${article.slug}`} className="group block h-full">
        <EditorialCover
          label={article.locale === 'en' ? article.coverLabel ?? label : label}
          title={article.title}
          compact={!featured}
          imageUrl={article.coverImageUrl}
          imageAlt={article.coverImageAlt}
          imageDisclosure={article.coverImageDisclosure}
        />
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
            <span>{label}</span><span className="text-muted-foreground">·</span><time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
            {locale === 'en' && article.locale === 'vi' ? <><span className="text-muted-foreground">·</span><span>Vietnamese original</span></> : null}
          </div>
          <h2 className={`mt-2 line-clamp-3 font-heading font-semibold tracking-tight transition-colors group-hover:text-primary ${featured ? 'text-2xl sm:text-3xl' : 'text-lg'}`}>{article.title}</h2>
          <p className={`mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground ${featured ? 'max-w-2xl' : ''}`}>{article.excerpt}</p>
          <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" aria-hidden="true" />{article.readingMinutes} {locale === 'en' ? 'min read' : 'phút đọc'}</p>
        </div>
      </Link>
    </article>
  );
}
