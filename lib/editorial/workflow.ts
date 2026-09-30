import 'server-only';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { getDatabase, withDatabaseAdvisoryLock } from '@/db';
import {
  articleRevisions,
  articleTranslations,
  articles,
  editorialEvents,
  editorialJobAttempts,
  editorialJobs,
  editorialPublicationSlots,
  editorialSourceItems,
} from '@/db/schema';
import {
  approveAndScheduleRevisions,
  createArticleDraft,
  createEditorialRevision,
  ensurePublicationSlots,
  publishDueSlot,
  validateEditorialSources,
} from './admin';
import {
  estimateEditorialTextActualVnd,
  estimateEditorialTextReservationVnd,
  releaseEditorialCost,
  reserveEditorialCost,
  settleEditorialCost,
} from './budget';
import {
  EditorialGenerationError,
  generateEditorialDraft,
  generateEditorialTranslation,
} from './generation';
import { enqueueEditorialWorker, editorialAutomationStatus } from './qstash';
import {
  fetchEditorialEvidence,
  scoutEditorialSources,
  selectDailyEditorialTopics,
  type ScoutedItem,
} from './scouting';
import { vietnamLocalDate } from './time';
import type {
  EditorialCategory,
  EditorialEvidence,
  EditorialSource,
} from './types';
import { getMarketData } from '@/lib/server/sjc';

