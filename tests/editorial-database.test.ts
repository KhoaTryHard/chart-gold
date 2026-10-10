import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import type { Pool } from 'pg';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { revalidateTag } from 'next/cache';

const mocks = vi.hoisted(() => ({
  gemini: vi.fn(),
  blob: vi.fn(),
  fetch: vi.fn(),
  put: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (read: (...args: unknown[]) => unknown) => read,
}));
vi.mock('@vercel/functions', () => ({ attachDatabasePool: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.gemini };
  },
}));
vi.mock('@vercel/blob', () => ({
  get: mocks.blob,
  put: mocks.put,
  del: vi.fn(),
}));
vi.mock('@/lib/editorial/auth', () => ({
  requireEditorialAdmin: vi.fn(async () => {
    throw new Error('Guest');
  }),
  EditorialAuthError: class extends Error {
    status = 401;
  },
}));

import { getDatabase } from '@/db';
import { articleRevisions, editorialJobs } from '@/db/schema';
import {
  approveAndScheduleRevisions,
  approveEditorialRevisions,
  changeEditorialSlot,
  createArticleDraft,
  createEditorialRevision,
  lockEditorialArticle,
  publishDueSlot,
  requestRevisionChanges,
  restoreArticleRevision,
  scheduleEditorialRevision,
  setRevisionCoverImage,
  unpublishArticle,
  validateEvidence,
  listAdminArticles,
  listEditorialJobs,
} from '@/lib/editorial/admin';
import {
  getAdminInbox,
  getAdminRevision,
  getAdminSlots,
} from '@/lib/editorial/admin-read';
import { revisionVersion } from '@/lib/editorial/review';
import {
  reconcileEditorialWork,
  runEditorialGenerationJob,
  createEditorialRewriteJob,
} from '@/lib/editorial/workflow';
import { GET as mediaGet } from '@/app/api/editorial/media/[revisionId]/route';
import { vietnamLocalDate } from '@/lib/editorial/time';
import { readEditorialBudget } from '@/lib/editorial/budget';
import {
  prepareHermesPackage,
  publishHermesPackage,
  getHermesPackage,
} from '@/lib/editorial/hermes-integration';
import { sha256 } from '@/lib/editorial/integration-auth';

const connection = process.env.EDITORIAL_TEST_DATABASE_URL;
const tomorrow = () => vietnamLocalDate(new Date(Date.now() + 86_400_000));
let pool: Pool;
const sdkResult = () => ({
  text: JSON.stringify({
    title: 'Giá vàng cần theo dõi gì?',
    excerpt: 'Bản tóm tắt dựa trên nguồn đã được kiểm chứng.',
    contentMarkdown: '## Dữ kiện\n\nNội dung có nguồn và đủ dài.',
    seoTitle: 'SEO giữ lại',
    seoDescription: 'Mô tả SEO đã biên tập.',
  }),
  usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 30 },
});
async function seed(title = 'Giá vàng cần đối chiếu nguồn') {
  return createArticleDraft({
    title,
    excerpt: 'Đoạn dẫn đầy đủ dựa trên dữ liệu thị trường đã kiểm chứng.',
    contentMarkdown: '## Dữ kiện\n\nNội dung có dữ kiện đã kiểm chứng.',
    category: 'news',
    sources: [
      {
        title: 'Tên nguồn gốc',
        url: 'https://sjc.com.vn/',
        publishedAt: '2026-10-01T00:00:00.000Z',
        accessedAt: '2026-10-01T01:00:00.000Z',
      },
    ],
    evidence: [
      {
        label: 'Giá SJC',
        value: '100 triệu đồng',
        observedAt: '2026-10-01T01:00:00.000Z',
      },
    ],
    seoTitle: 'SEO giữ nguyên',
    seoDescription: 'Mô tả cần giữ nguyên khi sửa lỗi chữ.',
  });
}
async function approveSeed() {
  const created = await seed();
  const t = {
    articleId: created.article.id,
    revisionId: created.revision.id,
    version: revisionVersion(created.revision),
  };
  await approveEditorialRevisions([t]);
  return { ...created, target: t };
}
async function forceDue() {
  await pool.query(
    "update editorial_publication_slots set scheduled_at = now() - interval '1 minute' where status='scheduled'",
  );
}
async function job() {
  const [created] = await getDatabase()
    .insert(editorialJobs)
    .values({
      topic: 'Chủ đề audit',
      dedupeKey: randomUUID(),
      stage: 'generate',
      status: 'queued',
      payload: {
        category: 'news',
        sources: [],
        evidence: [
          {
            label: 'Giá',
            value: '100',
            observedAt: '2026-10-01T01:00:00.000Z',
          },
        ],
      },
    })
    .returning();
  return created;
}

