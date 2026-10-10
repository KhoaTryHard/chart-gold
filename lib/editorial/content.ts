import 'server-only';

import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { getDatabase } from '@/db';
import { articleRevisions, articleTranslations, articles } from '@/db/schema';
import type {
  EditorialCategory,
  EditorialLocale,
  PublicArticle,
  PublicArticleCard,
} from './types';
import { editorialPublicCacheSeconds, editorialPublicCacheTag } from './public-cache';

function editorialDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

type EditorialRow = {
  article: typeof articles.$inferSelect;
  revision: typeof articleRevisions.$inferSelect | null;
  translation: typeof articleTranslations.$inferSelect | null;
};

function toPublicArticle(row: EditorialRow, locale: EditorialLocale): PublicArticle | null {
  if (!row.revision || !row.article.publishedAt) return null;
  const translation = row.translation;
  const translated = Boolean(
    locale === 'en' &&
      translation?.status === 'ready' &&
      translation.title &&
      translation.excerpt &&
      translation.contentMarkdown,
  );
  return {
    id: row.article.id,
    slug: row.article.slug,
    category: (row.article.publishedCategory ?? row.revision.publicationCategory ?? row.article.category) as EditorialCategory,
    authorName: row.article.authorName,
    authorUrl: row.article.authorUrl,
    revisionId: row.revision.id,
    title: translated ? translation!.title! : row.revision.title,
    excerpt: translated ? translation!.excerpt! : row.revision.excerpt,
    contentMarkdown: translated ? translation!.contentMarkdown! : row.revision.contentMarkdown,
    coverLabel: translated ? translation!.coverLabel : row.revision.coverLabel,
    coverAlt: translated ? translation!.coverAlt : row.revision.coverAlt,
    seoTitle: translated ? translation!.seoTitle : row.revision.seoTitle,
    seoDescription: translated ? translation!.seoDescription : row.revision.seoDescription,
    coverImageUrl: row.revision.coverImageUrl,
    coverImageAlt: row.revision.coverImageAlt,
    coverImageDisclosure: row.revision.coverImageDisclosure,
    sources: row.revision.sources,
    evidence: row.revision.evidence,
    publishedAt: row.article.publishedAt.toISOString(),
    updatedAt: (row.article.publicModifiedAt ?? row.article.updatedAt).toISOString(),
    locale: translated ? 'en' : 'vi',
    translationStatus:
      locale === 'vi'
        ? 'source'
        : translated
          ? 'ready'
          : translation?.status === 'failed'
            ? 'failed'
            : translation?.status === 'hidden'
              ? 'hidden'
              : 'queued',
  };
}

function publishedQuery(locale: EditorialLocale) {
  return getDatabase()
    .select({ article: articles, revision: articleRevisions, translation: articleTranslations })
    .from(articles)
    .leftJoin(articleRevisions, eq(articleRevisions.id, articles.publishedRevisionId))
    .leftJoin(
      articleTranslations,
      and(
        eq(articleTranslations.sourceRevisionId, articleRevisions.id),
        eq(articleTranslations.locale, locale),
      ),
    );
}

async function readPublishedArticles(
  locale: EditorialLocale,
  category: EditorialCategory | null,
  page: number,
  limit: number,
): Promise<PublicArticleCard[]> {
  const now = new Date();
  const rows = await publishedQuery(locale)
    .where(
      and(
        eq(articles.status, 'published'),
        isNotNull(articles.publishedRevisionId),
        category
          ? sql`coalesce(${articles.publishedCategory}, ${articleRevisions.publicationCategory}, ${articles.category}) = ${category}`
          : undefined,
      ),
    )
    .orderBy(
      desc(sql`case when ${articles.pinnedUntil} > ${now} then 1 else 0 end`),
      desc(articles.publishedAt),
      desc(sql`coalesce(${articles.publicModifiedAt}, ${articles.updatedAt})`),
    )
    .limit(limit)
    .offset((page - 1) * limit);

  return rows.flatMap((row) => {
    const article = toPublicArticle(row, locale);
    if (!article) return [];
    return [{
      ...article,
      contentMarkdown: undefined,
      readingMinutes: Math.max(
        1,
        Math.ceil(article.contentMarkdown.split(/\s+/).filter(Boolean).length / 220),
      ),
    } satisfies PublicArticleCard];
  });
}

