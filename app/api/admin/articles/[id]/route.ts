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
import {
  getAdminHistory,
  getAdminRevision,
  listTranslationSummaries,
} from '@/lib/editorial/admin-read';
import { EditorialStateError } from '@/lib/editorial/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  revisionId: z.uuid(),
  version: z.string().length(64),
  title: z.string().trim().min(5).max(180).optional(),
  excerpt: z.string().trim().min(20).max(360).optional(),
  contentMarkdown: z.string().trim().min(20).max(40_000).optional(),
  sources: z.unknown().optional(),
  evidence: z.unknown().optional(),
  category: z.enum(['news', 'explain', 'practice']).optional(),
  seoTitle: z.string().trim().max(180).nullable().optional(),
  seoDescription: z.string().trim().max(360).nullable().optional(),
  coverAlt: z.string().trim().max(240).nullable().optional(),
  reviewNote: z.string().trim().max(2_000).optional(),
});

function errorResponse(error: unknown) {
  if (error instanceof EditorialStateError)
    return Response.json({ error: error.message }, { status: error.status });
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

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireEditorialAdmin();
    const { id } = await context.params;
    const params = new URL(request.url).searchParams;
    const parsed = z
      .object({
        revisionId: z.uuid().optional(),
        mode: z.enum(['history', 'translations']).optional(),
        page: z.coerce.number().int().min(1).max(100_000).default(1),
      })
      .safeParse(Object.fromEntries(params));
    if (!z.uuid().safeParse(id).success || !parsed.success)
      return Response.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 400 });
    const data = parsed.data;
    return Response.json(
      data.mode === 'history'
        ? { history: await getAdminHistory(id, data.page) }
        : data.mode === 'translations'
          ? {
              translations: await listTranslationSummaries(
                (await getAdminRevision(id, data.revisionId)).revisionId,
              ),
            }
          : { item: await getAdminRevision(id, data.revisionId) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
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
      sources:
        parsed.data.sources === undefined
          ? undefined
          : validateEditorialSources(parsed.data.sources),
      evidence:
        parsed.data.evidence === undefined
          ? undefined
          : validateEvidence(parsed.data.evidence),
      createdByUserId: admin.id,
    });
    return Response.json(
      { item: await getAdminRevision(id, revision.id) },
      { status: 201 },
    );
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
    const parsed = z
      .object({ revisionId: z.uuid(), version: z.string().length(64) })
      .safeParse(await readJsonBody(request, 1024));
    if (!parsed.success)
      return Response.json(
        { error: 'Phiên bản không hợp lệ.' },
        { status: 400 },
      );
    const article = await unpublishArticle(id, parsed.data);
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
