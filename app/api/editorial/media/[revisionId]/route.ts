import { get } from '@vercel/blob';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { articleRevisions, articles } from '@/db/schema';
import {
  requireEditorialAdmin,
  EditorialAuthError,
} from '@/lib/editorial/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ revisionId: string }> },
) {
  const { revisionId } = await context.params;
  const [row] = await getDatabase()
    .select({ article: articles, revision: articleRevisions })
    .from(articleRevisions)
    .innerJoin(articles, eq(articles.id, articleRevisions.articleId))
    .where(eq(articleRevisions.id, revisionId))
    .limit(1);
  if (!row?.revision.coverImageStorageKey) {
    return new Response('Không tìm thấy ảnh.', { status: 404 });
  }
  const publicRevision =
    row.article.status === 'published' &&
    row.article.publishedRevisionId === row.revision.id;
  if (!publicRevision) {
    try {
      await requireEditorialAdmin();
    } catch (error) {
      const status = error instanceof EditorialAuthError ? error.status : 403;
      return new Response('Không có quyền xem ảnh nháp.', { status });
    }
  }
  const result = await get(row.revision.coverImageStorageKey, {
    access: 'private',
  }).catch(() => null);
  if (!result || result.statusCode !== 200 || !result.stream) {
    return new Response('Không tìm thấy ảnh.', { status: 404 });
  }
  return new Response(result.stream, {
    headers: {
      'Content-Type': result.blob.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': publicRevision
        ? 'public, max-age=31536000, immutable'
        : 'private, no-store',
    },
  });
}
