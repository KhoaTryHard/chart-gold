import 'server-only';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { getDatabase } from '@/db';
import {
  articleRevisions,
  articleTranslations,
  articles,
  editorialJobs,
  editorialPublicationSlots,
} from '@/db/schema';
import { clearEditorialCache } from './content';
import { getBrandCover, isBrandCoverUrl } from './brand-covers';
import { editorialSlug } from './slug';
import {
  editorialPublicationSlots as publicationSlots,
  isEditorialPublicationSlot,
  type EditorialCategory,
  type EditorialEvidence,
  type EditorialPublicationSlot,
  type EditorialSource,
} from './types';
import { editorialScheduleForDate, vietnamLocalDate } from './time';

const allowedDomains = [
  'sjc.com.vn',
  'pnj.com.vn',
  'btmc.vn',
  'vietinbankgold.vn',
  'gold.org',
  'sbv.gov.vn',
  'sbv.vn',
  'federalreserve.gov',
  'bls.gov',
  'baotintuc.vn',
  'vnexpress.net',
  'vneconomy.vn',
] as const;

export function validateEditorialSource(
  value: unknown,
): EditorialSource | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as {
    title?: unknown;
    url?: unknown;
    publishedAt?: unknown;
    accessedAt?: unknown;
  };
  if (typeof candidate.title !== 'string' || typeof candidate.url !== 'string')
    return null;
  try {
    const url = new URL(candidate.url);
    const allowed = allowedDomains.some(
      (domain) =>
        url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    );
    if (!allowed || !['http:', 'https:'].includes(url.protocol)) return null;
    return {
      title: candidate.title.trim().slice(0, 180),
      url: url.toString(),
      publishedAt:
        typeof candidate.publishedAt === 'string'
          ? candidate.publishedAt.slice(0, 40)
          : undefined,
      accessedAt:
        typeof candidate.accessedAt === 'string'
          ? candidate.accessedAt.slice(0, 40)
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function validateEditorialSources(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 12)
    .map(validateEditorialSource)
    .filter((source): source is EditorialSource => Boolean(source));
}

function validateEvidence(value: unknown): EditorialEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as {
      label?: unknown;
      value?: unknown;
      sourceUrl?: unknown;
      observedAt?: unknown;
    };
    if (
      typeof candidate.label !== 'string' ||
      typeof candidate.value !== 'string'
    )
      return [];
    const sourceUrl =
      typeof candidate.sourceUrl === 'string' &&
      validateEditorialSource({
        title: candidate.label,
        url: candidate.sourceUrl,
      })
        ? candidate.sourceUrl
        : undefined;
    return [
      {
        label: candidate.label.trim().slice(0, 180),
        value: candidate.value.trim().slice(0, 2_000),
        sourceUrl,
        observedAt:
          typeof candidate.observedAt === 'string'
            ? candidate.observedAt.slice(0, 40)
            : undefined,
      },
    ];
  });
}

function editorialCoverLabel(category: EditorialCategory) {
  return category === 'news'
    ? 'Nhịp vàng hôm nay'
    : category === 'explain'
      ? 'Giải mã thị trường'
      : 'Kinh nghiệm giao dịch';
}

async function uniqueSlug(base: string) {
  const normalized = editorialSlug(base);
  const rows = await getDatabase()
    .select({ slug: articles.slug })
    .from(articles)
    .where(like(articles.slug, `${normalized}%`));
  const existing = new Set(rows.map((row) => row.slug));
  if (!existing.has(normalized)) return normalized;
  let index = 2;
  let next = `${normalized.slice(0, 150)}-${index}`;
  while (existing.has(next)) {
    index += 1;
    next = `${normalized.slice(0, 150)}-${index}`;
  }
  return next;
}

export async function ensurePublicationSlots(localDate = vietnamLocalDate()) {
  const values = editorialScheduleForDate(localDate).map((entry) => ({
    ...entry,
    status: 'open' as const,
  }));
  await getDatabase()
    .insert(editorialPublicationSlots)
    .values(values)
    .onConflictDoNothing({
      target: [
        editorialPublicationSlots.localDate,
        editorialPublicationSlots.slot,
      ],
    });
  return listPublicationSlots(localDate);
}

export async function listPublicationSlots(localDate = vietnamLocalDate()) {
  return getDatabase()
    .select()
    .from(editorialPublicationSlots)
    .where(eq(editorialPublicationSlots.localDate, localDate))
    .orderBy(editorialPublicationSlots.scheduledAt);
}