type JobPayload = {
  category?: EditorialCategory;
  localDate?: string;
  lane?: string;
  sources?: EditorialSource[];
  evidence?: EditorialEvidence[];
  sourceEventId?: string;
  imagePrompt?: string;
  articleIdToRevise?: string;
  revisionIdToRevise?: string;
  reviewNote?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jobPayload(value: unknown): JobPayload {
  const candidate = record(value);
  const category = candidate.category;
  return {
    category:
      category === 'news' || category === 'explain' || category === 'practice'
        ? category
        : 'news',
    localDate:
      typeof candidate.localDate === 'string' ? candidate.localDate : undefined,
    lane: typeof candidate.lane === 'string' ? candidate.lane : undefined,
    sources: validateEditorialSources(candidate.sources),
    evidence: Array.isArray(candidate.evidence)
      ? (candidate.evidence as EditorialEvidence[])
      : [],
    sourceEventId:
      typeof candidate.sourceEventId === 'string'
        ? candidate.sourceEventId
        : undefined,
    imagePrompt:
      typeof candidate.imagePrompt === 'string'
        ? candidate.imagePrompt
        : undefined,
    articleIdToRevise:
      typeof candidate.articleIdToRevise === 'string'
        ? candidate.articleIdToRevise
        : undefined,
    revisionIdToRevise:
      typeof candidate.revisionIdToRevise === 'string'
        ? candidate.revisionIdToRevise
        : undefined,
    reviewNote:
      typeof candidate.reviewNote === 'string'
        ? candidate.reviewNote
        : undefined,
  };
}

function editorialPromptCharacters(topic: string, payload: JobPayload) {
  const sources = (payload.sources ?? []).reduce(
    (total, source) => total + source.title.length + source.url.length,
    0,
  );
  const evidence = (payload.evidence ?? []).reduce(
    (total, item) =>
      total +
      item.label.length +
      item.value.length +
      (item.sourceUrl?.length ?? 0),
    0,
  );
  return topic.length + sources + evidence + 1_500;
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function sourceDomain(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
}

async function persistScoutedItems(items: ScoutedItem[]) {
  const db = getDatabase();
  const rows = new Map<
    string,
    { eventId: string; sourceItemId: string; item: ScoutedItem }
  >();
  for (const item of items) {
    const now = new Date();
    const [event] = await db
      .insert(editorialEvents)
      .values({
        fingerprint: item.eventFingerprint,
        title: item.title,
        summary: item.summary ?? null,
        category: item.lane === 'domestic' ? 'news' : 'explain',
        status: 'candidate',
        relevanceScore: item.relevanceScore,
        relevanceReason:
          item.lane === 'domestic'
            ? 'Nguồn trong nước có khả năng liên quan vàng Việt Nam.'
            : 'Nguồn quốc tế cần đối chiếu tác động tới vàng Việt Nam.',
        detectedAt: now,
        lastSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: editorialEvents.fingerprint,
        set: {
          title: item.title,
          summary: item.summary ?? null,
          relevanceScore: item.relevanceScore,
          lastSeenAt: now,
          updatedAt: now,
        },
      })
      .returning();
    const [sourceItem] = await db
      .insert(editorialSourceItems)
      .values({
        eventId: event.id,
        url: item.url,
        normalizedUrl: item.url,
        title: item.title,
        domain: sourceDomain(item.url),
        sourceType: item.sourceType,
        status: 'queued',
        publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
        rawPayload: {
          summary: item.summary ?? null,
          sourceName: item.sourceName,
        },
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: editorialSourceItems.normalizedUrl,
        set: {
          eventId: event.id,
          title: item.title,
          sourceType: item.sourceType,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
          updatedAt: now,
        },
      })
      .returning();
    rows.set(item.url, {
      eventId: event.id,
      sourceItemId: sourceItem.id,
      item,
    });
  }
  return rows;
}

async function evidenceFor(item: ScoutedItem) {
  try {
    const source = await fetchEditorialEvidence(
      item,
      AbortSignal.timeout(12_000),
    );
    return {
      source: {
        title: source.title,
        url: source.url,
        publishedAt: source.publishedAt,
        accessedAt: source.accessedAt,
      } satisfies EditorialSource,
      evidence: {
        label: source.title,
        value: source.excerpt.slice(0, 2_000),
        sourceUrl: source.url,
        observedAt: source.accessedAt,
      } satisfies EditorialEvidence,
      excerpt: source.excerpt,
    };
  } catch {
    return null;
  }
}

async function createQueuedJob(input: {
  topic: string;
  dedupeKey: string;
  stage: 'generate' | 'image' | 'translate';
  payload: Record<string, unknown>;
  sourceEventId?: string | null;
  sourceItemId?: string | null;
  articleId?: string | null;
  revisionId?: string | null;
}) {
  const [job] = await getDatabase()
    .insert(editorialJobs)
    .values({
      topic: input.topic.slice(0, 240),
      dedupeKey: input.dedupeKey.slice(0, 240),
      status: 'queued',
      stage: input.stage,
      payload: input.payload,
      sourceEventId: input.sourceEventId ?? null,
      sourceItemId: input.sourceItemId ?? null,
      articleId: input.articleId ?? null,
      revisionId: input.revisionId ?? null,
      maxAttempts: 3,
    })
    .onConflictDoNothing({ target: editorialJobs.dedupeKey })
    .returning();
  return job ?? null;
}

async function enqueueIfConfigured(
  jobId: string,
  stage: 'generate' | 'image' | 'translate' = 'generate',
) {
  const automation = editorialAutomationStatus();
  if (!automation.configured || !automation.enabled) return null;
  const response = await enqueueEditorialWorker(
    stage === 'image'
      ? { kind: 'image', jobId }
      : stage === 'translate'
        ? { kind: 'translate', jobId }
        : { kind: 'generate', jobId },
  );
  await getDatabase()
    .update(editorialJobs)
    .set({ qstashMessageId: response.messageId, updatedAt: new Date() })
    .where(eq(editorialJobs.id, jobId));
  return response.messageId;
}

export async function createManualEditorialJob(input: {
  topic: string;
  category: EditorialCategory;
  sources: EditorialSource[];
}) {
  const localDate = vietnamLocalDate();
  const key = `manual:${localDate}:${hash(input.topic.toLowerCase()).slice(0, 32)}`;
  const job = await createQueuedJob({
    topic: input.topic,
    dedupeKey: key,
    stage: 'generate',
    payload: {
      category: input.category,
      localDate,
      sources: input.sources,
      evidence: [],
    },
  });
  if (job) await enqueueIfConfigured(job.id);
  return job;
}

export async function createEditorialRewriteJob(input: {
  articleId: string;
  revisionId: string;
  reviewNote: string;
}) {
  const [revision] = await getDatabase()
    .select()
    .from(articleRevisions)
    .where(
      and(
        eq(articleRevisions.id, input.revisionId),
        eq(articleRevisions.articleId, input.articleId),
      ),
    )
    .limit(1);
  if (!revision) throw new Error('Không tìm thấy phiên bản cần AI sửa.');
  const topic = `Viết lại bài “${revision.title}”. Góp ý bắt buộc của biên tập viên: ${input.reviewNote.trim().slice(0, 2_000)}. Giữ các nguồn và dữ kiện đã có, sửa nội dung để đáp ứng góp ý; không bịa thêm dữ kiện.`;
  const job = await createQueuedJob({
    topic,
    dedupeKey: `rewrite:${revision.id}:${hash(input.reviewNote).slice(0, 24)}`,
    stage: 'generate',
    articleId: input.articleId,
    revisionId: input.revisionId,
    payload: {
      category: revision.publicationCategory ?? 'news',
      sources: revision.sources,
      evidence: revision.evidence,
      sourceEventId: revision.sourceEventId ?? undefined,
      articleIdToRevise: input.articleId,
      revisionIdToRevise: input.revisionId,
      reviewNote: input.reviewNote,
    },
  });
  if (job) await enqueueIfConfigured(job.id);
  return job;
}

async function collectDailyEditorialWorkUnlocked(localDate: string) {
  await ensurePublicationSlots(localDate);
  const market = await getMarketData('sjc', 'bar-1l');
  const scouting = await scoutEditorialSources(AbortSignal.timeout(45_000));
  const persisted = await persistScoutedItems(scouting.items);
  const currentMarket = market.latest
    ? {
        buy: market.latest.buy,
        sell: market.latest.sell,
        observedAt: market.generatedAt,
      }
    : null;
  const topics = selectDailyEditorialTopics(scouting.items, currentMarket);
  const jobs: Array<{ id: string; lane: string }> = [];
  for (const topic of topics) {
    const sourceEvidence = await Promise.all(topic.items.map(evidenceFor));
    await Promise.all(
      sourceEvidence.map(async (entry, index) => {
        const item = topic.items[index];
        const stored = item ? persisted.get(item.url) : undefined;
        if (!stored) return;
        await getDatabase()
          .update(editorialSourceItems)
          .set(
            entry
              ? {
                  status: 'fetched',
                  fetchedAt: new Date(),
                  contentExcerpt: entry.excerpt,
                  contentHash: hash(entry.excerpt),
                  errorMessage: null,
                  updatedAt: new Date(),
                }
              : {
                  status: 'failed',
                  errorMessage: 'Không đọc được nội dung nguồn để kiểm chứng.',
                  updatedAt: new Date(),
                },
          )
          .where(eq(editorialSourceItems.id, stored.sourceItemId));
      }),
    );
    const usableEvidence = sourceEvidence.filter(
      (item): item is NonNullable<typeof item> => Boolean(item),
    );
    const sources = usableEvidence.map((item) => item.source);
    const evidence: EditorialEvidence[] = [
      ...(market.latest
        ? [
            {
              label: 'Giá mua vào SJC',
              value: `${market.latest.buy.toFixed(2)} triệu đồng/lượng`,
              sourceUrl: market.source.url ?? undefined,
              observedAt: market.generatedAt,
            },
            {
              label: 'Giá bán ra SJC',
              value: `${market.latest.sell.toFixed(2)} triệu đồng/lượng`,
              sourceUrl: market.source.url ?? undefined,
              observedAt: market.generatedAt,
            },
          ]
        : []),
      ...usableEvidence.map((item) => item.evidence),
    ];
    if (!evidence.length) continue;
    const primary = topic.items[0]
      ? persisted.get(topic.items[0].url)
      : undefined;
    const job = await createQueuedJob({
      topic: topic.topic,
      dedupeKey: `daily:${localDate}:${topic.lane}`,
      stage: 'generate',
      payload: {
        category: topic.category,
        localDate,
        lane: topic.lane,
        sources,
        evidence,
        sourceEventId: primary?.eventId,
      },
      sourceEventId: primary?.eventId ?? null,
      sourceItemId: primary?.sourceItemId ?? null,
    });
    if (job) {
      jobs.push({ id: job.id, lane: topic.lane });
      if (primary?.eventId) {
        await getDatabase()
          .update(editorialEvents)
          .set({
            status: 'selected',
            selectedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(editorialEvents.id, primary.eventId));
      }
      await enqueueIfConfigured(job.id);
    }
  }
  return {
    status: 'queued' as const,
    localDate,
    jobs,
    scoutingErrors: scouting.errors,
  };
}

export async function collectDailyEditorialWork(
  localDate = vietnamLocalDate(),
) {
  const result = await withDatabaseAdvisoryLock(
    `editorial:collect:${localDate}`,
    () => collectDailyEditorialWorkUnlocked(localDate),
  );
  return result ?? { status: 'locked' as const, localDate };
}

async function recordGenerationAttempts(
  jobId: string,
  attempts: readonly {
    provider: string;
    model: string | null;
    status: string;
    retryable: boolean;
    statusCode: number | null;
    retryAfterMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    errorMessage?: string;
  }[],
  stage: 'generate' | 'translate' = 'generate',
) {
  if (!attempts.length) return [];
  return getDatabase()
    .insert(editorialJobAttempts)
    .values(
      attempts.map((attempt, index) => ({
        jobId,
        attemptNumber: index + 1,
        stage,
        provider: attempt.provider,
        model: attempt.model,
        status:
          attempt.status === 'succeeded'
            ? 'succeeded'
            : attempt.status === 'skipped'
              ? 'cancelled'
              : 'failed',
        retryable: attempt.retryable,
        httpStatus: attempt.statusCode,
        retryAfterMs: attempt.retryAfterMs,
        inputTokens: attempt.inputTokens,
        outputTokens: attempt.outputTokens,
        errorMessage: attempt.errorMessage ?? null,
        completedAt: new Date(),
      })),
    )
    .onConflictDoNothing();
}

export async function runEditorialGenerationJob(jobId: string) {
  const db = getDatabase();
  const [job] = await db
    .select()
    .from(editorialJobs)
    .where(eq(editorialJobs.id, jobId))
    .limit(1);
  if (!job) throw new Error('Không tìm thấy tác vụ biên tập.');
  if (job.status === 'completed') return { status: 'completed' as const, job };
  if (job.stage !== 'generate')
    return { status: 'skipped' as const, reason: 'wrong-stage' };
  if (job.attemptCount >= job.maxAttempts) {
    return { status: 'skipped' as const, reason: 'max-attempts' };
  }
  const payload = jobPayload(job.payload);
  const reservationKey = `editorial:generate:${job.id}:${job.attemptCount + 1}`;
  const reservation = await reserveEditorialCost({
    idempotencyKey: reservationKey,
    entryType: 'generation',
    reservedVnd: estimateEditorialTextReservationVnd({
      promptCharacters: editorialPromptCharacters(job.topic, payload),
    }),
    jobId: job.id,
    metadata: { stage: 'generate' },
  });
  if (!reservation.accepted) {
    await db
      .update(editorialJobs)
      .set({
        status: 'queued',
        retryAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        errorMessage: 'Ngân sách biên tập hôm nay hoặc tháng này không đủ.',
        updatedAt: new Date(),
      })
      .where(eq(editorialJobs.id, job.id));
    return { status: 'waiting_budget' as const };
  }
  const startedAt = new Date();
  await db
    .update(editorialJobs)
    .set({
      status: 'running',
      attemptCount: job.attemptCount + 1,
      startedAt,
      updatedAt: startedAt,
      errorMessage: null,
    })
    .where(eq(editorialJobs.id, job.id));
  try {
    const generated = await generateEditorialDraft(
      job.topic,
      payload.sources ?? [],
      AbortSignal.timeout(35_000),
      payload.evidence ?? [],
    );
    await recordGenerationAttempts(job.id, generated.attempts);
    const created = payload.articleIdToRevise
      ? {
          article: { id: payload.articleIdToRevise },
          revision: await createEditorialRevision({
            articleId: payload.articleIdToRevise,
            title: generated.title,
            excerpt: generated.excerpt,
            contentMarkdown: generated.contentMarkdown,
            category: payload.category ?? 'news',
            sources: payload.sources ?? [],
            evidence: payload.evidence ?? [],
            seoTitle: generated.seoTitle,
            seoDescription: generated.seoDescription,
            coverAlt: generated.coverAlt,
            imagePrompt: generated.imagePrompt,
            reviewNote: payload.reviewNote,
          }),
        }
      : await createArticleDraft({
          title: generated.title,
          excerpt: generated.excerpt,
          contentMarkdown: generated.contentMarkdown,
          category: payload.category ?? 'news',
          sources: payload.sources ?? [],
          evidence: payload.evidence ?? [],
          sourceEventId: payload.sourceEventId ?? job.sourceEventId,
          seoTitle: generated.seoTitle,
          seoDescription: generated.seoDescription,
          coverAlt: generated.coverAlt,
          imagePrompt: generated.imagePrompt,
        });
    await db
      .update(editorialJobs)
      .set({
        status: 'completed',
        provider: generated.provider,
        model: generated.model,
        inputTokens: generated.inputTokens,
        outputTokens: generated.outputTokens,
        articleId: created.article.id,
        revisionId: created.revision.id,
        result: {
          provider: generated.provider,
          attempts: generated.attempts.length,
        },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(editorialJobs.id, job.id));
    await settleEditorialCost(reservationKey, {
      actualVnd: estimateEditorialTextActualVnd({
        inputTokens: generated.inputTokens,
        outputTokens: generated.outputTokens,
      }),
      provider: generated.provider,
      model: generated.model,
    });
    return {
      status: 'completed' as const,
      articleId: created.article.id,
      revisionId: created.revision.id,
    };
  } catch (error) {
    const attempts =
      error instanceof EditorialGenerationError ? error.attempts : [];
    await recordGenerationAttempts(job.id, attempts);
    const retryable =
      error instanceof EditorialGenerationError
        ? attempts.length > 0 &&
          attempts.every(
            (attempt) => attempt.retryable || attempt.status === 'skipped',
          )
        : true;
    const retryAfterMs = Math.max(
      0,
      ...attempts.map((attempt) => attempt.retryAfterMs ?? 0),
    );
    await db
      .update(editorialJobs)
      .set({
        status:
          retryable && job.attemptCount + 1 < job.maxAttempts
            ? 'queued'
            : 'failed',
        retryAt: retryable
          ? new Date(Date.now() + Math.max(60_000, retryAfterMs))
          : null,
        errorMessage:
          error instanceof Error
            ? error.message.slice(0, 500)
            : 'Không tạo được bản nháp.',
        updatedAt: new Date(),
        completedAt: retryable ? null : new Date(),
      })
      .where(eq(editorialJobs.id, job.id));
    const usedUpstream = attempts.some(
      (attempt) => attempt.status !== 'skipped',
    );
    if (usedUpstream) {
      await settleEditorialCost(reservationKey, {});
    } else {
      await releaseEditorialCost(reservationKey);
    }
    return { status: retryable ? ('retrying' as const) : ('failed' as const) };
  }
}

/** Queue exactly one English translation for a specific published revision. */
export async function queueEditorialTranslation(
  revisionId: string,
  options: { retry?: boolean } = {},
) {
  const db = getDatabase();
  const [revision] = await db
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.id, revisionId))
    .limit(1);
  if (!revision) throw new Error('Không tìm thấy phiên bản bài viết để dịch.');

  if (options.retry) {
    await db
      .insert(articleTranslations)
      .values({ sourceRevisionId: revision.id, locale: 'en', status: 'queued' })
      .onConflictDoNothing({
        target: [articleTranslations.sourceRevisionId, articleTranslations.locale],
      });
    await db
      .update(articleTranslations)
      .set({ status: 'queued', errorMessage: null, updatedAt: new Date() })
      .where(
        and(
          eq(articleTranslations.sourceRevisionId, revision.id),
          eq(articleTranslations.locale, 'en'),
        ),
      );
  } else {
    await db
      .insert(articleTranslations)
      .values({ sourceRevisionId: revision.id, locale: 'en', status: 'queued' })
      .onConflictDoNothing({
        target: [articleTranslations.sourceRevisionId, articleTranslations.locale],
      });
  }

  const job = await createQueuedJob({
    topic: `Translate “${revision.title}” to English`,
    dedupeKey: options.retry
      ? `translate:${revision.id}:en:retry:${Date.now()}`
      : `translate:${revision.id}:en`,
    stage: 'translate',
    payload: { sourceRevisionId: revision.id, locale: 'en' },
    articleId: revision.articleId,
    revisionId: revision.id,
  });
  if (job) await enqueueIfConfigured(job.id, 'translate');
  return job;
}

/** Backfill published revisions in bounded batches so a restart is harmless. */
export async function queueMissingEditorialTranslations(limit = 12) {
  const rows = await getDatabase()
    .select({ revisionId: articleRevisions.id })
    .from(articles)
    .innerJoin(
      articleRevisions,
      eq(articleRevisions.id, articles.publishedRevisionId),
    )
    .leftJoin(
      articleTranslations,
      and(
        eq(articleTranslations.sourceRevisionId, articleRevisions.id),
        eq(articleTranslations.locale, 'en'),
      ),
    )
    .where(
      and(
        eq(articles.status, 'published'),
        isNull(articleTranslations.id),
      ),
    )
    .orderBy(desc(articles.publishedAt))
    .limit(Math.max(1, Math.min(24, limit)));
  let queued = 0;
  for (const row of rows) {
    if (await queueEditorialTranslation(row.revisionId)) queued += 1;
  }
  return queued;
}

async function runEditorialTranslationJobLocked(jobId: string) {
  const db = getDatabase();
  const [job] = await db
    .select()
    .from(editorialJobs)
    .where(eq(editorialJobs.id, jobId))
    .limit(1);
  if (!job) throw new Error('Không tìm thấy tác vụ dịch bài viết.');
  if (job.status === 'completed') return { status: 'completed' as const, job };
  if (job.stage !== 'translate')
    return { status: 'skipped' as const, reason: 'wrong-stage' };
  if (!job.revisionId || job.attemptCount >= job.maxAttempts)
    return { status: 'skipped' as const, reason: 'max-attempts' };

  const [revision] = await db
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.id, job.revisionId))
    .limit(1);
  if (!revision) throw new Error('Phiên bản bài viết cần dịch không còn tồn tại.');

  const reservationKey = `editorial:translate:${job.id}:${job.attemptCount + 1}`;
  const reservation = await reserveEditorialCost({
    idempotencyKey: reservationKey,
    entryType: 'translation',
    reservedVnd: estimateEditorialTextReservationVnd({
      promptCharacters:
        revision.title.length +
        revision.excerpt.length +
        revision.contentMarkdown.length +
        1_000,
      outputTokens: Math.ceil(revision.contentMarkdown.length / 3) + 1_000,
    }),
    jobId: job.id,
    articleId: revision.articleId,
    revisionId: revision.id,
    metadata: { stage: 'translate', locale: 'en' },
  });
  if (!reservation.accepted) {
    await db
      .update(editorialJobs)
      .set({
        status: 'queued',
        retryAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        errorMessage: 'Ngân sách biên tập hôm nay hoặc tháng này không đủ.',
        updatedAt: new Date(),
      })
      .where(eq(editorialJobs.id, job.id));
    return { status: 'waiting_budget' as const };
  }

  const startedAt = new Date();
  await db
    .update(editorialJobs)
    .set({
      status: 'running',
      attemptCount: job.attemptCount + 1,
      startedAt,
      updatedAt: startedAt,
      errorMessage: null,
    })
    .where(eq(editorialJobs.id, job.id));
  try {
    const translated = await generateEditorialTranslation(
      revision,
      AbortSignal.timeout(80_000),
    );
    await recordGenerationAttempts(job.id, translated.attempts, 'translate');
    const now = new Date();
    await db
      .update(articleTranslations)
      .set({
        status: 'ready',
        title: translated.title,
        excerpt: translated.excerpt,
        contentMarkdown: translated.contentMarkdown,
        seoTitle: translated.seoTitle ?? null,
        seoDescription: translated.seoDescription ?? null,
        coverAlt: translated.coverAlt ?? null,
        provider: translated.provider,
        model: translated.model,
        inputTokens: translated.inputTokens,
        outputTokens: translated.outputTokens,
        errorMessage: null,
        translatedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(articleTranslations.sourceRevisionId, revision.id),
          eq(articleTranslations.locale, 'en'),
        ),
      );
    await db
      .update(editorialJobs)
      .set({
        status: 'completed',
        provider: translated.provider,
        model: translated.model,
        inputTokens: translated.inputTokens,
        outputTokens: translated.outputTokens,
        result: { provider: translated.provider, locale: 'en' },
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(editorialJobs.id, job.id));
    await settleEditorialCost(reservationKey, {
      actualVnd: estimateEditorialTextActualVnd({
        inputTokens: translated.inputTokens,
        outputTokens: translated.outputTokens,
      }),
      provider: translated.provider,
      model: translated.model,
    });
    const [article] = await db
      .select({ slug: articles.slug })
      .from(articles)
      .where(eq(articles.id, revision.articleId))
      .limit(1);
    revalidatePath('/');
    revalidatePath('/nhip-vang');
    if (article) revalidatePath(`/nhip-vang/${article.slug}`);
    return { status: 'completed' as const, revisionId: revision.id };
  } catch (error) {
    const attempts = error instanceof EditorialGenerationError ? error.attempts : [];
    await recordGenerationAttempts(job.id, attempts, 'translate');
    const failures = attempts.filter((attempt) => attempt.status === 'failed');
    const retryable = error instanceof EditorialGenerationError
      ? failures.length > 0 && failures.every((attempt) => attempt.retryable)
      : true;
    const retry = retryable && job.attemptCount + 1 < job.maxAttempts;
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Không thể dịch bài viết.';
    await db
      .update(editorialJobs)
      .set({
        status: retry ? 'queued' : 'failed',
        retryAt: retry ? new Date(Date.now() + 60_000) : null,
        errorMessage: message,
        updatedAt: new Date(),
        completedAt: retry ? null : new Date(),
      })
      .where(eq(editorialJobs.id, job.id));
    if (!retry)
      await db
        .update(articleTranslations)
        .set({ status: 'failed', errorMessage: message, updatedAt: new Date() })
        .where(
          and(
            eq(articleTranslations.sourceRevisionId, revision.id),
            eq(articleTranslations.locale, 'en'),
          ),
        );
    if (attempts.some((attempt) => attempt.status !== 'skipped'))
      await settleEditorialCost(reservationKey, {});
    else await releaseEditorialCost(reservationKey);
    return { status: retry ? ('retrying' as const) : ('failed' as const) };
  }
}

export async function runEditorialTranslationJob(jobId: string) {
  const result = await withDatabaseAdvisoryLock(
    `editorial-translation:${jobId}`,
    () => runEditorialTranslationJobLocked(jobId),
  );
  return result ?? { status: 'skipped' as const, reason: 'already-running' };
}

export async function runEditorialImageJob(jobId: string) {
  const db = getDatabase();
  const [job] = await db
    .select()
    .from(editorialJobs)
    .where(eq(editorialJobs.id, jobId))
    .limit(1);
  if (!job || job.stage !== 'image') {
    throw new Error('Tác vụ ảnh biên tập không hợp lệ.');
  }
  await db
    .update(editorialJobs)
    .set({
      status: 'cancelled',
      errorMessage:
        'Đã tắt tạo ảnh AI; Admin chọn ảnh thương hiệu hoặc tải ảnh lên.',
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(editorialJobs.id, job.id));
  return { status: 'cancelled' as const, reason: 'brand-upload-mode' };
}

async function sourcesRemainReachable(sources: EditorialSource[]) {
  if (!sources.length) return false;
  const checks = await Promise.all(
    sources.slice(0, 3).map(async (source) => {
      try {
        const response = await fetch(source.url, {
          method: 'HEAD',
          redirect: 'follow',
          headers: {
            'User-Agent':
              'KimTuyenEditorialBot/1.0 (+https://www.vanghomnay.online/bien-tap)',
          },
          signal: AbortSignal.timeout(8_000),
        });
        return response.ok || response.status === 405;
      } catch {
        return false;
      }
    }),
  );
  return checks.every(Boolean);
}

async function recheckScheduledSources(localDate: string) {
  const db = getDatabase();
  const threshold = new Date(Date.now() - 50 * 60 * 1_000);
  const candidates = await db
    .select({ slot: editorialPublicationSlots, revision: articleRevisions })
    .from(editorialPublicationSlots)
    .innerJoin(
      articleRevisions,
      eq(articleRevisions.id, editorialPublicationSlots.revisionId),
    )
    .where(
      and(
        eq(editorialPublicationSlots.localDate, localDate),
        eq(editorialPublicationSlots.status, 'scheduled'),
        lte(editorialPublicationSlots.updatedAt, threshold),
      ),
    )
    .limit(3);
  const results: Array<{ slot: string; reachable: boolean }> = [];
  for (const candidate of candidates) {
    const reachable = await sourcesRemainReachable(candidate.revision.sources);
    results.push({ slot: candidate.slot.slot, reachable });
    if (reachable) {
      await db
        .update(editorialPublicationSlots)
        .set({ updatedAt: new Date() })
        .where(eq(editorialPublicationSlots.id, candidate.slot.id));
      continue;
    }
    await db.transaction(async (tx) => {
      await tx
        .update(articleRevisions)
        .set({
          approvalStatus: 'revoked',
          reviewNote: 'Nguồn cần kiểm tra lại trước khi đăng theo lịch.',
          reviewedAt: new Date(),
        })
        .where(eq(articleRevisions.id, candidate.revision.id));
      await tx
        .update(editorialPublicationSlots)
        .set({
          status: 'failed',
          failureCount: candidate.slot.failureCount + 1,
          failureMessage: 'Nguồn không còn phản hồi; cần Admin duyệt lại.',
          lastFailedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(editorialPublicationSlots.id, candidate.slot.id));
    });
  }
  return results;
}

export async function reconcileEditorialWork() {
  const localDate = vietnamLocalDate();
  await ensurePublicationSlots(localDate);
  const sourceChecks = await recheckScheduledSources(localDate);
  const slots = await getDatabase()
    .select()
    .from(editorialPublicationSlots)
    .where(
      and(
        eq(editorialPublicationSlots.localDate, localDate),
        inArray(editorialPublicationSlots.status, ['scheduled', 'failed']),
      ),
    );
  const published = [] as Array<{ slot: string; status: string }>;
  for (const slot of slots) {
    if (slot.status === 'scheduled' && slot.scheduledAt <= new Date()) {
      const outcome = await publishDueSlot(
        localDate,
        slot.slot as 'morning' | 'noon' | 'evening',
      );
      published.push({ slot: slot.slot, status: outcome.status });
    }
  }
  const queuedTranslations = await queueMissingEditorialTranslations();
  const queued = await getDatabase()
    .select({ id: editorialJobs.id, stage: editorialJobs.stage })
    .from(editorialJobs)
    .where(
      and(
        eq(editorialJobs.status, 'queued'),
        or(
          isNull(editorialJobs.retryAt),
          lte(editorialJobs.retryAt, new Date()),
        ),
      ),
    )
    .orderBy(desc(editorialJobs.createdAt))
    .limit(12);
  const automation = editorialAutomationStatus();
  if (automation.configured && automation.enabled) {
    await Promise.all(
      queued.map((job) =>
        job.stage === 'image'
          ? runEditorialImageJob(job.id)
          : job.stage === 'translate'
            ? enqueueEditorialWorker({ kind: 'translate', jobId: job.id })
            : enqueueEditorialWorker({ kind: 'generate', jobId: job.id }),
      ),
    );
  }
  return {
    localDate,
    published,
    queued: queued.length,
    queuedTranslations,
    sourceChecks,
  };
}

export async function enqueueImageRevision(jobId: string, revisionId?: string) {
  return enqueueEditorialWorker({ kind: 'image', jobId, revisionId });
}

export { approveAndScheduleRevisions };
