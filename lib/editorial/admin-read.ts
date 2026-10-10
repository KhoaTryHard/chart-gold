import 'server-only';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { getDatabase } from '@/db';
import {
  articles,
  articleRevisions,
  articleTranslations,
  editorialJobs,
  editorialPublicationSlots,
  editorialIntegrationPackages,
} from '@/db/schema';
import {
  editorialReadiness,
  EditorialStateError,
  revisionVersion,
} from './review';
import { editorialScheduleForDate, vietnamLocalDate } from './time';
import type { EditorialCategory } from './types';
import type {
  ReviewDetail,
  ReviewGroup,
  ReviewInbox,
  ReviewSlot,
  ReviewSummary,
} from './review-types';

type Revision = typeof articleRevisions.$inferSelect;
type Article = typeof articles.$inferSelect;

export function toReviewSummary(
  article: Article,
  revision: Revision,
  external = false,
): ReviewSummary {
  return {
    ...(external ? { approvalOrigin: 'telegram' as const } : {}),
    articleId: article.id,
    revisionId: revision.id,
    slug: article.slug,
    title: revision.title,
    excerpt: revision.excerpt,
    category: (revision.publicationCategory ??
      article.category) as EditorialCategory,
    articleStatus: article.status,
    approvalStatus: revision.approvalStatus,
    revisionStatus: revision.status,
    createdAt: revision.createdAt.toISOString(),
    approvedAt: revision.approvedAt?.toISOString() ?? null,
    reviewNote: revision.reviewNote,
    sourceCount: revision.sources.length,
    evidenceCount: revision.evidence.length,
    coverImageUrl: revision.coverImageUrl,
    version: revisionVersion(revision),
    readiness: editorialReadiness(revision),
  };
}

export async function getAdminRevision(
  articleId: string,
  revisionId?: string,
): Promise<ReviewDetail> {
  const db = getDatabase();
  const [article] = await db
    .select()
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  const [revision] = await db
    .select()
    .from(articleRevisions)
    .where(
      and(
        eq(articleRevisions.articleId, articleId),
        revisionId ? eq(articleRevisions.id, revisionId) : undefined,
      ),
    )
    .orderBy(desc(articleRevisions.createdAt), desc(articleRevisions.id))
    .limit(1);
  if (!article || !revision)
    throw new EditorialStateError('Không tìm thấy bài viết.', 404);
  const [external] = await db
    .select({ id: editorialIntegrationPackages.id })
    .from(editorialIntegrationPackages)
    .where(eq(editorialIntegrationPackages.revisionId, revision.id))
    .limit(1);
  return {
    ...toReviewSummary(article, revision, Boolean(external)),
    contentMarkdown: revision.contentMarkdown,
    sources: revision.sources,
    evidence: revision.evidence,
    seoTitle: revision.seoTitle,
    seoDescription: revision.seoDescription,
    coverAlt: revision.coverAlt,
    coverImageAlt: revision.coverImageAlt,
    coverImageDisclosure: revision.coverImageDisclosure,
  };
}

export async function getAdminHistory(articleId: string, page = 1) {
  return getDatabase()
    .select({
      id: articleRevisions.id,
      title: articleRevisions.title,
      createdAt: articleRevisions.createdAt,
      status: articleRevisions.status,
      approvalStatus: articleRevisions.approvalStatus,
    })
    .from(articleRevisions)
    .where(eq(articleRevisions.articleId, articleId))
    .orderBy(desc(articleRevisions.createdAt), desc(articleRevisions.id))
    .limit(20)
    .offset((page - 1) * 20);
}

export async function getAdminSlots(date: string): Promise<ReviewSlot[]> {
  const rows = await getDatabase()
    .select({ slot: editorialPublicationSlots, revision: articleRevisions })
    .from(editorialPublicationSlots)
    .leftJoin(
      articleRevisions,
      eq(articleRevisions.id, editorialPublicationSlots.revisionId),
    )
    .where(eq(editorialPublicationSlots.localDate, date));
  return editorialScheduleForDate(date).map((entry) => {
    const row = rows.find((row) => row.slot.slot === entry.slot);
    return {
      ...entry,
      scheduledAt: entry.scheduledAt.toISOString(),
      id: row?.slot.id ?? null,
      status: row?.slot.status ?? 'open',
      articleId: row?.slot.articleId ?? null,
      revisionId: row?.slot.revisionId ?? null,
      title: row?.revision?.title ?? null,
      failureMessage: row?.slot.failureMessage ?? null,
      revisionVersion: row?.revision ? revisionVersion(row.revision) : null,
    };
  });
}