async function integrationFixture() {
  const contentMarkdown =
    '## Dữ kiện\n\nBài đầy đủ để kiểm thử duyệt một lần đăng hai kênh.';
  const caption = 'Giá vàng: bản caption đã được Admin kiểm tra.';
  const image = await sharp({
    create: { width: 1200, height: 675, channels: 3, background: '#c19c44' },
  })
    .png()
    .toBuffer();
  const manifest = {
    rootId: randomUUID(),
    draftId: randomUUID(),
    externalRevision: 1,
    website: {
      title: 'Bài tích hợp Telegram hai kênh',
      excerpt: 'Đoạn dẫn đầy đủ đã kiểm chứng để xuất bản website.',
      contentMarkdown,
      category: 'news',
      sources: [
        {
          title: 'Kitco',
          url: 'https://www.kitco.com/',
          accessedAt: new Date().toISOString(),
        },
      ],
      evidence: [],
      seoTitle: 'SEO hai kênh',
      seoDescription: 'Mô tả bài website kiểm chứng.',
      coverAlt: 'Ảnh minh họa vàng',
    },
    facebook: {
      pageId: '1262243656966414',
      caption,
      sourceComment: 'Nguồn tham khảo: https://www.kitco.com/',
    },
    verification: {
      verdict: 'PASS',
      websiteDigest: sha256(contentMarkdown),
      captionDigest: sha256(caption),
    },
  };
  const pack = await prepareHermesPackage(manifest, image);
  const approval = {
    reviewDigest: pack.reviewDigest,
    actorId: '1758923792',
    chatId: '-1003759063639',
    reviewMessageId: '100',
    callbackId: randomUUID(),
    approvedAt: new Date().toISOString(),
  };
  return { manifest, image, pack, approval };
}

