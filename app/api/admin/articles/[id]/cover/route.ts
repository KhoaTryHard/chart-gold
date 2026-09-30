import sharp from 'sharp';
import { del } from '@vercel/blob';
import { and, eq } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { articleRevisions } from '@/db/schema';
import {
  requireEditorialAdmin,
  EditorialAuthError,
} from '@/lib/editorial/auth';
import { getBrandCover } from '@/lib/editorial/brand-covers';
import { setRevisionCoverImage } from '@/lib/editorial/admin';
import { storeEditorialImageUpload } from '@/lib/editorial/images';
import { isTrustedOrigin } from '@/lib/server/origin';
import type { EditorialCategory } from '@/lib/editorial/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function textField(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function errorResponse(error: unknown) {
  if (error instanceof EditorialAuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message =
    error instanceof Error ? error.message : 'Không thể đổi ảnh bìa.';
  return Response.json({ error: message }, { status: 503 });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 403 });
  }
  try {
    await requireEditorialAdmin();
    const { id: articleId } = await context.params;
    const form = await request.formData();
    const revisionId = textField(form, 'revisionId');
    const source = textField(form, 'source');
    if (
      !revisionId ||
      (source !== 'brand-library' && source !== 'admin-upload')
    ) {
      return Response.json(
        { error: 'Dữ liệu ảnh bìa không hợp lệ.' },
        { status: 400 },
      );
    }
    const [revision] = await getDatabase()
      .select()
      .from(articleRevisions)
      .where(
        and(
          eq(articleRevisions.id, revisionId),
          eq(articleRevisions.articleId, articleId),
        ),
      )
      .limit(1);
    if (!revision) {
      return Response.json(
        { error: 'Không tìm thấy phiên bản bài viết.' },
        { status: 404 },
      );
    }
    if (
      revision.approvalStatus === 'approved' ||
      revision.status === 'published'
    ) {
      return Response.json(
        { error: 'Phiên bản đã duyệt cần tạo revision mới trước khi đổi ảnh.' },
        { status: 409 },
      );
    }

    if (source === 'brand-library') {
      const category = (revision.publicationCategory ??
        'news') as EditorialCategory;
      const cover = getBrandCover(category, textField(form, 'coverId') || null);
      const updated = await setRevisionCoverImage({
        articleId,
        revisionId,
        url: cover.url,
        alt: textField(form, 'alt') || cover.alt,
        disclosure: cover.disclosure,
        provider: 'brand-library',
        model: cover.version,
      });
      return Response.json({ revision: updated });
    }

    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return Response.json(
        { error: 'Chọn một ảnh JPG, PNG hoặc WebP.' },
        { status: 400 },
      );
    }
    if (file.size > MAX_UPLOAD_BYTES || !allowedMimeTypes.has(file.type)) {
      return Response.json(
        { error: 'Ảnh phải là JPG, PNG hoặc WebP và không quá 4 MB.' },
        { status: 400 },
      );
    }
    const inputBytes = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(inputBytes).metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width < 640 ||
      metadata.height < 360
    ) {
      return Response.json(
        { error: 'Ảnh cần có kích thước tối thiểu 640×360.' },
        { status: 400 },
      );
    }
    const normalized = await sharp(inputBytes)
      .resize({ width: 1200, height: 675, fit: 'cover', position: 'centre' })
      .webp({ quality: 84 })
      .toBuffer();
    const stored = await storeEditorialImageUpload({
      revisionId,
      bytes: normalized,
      mimeType: 'image/webp',
    });
    try {
      const updated = await setRevisionCoverImage({
        articleId,
        revisionId,
        url: `/api/editorial/media/${revisionId}`,
        storageKey: stored.pathname,
        alt: textField(form, 'alt') || revision.coverAlt || revision.title,
        disclosure: textField(form, 'disclosure') || 'Ảnh do Admin tải lên',
        provider: 'admin-upload',
        model: 'webp-1200x675',
      });
      return Response.json({ revision: updated });
    } catch (error) {
      await del(stored.url).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
