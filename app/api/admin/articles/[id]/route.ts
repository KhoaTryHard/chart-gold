import { z } from 'zod';
import {
  createEditorialRevision,
  unpublishArticle,
  validateEvidence,
  validateEditorialSources,
} from '@/lib/editorial/admin';
import {
  requireEditorialAdmin,
  EditorialAuthError,
} from '@/lib/editorial/auth';
import { isTrustedOrigin } from '@/lib/server/origin';
import { readJsonBody } from '@/lib/server/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  title: z.string().trim().min(5).max(180),
  excerpt: z.string().trim().min(20).max(360),
  contentMarkdown: z.string().trim().min(20).max(40_000),
  sources: z.unknown().optional(),
  evidence: z.unknown().optional(),
  category: z.enum(['news', 'explain', 'practice']),
  seoTitle: z.string().trim().max(180).optional(),
  seoDescription: z.string().trim().max(360).optional(),
  coverAlt: z.string().trim().max(240).optional(),
  reviewNote: z.string().trim().max(2_000).optional(),
});

function errorResponse(error: unknown) {
  if (error instanceof EditorialAuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    {
      error:
        error instanceof Error ? error.message : 'Không thể cập nhật bài viết.',
    },
    { status: 503 },
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 403 });
  }
  try {
    const admin = await requireEditorialAdmin();
    const { id } = await context.params;
    const parsed = updateSchema.safeParse(
      await readJsonBody(request, 60 * 1024),
    );
    if (!parsed.success) {
      return Response.json(
        { error: 'Dữ liệu phiên bản không hợp lệ.' },
        { status: 400 },
      );
    }
    const revision = await createEditorialRevision({
      articleId: id,
      ...parsed.data,
      sources: validateEditorialSources(parsed.data.sources),
      evidence: validateEvidence(parsed.data.evidence),
      createdByUserId: admin.id,
    });
    return Response.json({ revision }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 403 });
  }
  try {
    await requireEditorialAdmin();
    const { id } = await context.params;
    const article = await unpublishArticle(id);
    if (!article)
      return Response.json(
        { error: 'Không tìm thấy bài viết.' },
        { status: 404 },
      );
    return Response.json({ article });
  } catch (error) {
    return errorResponse(error);
  }
}
