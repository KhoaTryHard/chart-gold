import { z } from 'zod';
import { waitUntil } from '@vercel/functions';
import {
  getAdminInbox,
  getAdminRevision,
  listAdminJobSummaries,
  toReviewSummary,
} from '@/lib/editorial/admin-read';
import {
  approveEditorialRevisions,
  scheduleEditorialRevision,
  changeEditorialSlot,
} from '@/lib/editorial/admin';
import { EditorialStateError } from '@/lib/editorial/review';
import { revalidateEditorialPublicContent } from '@/lib/editorial/public-cache';
import {
  approveAndScheduleRevisions,
  createArticleDraft,
  listAdminArticles,
  listEditorialJobs,
  listPublicationSlots,
  requestRevisionChanges,
  restoreArticleRevision,
  skipEditorialSlot,
  unpublishArticle,
  validateEvidence,
  validateEditorialSources,
} from '@/lib/editorial/admin';
import {
  requireEditorialAdmin,
  EditorialAuthError,
} from '@/lib/editorial/auth';
import { readEditorialBudget } from '@/lib/editorial/budget';
import { editorialAdminSummary } from '@/lib/editorial/admin';
import {
  ensureEditorialAutomationSchedules,
  editorialAutomationStatus,
  pauseEditorialAutomationSchedules,
} from '@/lib/editorial/qstash';
import { getEditorialProviderAvailability } from '@/lib/editorial/provider';
import { getEditorialImageAvailability } from '@/lib/editorial/images';
import { listBrandCovers } from '@/lib/editorial/brand-covers';
import {
  createEditorialRewriteJob,
  createManualEditorialJob,
  queueEditorialTranslation,
  runEditorialGenerationJob,
} from '@/lib/editorial/workflow';
import { isTrustedOrigin } from '@/lib/server/origin';
import { readJsonBody } from '@/lib/server/body';
import { vietnamLocalDate } from '@/lib/editorial/time';
import { articles, articleTranslations } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { getDatabase } from '@/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const category = z.enum(['news', 'explain', 'practice']);
const approval = z.object({
  articleId: z.uuid(),
  revisionId: z.uuid(),
  slot: z.enum(['morning', 'noon', 'evening']),
  version: z.string().length(64).optional(),
});
const target = z.object({
  articleId: z.uuid(),
  revisionId: z.uuid(),
  version: z.string().length(64),
});
const mutation = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    targets: z.array(target).min(1).max(20),
  }),
  target.extend({
    action: z.literal('schedule'),
    date: z.iso.date(),
    slot: z.enum(['morning', 'noon', 'evening']),
  }),
  target.extend({
    action: z.literal('unschedule'),
    date: z.iso.date(),
    slot: z.enum(['morning', 'noon', 'evening']),
  }),
  z.object({
    action: z.literal('reopen_slot'),
    date: z.iso.date(),
    slot: z.enum(['morning', 'noon', 'evening']),
  }),
  z.object({
    action: z.literal('create'),
    title: z.string().trim().min(5).max(180),
    excerpt: z.string().trim().min(20).max(360),
    contentMarkdown: z.string().trim().min(20).max(40_000),
    category,
    sources: z.unknown().optional(),
    evidence: z.unknown().optional(),
  }),
  z.object({
    action: z.literal('generate'),
    topic: z.string().trim().min(5).max(240),
    category,
    sources: z.unknown().optional(),
  }),
  z.object({
    action: z.literal('approve_schedule'),
    date: z.iso.date().optional(),
    approvals: z.array(approval).min(1).max(3),
  }),
  z.object({
    action: z.literal('request_changes'),
    articleId: z.uuid(),
    revisionId: z.uuid(),
    version: z.string().length(64),
    note: z.string().trim().min(3).max(2_000),
  }),
  z.object({
    action: z.literal('skip_slot'),
    date: z.iso.date().optional(),
    slot: z.enum(['morning', 'noon', 'evening']),
  }),
  z.object({
    action: z.literal('restore'),
    articleId: z.uuid(),
    revisionId: z.uuid(),
    currentRevisionId: z.uuid(),
    version: z.string().length(64),
  }),
  target.extend({ action: z.literal('unpublish') }),
  z.object({ action: z.literal('translate'), revisionId: z.uuid() }),
  z.object({ action: z.literal('hide_translation'), revisionId: z.uuid() }),
  z.object({ action: z.literal('setup_automation') }),
  z.object({ action: z.literal('pause_automation') }),
]);

