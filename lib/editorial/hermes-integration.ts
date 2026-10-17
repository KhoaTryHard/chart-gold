import 'server-only';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { get, put, del } from './media-storage';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '@/db';
import {
  articles,
  articleRevisions,
  editorialIntegrationPackages,
  editorialPublicationSlots,
} from '@/db/schema';
import {
  createArticleDraft,
  createEditorialRevision,
  lockEditorialArticle,
  publishEditorialRevisionTransaction,
  revalidateEditorialPublicContent,
  validateEditorialSource,
  validateEvidence,
  validatePublishableRevision,
} from './admin';
import { assertRevisionVersion, revisionVersion } from './review';
import {
  integrationClient,
  IntegrationError,
  sha256,
} from './integration-auth';
import { siteUrl } from '@/lib/seo';
import {
  assertReadyVideo,
  readyVideoDescriptorSchema,
  requireHermesVideo,
  type ReadyVideoDescriptor,
} from './video-assets';

const timestamp = z.iso.datetime({ offset: true });
const sourceSchema = z.object({
  title: z.string().trim().min(1).max(180),
  url: z.url(),
  publishedAt: timestamp.optional(),
  accessedAt: timestamp,
});
const commonManifestSchema = z.object({
  imageOrigin: z.enum(['ai_generated', 'owner_upload']).optional(),
  rootId: z.string().regex(/^[A-Za-z0-9-]{1,80}$/),
  draftId: z.string().regex(/^[A-Za-z0-9-]{1,80}$/),
  externalRevision: z.number().int().min(1),
  website: z.object({
    title: z.string().trim().min(5).max(180),
    excerpt: z.string().trim().min(20).max(360),
    contentMarkdown: z.string().trim().min(20).max(40000),
    category: z.enum(['news', 'explain', 'practice']),
    sources: z.array(sourceSchema).min(1).max(12),
    evidence: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(180),
          value: z.string().trim().min(1).max(2000),
          sourceUrl: z.url().optional(),
          observedAt: timestamp.optional(),
        }),
      )
      .max(24)
      .default([]),
    seoTitle: z.string().trim().min(1).max(180),
    seoDescription: z.string().trim().min(1).max(360),
    coverAlt: z.string().trim().min(1).max(240),
  }),
  facebook: z.object({
    pageId: z.string().regex(/^\d+$/),
    caption: z.string().trim().min(20).max(2000),
    sourceComment: z.string().trim().min(10).max(7000),
  }),
  verification: z.object({
    verdict: z.literal('PASS'),
    websiteDigest: z.string().length(64),
    captionDigest: z.string().length(64),
  }),
});
// Strip an explicit legacy version as the original parser did: v2 digests remain unchanged.
const legacyManifestSchema = commonManifestSchema
  .extend({
    schemaVersion: z.literal(2).optional(),
    facebookMode: z.never().optional(),
    video: z.never().optional(),
  })
  .transform(({ schemaVersion: _schemaVersion, ...manifest }) => manifest);
export const hermesManifestSchema = z.union([
  commonManifestSchema.extend({
    schemaVersion: z.literal(3),
    facebookMode: z.literal('video'),
    video: readyVideoDescriptorSchema,
  }),
  commonManifestSchema.extend({
    schemaVersion: z.literal(3),
    facebookMode: z.literal('photo'),
    video: z.never().optional(),
  }),
  legacyManifestSchema,
]);
export const hermesApprovalSchema = z.object({
  reviewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  actorId: z.string().regex(/^\d+$/),
  chatId: z.string().regex(/^-?\d+$/),
  reviewMessageId: z.string().regex(/^\d+$/),
  callbackId: z.string().min(1).max(160),
  approvedAt: timestamp,
});
type Manifest = z.infer<typeof hermesManifestSchema>;
type CommonReviewPackage = {
  imageOrigin?: 'ai_generated' | 'owner_upload';
  draftId: string;
  rootId: string;
  externalRevision: number;
  website: Manifest['website'] & { url: string; revisionId: string };
  facebook: Manifest['facebook'];
  image: { sha256: string; mimeType: 'image/png'; url: string };
  verification: Manifest['verification'];
};
export type HermesReviewPackage = CommonReviewPackage &
  (
    | { schemaVersion: 2 }
    | { schemaVersion: 3; facebookMode: 'photo' }
    | { schemaVersion: 3; facebookMode: 'video'; video: ReadyVideoDescriptor }
  );
