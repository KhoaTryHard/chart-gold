import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { getDatabase, type AppDatabase } from '@/db';
import {
  assertRevisionVersion,
  editorialReadiness,
  EditorialStateError,
  validEditorialTimestamp,
} from './review';
import {
  articleRevisions,
  articleTranslations,
  articles,
  editorialJobs,
  editorialPublicationSlots,
  editorialIntegrationPackages,
} from '@/db/schema';
import { revalidateEditorialPublicContent } from './public-cache';
export { revalidateEditorialPublicContent } from './public-cache';
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

export type EditorialTransaction = Parameters<
  Parameters<AppDatabase['transaction']>[0]
>[0];
type EditorialConnection = AppDatabase | EditorialTransaction;

export async function lockEditorialArticle(
  tx: EditorialTransaction,
  articleId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${'editorial:article:' + articleId}))`,
  );
}
async function lockEditorialSlot(
  tx: EditorialTransaction,
  date: string,
  slot: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${'editorial:slot:' + date + ':' + slot}))`,
  );
}
async function latestRevision(db: EditorialConnection, articleId: string) {
  const [revision] = await db
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.articleId, articleId))
    .orderBy(desc(articleRevisions.createdAt), desc(articleRevisions.id))
    .limit(1);
  return revision;
}
async function currentRevision(
  tx: EditorialTransaction,
  articleId: string,
  revisionId?: string,
  version?: string,
) {
  await lockEditorialArticle(tx, articleId);
  const revision = await latestRevision(tx, articleId);
  if (!revision) throw new EditorialStateError('Không tìm thấy bài viết.', 404);
  if (revisionId && revision.id !== revisionId)
    throw new EditorialStateError('Bài đã có phiên bản mới. Hãy mở lại bài.');
  assertRevisionVersion(revision, version);
  return revision;
}
async function cancelArticleSchedules(
  tx: EditorialTransaction,
  articleId: string,
) {
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
      failureMessage: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(editorialPublicationSlots.articleId, articleId),
        inArray(editorialPublicationSlots.status, [
          'scheduled',
          'failed',
          'publishing',
        ]),
      ),
    );
}
async function revokeUnpublishedApprovals(
  tx: EditorialTransaction,
  articleId: string,
) {
  await cancelArticleSchedules(tx, articleId);
  await tx
    .update(articleRevisions)
    .set({
      approvalStatus: 'revoked',
      approvedAt: null,
      approvedByUserId: null,
    })
    .where(
      and(
        eq(articleRevisions.articleId, articleId),
        eq(articleRevisions.approvalStatus, 'approved'),
      ),
    );
}

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
  'moneyweb.co.za',
  'kitco.com',
  'reuters.com',
  'bloomberg.com',
  'apnews.com',
  'businessinsider.com',
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
    if (!allowed || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || Array.from(candidate.url).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 92)) return null;
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
    if (
      candidate.observedAt !== undefined &&
      (typeof candidate.observedAt !== 'string' ||
        !validEditorialTimestamp(candidate.observedAt))
    )
      throw new EditorialStateError(
        'Ngày ghi nhận dữ kiện phải là timestamp ISO hợp lệ.',
        400,
      );
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

async function uniqueSlug(
  base: string,
  db: EditorialConnection = getDatabase(),
) {
  const normalized = editorialSlug(base);
  const rows = await db
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

export async function createArticleDraft(
  input: {
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
  },
  transaction?: EditorialTransaction,
) {
  const cover = getBrandCover(input.category);
  const persist = async (tx: EditorialTransaction) => {
    // Different jobs can produce the same title. Serialize slug allocation with
    // the insert, rather than choosing a slug before the transaction starts.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${'editorial:slug:' + editorialSlug(input.title)}))`,
    );
    const slug = await uniqueSlug(input.title, tx);
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
  };
  return transaction
    ? persist(transaction)
    : getDatabase().transaction(persist);
}