function errorResponse(error: unknown) {
  if (error instanceof EditorialStateError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof EditorialAuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    {
      error:
        error instanceof Error ? error.message : 'Không thể xử lý bài viết.',
    },
    { status: 503 },
  );
}

export async function GET(request?: Request) {
  try {
    await requireEditorialAdmin();
    const params = new URL(
      request?.url ?? 'http://localhost/api/admin/articles',
    ).searchParams;
    const mode = params.get('mode');
    if (mode === 'operations') {
      const [jobs, budget] = await Promise.all([
        listAdminJobSummaries(),
        readEditorialBudget(),
      ]);
      return Response.json(
        {
          jobs,
          budget,
          automation: editorialAutomationStatus(),
          providers: getEditorialProviderAvailability(),
          imageProvider: getEditorialImageAvailability(),
          brandCovers: listBrandCovers(),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (mode !== 'legacy') {
      const parsed = z
        .object({
          group: z
            .enum(['pending', 'approved', 'scheduled', 'attention'])
            .optional(),
          category: category.optional(),
          search: z.string().max(180).optional(),
          page: z.coerce.number().int().min(1).max(100_000).default(1),
          date: z.iso.date().optional(),
        })
        .safeParse(Object.fromEntries(params));
      if (!parsed.success)
        return Response.json(
          { error: 'Bộ lọc không hợp lệ.' },
          { status: 400 },
        );
      return Response.json(await getAdminInbox(parsed.data), {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    const localDate = vietnamLocalDate();
    const [articles, jobs, budget, slots] = await Promise.all([
      listAdminArticles(),
      listEditorialJobs(),
      readEditorialBudget(),
      listPublicationSlots(localDate),
    ]);
    return Response.json(
      {
        articles,
        jobs,
        budget,
        slots,
        inbox: editorialAdminSummary({ articles, slots }),
        automation: editorialAutomationStatus(),
        providers: getEditorialProviderAvailability(),
        imageProvider: getEditorialImageAvailability(),
        brandCovers: listBrandCovers(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 403 });
  }
  try {
    const admin = await requireEditorialAdmin();
    const parsed = mutation.safeParse(await readJsonBody(request, 60 * 1024));
    if (!parsed.success) {
      return Response.json(
        { error: 'Dữ liệu bài viết không hợp lệ.' },
        { status: 400 },
      );
    }
    const action = parsed.data;
    if (action.action === 'approve') {
      const results = await approveEditorialRevisions(action.targets, admin.id);
      const successfulIds = results
        .filter((result) => result.ok)
        .map((result) => result.articleId);
      const affectedArticles = successfulIds.length
        ? await getDatabase()
            .select()
            .from(articles)
            .where(inArray(articles.id, successfulIds))
        : [];
      return Response.json({
        results: results.map((result) => {
          if (!result.ok) return result;
          return {
            articleId: result.articleId,
            revisionId: result.revisionId,
            version: result.version,
            ok: true,
            item: toReviewSummary(
              affectedArticles.find(
                (article) => article.id === result.articleId,
              )!,
              result.revision,
            ),
          };
        }),
      });
    }
    if (action.action === 'schedule') {
      const slot = await scheduleEditorialRevision(
        { ...action, localDate: action.date },
        admin.id,
      );
      return Response.json({
        slot,
        item: await getAdminRevision(action.articleId, action.revisionId),
      });
    }
    if (action.action === 'unschedule' || action.action === 'reopen_slot') {
      const slot = await changeEditorialSlot(
        action.date,
        action.slot,
        action.action === 'unschedule' ? 'unschedule' : 'reopen',
        action.action === 'unschedule' ? action : undefined,
      );
      return Response.json({
        slot,
        ...(action.action === 'unschedule'
          ? {
              item: await getAdminRevision(action.articleId, action.revisionId),
            }
          : {}),
      });
    }
    if (action.action === 'create') {
      const result = await createArticleDraft({
        ...action,
        sources: validateEditorialSources(action.sources),
        evidence: validateEvidence(action.evidence),
        createdByUserId: admin.id,
      });
      return Response.json(
        {
          ...result,
          item: await getAdminRevision(result.article.id, result.revision.id),
        },
        { status: 201 },
      );
    }
    if (action.action === 'generate') {
      const job = await createManualEditorialJob({
        topic: action.topic,
        category: action.category,
        sources: validateEditorialSources(action.sources),
      });
      if (!job) {
        return Response.json(
          { error: 'Chủ đề này đã có tác vụ trong ngày.' },
          { status: 409 },
        );
      }
      const automation = editorialAutomationStatus();
      if (!automation.enabled || !automation.configured)
        waitUntil(runEditorialGenerationJob(job.id));
      const outcome = null;
      return Response.json(
        {
          job,
          outcome,
          automation,
          message:
            automation.enabled && automation.configured
              ? 'Đã đưa yêu cầu vào hàng đợi biên tập.'
              : 'Đã nhận yêu cầu tạo nháp. Bạn có thể tiếp tục duyệt các bài khác.',
        },
        { status: 202 },
      );
    }
    if (action.action === 'approve_schedule') {
      const scheduled = await approveAndScheduleRevisions({
        localDate: action.date,
        approvals: action.approvals,
        reviewerId: admin.id,
      });
      return Response.json({ scheduled });
    }
    if (action.action === 'request_changes') {
      const revision = await requestRevisionChanges({
        articleId: action.articleId,
        revisionId: action.revisionId,
        version: action.version,
        reviewNote: action.note,
        reviewerId: admin.id,
      });
      const job = await createEditorialRewriteJob({
        articleId: action.articleId,
        revisionId: action.revisionId,
        reviewNote: action.note,
      });
      const automation = editorialAutomationStatus();
      if (job && (!automation.enabled || !automation.configured))
        waitUntil(runEditorialGenerationJob(job.id));
      const outcome = null;
      return Response.json({
        item: await getAdminRevision(action.articleId, revision.id),
        job,
        outcome,
      });
    }
    if (action.action === 'skip_slot') {
      return Response.json({
        slot: await skipEditorialSlot(
          action.date || vietnamLocalDate(),
          action.slot,
        ),
      });
    }
    if (action.action === 'restore') {
      const revision = await restoreArticleRevision(
        action.articleId,
        action.revisionId,
        admin.id,
        { revisionId: action.currentRevisionId, version: action.version },
      );
      return Response.json(
        { item: await getAdminRevision(action.articleId, revision.id) },
        { status: 201 },
      );
    }
    if (action.action === 'unpublish') {
      return Response.json({
        article: await unpublishArticle(action.articleId, action),
      });
    }
    if (action.action === 'translate') {
      const job = await queueEditorialTranslation(action.revisionId, {
        retry: true,
      });
      return Response.json({ job }, { status: 202 });
    }
    if (action.action === 'hide_translation') {
      const [translation] = await getDatabase()
        .update(articleTranslations)
        .set({ status: 'hidden', updatedAt: new Date() })
        .where(
          and(
            eq(articleTranslations.sourceRevisionId, action.revisionId),
            eq(articleTranslations.locale, 'en'),
          ),
        )
        .returning();
      if (translation) revalidateEditorialPublicContent();
      return Response.json({ translation: translation ?? null });
    }
    if (action.action === 'setup_automation') {
      const status = editorialAutomationStatus();
      if (!status.enabled || !status.configured) {
        return Response.json(
          {
            error:
              'Cần cấu hình và bật EDITORIAL_AUTOMATION_ENABLED trên Vercel trước.',
          },
          { status: 409 },
        );
      }
      return Response.json({
        schedules: await ensureEditorialAutomationSchedules(),
      });
    }
    return Response.json({
      schedules: await pauseEditorialAutomationSchedules(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