export async function listAdminArticles() {
  const db = getDatabase();
  const rows = await db
    .select()
    .from(articles)
    .orderBy(desc(articles.updatedAt))
    .limit(100);
  const revisions = rows.length
    ? await db
        .select()
        .from(articleRevisions)
        .where(
          inArray(
            articleRevisions.articleId,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(desc(articleRevisions.createdAt))
    : [];
  const translations = revisions.length
    ? await db
        .select()
        .from(articleTranslations)
        .where(
          inArray(
            articleTranslations.sourceRevisionId,
            revisions.map((revision) => revision.id),
          ),
        )
    : [];
  return rows.map((article) => {
    const articleRevisionsForArticle = revisions.filter(
      (revision) => revision.articleId === article.id,
    );
    return {
      ...article,
      latestRevision: articleRevisionsForArticle[0] ?? null,
      publishedRevision:
        articleRevisionsForArticle.find(
          (revision) => revision.id === article.publishedRevisionId,
        ) ?? null,
      revisions: articleRevisionsForArticle,
      translations: translations.filter((translation) =>
        articleRevisionsForArticle.some(
          (revision) => revision.id === translation.sourceRevisionId,
        ),
      ),
    };
  });
}

export async function listEditorialJobs() {
  return getDatabase()
    .select()
    .from(editorialJobs)
    .orderBy(desc(editorialJobs.createdAt))
    .limit(50);
}

export async function createArticleDraft(input: {
  title: string;
  excerpt: string;
  contentMarkdown: string;
  category: EditorialCategory;
  sources: EditorialSource[];
  evidence?: EditorialEvidence[];
  sourceEventId?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  coverAlt?: string | null;
  imagePrompt?: string | null;
  authorName?: string;
  createdByUserId?: string | null;
}) {
  const db = getDatabase();
  const slug = await uniqueSlug(input.title);
  const cover = getBrandCover(input.category);
  return db.transaction(async (tx) => {
    const [article] = await tx
      .insert(articles)
      .values({
        slug,
        category: input.category,
        status: 'draft',
        authorName: input.authorName || 'Kim Tuyến',
      })
      .returning();
    const [revision] = await tx
      .insert(articleRevisions)
      .values({
        articleId: article.id,
        title: input.title.trim().slice(0, 180),
        excerpt: input.excerpt.trim().slice(0, 360),
        contentMarkdown: input.contentMarkdown.trim().slice(0, 40_000),
        coverLabel: editorialCoverLabel(input.category),
        coverAlt: input.coverAlt?.trim().slice(0, 240) || cover.alt,
        publicationCategory: input.category,
        sourceEventId: input.sourceEventId ?? null,
        seoTitle: input.seoTitle?.trim().slice(0, 180) || null,
        seoDescription: input.seoDescription?.trim().slice(0, 360) || null,
        coverImageUrl: cover.url,
        coverImageAlt: cover.alt,
        coverImageDisclosure: cover.disclosure,
        coverImageProvider: 'brand-library',
        coverImageModel: cover.version,
        coverImagePrompt: null,
        coverImageGeneratedAt: null,
        sources: input.sources,
        evidence: input.evidence ?? [],
        status: 'draft',
        approvalStatus: 'pending',
        createdByUserId: input.createdByUserId || null,
      })
      .returning();
    return { article, revision };
  });
}

export async function createEditorialRevision(input: {
  articleId: string;
  title: string;
  excerpt: string;
  contentMarkdown: string;
  category: EditorialCategory;
  sources: EditorialSource[];
  evidence?: EditorialEvidence[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  coverAlt?: string | null;
  imagePrompt?: string | null;
  reviewNote?: string | null;
  createdByUserId?: string | null;
}) {
  const db = getDatabase();
  const [article] = await db
    .select()
    .from(articles)
    .where(eq(articles.id, input.articleId))
    .limit(1);
  if (!article) throw new Error('Không tìm thấy bài viết.');
  const [previous] = await db
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.articleId, input.articleId))
    .orderBy(desc(articleRevisions.createdAt))
    .limit(1);
  const inheritedCover =
    previous?.publicationCategory === input.category && previous.coverImageUrl
      ? {
          coverImageUrl: previous.coverImageUrl,
          coverImageAlt: previous.coverImageAlt,
          coverImageStorageKey: previous.coverImageStorageKey,
          coverImageDisclosure: previous.coverImageDisclosure,
          coverImageProvider: previous.coverImageProvider,
          coverImageModel: previous.coverImageModel,
        }
      : (() => {
          const cover = getBrandCover(input.category);
          return {
            coverImageUrl: cover.url,
            coverImageAlt: cover.alt,
            coverImageStorageKey: null,
            coverImageDisclosure: cover.disclosure,
            coverImageProvider: 'brand-library',
            coverImageModel: cover.version,
          };
        })();
  const [revision] = await db
    .insert(articleRevisions)
    .values({
      articleId: input.articleId,
      title: input.title.trim().slice(0, 180),
      excerpt: input.excerpt.trim().slice(0, 360),
      contentMarkdown: input.contentMarkdown.trim().slice(0, 40_000),
      coverLabel: editorialCoverLabel(input.category),
      coverAlt:
        input.coverAlt?.trim().slice(0, 240) ||
        input.title.trim().slice(0, 240),
      publicationCategory: input.category,
      sourceEventId: previous?.sourceEventId ?? null,
      seoTitle: input.seoTitle?.trim().slice(0, 180) || null,
      seoDescription: input.seoDescription?.trim().slice(0, 360) || null,
      ...inheritedCover,
      coverImagePrompt: null,
      coverImageGeneratedAt: null,
      sources: input.sources,
      evidence: input.evidence ?? previous?.evidence ?? [],
      status: 'draft',
      approvalStatus: 'pending',
      reviewNote: input.reviewNote?.trim().slice(0, 2_000) || null,
      createdByUserId: input.createdByUserId || null,
    })
    .returning();
  await db
    .update(articles)
    .set({ updatedAt: new Date() })
    .where(eq(articles.id, input.articleId));
  return revision;
}

function validatePublishableRevision(
  revision: typeof articleRevisions.$inferSelect,
) {
  if (
    !revision.title.trim() ||
    !revision.excerpt.trim() ||
    !revision.contentMarkdown.trim()
  ) {
    throw new Error('Bài viết chưa đủ nội dung để xuất bản.');
  }
  if (!revision.sources.length && !revision.evidence.length) {
    throw new Error(
      'Bài viết cần ít nhất một nguồn hoặc gói dữ kiện trước khi xuất bản.',
    );
  }
  const isBrandCover =
    revision.coverImageProvider === 'brand-library' &&
    isBrandCoverUrl(revision.coverImageUrl);
  if (
    !revision.coverImageUrl ||
    (!isBrandCover && !revision.coverImageStorageKey)
  ) {
    throw new Error('Bài viết cần ảnh minh họa hợp lệ trước khi duyệt.');
  }
}

export async function setRevisionCoverImage(input: {
  articleId: string;
  revisionId: string;
  url: string;
  storageKey?: string | null;
  alt: string;
  disclosure: string;
  provider: 'brand-library' | 'admin-upload';
  model: string;
}) {
  if (input.provider === 'brand-library' && !isBrandCoverUrl(input.url)) {
    throw new Error('Ảnh thương hiệu không nằm trong danh mục cho phép.');
  }
  const [revision] = await getDatabase()
    .update(articleRevisions)
    .set({
      coverImageUrl: input.url,
      coverImageStorageKey: input.storageKey ?? null,
      coverAlt: input.alt.slice(0, 240),
      coverImageAlt: input.alt.slice(0, 240),
      coverImageDisclosure: input.disclosure.slice(0, 160),
      coverImageProvider: input.provider,
      coverImageModel: input.model.slice(0, 120),
      coverImagePrompt: null,
      coverImageGeneratedAt: null,
      approvalStatus: 'pending',
      approvedByUserId: null,
      approvedAt: null,
      reviewedByUserId: null,
      reviewedAt: null,
    })
    .where(
      and(
        eq(articleRevisions.id, input.revisionId),
        eq(articleRevisions.articleId, input.articleId),
        inArray(articleRevisions.approvalStatus, [
          'pending',
          'changes_requested',
        ]),
      ),
    )
    .returning();
  if (!revision) {
    throw new Error(
      'Phiên bản đã được duyệt hoặc đã thay đổi; hãy tạo revision mới trước khi đổi ảnh.',
    );
  }
  await getDatabase()
    .update(articles)
    .set({ updatedAt: new Date() })
    .where(eq(articles.id, input.articleId));
  return revision;
}

export async function setRevisionGeneratedImage(input: {
  revisionId: string;
  url: string;
  storageKey: string;
  alt: string;
  prompt: string;
  provider: string;
  model: string;
}) {
  const [revision] = await getDatabase()
    .update(articleRevisions)
    .set({
      coverImageUrl: input.url,
      coverImageStorageKey: input.storageKey,
      coverImageAlt: input.alt.slice(0, 240),
      coverImageDisclosure: 'Ảnh minh họa bằng AI',
      coverImagePrompt: input.prompt.slice(0, 4_000),
      coverImageProvider: input.provider.slice(0, 80),
      coverImageModel: input.model.slice(0, 120),
      coverImageGeneratedAt: new Date(),
      approvalStatus: 'pending',
      approvedByUserId: null,
      approvedAt: null,
    })
    .where(eq(articleRevisions.id, input.revisionId))
    .returning();
  if (!revision) throw new Error('Không tìm thấy phiên bản ảnh cần cập nhật.');
  return revision;
}

export async function approveAndScheduleRevisions(input: {
  localDate?: string;
  approvals: Array<{
    articleId: string;
    revisionId: string;
    slot: EditorialPublicationSlot;
  }>;
  reviewerId?: string | null;
}) {
  const localDate = input.localDate || vietnamLocalDate();
  if (!input.approvals.length || input.approvals.length > 3) {
    throw new Error('Chọn từ một đến ba phiên bản để duyệt.');
  }
  if (
    new Set(input.approvals.map((item) => item.slot)).size !==
    input.approvals.length
  ) {
    throw new Error('Mỗi khung giờ chỉ nhận một bài viết.');
  }
  if (!input.approvals.every((item) => isEditorialPublicationSlot(item.slot))) {
    throw new Error('Khung giờ xuất bản không hợp lệ.');
  }
  await ensurePublicationSlots(localDate);
  const db = getDatabase();
  const now = new Date();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`editorial-approval:${localDate}`}))`,
    );
    const result = [] as Array<{
      slot: EditorialPublicationSlot;
      revisionId: string;
    }>;
    for (const approval of input.approvals) {
      const [revision] = await tx
        .select()
        .from(articleRevisions)
        .where(
          and(
            eq(articleRevisions.id, approval.revisionId),
            eq(articleRevisions.articleId, approval.articleId),
          ),
        )
        .limit(1);
      if (!revision) throw new Error('Phiên bản cần duyệt không còn tồn tại.');
      validatePublishableRevision(revision);
      const [slot] = await tx
        .select()
        .from(editorialPublicationSlots)
        .where(
          and(
            eq(editorialPublicationSlots.localDate, localDate),
            eq(editorialPublicationSlots.slot, approval.slot),
          ),
        )
        .limit(1);
      if (!slot) throw new Error('Không tạo được lịch đăng.');
      if (slot.status === 'published' || slot.status === 'publishing') {
        throw new Error(`Khung ${approval.slot} đã được xử lý.`);
      }
      if (
        slot.status === 'scheduled' &&
        slot.revisionId !== approval.revisionId
      ) {
        throw new Error(`Khung ${approval.slot} đã có bài được duyệt.`);
      }
      await tx
        .update(articleRevisions)
        .set({
          approvalStatus: 'approved',
          approvedByUserId: input.reviewerId ?? null,
          approvedAt: now,
          reviewedByUserId: input.reviewerId ?? null,
          reviewedAt: now,
          status: 'reviewed',
          reviewNote: null,
        })
        .where(eq(articleRevisions.id, revision.id));
      await tx
        .update(editorialPublicationSlots)
        .set({
          status: 'scheduled',
          articleId: approval.articleId,
          revisionId: approval.revisionId,
          scheduledByUserId: input.reviewerId ?? null,
          scheduledOn: now,
          approvedByUserId: input.reviewerId ?? null,
          approvedAt: now,
          failureCount: 0,
          failureMessage: null,
          lastFailedAt: null,
          updatedAt: now,
        })
        .where(eq(editorialPublicationSlots.id, slot.id));
      result.push({ slot: approval.slot, revisionId: revision.id });
    }
    return result;
  });
}

export async function requestRevisionChanges(input: {
  articleId: string;
  revisionId: string;
  reviewNote: string;
  reviewerId?: string | null;
}) {
  const now = new Date();
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [revision] = await tx
      .select()
      .from(articleRevisions)
      .where(
        and(
          eq(articleRevisions.id, input.revisionId),
          eq(articleRevisions.articleId, input.articleId),
        ),
      )
      .limit(1);
    if (!revision) throw new Error('Không tìm thấy phiên bản cần góp ý.');
    await tx
      .update(articleRevisions)
      .set({
        approvalStatus: 'changes_requested',
        reviewNote: input.reviewNote.trim().slice(0, 2_000),
        reviewedByUserId: input.reviewerId ?? null,
        reviewedAt: now,
      })
      .where(eq(articleRevisions.id, revision.id));
    await tx
      .update(editorialPublicationSlots)
      .set({
        status: 'open',
        articleId: null,
        revisionId: null,
        scheduledByUserId: null,
        scheduledOn: null,
        approvedByUserId: null,
        approvedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(editorialPublicationSlots.revisionId, revision.id),
          eq(editorialPublicationSlots.status, 'scheduled'),
        ),
      );
    return revision;
  });
}

export async function skipEditorialSlot(
  localDate: string,
  slot: EditorialPublicationSlot,
) {
  if (!isEditorialPublicationSlot(slot))
    throw new Error('Khung giờ không hợp lệ.');
  await ensurePublicationSlots(localDate);
  const [updated] = await getDatabase()
    .update(editorialPublicationSlots)
    .set({
      status: 'skipped',
      articleId: null,
      revisionId: null,
      scheduledByUserId: null,
      scheduledOn: null,
      approvedByUserId: null,
      approvedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(editorialPublicationSlots.localDate, localDate),
        eq(editorialPublicationSlots.slot, slot),
      ),
    )
    .returning();
  return updated ?? null;
}

function revalidateEditorialPublicContent(slug: string) {
  revalidatePath('/');
  revalidatePath('/nhip-vang');
  revalidatePath('/sitemap.xml');
  revalidatePath('/news-sitemap.xml');
  revalidatePath(`/nhip-vang/${slug}`);
  clearEditorialCache(slug);
}

export async function publishDueSlot(
  localDate: string,
  slotName: EditorialPublicationSlot,
) {
  if (!isEditorialPublicationSlot(slotName))
    throw new Error('Khung giờ không hợp lệ.');
  const db = getDatabase();
  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`editorial-publish:${localDate}:${slotName}`}))`,
    );
    const [slot] = await tx
      .select()
      .from(editorialPublicationSlots)
      .where(
        and(
          eq(editorialPublicationSlots.localDate, localDate),
          eq(editorialPublicationSlots.slot, slotName),
        ),
      )
      .limit(1);
    if (!slot) return { status: 'missing' as const };
    if (slot.status === 'published')
      return { status: 'published' as const, slug: null };
    if (slot.status !== 'scheduled' || !slot.articleId || !slot.revisionId) {
      return { status: 'not_scheduled' as const };
    }
    if (slot.scheduledAt > now) return { status: 'not_due' as const };
    const [revision] = await tx
      .select()
      .from(articleRevisions)
      .where(
        and(
          eq(articleRevisions.id, slot.revisionId),
          eq(articleRevisions.articleId, slot.articleId),
        ),
      )
      .limit(1);
    const [article] = await tx
      .select()
      .from(articles)
      .where(eq(articles.id, slot.articleId))
      .limit(1);
    if (!revision || !article || revision.approvalStatus !== 'approved') {
      await tx
        .update(editorialPublicationSlots)
        .set({
          status: 'failed',
          failureCount: slot.failureCount + 1,
          failureMessage: 'Phiên bản đã duyệt không còn hợp lệ.',
          lastFailedAt: now,
          updatedAt: now,
        })
        .where(eq(editorialPublicationSlots.id, slot.id));
      return { status: 'invalid_approval' as const };
    }
    try {
      validatePublishableRevision(revision);
    } catch (error) {
      await tx
        .update(editorialPublicationSlots)
        .set({
          status: 'failed',
          failureCount: slot.failureCount + 1,
          failureMessage:
            error instanceof Error
              ? error.message.slice(0, 500)
              : 'Bài không đủ điều kiện đăng.',
          lastFailedAt: now,
          updatedAt: now,
        })
        .where(eq(editorialPublicationSlots.id, slot.id));
      return { status: 'invalid_content' as const };
    }
    await tx
      .update(articleRevisions)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(articleRevisions.articleId, article.id),
          eq(articleRevisions.status, 'published'),
        ),
      );
    await tx
      .update(articleRevisions)
      .set({ status: 'published', reviewedAt: revision.reviewedAt ?? now })
      .where(eq(articleRevisions.id, revision.id));
    await tx
      .update(articles)
      .set({
        status: 'published',
        publishedRevisionId: revision.id,
        publishedCategory: revision.publicationCategory ?? article.category,
        publishedAt: article.publishedAt ?? now,
        publicModifiedAt: now,
        updatedAt: now,
      })
      .where(eq(articles.id, article.id));
    await tx
      .update(editorialPublicationSlots)
      .set({
        status: 'published',
        publishedAt: now,
        failureMessage: null,
        updatedAt: now,
      })
      .where(eq(editorialPublicationSlots.id, slot.id));
    return {
      status: 'published_now' as const,
      slug: article.slug,
      revisionId: revision.id,
    };
  });
  if (outcome.status === 'published_now' && outcome.slug) {
    revalidateEditorialPublicContent(outcome.slug);
    await import('./workflow')
      .then(({ queueEditorialTranslation }) =>
        queueEditorialTranslation(outcome.revisionId),
      )
      .catch(() => undefined);
  }
  return outcome;
}

