'use client';

import Link from 'next/link';
import { ArrowUpRight, Newspaper } from 'lucide-react';
import { useLocale } from '@/components/locale-provider';
import type { PublicArticleCard } from '@/lib/editorial/types';
import { ArticleCard } from './article-card';

export function EditorialHomeClient({
  vietnameseArticles,
  englishArticles,
}: {
  vietnameseArticles: PublicArticleCard[];
  englishArticles: PublicArticleCard[];
}) {
  const { locale } = useLocale();
  const english = locale === 'en';
  const articles = english ? englishArticles : vietnameseArticles;
  const [featured, ...secondary] = articles;
  const heading = (
    <div>
      <p className="tool-eyebrow">
        <span aria-hidden="true" />
        {english ? 'Market view' : 'Góc nhìn thị trường'}
      </p>
      <h2
        id="editorial-home-title"
        className="mt-3 font-heading text-2xl font-semibold tracking-tight sm:text-3xl"
      >
        {english ? 'Gold Pulse' : 'Nhịp vàng'}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        {english
          ? 'Read the movement, understand the value. Reporting and explainers grounded in sourced data.'
          : 'Đọc chuyển động, hiểu giá trị. Bản tin và giải thích dựa trên dữ liệu có nguồn.'}
      </p>
    </div>
  );
  const allLink = (
    <Link
      href="/nhip-vang"
      className="inline-flex min-h-10 items-center gap-1 rounded-full border border-border bg-card/70 px-4 text-sm font-semibold transition-colors hover:bg-card"
    >
      {english ? 'View all' : 'Xem tất cả'}
      <ArrowUpRight className="size-4" aria-hidden="true" />
    </Link>
  );

  return (
    <section
      id="nhip-vang"
      className="editorial-home-section"
      aria-labelledby="editorial-home-title"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        {heading}
        {allLink}
      </div>
      {articles.length ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
          <ArticleCard article={featured} featured />
          <div className="grid gap-4">
            {secondary.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <div className="editorial-empty">
            <Newspaper className="size-5 text-primary" aria-hidden="true" />
            <p>
              {english
                ? 'Gold Pulse is preparing its first articles from reviewed data and sources.'
                : 'Nhịp vàng đang chuẩn bị các bài viết đầu tiên từ dữ liệu và nguồn đã kiểm tra.'}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
