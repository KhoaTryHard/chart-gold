import { z } from 'zod';
import {
  approveAndScheduleRevisions,
  createArticleDraft,
  ensurePublicationSlots,
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
import { articleTranslations } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { getDatabase } from '@/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const category = z.enum(['news', 'explain', 'practice']);
const approval = z.object({
  articleId: z.uuid(),
  revisionId: z.uuid(),
  slot: z.enum(['morning', 'noon', 'evening']),
});
const mutation = z.discriminatedUnion('action', [
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
  }),
  z.object({ action: z.literal('unpublish'), articleId: z.uuid() }),
  z.object({ action: z.literal('translate'), revisionId: z.uuid() }),
  z.object({ action: z.literal('hide_translation'), revisionId: z.uuid() }),
  z.object({ action: z.literal('setup_automation') }),
  z.object({ action: z.literal('pause_automation') }),
]);

function errorResponse(error: unknown) {
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

export async function GET() {
  try {
    await requireEditorialAdmin();
    const localDate = vietnamLocalDate();
    await ensurePublicationSlots(localDate);
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
    if (action.action === 'create') {
      const result = await createArticleDraft({
        ...action,
        sources: validateEditorialSources(action.sources),
        evidence: validateEvidence(action.evidence),
        createdByUserId: admin.id,
      });
      return Response.json(result, { status: 201 });
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
      const outcome =
        automation.enabled && automation.configured
          ? null
          : await runEditorialGenerationJob(job.id);
      return Response.json(
        {
          job,
          outcome,
          automation,
          message:
            automation.enabled && automation.configured
              ? 'Đã đưa yêu cầu vào hàng đợi biên tập.'
              : 'Đã tạo bản nháp theo chế độ chạy thủ công. Cần bật QStash để tự động hóa hằng ngày.',
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
        reviewNote: action.note,
        reviewerId: admin.id,
      });
      const job = await createEditorialRewriteJob({
        articleId: action.articleId,
        revisionId: action.revisionId,
        reviewNote: action.note,
      });
      const automation = editorialAutomationStatus();
      const outcome =
        job && (!automation.enabled || !automation.configured)
          ? await runEditorialGenerationJob(job.id)
          : null;
      return Response.json({ revision, job, outcome });
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
      return Response.json(
        {
          revision: await restoreArticleRevision(
            action.articleId,
            action.revisionId,
            admin.id,
          ),
        },
        { status: 201 },
      );
    }
    if (action.action === 'unpublish') {
      return Response.json({
        article: await unpublishArticle(action.articleId),
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