async function rows(id: string) {
  return getDatabase()
    .select({
      pack: editorialIntegrationPackages,
      article: articles,
      revision: articleRevisions,
    })
    .from(editorialIntegrationPackages)
    .innerJoin(
      articles,
      eq(articles.id, editorialIntegrationPackages.articleId),
    )
    .innerJoin(
      articleRevisions,
      eq(articleRevisions.id, editorialIntegrationPackages.revisionId),
    )
    .where(
      and(
        eq(editorialIntegrationPackages.id, id),
        eq(editorialIntegrationPackages.clientId, integrationClient),
      ),
    )
    .limit(1);
}
type Row = Awaited<ReturnType<typeof rows>>[number];
function response(row: Row) {
  const canonical = row.pack.reviewPackage;
  const reviewPackage = JSON.parse(canonical) as HermesReviewPackage;
  const current =
    row.article.status === 'published' &&
    row.article.publishedRevisionId === row.revision.id;
  return {
    packageId: row.pack.id,
    articleId: row.article.id,
    revisionId: row.revision.id,
    websiteVersion: row.pack.websiteVersion,
    reviewDigest: row.pack.reviewDigest,
    canonicalPackage: canonical,
    reviewPackage,
    state: row.pack.state,
    websitePublic: current,
    contentUnchanged: revisionVersion(row.revision) === row.pack.websiteVersion,
    expiresAt: new Date(
      row.pack.createdAt.getTime() + 24 * 3600000,
    ).toISOString(),
    receipt: row.pack.receipt,
    url: reviewPackage.website.url,
    imageUrl: reviewPackage.image.url,
    imageSha256: row.pack.imageSha256,
  };
}
export async function getHermesPackage(id: string) {
  const [row] = await rows(id);
  if (!row) throw new IntegrationError('Không tìm thấy gói.', 404);
  return response(row);
}