export async function getAdminInbox(
  options: {
    group?: ReviewGroup;
    category?: EditorialCategory;
    search?: string;
    page?: number;
    date?: string;
  } = {},
): Promise<ReviewInbox> {
  const db = getDatabase();
  const latest = db
    .selectDistinctOn([articleRevisions.articleId])
    .from(articleRevisions)
    .orderBy(
      articleRevisions.articleId,
      desc(articleRevisions.createdAt),
      desc(articleRevisions.id),
    )
    .as('latest');
  const revisionFields = {
    id: latest.id,
    articleId: latest.articleId,
    title: latest.title,
    excerpt: latest.excerpt,
    contentMarkdown: latest.contentMarkdown,
    publicationCategory: latest.publicationCategory,
    sourceEventId: latest.sourceEventId,
    sources: latest.sources,
    evidence: latest.evidence,
    coverLabel: latest.coverLabel,
    coverAlt: latest.coverAlt,
    seoTitle: latest.seoTitle,
    seoDescription: latest.seoDescription,
    coverImageUrl: latest.coverImageUrl,
    coverImageAlt: latest.coverImageAlt,
    coverImageStorageKey: latest.coverImageStorageKey,
    coverImageDisclosure: latest.coverImageDisclosure,
    coverImageProvider: latest.coverImageProvider,
    coverImageModel: latest.coverImageModel,
    coverImagePrompt: latest.coverImagePrompt,
    coverImageGeneratedAt: latest.coverImageGeneratedAt,
    status: latest.status,
    approvalStatus: latest.approvalStatus,
    approvedByUserId: latest.approvedByUserId,
    approvedAt: latest.approvedAt,
    reviewNote: latest.reviewNote,
    createdByUserId: latest.createdByUserId,
    reviewedByUserId: latest.reviewedByUserId,
    reviewedAt: latest.reviewedAt,
    createdAt: latest.createdAt,
  };
  const scheduled = sql`exists (select 1 from ${editorialPublicationSlots} s where s.revision_id = ${latest.id} and s.status in ('scheduled','publishing'))`;
  const imported = sql<boolean>`exists (select 1 from ${editorialIntegrationPackages} p where p.revision_id=${latest.id})`;
  const needsAttention = sql`(${latest.approvalStatus} in ('changes_requested','revoked') or exists (select 1 from ${editorialPublicationSlots} s where s.revision_id = ${latest.id} and s.status = 'failed'))`;
  const notArchived = sql`${articles.status} <> 'archived'`;
  const groupConditions = {
    pending: and(
      notArchived,
      eq(latest.approvalStatus, 'pending'),
      inArray(latest.status, ['draft', 'reviewed']),
      sql`not ${imported}`,
    ),
    approved: and(
      notArchived,
      eq(latest.approvalStatus, 'approved'),
      eq(latest.status, 'reviewed'),
      sql`not ${scheduled}`,
      sql`not ${needsAttention}`,
    ),
    scheduled: and(
      notArchived,
      sql`(${scheduled} or ${latest.status} = 'published')`,
    ),
    attention: and(
      sql`(${needsAttention} or ${articles.status} = 'archived' or (${imported} and ${latest.status} <> 'published'))`,
      sql`not ${scheduled}`,
    ),
  };
  const visible = sql`${latest.status} <> 'superseded'`;
  const filters = and(
    visible,
    options.category
      ? eq(latest.publicationCategory, options.category)
      : undefined,
    options.search
      ? ilike(
          latest.title,
          '%' + options.search.replace(/[\\%_]/g, '\\$&') + '%',
        )
      : undefined,
  );
  const page = Math.max(1, options.page ?? 1);
  const where = and(filters, groupConditions[options.group ?? 'pending']);
  const [rows, counters, slots, active] = await Promise.all([
    db
      .select({
        article: articles,
        revision: revisionFields,
        external: imported,
      })
      .from(articles)
      .innerJoin(latest, eq(latest.articleId, articles.id))
      .where(where)
      .orderBy(
        options.group === 'approved'
          ? asc(latest.approvedAt)
          : desc(latest.createdAt),
        desc(latest.id),
      )
      .limit(20)
      .offset((page - 1) * 20),
    db
      .select({
        pending: sql<number>`count(*) filter (where ${groupConditions.pending})::int`,
        approved: sql<number>`count(*) filter (where ${groupConditions.approved})::int`,
        scheduled: sql<number>`count(*) filter (where ${groupConditions.scheduled})::int`,
        attention: sql<number>`count(*) filter (where ${groupConditions.attention})::int`,
      })
      .from(articles)
      .innerJoin(latest, eq(latest.articleId, articles.id))
      .where(filters),
    getAdminSlots(options.date ?? vietnamLocalDate()),
    db
      .select({ total: count() })
      .from(editorialJobs)
      .where(
        or(
          eq(editorialJobs.status, 'running'),
          and(
            eq(editorialJobs.status, 'queued'),
            or(
              isNull(editorialJobs.retryAt),
              lte(editorialJobs.retryAt, new Date()),
            ),
          ),
        ),
      ),
  ]);
  return {
    items: rows.map((row) =>
      toReviewSummary(row.article, row.revision, row.external),
    ),
    counts: counters[0],
    slots,
    localDate: vietnamLocalDate(),
    serverNow: new Date().toISOString(),
    hasActiveJobs: Number(active[0].total) > 0,
    page,
    total: Number(counters[0][options.group ?? 'pending']),
    pageSize: 20,
  };
}

export async function listAdminJobSummaries() {
  return getDatabase()
    .select({
      id: editorialJobs.id,
      topic: editorialJobs.topic,
      status: editorialJobs.status,
      stage: editorialJobs.stage,
      articleId: editorialJobs.articleId,
      revisionId: editorialJobs.revisionId,
      provider: editorialJobs.provider,
      attemptCount: editorialJobs.attemptCount,
      retryAt: editorialJobs.retryAt,
      errorMessage: editorialJobs.errorMessage,
      updatedAt: editorialJobs.updatedAt,
    })
    .from(editorialJobs)
    .orderBy(desc(editorialJobs.updatedAt))
    .limit(20);
}

export async function listTranslationSummaries(revisionId: string) {
  return getDatabase()
    .select({
      locale: articleTranslations.locale,
      status: articleTranslations.status,
      errorMessage: articleTranslations.errorMessage,
    })
    .from(articleTranslations)
    .where(eq(articleTranslations.sourceRevisionId, revisionId));
}