export async function unpublishArticle(articleId: string) {
  const now = new Date();
  const [article] = await getDatabase()
    .update(articles)
    .set({ status: 'archived', publishedRevisionId: null, updatedAt: now })
    .where(eq(articles.id, articleId))
    .returning();
  if (article) revalidateEditorialPublicContent(article.slug);
  return article ?? null;
}

export async function restoreArticleRevision(
  articleId: string,
  revisionId: string,
  createdByUserId?: string | null,
) {
  const db = getDatabase();
  const [revision] = await db
    .select()
    .from(articleRevisions)
    .where(
      and(
        eq(articleRevisions.id, revisionId),
        eq(articleRevisions.articleId, articleId),
      ),
    )
    .limit(1);
  if (!revision) throw new Error('Không tìm thấy phiên bản cần khôi phục.');
  const [restored] = await db
    .insert(articleRevisions)
    .values({
      articleId,
      title: revision.title,
      excerpt: revision.excerpt,
      contentMarkdown: revision.contentMarkdown,
      coverLabel: revision.coverLabel,
      coverAlt: revision.coverAlt,
      publicationCategory: revision.publicationCategory,
      sourceEventId: revision.sourceEventId,
      seoTitle: revision.seoTitle,
      seoDescription: revision.seoDescription,
      coverImageUrl: revision.coverImageUrl,
      coverImageAlt: revision.coverImageAlt,
      coverImageStorageKey: revision.coverImageStorageKey,
      coverImageDisclosure: revision.coverImageDisclosure,
      coverImageProvider: revision.coverImageProvider,
      coverImageModel: revision.coverImageModel,
      coverImagePrompt: revision.coverImagePrompt,
      coverImageGeneratedAt: revision.coverImageGeneratedAt,
      sources: revision.sources,
      evidence: revision.evidence,
      status: 'draft',
      approvalStatus: 'pending',
      createdByUserId: createdByUserId || null,
    })
    .returning();
  await db
    .update(articles)
    .set({ updatedAt: new Date() })
    .where(eq(articles.id, articleId));
  return restored;
}

export function editorialAdminSummary(input: {
  slots: Awaited<ReturnType<typeof listPublicationSlots>>;
  articles: Awaited<ReturnType<typeof listAdminArticles>>;
}) {
  const pendingRevisions = input.articles.flatMap((article) =>
    article.revisions
      .filter(
        (revision) =>
          revision.approvalStatus === 'pending' ||
          revision.approvalStatus === 'changes_requested',
      )
      .map((revision) => ({
        articleId: article.id,
        slug: article.slug,
        revision,
      })),
  );
  return {
    localDate: input.slots[0]?.localDate ?? vietnamLocalDate(),
    slots: input.slots,
    pendingRevisions,
    missingSlots: publicationSlots.filter(
      (slot) =>
        !input.slots.some(
          (item) => item.slot === slot && item.status === 'scheduled',
        ),
    ),
  };
}

export { validateEvidence };