export async function prepareHermesPackage(value: unknown, original: Buffer) {
  const parsed = hermesManifestSchema.safeParse(value);
  if (!parsed.success)
    throw new IntegrationError('Gói nội dung không đúng schema.');
  const manifest = parsed.data;
  if ('schemaVersion' in manifest && manifest.schemaVersion === 3) {
    requireHermesVideo();
    if (manifest.facebookMode === 'video')
      await assertReadyVideo(manifest.video, manifest);
  }
  if (
    manifest.facebook.pageId !==
    (process.env.HERMES_EDITORIAL_PAGE_ID ?? '1262243656966414')
  )
    throw new IntegrationError('Fanpage không đúng đích.');
  for (const source of manifest.website.sources)
    if (
      !validateEditorialSource(source) ||
      new URL(source.url).protocol !== 'https:'
    )
      throw new IntegrationError(
        'Nguồn không được hỗ trợ: ' + new URL(source.url).hostname,
      );
  validateEvidence(manifest.website.evidence);
  if (
    sha256(manifest.website.contentMarkdown) !==
      manifest.verification.websiteDigest ||
    sha256(manifest.facebook.caption) !== manifest.verification.captionDigest
  )
    throw new IntegrationError('Kết quả kiểm chứng không khớp nội dung.');
  if (!original.length || original.length > 4 * 1024 * 1024)
    throw new IntegrationError('Ảnh vượt giới hạn 4 MB.');
  const metadata = await sharp(original, {
    limitInputPixels: 20_000_000,
  }).metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width < 640 ||
    metadata.height < 360
  )
    throw new IntegrationError('Ảnh cần tối thiểu 640×360.');
  const normalized = await sharp(original, { limitInputPixels: 20_000_000 })
    .rotate()
    .resize({ width: 1200, height: 675, fit: 'cover' })
    .png()
    .toBuffer();
  const imageSha = sha256(normalized);
  const inputDigest = sha256(JSON.stringify([manifest, sha256(original)]));
  let uploadedUrl: string | undefined;
  try {
    return await getDatabase().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${'hermes:root:' + manifest.rootId}))`,
      );
      const [existing] = await tx
        .select()
        .from(editorialIntegrationPackages)
        .where(
          and(
            eq(editorialIntegrationPackages.clientId, integrationClient),
            eq(editorialIntegrationPackages.draftId, manifest.draftId),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.inputDigest !== inputDigest)
          throw new IntegrationError(
            'Mã gói đã có nội dung khác; tạo phiên bản mới.',
            409,
          );
        const [article] = await tx
          .select()
          .from(articles)
          .where(eq(articles.id, existing.articleId));
        const [revision] = await tx
          .select()
          .from(articleRevisions)
          .where(eq(articleRevisions.id, existing.revisionId));
        return response({ pack: existing, article, revision });
      }
      const [previous] = await tx
        .select()
        .from(editorialIntegrationPackages)
        .where(
          and(
            eq(editorialIntegrationPackages.clientId, integrationClient),
            eq(editorialIntegrationPackages.rootId, manifest.rootId),
          ),
        )
        .orderBy(desc(editorialIntegrationPackages.externalRevision))
        .limit(1);
      if (previous && manifest.externalRevision <= previous.externalRevision)
        throw new IntegrationError(
          'Phiên bản bên ngoài không mới hơn bản trước.',
          409,
        );
      const created = previous
        ? {
            article: (
              await tx
                .select()
                .from(articles)
                .where(eq(articles.id, previous.articleId))
            )[0],
            revision: await createEditorialRevision(
              { ...manifest.website, articleId: previous.articleId },
              tx,
            ),
          }
        : await createArticleDraft(manifest.website, tx);
      const id = randomUUID();
      const stored = await put(
        `editorial/integrations/${id}/${imageSha}.png`,
        normalized,
        { access: 'private', contentType: 'image/png', addRandomSuffix: false },
      );
      uploadedUrl = stored.url;
      const imageUrl = new URL(
        '/api/editorial/media/' + created.revision.id,
        siteUrl,
      ).href;
      const [revision] = await tx
        .update(articleRevisions)
        .set({
          coverImageUrl: '/api/editorial/media/' + created.revision.id,
          coverImageStorageKey: stored.pathname,
          coverImageAlt: manifest.website.coverAlt,
          coverImageDisclosure:
            manifest.imageOrigin === 'owner_upload'
              ? 'Ảnh do chủ trang cung cấp'
              : 'Ảnh AI minh họa, không phải ảnh sự kiện hoặc bảng giá.',
          coverImageProvider: 'admin-upload',
          coverImageModel: 'hermes-png-1200x675',
          reviewNote: null,
        })
        .where(eq(articleRevisions.id, created.revision.id))
        .returning();
      validatePublishableRevision(revision);
      const url = new URL('/nhip-vang/' + created.article.slug, siteUrl).href;
      const commonReviewPackage: CommonReviewPackage = {
        ...(manifest.imageOrigin ? { imageOrigin: manifest.imageOrigin } : {}),
        draftId: manifest.draftId,
        rootId: manifest.rootId,
        externalRevision: manifest.externalRevision,
        website: { ...manifest.website, url, revisionId: revision.id },
        facebook: {
          ...manifest.facebook,
          caption: manifest.facebook.caption + '\n\nĐọc bài đầy đủ: ' + url,
        },
        image: { sha256: imageSha, mimeType: 'image/png', url: imageUrl },
        verification: manifest.verification,
      };
      const reviewPackage: HermesReviewPackage =
        'schemaVersion' in manifest && manifest.schemaVersion === 3
          ? manifest.facebookMode === 'video'
            ? {
                schemaVersion: 3,
                ...commonReviewPackage,
                facebookMode: 'video',
                video: manifest.video,
              }
            : {
                schemaVersion: 3,
                ...commonReviewPackage,
                facebookMode: 'photo',
              }
          : { schemaVersion: 2, ...commonReviewPackage };
      const canonical = JSON.stringify(reviewPackage);
      const [pack] = await tx
        .insert(editorialIntegrationPackages)
        .values({
          id,
          clientId: integrationClient,
          rootId: manifest.rootId,
          draftId: manifest.draftId,
          externalRevision: manifest.externalRevision,
          inputDigest,
          reviewDigest: sha256(canonical),
          reviewPackage: canonical,
          websiteVersion: revisionVersion(revision),
          articleId: created.article.id,
          revisionId: revision.id,
          imageSha256: imageSha,
        })
        .returning();
      return response({ pack, article: created.article, revision });
    });
  } catch (error) {
    if (uploadedUrl) await del(uploadedUrl).catch(() => undefined);
    throw error;
  }
}

export async function publishHermesPackage(id: string, value: unknown) {
  const parsed = hermesApprovalSchema.safeParse(value);
  if (!parsed.success)
    throw new IntegrationError('Bằng chứng duyệt không hợp lệ.');
  const approval = parsed.data;
  if (
    approval.actorId !== process.env.HERMES_EDITORIAL_OWNER_ID ||
    approval.chatId !== process.env.HERMES_EDITORIAL_CHAT_ID
  )
    throw new IntegrationError('Sai tài khoản hoặc nhóm duyệt.', 403);
  const [observed] = await rows(id);
  if (!observed) throw new IntegrationError('Không tìm thấy gói.', 404);
  const result = await getDatabase().transaction(async (tx) => {
    await lockEditorialArticle(tx, observed.article.id);
    const [pack] = await tx
      .select()
      .from(editorialIntegrationPackages)
      .where(eq(editorialIntegrationPackages.id, id))
      .limit(1);
    const [article] = await tx
      .select()
      .from(articles)
      .where(eq(articles.id, pack.articleId))
      .limit(1);
    const [revision] = await tx
      .select()
      .from(articleRevisions)
      .where(eq(articleRevisions.id, pack.revisionId))
      .limit(1);
    if (
      pack.reviewDigest !== approval.reviewDigest ||
      sha256(pack.reviewPackage) !== approval.reviewDigest
    )
      throw new IntegrationError('Digest không đúng bản duyệt.', 409);
    const reviewPackage = JSON.parse(pack.reviewPackage) as HermesReviewPackage;
    if (reviewPackage.schemaVersion === 3) {
      requireHermesVideo();
      if (reviewPackage.facebookMode === 'video')
        await assertReadyVideo(reviewPackage.video, pack);
    }
    assertRevisionVersion(revision, pack.websiteVersion);
    if (pack.state === 'published') {
      if (
        article.status !== 'published' ||
        article.publishedRevisionId !== revision.id
      )
        throw new IntegrationError(
          'Bài đã bị gỡ hoặc thay thế; không đăng lại.',
          409,
        );
      return response({ pack, article, revision });
    }
    const approvedTime = Date.parse(approval.approvedAt);
    const expiry = pack.createdAt.getTime() + 24 * 3600000;
    if (
      approvedTime < pack.createdAt.getTime() ||
      approvedTime > expiry ||
      approvedTime > Date.now() + 60000
    )
      throw new IntegrationError('Lần duyệt nằm ngoài hạn.', 409);
    const [latest] = await tx
      .select({ id: articleRevisions.id })
      .from(articleRevisions)
      .where(eq(articleRevisions.articleId, article.id))
      .orderBy(desc(articleRevisions.createdAt), desc(articleRevisions.id))
      .limit(1);
    if (latest.id !== revision.id || article.status === 'archived')
      throw new IntegrationError('Bài đã thay đổi hoặc đã gỡ.', 409);
    const [slot] = await tx
      .select({ id: editorialPublicationSlots.id })
      .from(editorialPublicationSlots)
      .where(
        and(
          eq(editorialPublicationSlots.articleId, article.id),
          inArray(editorialPublicationSlots.status, [
            'scheduled',
            'publishing',
          ]),
        ),
      )
      .limit(1);
    if (slot)
      throw new IntegrationError('Bài có lịch khác đang hiệu lực.', 409);
    const [approved] = await tx
      .update(articleRevisions)
      .set({
        approvalStatus: 'approved',
        status: 'reviewed',
        approvedAt: new Date(approval.approvedAt),
        reviewedAt: new Date(),
        approvedByUserId: null,
      })
      .where(eq(articleRevisions.id, revision.id))
      .returning();
    await publishEditorialRevisionTransaction(tx, article, approved);
    const receipt = {
      articleId: article.id,
      revisionId: revision.id,
      reviewDigest: pack.reviewDigest,
      url: reviewPackage.website.url,
      imageUrl: reviewPackage.image.url,
      imageSha256: pack.imageSha256,
      contentSha256: sha256(revision.contentMarkdown),
      publishedAt: new Date().toISOString(),
      ...(reviewPackage.schemaVersion === 3
        ? {
            facebookMode: reviewPackage.facebookMode,
            ...(reviewPackage.facebookMode === 'video'
              ? { video: reviewPackage.video }
              : {}),
          }
        : {}),
    };
    const [updated] = await tx
      .update(editorialIntegrationPackages)
      .set({
        state: 'published',
        approvalProvenance: approval,
        receipt,
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(editorialIntegrationPackages.id, id))
      .returning();
    return response({
      pack: updated,
      article: {
        ...article,
        status: 'published',
        publishedRevisionId: revision.id,
      },
      revision: approved,
    });
  });
  revalidateEditorialPublicContent(observed.article.slug);
  await import('./workflow')
    .then(({ queueEditorialTranslation }) =>
      queueEditorialTranslation(observed.revision.id),
    )
    .catch(() => undefined);
  return result;
}

export async function hermesPackageMedia(id: string) {
  const [row] = await rows(id);
  if (!row) throw new IntegrationError('Không tìm thấy gói.', 404);
  const file = await get(row.revision.coverImageStorageKey!, {
    access: 'private',
  });
  if (!file || file.statusCode !== 200 || !file.stream)
    throw new IntegrationError('Không đọc được ảnh.', 503);
  return new Response(file.stream, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, no-store',
      'X-Image-Sha256': row.pack.imageSha256,
    },
  });
}