export async function createEditorialRevision(
  input: {
    articleId: string;
    title?: string;
    excerpt?: string;
    contentMarkdown?: string;
    category?: EditorialCategory;
    sources?: EditorialSource[];
    evidence?: EditorialEvidence[];
    seoTitle?: string | null;
    seoDescription?: string | null;
    coverAlt?: string | null;
    imagePrompt?: string | null;
    reviewNote?: string | null;
    createdByUserId?: string | null;
    revisionId?: string;
    version?: string;
    restoreRevisionId?: string;
  },
  transaction?: EditorialTransaction,
) {
  const persist = async (tx: EditorialTransaction) => {
    const latest = await currentRevision(
      tx,
      input.articleId,
      input.revisionId,
      input.version,
    );
    const [article] = await tx
      .select()
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);
    if (!article)
      throw new EditorialStateError('Không tìm thấy bài viết.', 404);
    let previous = latest;
    if (input.restoreRevisionId) {
      const [restored] = await tx
        .select()
        .from(articleRevisions)
        .where(
          and(
            eq(articleRevisions.id, input.restoreRevisionId),
            eq(articleRevisions.articleId, input.articleId),
          ),
        )
        .limit(1);
      if (!restored)
        throw new EditorialStateError(
          'Không tìm thấy phiên bản cần khôi phục.',
          404,
        );
      previous = restored;
    }
    const category =
      input.category ??
      (previous.publicationCategory as EditorialCategory) ??
      (article.category as EditorialCategory);
    const id = randomUUID();
    const cover = getBrandCover(category);
    const inheritCover =
      previous.publicationCategory === category && previous.coverImageUrl;
    await revokeUnpublishedApprovals(tx, input.articleId);
    const [revision] = await tx
      .insert(articleRevisions)
      .values({
        id,
        articleId: input.articleId,
        title: (input.title ?? previous.title).trim().slice(0, 180),
        excerpt: (input.excerpt ?? previous.excerpt).trim().slice(0, 360),
        contentMarkdown: (input.contentMarkdown ?? previous.contentMarkdown)
          .trim()
          .slice(0, 40_000),
        publicationCategory: category,
        coverLabel: editorialCoverLabel(category),
        sourceEventId: previous.sourceEventId,
        seoTitle:
          input.seoTitle === undefined ? previous.seoTitle : input.seoTitle,
        seoDescription:
          input.seoDescription === undefined
            ? previous.seoDescription
            : input.seoDescription,
        coverAlt:
          input.coverAlt === undefined ? previous.coverAlt : input.coverAlt,
        coverImageUrl: inheritCover
          ? previous.coverImageStorageKey
            ? '/api/editorial/media/' + id
            : previous.coverImageUrl
          : cover.url,
        coverImageStorageKey: inheritCover
          ? previous.coverImageStorageKey
          : null,
        coverImageAlt:
          input.coverAlt === undefined
            ? inheritCover
              ? previous.coverImageAlt
              : cover.alt
            : input.coverAlt,
        coverImageDisclosure: inheritCover
          ? previous.coverImageDisclosure
          : cover.disclosure,
        coverImageProvider: inheritCover
          ? previous.coverImageProvider
          : 'brand-library',
        coverImageModel: inheritCover
          ? previous.coverImageModel
          : cover.version,
        sources: input.sources ?? previous.sources,
        evidence:
          input.evidence === undefined ? previous.evidence : input.evidence,
        reviewNote: input.reviewNote ?? previous.reviewNote,
        createdByUserId: input.createdByUserId ?? null,
        status: 'draft',
        approvalStatus: 'pending',
      })
      .returning();
    await tx
      .update(articles)
      .set({
        updatedAt: new Date(),
        status: article.status === 'archived' ? 'draft' : article.status,
      })
      .where(eq(articles.id, input.articleId));
    return revision;
  };
  return transaction
    ? persist(transaction)
    : getDatabase().transaction(persist);
}

export function validatePublishableRevision(
  revision: typeof articleRevisions.$inferSelect,
) {
  const readiness = editorialReadiness(revision);
  if (!readiness.ready)
    throw new EditorialStateError(readiness.blockers.join(' '), 400);
}

