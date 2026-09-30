import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleBody } from '@/components/editorial/article-body';
import { ArticleCard, editorialCategoryLabel } from '@/components/editorial/article-card';
import { EditorialCover } from '@/components/editorial/editorial-cover';
import {
  getPublishedArticle,
  listPublishedArticles,
} from '@/lib/editorial/content';
import { editorialCategoryLabels } from '@/lib/editorial/types';
import { getRequestLocale } from '@/lib/request-locale';
import { siteUrl } from '@/lib/seo';

export const dynamic = 'force-dynamic';

function date(value: string, locale: 'vi' | 'en') {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
    dateStyle: 'medium',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const [resolvedParams, locale] = await Promise.all([params, getRequestLocale()]);
  const article = await getPublishedArticle(resolvedParams.slug, locale);
  if (!article) return { title: 'Không tìm thấy bài viết — Nhịp vàng' };
  const url = `${siteUrl}/nhip-vang/${article.slug}`;
  const title = article.seoTitle ?? article.title;
  const description = article.seoDescription ?? article.excerpt;
  const image = article.coverImageUrl ?? '/og.png';
  return {
    title: `${title} — Nhịp vàng | Kim Tuyến`,
    description,
    alternates: { canonical: url },
    robots: {
      index: true,
      follow: true,
      googleBot: { 'max-image-preview': 'large' },
    },
    openGraph: {
      type: 'article',
      url,
      title,
      description,
      siteName: 'Kim Tuyến',
      locale: 'vi_VN',
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
      authors: [article.authorName],
      images: [
        {
          url: image,
          width: article.coverImageUrl ? 1536 : 1200,
          height: article.coverImageUrl ? 1024 : 630,
          alt: article.coverImageAlt ?? article.coverAlt ?? article.title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}

export default async function NhipVangArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [resolvedParams, locale] = await Promise.all([params, getRequestLocale()]);
  const article = await getPublishedArticle(resolvedParams.slug, locale);
  if (!article) notFound();
  const english = locale === 'en';
  const related = (
    await listPublishedArticles({ category: article.category, limit: 4, locale })
  )
    .filter((item) => item.slug !== article.slug)
    .slice(0, 3);
  const wordCount = article.contentMarkdown.split(/\s+/).filter(Boolean).length;
  const articleUrl = `${siteUrl}/nhip-vang/${article.slug}`;
  const articleImage = article.coverImageUrl
    ? new URL(article.coverImageUrl, siteUrl).href
    : `${siteUrl}/og.png`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': article.category === 'news' ? 'NewsArticle' : 'BlogPosting',
    headline: article.seoTitle ?? article.title,
    description: article.seoDescription ?? article.excerpt,
    url: articleUrl,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: {
      '@type': 'Organization',
      name: article.authorName,
      url: article.authorUrl
        ? new URL(article.authorUrl, siteUrl).href
        : siteUrl,
    },
    publisher: { '@type': 'Organization', name: 'Kim Tuyến', url: siteUrl },
    image: [articleImage],
    inLanguage: article.locale === 'en' ? 'en' : 'vi-VN',
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: english ? 'Home' : 'Trang chủ', item: siteUrl },
      {
        '@type': 'ListItem',
        position: 2,
        name: english ? 'Gold Pulse' : 'Nhịp vàng',
        item: `${siteUrl}/nhip-vang`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: article.title,
        item: articleUrl,
      },
    ],
  };
  return (
    <main id="main-content" tabIndex={-1} className="editorial-page" aria-labelledby="article-title">
      <article className="editorial-article">
        <nav className="editorial-breadcrumb" aria-label={english ? 'Breadcrumb' : 'Breadcrumb'}>
          <Link href="/">{english ? 'Home' : 'Trang chủ'}</Link>
          <span aria-hidden="true">/</span>
          <Link href="/nhip-vang">{english ? 'Gold Pulse' : 'Nhịp vàng'}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{article.title}</span>
        </nav>
        <header className="mt-8">
          <p className="tool-eyebrow">
            <span aria-hidden="true" />
            {english ? editorialCategoryLabel(article.category, 'en') : editorialCategoryLabels[article.category]}
          </p>
          <h1
            id="article-title"
            className="mt-4 font-heading text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
          >
            {article.title}
          </h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">
            {article.excerpt}
          </p>
          {english && article.translationStatus !== 'ready' ? (
            <p className="mt-3 rounded-xl border border-amber-400/35 bg-amber-100/55 px-3 py-2 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
              This article is still being translated. The original Vietnamese version is shown below.
            </p>
          ) : null}
          <div className="editorial-article__meta mt-5">
            <span>{english ? 'Author' : 'Tác giả'}: {article.authorName}</span>
            <time dateTime={article.publishedAt}>
              {english ? 'Published' : 'Đăng'} {date(article.publishedAt, locale)}
            </time>
            <time dateTime={article.updatedAt}>
              {english ? 'Updated' : 'Cập nhật'} {date(article.updatedAt, locale)}
            </time>
            <span>{Math.max(1, Math.ceil(wordCount / 220))} {english ? 'min read' : 'phút đọc'}</span>
          </div>
        </header>
        <div className="editorial-article__hero">
          <EditorialCover
            label={article.coverLabel}
            title={article.title}
            imageUrl={article.coverImageUrl}
            imageAlt={article.coverImageAlt}
            imageDisclosure={article.coverImageDisclosure}
          />
        </div>
        <div lang={article.locale === 'en' ? 'en' : 'vi'}><ArticleBody article={article} /></div>
        {article.evidence.length ? (
          <section
            className="editorial-sources"
            aria-labelledby="article-evidence"
          >
            <h2
              id="article-evidence"
              className="font-heading text-lg font-semibold text-foreground"
            >
              {english ? 'Facts in this article' : 'Dữ kiện trong bài'}
            </h2>
            <ul className="mt-3 space-y-2">
              {article.evidence.map((item, index) => (
                <li key={`${item.label}-${index}`}>
                  <strong className="text-foreground">{item.label}:</strong>{' '}
                  {item.value}
                  {item.observedAt
                    ? ` · ${english ? 'observed' : 'ghi nhận'} ${date(item.observedAt, locale)}`
                    : ''}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section
          className="editorial-sources"
          aria-labelledby="article-sources"
        >
          <h2
            id="article-sources"
            className="font-heading text-lg font-semibold text-foreground"
          >
            {english ? 'Sources' : 'Nguồn tham khảo'}
          </h2>
          {article.sources.length ? (
            <ol>
              {article.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                  {source.publishedAt ? ` · ${english ? 'published' : 'công bố'} ${source.publishedAt}` : ''}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3">
              {english ? 'This article uses internal facts identified in its content. Verify original sources before making a financial decision.' : 'Bài này dùng dữ kiện nội bộ đã ghi rõ trong nội dung; cần đối chiếu nguồn gốc trước quyết định tài chính.'}
            </p>
          )}
        </section>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/"
            className="rounded-full border border-border bg-card/70 px-4 py-2 text-sm font-semibold"
          >
            {english ? 'View price table' : 'Xem bảng giá'}
          </Link>
          <Link
            href="/cong-cu-vang#hoa-von"
            className="rounded-full border border-primary/25 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary"
          >
            {english ? 'Try the break-even calculator' : 'Thử tính hòa vốn'}
          </Link>
        </div>
        {related.length ? (
          <section
            className="editorial-related"
            aria-labelledby="related-articles"
          >
            <h2 id="related-articles" className="sr-only">
              {english ? 'Related articles' : 'Bài viết liên quan'}
            </h2>
            {related.map((item) => (
              <ArticleCard key={item.id} article={item} />
            ))}
          </section>
        ) : null}
      </article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(schema).replace(/</g, '\\u003c'),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumb).replace(/</g, '\\u003c'),
        }}
      />
    </main>
  );
}