const readCachedPublishedArticles = unstable_cache(
  readPublishedArticles,
  ['editorial-public-list-v1'],
  { tags: [editorialPublicCacheTag], revalidate: editorialPublicCacheSeconds },
);

export async function listPublishedArticles(
  options: {
    category?: EditorialCategory;
    page?: number;
    limit?: number;
    locale?: EditorialLocale;
  } = {},
): Promise<PublicArticleCard[]> {
  if (!editorialDatabaseConfigured()) return [];
  const page = Number.isFinite(options.page) ? Math.max(1, Math.floor(options.page!)) : 1;
  const limit = Number.isFinite(options.limit) ? Math.min(1000, Math.max(1, Math.floor(options.limit!))) : 12;
  return readCachedPublishedArticles(options.locale ?? 'vi', options.category ?? null, page, limit);
}

async function readPublishedArticle(
  slug: string,
  locale: EditorialLocale,
) {
  const [row] = await publishedQuery(locale)
    .where(
      and(
        eq(articles.slug, slug),
        eq(articles.status, 'published'),
        isNotNull(articles.publishedRevisionId),
      ),
    )
    .limit(1);
  return row ? toPublicArticle(row, locale) : null;
}

const readCachedPublishedArticle = unstable_cache(
  readPublishedArticle,
  ['editorial-public-article-v1'],
  { tags: [editorialPublicCacheTag], revalidate: editorialPublicCacheSeconds },
);

// Metadata and the article body share one read within a server render.
export const getPublishedArticle = cache(async (
  slug: string,
  locale: EditorialLocale = 'vi',
) => {
  if (!editorialDatabaseConfigured()) return null;
  return readCachedPublishedArticle(slug, locale);
});

export async function listArticleSlugs() {
  try {
    return await getDatabase()
      .select({ slug: articles.slug, updatedAt: sql<Date>`coalesce(${articles.publicModifiedAt}, ${articles.updatedAt})` })
      .from(articles)
      .where(and(eq(articles.status, 'published'), isNotNull(articles.publishedRevisionId)))
      .orderBy(desc(sql`coalesce(${articles.publicModifiedAt}, ${articles.updatedAt})`));
  } catch {
    return [];
  }
}

export async function listRecentNewsArticleSlugs(now = new Date()) {
  const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1_000);
  try {
    return await getDatabase()
      .select({
        slug: articles.slug,
        title: articleRevisions.title,
        publishedAt: articles.publishedAt,
        updatedAt: sql<Date>`coalesce(${articles.publicModifiedAt}, ${articles.updatedAt})`,
      })
      .from(articles)
      .leftJoin(articleRevisions, eq(articleRevisions.id, articles.publishedRevisionId))
      .where(and(
        eq(articles.status, 'published'),
        isNotNull(articles.publishedRevisionId),
        gte(articles.publishedAt, cutoff),
        sql`coalesce(${articles.publishedCategory}, ${articleRevisions.publicationCategory}, ${articles.category}) = 'news'`,
      ))
      .orderBy(desc(articles.publishedAt));
  } catch {
    return [];
  }
}

export async function listEditorialArticles() {
  try {
    return await getDatabase()
      .select({ article: articles, revision: articleRevisions })
      .from(articles)
      .leftJoin(articleRevisions, eq(articleRevisions.id, articles.publishedRevisionId))
      .orderBy(desc(articles.updatedAt))
      .limit(100);
  } catch {
    return [];
  }
}