describe.skipIf(!connection)(
  'editorial transitions against isolated PostgreSQL',
  () => {
    beforeAll(async () => {
      const url = new URL(connection!);
      if (
        !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        url.pathname !== '/editorial_test'
      )
        throw new Error('Only local editorial_test database is allowed');
      vi.stubEnv('DATABASE_URL', connection!);
      getDatabase();
      pool = (globalThis as typeof globalThis & { __kimTuyenPool: Pool })
        .__kimTuyenPool;
      expect(
        (await pool.query('select current_database() as name')).rows[0].name,
      ).toBe('editorial_test');
    });
    beforeEach(async () => {
      await pool.query(
        'truncate articles, editorial_jobs, editorial_publication_slots, editorial_cost_ledger, market_history_leases cascade',
      );
      vi.clearAllMocks();
      vi.stubEnv('EDITORIAL_GEMINI_API_KEY', 'audit-only-key');
      vi.stubEnv('EDITORIAL_AUTOMATION_ENABLED', 'false');
      vi.stubGlobal('fetch', mocks.fetch);
      mocks.fetch.mockResolvedValue(new Response('', { status: 200 }));
      mocks.gemini.mockResolvedValue(sdkResult());
      mocks.put.mockResolvedValue({
        pathname: 'editorial/integration/test.png',
        url: 'https://test.blob/asset.png',
      });
      vi.stubEnv('HERMES_EDITORIAL_OWNER_ID', '1758923792');
      vi.stubEnv('HERMES_EDITORIAL_CHAT_ID', '-1003759063639');
    });
    afterAll(async () => {
      await pool?.end();
      delete (globalThis as { __kimTuyenPool?: Pool; __kimTuyenDb?: unknown })
        .__kimTuyenPool;
      delete (globalThis as { __kimTuyenDb?: unknown }).__kimTuyenDb;
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it('approves five articles without needing any publication slots', async () => {
      const targets = [];
      for (let i = 0; i < 5; i++) {
        const value = await seed('Tin vàng số ' + i);
        targets.push({
          articleId: value.article.id,
          revisionId: value.revision.id,
          version: revisionVersion(value.revision),
        });
      }
      const result = await approveEditorialRevisions(targets);
      expect(result.every((item) => item.ok)).toBe(true);
      expect(
        (await pool.query('select count(*) from editorial_publication_slots'))
          .rows[0].count,
      ).toBe('0');
    });
    it('keeps a valid approval when another item in the batch is invalid', async () => {
      const good = await seed();
      const bad = await seed('Thiếu nguồn và dữ kiện');
      await getDatabase()
        .update(articleRevisions)
        .set({ sources: [], evidence: [] })
        .where(eq(articleRevisions.id, bad.revision.id));
      const result = await approveEditorialRevisions([
        { articleId: good.article.id, revisionId: good.revision.id },
        { articleId: bad.article.id, revisionId: bad.revision.id },
      ]);
      expect(result.map((item) => item.ok)).toEqual([true, false]);
    });
    it('preserves evidence, source metadata, SEO and category on a typo-only edit', async () => {
      const created = await approveSeed();
      const updated = await createEditorialRevision({
        ...created.target,
        title: 'Tiêu đề chỉ sửa một lỗi chữ',
      });
      expect(updated.evidence).toEqual(created.revision.evidence);
      expect(updated.sources).toEqual(created.revision.sources);
      expect(updated.seoTitle).toBe(created.revision.seoTitle);
      expect(updated.publicationCategory).toBe('news');
      expect(updated.approvalStatus).toBe('pending');
    });
    it('distinguishes omitted metadata from explicit clearing', async () => {
      const value = await seed();
      const edited = await createEditorialRevision({
        articleId: value.article.id,
        evidence: [],
        seoTitle: null,
      });
      expect(edited.evidence).toEqual([]);
      expect(edited.seoTitle).toBeNull();
      expect(edited.sources).toEqual(value.revision.sources);
    });
    it('rejects old revision ids and modified same-id content', async () => {
      const value = await seed();
      const t = {
        articleId: value.article.id,
        revisionId: value.revision.id,
        version: revisionVersion(value.revision),
      };
      await setRevisionCoverImage({
        ...t,
        provider: 'brand-library',
        model: 'v1',
        url: '/brand/covers/news.webp',
        alt: 'Alt mới',
        disclosure: 'Brand',
      });
      expect((await approveEditorialRevisions([t]))[0]).toMatchObject({
        ok: false,
        status: 409,
      });
      await createEditorialRevision({
        articleId: value.article.id,
        title: 'Phiên bản mới',
      });
      expect(
        (await approveEditorialRevisions([{ ...t, version: undefined }]))[0],
      ).toMatchObject({ ok: false, status: 409 });
    });
    it('rejects scheduling a pending revision or a past slot', async () => {
      const value = await seed();
      const t = { articleId: value.article.id, revisionId: value.revision.id };
      await expect(
        scheduleEditorialRevision({
          ...t,
          localDate: tomorrow(),
          slot: 'morning',
        }),
      ).rejects.toThrow('Hãy duyệt');
      await approveEditorialRevisions([t]);
      await expect(
        scheduleEditorialRevision({
          ...t,
          localDate: '2020-01-01',
          slot: 'morning',
        }),
      ).rejects.toThrow('tương lai');
    });
    it('allows only one active schedule per article and retains approval after unscheduling', async () => {
      const value = await approveSeed();
      await scheduleEditorialRevision({
        ...value.target,
        localDate: tomorrow(),
        slot: 'morning',
      });
      await expect(
        scheduleEditorialRevision({
          ...value.target,
          localDate: tomorrow(),
          slot: 'noon',
        }),
      ).rejects.toThrow('Bài đã có lịch');
      await changeEditorialSlot(
        tomorrow(),
        'morning',
        'unschedule',
        value.target,
      );
      expect((await getAdminRevision(value.article.id)).approvalStatus).toBe(
        'approved',
      );
      await scheduleEditorialRevision({
        ...value.target,
        localDate: tomorrow(),
        slot: 'noon',
      });
    });
    it('cancels the old schedule when an approved article is edited', async () => {
      const value = await approveSeed();
      await scheduleEditorialRevision({
        ...value.target,
        localDate: tomorrow(),
        slot: 'morning',
      });
      await createEditorialRevision({
        ...value.target,
        title: 'Bản mới phải duyệt lại',
      });
      await forceDue();
      expect((await publishDueSlot(tomorrow(), 'morning')).status).toBe(
        'not_scheduled',
      );
      expect(
        (
          await pool.query(
            'select approval_status from article_revisions where id=$1',
            [value.revision.id],
          )
        ).rows[0].approval_status,
      ).toBe('revoked');
    });
    it('never republishes an archived article from its old schedule', async () => {
      const value = await approveSeed();
      await scheduleEditorialRevision({
        ...value.target,
        localDate: tomorrow(),
        slot: 'morning',
      });
      await unpublishArticle(value.article.id, value.target);
      await forceDue();
      expect((await publishDueSlot(tomorrow(), 'morning')).status).toBe(
        'not_scheduled',
      );
      expect(
        (await pool.query('select status from articles')).rows[0].status,
      ).toBe('archived');
    });
    it('serializes a publish behind an in-flight edit on a different PostgreSQL connection', async () => {
      const value = await approveSeed();
      await scheduleEditorialRevision({
        ...value.target,
        localDate: tomorrow(),
        slot: 'morning',
      });
      await forceDue();
      let release!: () => void;
      let locked!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const editing = getDatabase().transaction(async (tx) => {
        await lockEditorialArticle(tx, value.article.id);
        locked();
        await gate;
        return createEditorialRevision(
          { ...value.target, title: 'Bài đã đổi trong lúc publish' },
          tx,
        );
      });
      await ready;
      const publishing = publishDueSlot(tomorrow(), 'morning');
      try {
        await vi.waitFor(async () => {
          const waiting = await pool.query(
            "select count(*)::int as count from pg_locks where locktype='advisory' and not granted",
          );
          expect(waiting.rows[0].count).toBeGreaterThan(0);
        });
      } finally {
        release();
      }
      await editing;
      expect(['changed', 'not_scheduled', 'invalid_approval']).toContain(
        (await publishing).status,
      );
      expect(
        (await pool.query('select published_revision_id from articles')).rows[0]
          .published_revision_id,
      ).toBeNull();
    });
    it('keeps evidence-only approval during source recheck and tolerates network errors', async () => {
      const value = await approveSeed();
      await getDatabase()
        .update(articleRevisions)
        .set({ sources: [] })
        .where(eq(articleRevisions.id, value.revision.id));
      const revision = (await getDatabase().select().from(articleRevisions))[0];
      await scheduleEditorialRevision({
        articleId: value.article.id,
        revisionId: revision.id,
        version: revisionVersion(revision),
        localDate: tomorrow(),
        slot: 'evening',
      });
      await pool.query(
        "update editorial_publication_slots set local_date=$1, scheduled_at=now()+interval '1 hour', updated_at=now()-interval '1 hour'",
        [vietnamLocalDate()],
      );
      await reconcileEditorialWork();
      expect((await getAdminRevision(value.article.id)).approvalStatus).toBe(
        'approved',
      );
      expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it('rejects bad evidence dates at ingress', () => {
      expect(() =>
        validateEvidence([
          { label: 'Giá', value: '100', observedAt: 'bad-date' },
        ]),
      ).toThrow('timestamp ISO');
    });
    it('records a temporary source failure without revoking approval or closing its schedule', async () => {
      const value = await approveSeed();
      await scheduleEditorialRevision({
        ...value.target,
        localDate: tomorrow(),
        slot: 'evening',
      });
      await pool.query(
        "update editorial_publication_slots set local_date=$1, scheduled_at=now()+interval '1 hour', updated_at=now()-interval '1 hour'",
        [vietnamLocalDate()],
      );
      mocks.fetch.mockRejectedValueOnce(
        new TypeError('Temporary network error'),
      );
      await reconcileEditorialWork();
      expect((await getAdminRevision(value.article.id)).approvalStatus).toBe(
        'approved',
      );
      const result = await pool.query(
        'select status,failure_message from editorial_publication_slots where article_id=$1',
        [value.article.id],
      );
      expect(result.rows[0].status).toBe('scheduled');
      expect(result.rows[0].failure_message).toContain('tạm thời');
    });
    it('reuses the uploaded cover with a URL for the new revision after edit and restore', async () => {
      const value = await seed();
      await setRevisionCoverImage({
        articleId: value.article.id,
        revisionId: value.revision.id,
        url: '/api/editorial/media/' + value.revision.id,
        storageKey: 'test/cover.webp',
        alt: 'Ảnh upload',
        disclosure: 'Admin',
        provider: 'admin-upload',
        model: 'webp',
      });
      const edited = await createEditorialRevision({
        articleId: value.article.id,
        title: 'Tin vàng bản sửa',
      });
      expect(edited.coverImageUrl).toBe('/api/editorial/media/' + edited.id);
      const restored = await restoreArticleRevision(
        value.article.id,
        value.revision.id,
      );
      expect(restored.coverImageUrl).toBe(
        '/api/editorial/media/' + restored.id,
      );
      await approveAndScheduleRevisions({
        localDate: tomorrow(),
        approvals: [
          {
            articleId: value.article.id,
            revisionId: restored.id,
            slot: 'morning',
          },
        ],
      });
      await forceDue();
      expect((await publishDueSlot(tomorrow(), 'morning')).status).toBe(
        'published_now',
      );
      mocks.blob.mockResolvedValue({
        statusCode: 200,
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
            controller.close();
          },
        }),
        blob: { contentType: 'image/webp' },
      });
      expect(
        (
          await mediaGet(new Request('http://localhost/'), {
            params: Promise.resolve({ revisionId: restored.id }),
          })
        ).status,
      ).toBe(200);
    });
    it('provides read-only virtual slots and a summary without Markdown/history', async () => {
      await seed();
      const inbox = await getAdminInbox();
      expect(inbox.items).toHaveLength(1);
      expect(inbox.slots).toHaveLength(3);
      expect(inbox.items[0]).not.toHaveProperty('contentMarkdown');
      expect(inbox.items[0]).not.toHaveProperty('revisions');
      expect(
        (await pool.query('select count(*) from editorial_publication_slots'))
          .rows[0].count,
      ).toBe('0');
      expect(
        (await getAdminSlots(tomorrow())).every((slot) => slot.id === null),
      ).toBe(true);
    });
    it('prevents duplicate Gemini calls and draft writes with two concurrent deliveries', async () => {
      const value = await job();
      const result = await Promise.all([
        runEditorialGenerationJob(value.id),
        runEditorialGenerationJob(value.id),
      ]);
      expect(result.some((item) => item.status === 'completed')).toBe(true);
      expect(mocks.gemini).toHaveBeenCalledTimes(1);
      expect(
        (await pool.query('select count(*) from articles')).rows[0].count,
      ).toBe('1');
      expect(
        (await pool.query('select count(*) from editorial_cost_ledger')).rows[0]
          .count,
      ).toBe('1');
    });
    it('does not exhaust the five-connection pool when six distinct leased jobs run together', async () => {
      const jobs = [];
      for (let index = 0; index < 6; index++) jobs.push(await job());
      const results = await Promise.all(
        jobs.map((item) => runEditorialGenerationJob(item.id)),
      );
      expect(results.every((item) => item.status === 'completed')).toBe(true);
      expect(mocks.gemini).toHaveBeenCalledTimes(6);
    });
    it('does not dispatch a running job or a retry before cooldown', async () => {
      const value = await job();
      await getDatabase()
        .update(editorialJobs)
        .set({ retryAt: new Date(Date.now() + 60_000) })
        .where(eq(editorialJobs.id, value.id));
      expect((await runEditorialGenerationJob(value.id)).status).toBe(
        'skipped',
      );
      await getDatabase()
        .update(editorialJobs)
        .set({ status: 'running', retryAt: null })
        .where(eq(editorialJobs.id, value.id));
      expect((await runEditorialGenerationJob(value.id)).status).toBe(
        'skipped',
      );
      expect(mocks.gemini).not.toHaveBeenCalled();
    });
    it('records monotonic attempt numbers through 429 and a successful retry', async () => {
      const value = await job();
      mocks.gemini.mockRejectedValueOnce({ status: 429 });
      expect((await runEditorialGenerationJob(value.id)).status).toBe(
        'retrying',
      );
      await getDatabase()
        .update(editorialJobs)
        .set({ retryAt: null })
        .where(eq(editorialJobs.id, value.id));
      expect((await runEditorialGenerationJob(value.id)).status).toBe(
        'completed',
      );
      const rows = (
        await pool.query(
          'select attempt_number,status from editorial_job_attempts order by attempt_number',
        )
      ).rows;
      expect(rows).toEqual([
        { attempt_number: 1, status: 'failed' },
        { attempt_number: 2, status: 'succeeded' },
      ]);
    });
    it('does not consume a provider attempt while waiting for budget', async () => {
      const value = await job();
      const previous = process.env.EDITORIAL_DAILY_BUDGET_VND;
      process.env.EDITORIAL_DAILY_BUDGET_VND = '0';
      try {
        expect((await runEditorialGenerationJob(value.id)).status).toBe(
          'waiting_budget',
        );
        const [updated] = await getDatabase()
          .select()
          .from(editorialJobs)
          .where(eq(editorialJobs.id, value.id));
        expect(updated.attemptCount).toBe(0);
        expect(mocks.gemini).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined)
          delete process.env.EDITORIAL_DAILY_BUDGET_VND;
        else process.env.EDITORIAL_DAILY_BUDGET_VND = previous;
      }
    });
    it('does not apply stale AI edits after the same revision content changes', async () => {
      const value = await seed();
      const changed = await requestRevisionChanges({
        articleId: value.article.id,
        revisionId: value.revision.id,
        version: revisionVersion(value.revision),
        reviewNote: 'Sửa phần giải thích dữ kiện.',
      });
      const rewrite = await createEditorialRewriteJob({
        articleId: value.article.id,
        revisionId: changed.id,
        reviewNote: 'Sửa phần giải thích dữ kiện.',
      });
      mocks.gemini.mockImplementationOnce(async () => {
        await setRevisionCoverImage({
          articleId: value.article.id,
          revisionId: changed.id,
          version: revisionVersion(changed),
          provider: 'brand-library',
          model: 'v1',
          url: '/brand/covers/news.webp',
          alt: 'Ảnh được Admin sửa khi AI chạy',
          disclosure: 'Brand',
        });
        return sdkResult();
      });
      expect((await runEditorialGenerationJob(rewrite!.id)).status).toBe(
        'failed',
      );
      expect(
        (await pool.query('select count(*) from article_revisions')).rows[0]
          .count,
      ).toBe('1');
      expect(
        (await getAdminRevision(value.article.id)).coverImageAlt,
      ).toContain('Admin sửa');
    });
    it('fences the stopped worker when recovering a stale running job', async () => {
      const value = await job();
      await getDatabase()
        .update(editorialJobs)
        .set({
          status: 'running',
          startedAt: new Date(Date.now() - 180_000),
          updatedAt: new Date(Date.now() - 180_000),
          result: { runToken: 'old-worker' },
        })
        .where(eq(editorialJobs.id, value.id));
      await reconcileEditorialWork();
      const [updated] = await getDatabase()
        .select()
        .from(editorialJobs)
        .where(eq(editorialJobs.id, value.id));
      expect(updated.status).toBe('queued');
      expect((updated.result as { runToken: string }).runToken).not.toBe(
        'old-worker',
      );
      expect((await runEditorialGenerationJob(value.id)).status).toBe(
        'completed',
      );
    });
    it('retains an attempted provider and unknown cost when the request times out after dispatch', async () => {
      const value = await job();
      const controller = new AbortController();
      const spy = vi
        .spyOn(AbortSignal, 'timeout')
        .mockImplementation(() => controller.signal);
      mocks.gemini.mockImplementationOnce(async () => {
        controller.abort();
        throw new DOMException('Audit timeout', 'TimeoutError');
      });
      try {
        expect((await runEditorialGenerationJob(value.id)).status).toBe(
          'retrying',
        );
      } finally {
        spy.mockRestore();
      }
      expect(
        (
          await pool.query(
            'select status,retryable from editorial_job_attempts',
          )
        ).rows[0],
      ).toEqual({ status: 'failed', retryable: true });
      expect(
        (
          await pool.query(
            'select status,actual_vnd from editorial_cost_ledger',
          )
        ).rows[0],
      ).toEqual({ status: 'settled', actual_vnd: null });
    });
    it('reuses saved AI output after a completion transaction fails', async () => {
      const value = await job();
      await pool.query(
        "create function fail_editorial_complete() returns trigger language plpgsql as $$ begin if new.status='completed' then raise exception 'Injected completion failure'; end if; return new; end $$",
      );
      await pool.query(
        'create trigger audit_fail_complete before update on editorial_jobs for each row execute function fail_editorial_complete()',
      );
      try {
        expect((await runEditorialGenerationJob(value.id)).status).toBe(
          'retrying',
        );
        expect(
          (await pool.query('select count(*) from articles')).rows[0].count,
        ).toBe('0');
      } finally {
        await pool.query(
          'drop trigger audit_fail_complete on editorial_jobs; drop function fail_editorial_complete()',
        );
      }
      await getDatabase()
        .update(editorialJobs)
        .set({ retryAt: null })
        .where(eq(editorialJobs.id, value.id));
      expect((await runEditorialGenerationJob(value.id)).status).toBe(
        'completed',
      );
      expect(mocks.gemini).toHaveBeenCalledTimes(1);
      expect(
        (await pool.query('select count(*) from articles')).rows[0].count,
      ).toBe('1');
    });
    it('prepares identical requests idempotently without exposing draft image', async () => {
      const f = await integrationFixture();
      const retry = await prepareHermesPackage(f.manifest, f.image);
      expect(retry.packageId).toBe(f.pack.packageId);
      expect(retry.reviewDigest).toBe(f.pack.reviewDigest);
      expect(
        (await pool.query('select count(*) from articles')).rows[0].count,
      ).toBe('1');
      expect(f.pack.websitePublic).toBe(false);
      expect(mocks.put).toHaveBeenCalledTimes(1);
      expect(sha256(f.pack.canonicalPackage)).toBe(f.pack.reviewDigest);
      expect(f.pack.reviewPackage.facebook.caption).toContain(f.pack.url);
      expect((await getAdminInbox({ group: 'pending' })).items).toHaveLength(0);
      expect(
        (await getAdminInbox({ group: 'attention' })).items[0].approvalOrigin,
      ).toBe('telegram');
    });
    it('rejects same external key with altered content and rejects unsupported sources', async () => {
      const f = await integrationFixture();
      const changed = {
        ...f.manifest,
        facebook: { ...f.manifest.facebook, caption: 'Nội dung khác' },
      };
      await expect(prepareHermesPackage(changed, f.image)).rejects.toThrow();
      await expect(
        prepareHermesPackage(
          {
            ...f.manifest,
            draftId: randomUUID(),
            website: {
              ...f.manifest.website,
              sources: [
                {
                  title: 'Unknown',
                  url: 'https://unknown.invalid/',
                  accessedAt: new Date().toISOString(),
                },
              ],
            },
          },
          f.image,
        ),
      ).rejects.toThrow('Nguồn không được hỗ trợ');
    });
    it('publishes the prepared exact version once without consuming manual slots', async () => {
      const f = await integrationFixture();
      const [a, b] = await Promise.all([
        publishHermesPackage(f.pack.packageId, f.approval),
        publishHermesPackage(f.pack.packageId, f.approval),
      ]);
      expect(a.receipt).toEqual(b.receipt);
      expect(a.websitePublic).toBe(true);
      expect(
        (await pool.query('select count(*) from articles')).rows[0].count,
      ).toBe('1');
      expect(
        (await pool.query('select count(*) from editorial_publication_slots'))
          .rows[0].count,
      ).toBe('0');
      expect((await getHermesPackage(f.pack.packageId)).state).toBe(
        'published',
      );
      expect(revalidateTag).toHaveBeenCalledWith('editorial-public', { expire: 0 });
    });
    it('rejects wrong owner/chat, changed digest and expired approvals', async () => {
      const f = await integrationFixture();
      await expect(
        publishHermesPackage(f.pack.packageId, { ...f.approval, actorId: '1' }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        publishHermesPackage(f.pack.packageId, { ...f.approval, chatId: '-1' }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        publishHermesPackage(f.pack.packageId, {
          ...f.approval,
          reviewDigest: 'b'.repeat(64),
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(revalidateTag).not.toHaveBeenCalled();
      await expect(
        publishHermesPackage(f.pack.packageId, {
          ...f.approval,
          approvedAt: '2020-01-01T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it('blocks web approval of Telegram package and stale website mutation', async () => {
      const f = await integrationFixture();
      expect(
        (
          await approveEditorialRevisions([
            { articleId: f.pack.articleId, revisionId: f.pack.revisionId },
          ])
        )[0].ok,
      ).toBe(false);
      await createEditorialRevision({
        articleId: f.pack.articleId,
        title: 'Bản mới từ Admin web',
      });
      await expect(
        publishHermesPackage(f.pack.packageId, f.approval),
      ).rejects.toMatchObject({ status: 409 });
    });
    it('never restores an already published package after unpublish', async () => {
      const f = await integrationFixture();
      await publishHermesPackage(f.pack.packageId, f.approval);
      vi.mocked(revalidateTag).mockClear();
      await unpublishArticle(f.pack.articleId);
      expect(revalidateTag).toHaveBeenCalledExactlyOnceWith('editorial-public', { expire: 0 });
      await expect(
        publishHermesPackage(f.pack.packageId, f.approval),
      ).rejects.toMatchObject({ status: 409 });
    });
    it('keeps the root article when preparing a higher external revision', async () => {
      const f = await integrationFixture();
      const newer = await prepareHermesPackage(
        { ...f.manifest, draftId: randomUUID(), externalRevision: 2 },
        f.image,
      );
      expect(newer.articleId).toBe(f.pack.articleId);
      expect(newer.revisionId).not.toBe(f.pack.revisionId);
      await expect(
        publishHermesPackage(f.pack.packageId, f.approval),
      ).rejects.toMatchObject({ status: 409 });
    });
    it('reduces list response bytes by at least 70 percent on the same multi-revision fixture', async () => {
      for (let i = 0; i < 20; i++) {
        const value = await seed('Tin vàng benchmark ' + i);
        for (let j = 0; j < 4; j++)
          await createEditorialRevision({
            articleId: value.article.id,
            contentMarkdown: 'Nội dung biên tập có dữ kiện.\n'.repeat(200),
          });
      }
      const startOld = performance.now();
      const legacy = {
        articles: await listAdminArticles(),
        jobs: await listEditorialJobs(),
        budget: await readEditorialBudget(),
      };
      const oldMs = performance.now() - startOld;
      const startNew = performance.now();
      const inbox = await getAdminInbox();
      const newMs = performance.now() - startNew;
      const oldBytes = Buffer.byteLength(JSON.stringify(legacy));
      const newBytes = Buffer.byteLength(JSON.stringify(inbox));
      expect(newBytes / oldBytes).toBeLessThan(0.3);
      await mkdir('outputs/editorial-implementation', { recursive: true });
      await writeFile(
        'outputs/editorial-implementation/api-benchmark.json',
        JSON.stringify(
          {
            fixture: '20 articles, 5 revisions each',
            oldBytes,
            newBytes,
            reductionPercent: 100 * (1 - newBytes / oldBytes),
            oldMs,
            newMs,
            latencyNote: 'Single local run; not production p95',
          },
          null,
          2,
        ),
      );
    });
  },
);