export async function setRevisionCoverImage(input: {
  articleId: string;
  revisionId: string;
  version?: string;
  url: string;
  storageKey?: string | null;
  alt: string;
  disclosure: string;
  provider: 'brand-library' | 'admin-upload';
  model: string;
}) {
  if (input.provider === 'brand-library' && !isBrandCoverUrl(input.url))
    throw new EditorialStateError(
      'Ảnh thương hiệu không nằm trong danh mục cho phép.',
      400,
    );
  return getDatabase().transaction(async (tx) => {
    const previous = await currentRevision(
      tx,
      input.articleId,
      input.revisionId,
      input.version,
    );
    if (
      previous.status === 'published' ||
      previous.status === 'superseded' ||
      previous.approvalStatus === 'approved'
    )
      throw new EditorialStateError(
        'Phiên bản đã duyệt cần tạo revision mới trước khi đổi ảnh.',
      );
    await cancelArticleSchedules(tx, input.articleId);
    const [revision] = await tx
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
      .where(eq(articleRevisions.id, previous.id))
      .returning();
    await tx
      .update(articles)
      .set({ updatedAt: new Date() })
      .where(eq(articles.id, input.articleId));
    return revision;
  });
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

export type EditorialReviewTarget = {
  articleId: string;
  revisionId: string;
  version?: string;
};
async function approveRevision(
  tx: EditorialTransaction,
  input: EditorialReviewTarget,
  reviewerId?: string | null,
) {
  const revision = await currentRevision(
    tx,
    input.articleId,
    input.revisionId,
    input.version,
  );
  const [external] = await tx
    .select({ id: editorialIntegrationPackages.id })
    .from(editorialIntegrationPackages)
    .where(eq(editorialIntegrationPackages.revisionId, revision.id))
    .limit(1);
  if (external)
    throw new EditorialStateError(
      'Gói Website + Facebook cần duyệt đúng bản trên Telegram.',
    );
  const [article] = await tx
    .select({ status: articles.status })
    .from(articles)
    .where(eq(articles.id, input.articleId))
    .limit(1);
  if (article?.status === 'archived')
    throw new EditorialStateError(
      'Bài đã gỡ; khôi phục thành nháp trước khi duyệt.',
    );
  if (revision.status === 'published' || revision.status === 'superseded')
    throw new EditorialStateError(
      'Phiên bản này đã đăng hoặc đã được thay thế.',
    );
  validatePublishableRevision(revision);
  const [updated] = await tx
    .update(articleRevisions)
    .set({
      approvalStatus: 'approved',
      approvedAt: revision.approvedAt ?? new Date(),
      approvedByUserId: revision.approvedByUserId ?? reviewerId ?? null,
      reviewedByUserId: reviewerId ?? null,
      reviewedAt: new Date(),
      status: 'reviewed',
    })
    .where(eq(articleRevisions.id, revision.id))
    .returning();
  return updated;
}
export async function approveEditorialRevisions(
  targets: EditorialReviewTarget[],
  reviewerId?: string | null,
) {
  if (!targets.length || targets.length > 20)
    throw new EditorialStateError('Chọn từ 1 đến 20 bài.', 400);
  const results = [];
  for (const target of targets) {
    try {
      const revision = await getDatabase().transaction((tx) =>
        approveRevision(tx, target, reviewerId),
      );
      results.push({ ...target, ok: true as const, revision });
    } catch (error) {
      results.push({
        ...target,
        ok: false as const,
        status: error instanceof EditorialStateError ? error.status : 503,
        error: error instanceof Error ? error.message : 'Không thể duyệt bài.',
      });
    }
  }
  return results;
}
async function scheduleRevision(
  tx: EditorialTransaction,
  input: EditorialReviewTarget & {
    localDate: string;
    slot: EditorialPublicationSlot;
  },
  reviewerId?: string | null,
) {
  const revision = await currentRevision(
    tx,
    input.articleId,
    input.revisionId,
    input.version,
  );
  if (revision.approvalStatus !== 'approved' || revision.status !== 'reviewed')
    throw new EditorialStateError(
      'Hãy duyệt đúng phiên bản trước khi xếp lịch.',
    );
  validatePublishableRevision(revision);
  const scheduled = editorialScheduleForDate(input.localDate).find(
    (item) => item.slot === input.slot,
  );
  if (!scheduled || scheduled.scheduledAt <= new Date())
    throw new EditorialStateError('Chọn một khung giờ trong tương lai.');
  await lockEditorialSlot(tx, input.localDate, input.slot);
  await tx
    .insert(editorialPublicationSlots)
    .values({ ...scheduled, status: 'open' })
    .onConflictDoNothing();
  const [slot] = await tx
    .select()
    .from(editorialPublicationSlots)
    .where(
      and(
        eq(editorialPublicationSlots.localDate, input.localDate),
        eq(editorialPublicationSlots.slot, input.slot),
      ),
    )
    .limit(1);
  if (slot.status === 'scheduled' && slot.revisionId === revision.id)
    return slot;
  if (slot.status !== 'open' || slot.articleId)
    throw new EditorialStateError('Khung giờ đã thay đổi. Hãy chọn lại.');
  const [existing] = await tx
    .select({ id: editorialPublicationSlots.id })
    .from(editorialPublicationSlots)
    .where(
      and(
        eq(editorialPublicationSlots.articleId, input.articleId),
        inArray(editorialPublicationSlots.status, ['scheduled', 'publishing']),
      ),
    )
    .limit(1);
  if (existing)
    throw new EditorialStateError(
      'Bài đã có lịch. Hủy lịch cũ trước khi chuyển giờ.',
    );
  const [updated] = await tx
    .update(editorialPublicationSlots)
    .set({
      status: 'scheduled',
      articleId: input.articleId,
      revisionId: revision.id,
      scheduledByUserId: reviewerId ?? null,
      scheduledOn: new Date(),
      approvedByUserId: revision.approvedByUserId,
      approvedAt: revision.approvedAt,
      failureCount: 0,
      failureMessage: null,
      lastFailedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(editorialPublicationSlots.id, slot.id))
    .returning();
  return updated;
}
export async function scheduleEditorialRevision(
  input: EditorialReviewTarget & {
    localDate: string;
    slot: EditorialPublicationSlot;
  },
  reviewerId?: string | null,
) {
  return getDatabase().transaction((tx) =>
    scheduleRevision(tx, input, reviewerId),
  );
}
export async function approveAndScheduleRevisions(input: {
  localDate?: string;
  approvals: (EditorialReviewTarget & { slot: EditorialPublicationSlot })[];
  reviewerId?: string | null;
}) {
  const localDate = input.localDate || vietnamLocalDate();
  if (
    !input.approvals.length ||
    input.approvals.length > 3 ||
    new Set(input.approvals.map((item) => item.slot)).size !==
      input.approvals.length
  )
    throw new EditorialStateError(
      'Chọn tối đa ba bài cho ba khung giờ khác nhau.',
      400,
    );
  return getDatabase().transaction(async (tx) => {
    const results = [];
    // All article locks precede any slot lock, and use stable ordering for legacy batches.
    for (const articleId of [
      ...new Set(input.approvals.map((item) => item.articleId)),
    ].sort())
      await lockEditorialArticle(tx, articleId);
    for (const item of [...input.approvals].sort((a, b) =>
      a.slot.localeCompare(b.slot),
    )) {
      await approveRevision(tx, item, input.reviewerId);
      const slot = await scheduleRevision(
        tx,
        { ...item, localDate },
        input.reviewerId,
      );
      results.push({ slot: slot.slot, revisionId: item.revisionId });
    }
    return results;
  });
}
export async function requestRevisionChanges(
  input: EditorialReviewTarget & {
    reviewNote: string;
    reviewerId?: string | null;
  },
) {
  return getDatabase().transaction(async (tx) => {
    const revision = await currentRevision(
      tx,
      input.articleId,
      input.revisionId,
      input.version,
    );
    await revokeUnpublishedApprovals(tx, input.articleId);
    const [updated] = await tx
      .update(articleRevisions)
      .set({
        approvalStatus: 'changes_requested',
        reviewNote: input.reviewNote.trim().slice(0, 2_000),
        approvedAt: null,
        approvedByUserId: null,
        reviewedByUserId: input.reviewerId ?? null,
        reviewedAt: new Date(),
      })
      .where(eq(articleRevisions.id, revision.id))
      .returning();
    return updated;
  });
}
export async function changeEditorialSlot(
  localDate: string,
  slotName: EditorialPublicationSlot,
  action: 'skip' | 'unschedule' | 'reopen',
  expected?: EditorialReviewTarget,
) {
  if (!isEditorialPublicationSlot(slotName))
    throw new EditorialStateError('Khung giờ không hợp lệ.', 400);
  const schedule = editorialScheduleForDate(localDate).find(
    (item) => item.slot === slotName,
  )!;
  const [observed] = await getDatabase()
    .select()
    .from(editorialPublicationSlots)
    .where(
      and(
        eq(editorialPublicationSlots.localDate, localDate),
        eq(editorialPublicationSlots.slot, slotName),
      ),
    )
    .limit(1);
  return getDatabase().transaction(async (tx) => {
    if (observed?.articleId) await lockEditorialArticle(tx, observed.articleId);
    await lockEditorialSlot(tx, localDate, slotName);
    await tx
      .insert(editorialPublicationSlots)
      .values({ ...schedule, status: 'open' })
      .onConflictDoNothing();
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
    if (
      slot.articleId !== (observed?.articleId ?? null) ||
      slot.revisionId !== (observed?.revisionId ?? null)
    )
      throw new EditorialStateError('Lịch đã thay đổi. Hãy tải lại.');
    if (expected) {
      if (
        slot.articleId !== expected.articleId ||
        slot.revisionId !== expected.revisionId
      )
        throw new EditorialStateError('Lịch đã thay đổi.');
      const [revision] = await tx
        .select()
        .from(articleRevisions)
        .where(eq(articleRevisions.id, expected.revisionId))
        .limit(1);
      if (!revision)
        throw new EditorialStateError('Phiên bản không còn tồn tại.');
      assertRevisionVersion(revision, expected.version);
    }
    if (['published', 'publishing'].includes(slot.status))
      throw new EditorialStateError('Khung giờ đã được xử lý.');
    if (action !== 'unschedule' && schedule.scheduledAt <= new Date())
      throw new EditorialStateError(
        'Khung giờ đã qua; hãy chọn giờ tương lai.',
      );
    if (
      action === 'reopen' &&
      !['failed', 'skipped', 'cancelled', 'missed'].includes(slot.status)
    )
      throw new EditorialStateError('Khung giờ không cần mở lại.');
    const [updated] = await tx
      .update(editorialPublicationSlots)
      .set({
        status: action === 'skip' ? 'skipped' : 'open',
        articleId: null,
        revisionId: null,
        scheduledByUserId: null,
        scheduledOn: null,
        approvedByUserId: null,
        approvedAt: null,
        failureMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(editorialPublicationSlots.id, slot.id))
      .returning();
    return updated;
  });
}
export async function skipEditorialSlot(
  date: string,
  slot: EditorialPublicationSlot,
) {
  return changeEditorialSlot(date, slot, 'skip');
}

export async function publishEditorialRevisionTransaction(
  tx: EditorialTransaction,
  article: typeof articles.$inferSelect,
  revision: typeof articleRevisions.$inferSelect,
  now = new Date(),
) {
  validatePublishableRevision(revision);
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
}

export async function publishDueSlot(
  localDate: string,
  slotName: EditorialPublicationSlot,
) {
  if (!isEditorialPublicationSlot(slotName))
    throw new Error('Khung giờ không hợp lệ.');
  const db = getDatabase();
  const now = new Date();
  const [observed] = await db
    .select()
    .from(editorialPublicationSlots)
    .where(
      and(
        eq(editorialPublicationSlots.localDate, localDate),
        eq(editorialPublicationSlots.slot, slotName),
      ),
    )
    .limit(1);
  const outcome = await db.transaction(async (tx) => {
    if (observed?.articleId) await lockEditorialArticle(tx, observed.articleId);
    await lockEditorialSlot(tx, localDate, slotName);
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
    if (
      slot.articleId !== observed?.articleId ||
      slot.revisionId !== observed?.revisionId
    )
      return { status: 'changed' as const };
    const latest = slot.articleId
      ? await latestRevision(tx, slot.articleId)
      : null;
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
    if (
      !revision ||
      !article ||
      article.status === 'archived' ||
      latest?.id !== revision.id ||
      revision.approvalStatus !== 'approved'
    ) {
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
    await publishEditorialRevisionTransaction(tx, article, revision, now);
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

export async function unpublishArticle(
  articleId: string,
  expected?: { revisionId: string; version?: string },
) {
  const article = await getDatabase().transaction(async (tx) => {
    await lockEditorialArticle(tx, articleId);
    if (expected)
      await currentRevision(
        tx,
        articleId,
        expected.revisionId,
        expected.version,
      );
    await revokeUnpublishedApprovals(tx, articleId);
    const [updated] = await tx
      .update(articles)
      .set({
        status: 'archived',
        publishedRevisionId: null,
        updatedAt: new Date(),
      })
      .where(eq(articles.id, articleId))
      .returning();
    return updated;
  });
  if (article) revalidateEditorialPublicContent(article.slug);
  return article ?? null;
}

export async function restoreArticleRevision(
  articleId: string,
  revisionId: string,
  createdByUserId?: string | null,
  expected?: { revisionId: string; version?: string },
) {
  return createEditorialRevision({
    articleId,
    restoreRevisionId: revisionId,
    createdByUserId,
    revisionId: expected?.revisionId,
    version: expected?.version,
  });
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
