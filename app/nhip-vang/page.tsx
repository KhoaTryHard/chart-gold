import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { ArticleCard, editorialCategoryLabel } from '@/components/editorial/article-card';
import { EditorialEmptyState } from '@/components/editorial/editorial-section';
import { listPublishedArticles } from '@/lib/editorial/content';
import { editorialCategoryLabels, isEditorialCategory, type EditorialCategory } from '@/lib/editorial/types';
import { getRequestLocale } from '@/lib/request-locale';
import { pageMetadata, siteUrl } from '@/lib/seo';

export const revalidate = 300;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const params = await searchParams;
  const category = first(params.category);
  const page = Number(first(params.page) ?? '1');
  const hasFilter = isEditorialCategory(category) || page > 1;
  const canonical = page > 1 ? `${siteUrl}/nhip-vang?page=${page}${isEditorialCategory(category) ? `&category=${category}` : ''}` : `${siteUrl}/nhip-vang`;
  return { ...pageMetadata('/nhip-vang', 'Nhịp vàng — Tin tức giá vàng và thị trường tài chính', 'Tin tức giá vàng, tỷ giá, lãi suất và chính sách tác động đến thị trường. Góc nhìn từ dữ liệu thực tế, giải thích dễ hiểu và nguồn rõ ràng.'), alternates: { canonical }, robots: hasFilter ? { index: false, follow: true } : { index: true, follow: true, googleBot: { 'max-image-preview': 'large' } } };
}

export default async function NhipVangPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, locale] = await Promise.all([searchParams, getRequestLocale()]);
  const english = locale === 'en';
  const requestedCategory = first(params.category);
  const category: EditorialCategory | undefined = isEditorialCategory(requestedCategory) ? requestedCategory : undefined;
  const page = Math.max(1, Number(first(params.page) ?? '1') || 1);
  const articles = await listPublishedArticles({ category, page, limit: 12, locale });
  const featured = !category && page === 1 ? articles[0] : null;
  const gridArticles = featured ? articles.slice(1) : articles;
  const pageUrl = (nextPage: number, nextCategory = category) => { const query = new URLSearchParams(); if (nextCategory) query.set('category', nextCategory); if (nextPage > 1) query.set('page', String(nextPage)); const value = query.toString(); return value ? `/nhip-vang?${value}` : '/nhip-vang'; };
  const label = (value: EditorialCategory) => english ? editorialCategoryLabel(value, 'en') : editorialCategoryLabels[value];

  return <main id="main-content" tabIndex={-1} className="editorial-page" aria-labelledby="nhip-vang-title">
    <header className="editorial-page__header"><p className="tool-eyebrow"><span aria-hidden="true" />{english ? 'Market view' : 'Góc nhìn thị trường'}</p><h1 id="nhip-vang-title" className="mt-4 font-heading text-4xl font-semibold tracking-tight sm:text-5xl">{english ? 'Gold Pulse' : 'Nhịp vàng'}</h1><p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">{english ? 'Read the movement, understand the value. Gold news and explainers checked against real data and clear sources.' : 'Đọc chuyển động, hiểu giá trị. Tin tức và giải thích về vàng được đối chiếu từ dữ liệu thực tế và nguồn rõ ràng.'}</p></header>
    <nav className="editorial-page__filters" aria-label={english ? 'Filter articles' : 'Lọc bài viết'}><Link href="/nhip-vang" aria-current={!category && page === 1 ? 'page' : undefined} className="editorial-page__filter">{english ? 'All' : 'Tất cả'}</Link>{(Object.keys(editorialCategoryLabels) as EditorialCategory[]).map((key) => <Link key={key} href={pageUrl(1, key)} aria-current={category === key ? 'page' : undefined} className="editorial-page__filter">{label(key)}</Link>)}</nav>
    {!articles.length ? <div className="mt-8"><EditorialEmptyState locale={locale} /></div> : <>
      {featured ? <div className="mt-8"><ArticleCard article={featured} featured /></div> : null}
      <section className="editorial-grid" aria-label={english ? 'Article list' : 'Danh sách bài viết'}>{gridArticles.map((article) => <ArticleCard key={article.id} article={article} />)}</section>
      <nav className="mt-8 flex items-center justify-between gap-3" aria-label={english ? 'Pagination' : 'Phân trang'}>{page > 1 ? <Link href={pageUrl(page - 1)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-card/70 px-4 text-sm font-semibold"><ArrowLeft className="size-4" aria-hidden="true" />{english ? 'Previous' : 'Trang trước'}</Link> : <span />}{articles.length === 12 ? <Link href={pageUrl(page + 1)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-card/70 px-4 text-sm font-semibold">{english ? 'Next' : 'Trang sau'}<ArrowRight className="size-4" aria-hidden="true" /></Link> : null}</nav>
    </>}
  </main>;
}
