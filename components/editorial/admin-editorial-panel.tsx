'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  editorialCategoryLabels,
  isEditorialCategory,
  type EditorialCategory,
} from '@/lib/editorial/types';

type UnknownRecord = Record<string, unknown>;

type SourceSummary = {
  title: string;
  url: string;
  publishedAt: string | null;
  accessedAt: string | null;
};

type EvidenceSummary = {
  label: string;
  value: string;
  sourceUrl: string | null;
  observedAt: string | null;
};

type EditorialRevision = {
  id: string;
  title: string;
  excerpt: string;
  contentMarkdown: string;
  sources: SourceSummary[];
  evidence: EvidenceSummary[];
  status: string;
  createdAt: string | null;
  approvalStatus: string | null;
  approvedAt: string | null;
  reviewNote: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  coverImageDisclosure: string | null;
  imagePrompt: string | null;
};

type EditorialArticle = {
  id: string;
  slug: string;
  category: string;
  status: string;
  updatedAt: string | null;
  latestRevision: EditorialRevision | null;
  revisions: EditorialRevision[];
  translations: Array<{
    sourceRevisionId: string;
    locale: string;
    status: string;
    updatedAt: string | null;
    errorMessage: string | null;
  }>;
};

type EditorialJob = {
  id: string;
  topic: string;
  status: string;
  costVnd: number | null;
  createdAt: string | null;
  errorMessage: string | null;
  provider: string | null;
  model: string | null;
};

type EditorialBudget = {
  monthUsedVnd: number | null;
  monthRemainingVnd: number | null;
  dayUsedVnd: number | null;
  dayRemainingVnd: number | null;
  monthlyLimitVnd: number | null;
  dailyLimitVnd: number | null;
};

type EditorialAutomation = {
  configured: boolean;
  enabled: boolean;
};

type EditorialProviderStatus = {
  provider: string;
  model: string | null;
  configured: boolean;
  missing: string[];
};

type EditorialBrandCover = {
  id: string;
  category: string;
  url: string;
  alt: string;
  disclosure: string;
  version: string;
};

type EditorialSlot = {
  id: string | null;
  localDate: string | null;
  slot: string;
  scheduledAt: string | null;
  articleId: string | null;
  revisionId: string | null;
  status: string;
  failureMessage: string | null;
};

type EditorialData = {
  articles: EditorialArticle[];
  jobs: EditorialJob[];
  budget: EditorialBudget;
  slots?: EditorialSlot[];
  automation?: EditorialAutomation;
  providers?: EditorialProviderStatus[];
  imageProvider?: EditorialProviderStatus;
  brandCovers?: EditorialBrandCover[];
};

type ReviewCard = {
  article: EditorialArticle;
  revision: EditorialRevision;
};

const initialForm = {
  title: '',
  excerpt: '',
  contentMarkdown: '',
  category: 'news' as EditorialCategory,
  sources: '',
};

const defaultSlots = [
  { slot: 'morning', label: 'Sáng · 08:30' },
  { slot: 'noon', label: 'Trưa · 12:00' },
  { slot: 'evening', label: 'Chiều · 17:00' },
] as const;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  return record ? Object.values(record) : [];
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value === 'string' &&
    value.trim() &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return null;
}

function sourceTitle(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Nguồn tham khảo';
  }
}

function parseSource(value: unknown): SourceSummary | null {
  const source = asRecord(value);
  if (!source) return null;
  const url = firstString(source.url, source.sourceUrl);
  if (!url) return null;
  return {
    title: firstString(source.title, source.name) ?? sourceTitle(url),
    url,
    publishedAt: firstString(source.publishedAt, source.published_at),
    accessedAt: firstString(source.accessedAt, source.accessed_at),
  };
}

function parseEvidence(value: unknown): EvidenceSummary | null {
  const evidence = asRecord(value);
  if (!evidence) return null;
  const label = firstString(evidence.label, evidence.name);
  const itemValue = firstString(
    evidence.value,
    evidence.detail,
    evidence.summary,
  );
  if (!label && !itemValue) return null;
  return {
    label: label ?? 'Dữ kiện',
    value: itemValue ?? 'Đã có dữ kiện kèm theo.',
    sourceUrl: firstString(
      evidence.sourceUrl,
      evidence.source_url,
      evidence.url,
    ),
    observedAt: firstString(
      evidence.observedAt,
      evidence.observed_at,
      evidence.date,
    ),
  };
}

function parseRevision(value: unknown): EditorialRevision | null {
  const revision = asRecord(value);
  if (!revision) return null;
  const id = firstString(revision.id);
  if (!id) return null;
  return {
    id,
    title: firstString(revision.title) ?? 'Bản nháp chưa có tiêu đề',
    excerpt: firstString(revision.excerpt, revision.description) ?? '',
    contentMarkdown:
      firstString(
        revision.contentMarkdown,
        revision.content_markdown,
        revision.content,
      ) ?? '',
    sources: asArray(revision.sources)
      .map(parseSource)
      .filter((source): source is SourceSummary => Boolean(source)),
    evidence: asArray(revision.evidence)
      .map(parseEvidence)
      .filter((item): item is EvidenceSummary => Boolean(item)),
    status: firstString(revision.status) ?? 'draft',
    createdAt: firstString(revision.createdAt, revision.created_at),
    approvalStatus: firstString(
      revision.approvalStatus,
      revision.approval_status,
    ),
    approvedAt: firstString(revision.approvedAt, revision.approved_at),
    reviewNote: firstString(revision.reviewNote, revision.review_note),
    seoTitle: firstString(
      revision.seoTitle,
      revision.seo_title,
      revision.metaTitle,
    ),
    seoDescription: firstString(
      revision.seoDescription,
      revision.seo_description,
      revision.metaDescription,
    ),
    coverImageUrl: firstString(
      revision.coverImageUrl,
      revision.cover_image_url,
      revision.imageUrl,
      revision.image_url,
    ),
    coverImageAlt: firstString(
      revision.coverImageAlt,
      revision.cover_image_alt,
      revision.imageAlt,
      revision.image_alt,
      revision.coverAlt,
    ),
    coverImageDisclosure: firstString(
      revision.coverImageDisclosure,
      revision.cover_image_disclosure,
      revision.imageDisclosure,
    ),
    imagePrompt: firstString(
      revision.imagePrompt,
      revision.image_prompt,
      revision.coverImagePrompt,
      revision.cover_image_prompt,
    ),
  };
}

function parseArticle(value: unknown, index: number): EditorialArticle | null {
  const article = asRecord(value);
  if (!article) return null;
  const revisions = asArray(article.revisions)
    .map(parseRevision)
    .filter((revision): revision is EditorialRevision => Boolean(revision));
  const parsedLatest = parseRevision(
    article.latestRevision ?? article.latest_revision,
  );
  const latestRevision = parsedLatest ?? revisions[0] ?? null;
  const id = firstString(article.id);
  if (!id) return null;
  const translations = asArray(article.translations)
    .flatMap((value) => {
      const item = asRecord(value);
      const sourceRevisionId = item ? firstString(item.sourceRevisionId, item.source_revision_id) : null;
      if (!item || !sourceRevisionId) return [];
      return [{
        sourceRevisionId,
        locale: firstString(item.locale) ?? 'en',
        status: firstString(item.status) ?? 'queued',
        updatedAt: firstString(item.updatedAt, item.updated_at),
        errorMessage: firstString(item.errorMessage, item.error_message),
      }];
    });
  return {
    id,
    slug: firstString(article.slug) ?? `bai-viet-${index + 1}`,
    category: firstString(article.category) ?? 'news',
    status: firstString(article.status) ?? 'draft',
    updatedAt: firstString(article.updatedAt, article.updated_at),
    latestRevision,
    revisions: latestRevision
      ? [
          latestRevision,
          ...revisions.filter((revision) => revision.id !== latestRevision.id),
        ]
      : revisions,
    translations,
  };
}

function parseJob(value: unknown): EditorialJob | null {
  const job = asRecord(value);
  const id = job ? firstString(job.id) : null;
  if (!job || !id) return null;
  return {
    id,
    topic: firstString(job.topic) ?? 'Tác vụ biên tập',
    status: firstString(job.status) ?? 'queued',
    costVnd: asNumber(job.costVnd ?? job.cost_vnd),
    createdAt: firstString(job.createdAt, job.created_at),
    errorMessage: firstString(job.errorMessage, job.error_message),
    provider: firstString(job.provider),
    model: firstString(job.model),
  };
}

function parseSlot(value: unknown): EditorialSlot | null {
  const slot = asRecord(value);
  if (!slot) return null;
  const slotName = firstString(slot.slot, slot.name, slot.time);
  if (!slotName) return null;
  return {
    id: firstString(slot.id),
    localDate: firstString(slot.localDate, slot.local_date, slot.date),
    slot: slotName,
    scheduledAt: firstString(slot.scheduledAt, slot.scheduled_at),
    articleId: firstString(slot.articleId, slot.article_id),
    revisionId: firstString(slot.revisionId, slot.revision_id),
    status: firstString(slot.status) ?? 'open',
    failureMessage: firstString(slot.failureMessage, slot.failure_message),
  };
}

function parseEditorialData(value: unknown): EditorialData {
  const data = asRecord(value) ?? {};
  const budget = asRecord(data.budget) ?? {};
  const slotsValue = data.slots ?? data.dailySlots ?? data.daily_slots;
  return {
    articles: asArray(data.articles)
      .map(parseArticle)
      .filter((article): article is EditorialArticle => Boolean(article)),
    jobs: asArray(data.jobs)
      .map(parseJob)
      .filter((job): job is EditorialJob => Boolean(job)),
    budget: {
      monthUsedVnd: asNumber(budget.monthUsedVnd ?? budget.month_used_vnd),
      monthRemainingVnd: asNumber(
        budget.monthRemainingVnd ?? budget.month_remaining_vnd,
      ),
      dayUsedVnd: asNumber(budget.dayUsedVnd ?? budget.day_used_vnd),
      dayRemainingVnd: asNumber(
        budget.dayRemainingVnd ?? budget.day_remaining_vnd,
      ),
      monthlyLimitVnd: asNumber(
        budget.monthlyLimitVnd ?? budget.monthly_limit_vnd,
      ),
      dailyLimitVnd: asNumber(budget.dailyLimitVnd ?? budget.daily_limit_vnd),
    },
    ...(slotsValue === undefined
      ? {}
      : {
          slots: asArray(slotsValue)
            .map(parseSlot)
            .filter((slot): slot is EditorialSlot => Boolean(slot)),
        }),
    automation: {
      configured: Boolean(asRecord(data.automation)?.configured),
      enabled: Boolean(asRecord(data.automation)?.enabled),
    },
    providers: asArray(data.providers).map((value) => {
      const provider = asRecord(value) ?? {};
      return {
        provider: firstString(provider.provider) ?? 'unknown',
        model: firstString(provider.model),
        configured: Boolean(provider.configured),
        missing: asArray(provider.missing).filter(
          (item): item is string => typeof item === 'string',
        ),
      };
    }),
    imageProvider: (() => {
      const provider = asRecord(data.imageProvider);
      if (!provider) return undefined;
      return {
        provider: firstString(provider.provider) ?? 'unknown',
        model: firstString(provider.model),
        configured: Boolean(provider.configured),
        missing: asArray(provider.missing).filter(
          (item): item is string => typeof item === 'string',
        ),
      };
    })(),
    brandCovers: asArray(data.brandCovers)
      .map((value) => {
        const cover = asRecord(value);
        if (!cover) return null;
        const id = firstString(cover.id);
        const category = firstString(cover.category);
        const url = firstString(cover.url);
        if (!id || !category || !url) return null;
        return {
          id,
          category,
          url,
          alt: firstString(cover.alt) ?? '',
          disclosure: firstString(cover.disclosure) ?? '',
          version: firstString(cover.version) ?? '',
        };
      })
      .filter((cover): cover is EditorialBrandCover => Boolean(cover)),
  };
}

function currentVietnamDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function formatVnd(value: number | null) {
  return value === null ? '—' : `${value.toLocaleString('vi-VN')}đ`;
}

function categoryLabel(category: string) {
  return isEditorialCategory(category)
    ? editorialCategoryLabels[category]
    : category || 'Bài viết';
}

function slotKey(slot: Pick<EditorialSlot, 'slot' | 'scheduledAt'>) {
  const value = `${slot.slot} ${slot.scheduledAt ?? ''}`.toLowerCase();
  if (
    value.includes('morning') ||
    value.includes('sáng') ||
    value.includes('08:30') ||
    value.includes('0830')
  )
    return 'morning';
  if (
    value.includes('noon') ||
    value.includes('trưa') ||
    value.includes('12:00') ||
    value.includes('1200')
  )
    return 'noon';
  if (
    value.includes('evening') ||
    value.includes('chiều') ||
    value.includes('17:00') ||
    value.includes('1700')
  )
    return 'evening';
  return slot.slot;
}

function slotName(slot: Pick<EditorialSlot, 'slot' | 'scheduledAt'>) {
  const key = slotKey(slot);
  const match = defaultSlots.find((item) => item.slot === key);
  return match?.label ?? slot.slot;
}

function slotStatusLabel(status: string) {
  const labels: Record<string, string> = {
    open: 'Chờ duyệt',
    scheduled: 'Đã lên lịch',
    publishing: 'Đang đăng',
    published: 'Đã đăng',
    missed: 'Lỡ giờ đăng',
    failed: 'Cần xử lý',
    skipped: 'Đã bỏ qua',
    cancelled: 'Bỏ trống',
  };
  return labels[status] ?? status;
}

function approvalLabel(revision: EditorialRevision) {
  const status = revision.approvalStatus ?? revision.status;
  const labels: Record<string, string> = {
    draft: 'Chờ duyệt',
    pending: 'Chờ duyệt',
    reviewed: 'Đã kiểm tra',
    approved: 'Đã duyệt',
    changes_requested: 'Cần sửa',
    revoked: 'Đã thu hồi duyệt',
    published: 'Đã đăng',
    superseded: 'Đã thay thế',
  };
  return labels[status] ?? status;
}

function englishTranslation(article: EditorialArticle) {
  const revisionId = article.latestRevision?.id;
  return revisionId
    ? article.translations.find(
        (translation) =>
          translation.sourceRevisionId === revisionId && translation.locale === 'en',
      )
    : undefined;
}

function reviewKey(articleId: string, revisionId: string) {
  return `${articleId}:${revisionId}`;
}

function isReviewableRevision(revision: EditorialRevision) {
  const approval = revision.approvalStatus;
  if (['published', 'superseded'].includes(revision.status)) return false;
  if (approval && ['revoked', 'published'].includes(approval)) return false;
  return true;
}

function isOpenSlot(slot: EditorialSlot) {
  return slot.status === 'open' && !slot.articleId && !slot.revisionId;
}

function isSameVietnamDay(slot: EditorialSlot, date: string) {
  return !slot.localDate || slot.localDate === date;
}

function mergeTodaySlots(slots: EditorialSlot[] | undefined, date: string) {
  const today = (slots ?? []).filter((slot) => isSameVietnamDay(slot, date));
  return defaultSlots.map((fallback) => {
    const match = today.find((slot) => slotKey(slot) === fallback.slot);
    return (
      match ?? {
        id: null,
        localDate: date,
        slot: fallback.slot,
        scheduledAt: null,
        articleId: null,
        revisionId: null,
        status: 'open',
        failureMessage: null,
      }
    );
  });
}

function readApiError(value: unknown) {
  const result = asRecord(value);
  return result ? firstString(result.error, result.message) : null;
}

async function readResponseJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function ArticleSummary({ article, revision }: ReviewCard) {
  const sourceCount = revision.sources.length;
  const evidenceCount = revision.evidence.length;
  const seoReady = Boolean(revision.seoTitle && revision.seoDescription);
  const imageReady = Boolean(
    revision.coverImageUrl || revision.coverImageAlt || revision.imagePrompt,
  );

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 font-semibold text-primary">
          {categoryLabel(article.category)}
        </span>
        <span className="text-muted-foreground">{approvalLabel(revision)}</span>
      </div>
      <h3 className="mt-2 font-heading text-lg font-semibold leading-snug">
        {revision.title}
      </h3>
      {revision.excerpt ? (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          {revision.excerpt}
        </p>
      ) : null}
      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-[12px] border border-border/70 bg-background/45 p-2.5">
          <dt className="text-muted-foreground">Nguồn</dt>
          <dd className="mt-1 font-semibold">
            {sourceCount ? `${sourceCount} nguồn` : 'Cần kiểm tra'}
          </dd>
        </div>
        <div className="rounded-[12px] border border-border/70 bg-background/45 p-2.5">
          <dt className="text-muted-foreground">Dữ kiện</dt>
          <dd className="mt-1 font-semibold">
            {evidenceCount ? `${evidenceCount} mục` : 'Chưa có'}
          </dd>
        </div>
        <div className="rounded-[12px] border border-border/70 bg-background/45 p-2.5">
          <dt className="text-muted-foreground">SEO</dt>
          <dd className="mt-1 font-semibold">
            {seoReady ? 'Đã đủ' : 'Cần xem lại'}
          </dd>
        </div>
        <div className="rounded-[12px] border border-border/70 bg-background/45 p-2.5">
          <dt className="text-muted-foreground">Ảnh bìa</dt>
          <dd className="mt-1 font-semibold">
            {imageReady ? 'Đã chuẩn bị' : 'Chưa có'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function ReviewDetails({ revision }: { revision: EditorialRevision }) {
  const searchDescription =
    (revision.seoDescription ?? revision.excerpt) || 'Chưa có mô tả SEO riêng.';

  return (
    <details className="mt-4 rounded-[14px] border border-border/70 bg-background/30 p-3.5">
      <summary className="cursor-pointer text-sm font-semibold">
        Nguồn, dữ kiện và SEO
      </summary>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Nguồn đã thu thập
          </p>
          {revision.sources.length ? (
            <ul className="mt-2 space-y-2 text-sm">
              {revision.sources.map((source) => (
                <li
                  key={`${source.url}:${source.title}`}
                  className="rounded-[10px] border border-border/60 bg-card/35 p-2.5"
                >
                  <a
                    className="font-medium text-primary underline-offset-4 hover:underline"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.title}
                  </a>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Công bố: {formatDateTime(source.publishedAt)} · Đã đọc:{' '}
                    {formatDateTime(source.accessedAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Chưa có nguồn trong phiên bản này.
            </p>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Dữ kiện và liên hệ thị trường
          </p>
          {revision.evidence.length ? (
            <ul className="mt-2 space-y-2 text-sm">
              {revision.evidence.map((item, index) => (
                <li
                  key={`${item.label}:${index}`}
                  className="rounded-[10px] border border-border/60 bg-card/35 p-2.5"
                >
                  <p className="font-medium">{item.label}</p>
                  <p className="mt-1 text-muted-foreground">{item.value}</p>
                  {item.sourceUrl ? (
                    <a
                      className="mt-1 inline-block text-xs text-primary underline-offset-4 hover:underline"
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Mở bằng chứng
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Chưa có gói dữ kiện để đối chiếu.
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-3 border-t border-border/70 pt-4 lg:grid-cols-2">
        <div className="rounded-[12px] border border-border/60 bg-card/35 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Xem trước tìm kiếm
          </p>
          <p className="mt-2 text-sm font-semibold text-primary">
            {revision.seoTitle ?? revision.title}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {searchDescription}
          </p>
        </div>
        <div className="rounded-[12px] border border-border/60 bg-card/35 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Ảnh minh họa
          </p>
          <p className="mt-2 text-sm">
            {revision.coverImageAlt ?? 'Chưa có alt ảnh.'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {revision.coverImageDisclosure ??
              'Ảnh chỉ được công khai sau khi phiên bản được duyệt.'}
          </p>
          {revision.imagePrompt ? (
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
              Prompt: {revision.imagePrompt}
            </p>
          ) : null}
        </div>
      </div>
    </details>
  );
}

export function AdminEditorialPanel() {
  const [data, setData] = useState<EditorialData | null>(null);
  const [form, setForm] = useState(initialForm);
  const [topic, setTopic] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [coverSelections, setCoverSelections] = useState<
    Record<string, string>
  >({});
  const [coverFiles, setCoverFiles] = useState<Record<string, File | null>>({});
  const [coverAlts, setCoverAlts] = useState<Record<string, string>>({});
  const [coverDisclosures, setCoverDisclosures] = useState<
    Record<string, string>
  >({});

  const load = useCallback(async (quiet = false) => {
    try {
      const response = await fetch('/api/admin/articles', {
        cache: 'no-store',
      });
      const body = await readResponseJson(response);
      if (!response.ok)
        throw new Error(
          readApiError(body) ?? 'Không tải được quản trị bài viết.',
        );
      setData(parseEditorialData(body));
    } catch (error) {
      if (!quiet)
        setNotice(
          error instanceof Error
            ? error.message
            : 'Không tải được quản trị bài viết.',
        );
    }
  }, []);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    refreshIfVisible();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 30_000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [load]);

  const request = useCallback(
    async (
      body: Record<string, unknown>,
      method = 'POST',
      path = '/api/admin/articles',
    ) => {
      const action = typeof body.action === 'string' ? body.action : method;
      setLoadingAction(action);
      setNotice('');
      try {
        const options: RequestInit = {
          method,
          headers: { 'Content-Type': 'application/json' },
        };
        if (method !== 'GET') options.body = JSON.stringify(body);
        const response = await fetch(path, options);
        const result = await readResponseJson(response);
        if (!response.ok)
          throw new Error(readApiError(result) ?? 'Không thể xử lý yêu cầu.');
        setNotice('Đã cập nhật hàng chờ biên tập.');
        await load(true);
        return true;
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : 'Không thể xử lý yêu cầu.',
        );
        return false;
      } finally {
        setLoadingAction(null);
      }
    },
    [load],
  );

  const today = useMemo(() => currentVietnamDate(), []);
  const todaySlots = useMemo(
    () => mergeTodaySlots(data?.slots, today),
    [data?.slots, today],
  );
  const reviewCards = useMemo<ReviewCard[]>(() => {
    if (!data) return [];
    const scheduled = new Set(
      todaySlots
        .map((slot) => slot.revisionId)
        .filter((id): id is string => Boolean(id)),
    );
    return data.articles
      .flatMap((article) =>
        article.latestRevision
          ? [{ article, revision: article.latestRevision }]
          : [],
      )
      .filter(
        ({ revision }) =>
          isReviewableRevision(revision) && !scheduled.has(revision.id),
      )
      .sort((left, right) =>
        (right.revision.createdAt ?? '').localeCompare(
          left.revision.createdAt ?? '',
        ),
      );
  }, [data, todaySlots]);
  const reviewCardByKey = useMemo(
    () =>
      new Map(
        reviewCards.map((card) => [
          reviewKey(card.article.id, card.revision.id),
          card,
        ]),
      ),
    [reviewCards],
  );
  const openSlots = useMemo(() => todaySlots.filter(isOpenSlot), [todaySlots]);
  const activeSelectedKeys = useMemo(
    () => selectedKeys.filter((key) => reviewCardByKey.has(key)),
    [reviewCardByKey, selectedKeys],
  );
  const selectedCards = useMemo(
    () =>
      activeSelectedKeys
        .map((key) => reviewCardByKey.get(key))
        .filter((card): card is ReviewCard => Boolean(card)),
    [activeSelectedKeys, reviewCardByKey],
  );

  const parseSources = () =>
    form.sources
      .split('\n')
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => ({
        title: new URL(url).hostname,
        url,
        accessedAt: new Date().toISOString(),
      }));

  const saveDraft = async () => {
    try {
      const sources = parseSources();
      const ok = await request(
        editingId
          ? { ...form, sources }
          : { action: 'create', ...form, sources },
        editingId ? 'PATCH' : 'POST',
        editingId ? `/api/admin/articles/${editingId}` : '/api/admin/articles',
      );
      if (ok) {
        setEditingId(null);
        setForm(initialForm);
      }
    } catch {
      setNotice('Mỗi dòng nguồn phải là một URL hợp lệ.');
    }
  };

  const generate = async () => {
    if (!topic.trim()) return;
    try {
      const ok = await request({
        action: 'generate',
        topic,
        category: form.category,
        sources: parseSources(),
      });
      if (ok) setTopic('');
    } catch {
      setNotice('Mỗi dòng nguồn phải là một URL hợp lệ.');
    }
  };

  const edit = (article: EditorialArticle) => {
    if (!article.latestRevision) return;
    setEditingId(article.id);
    setForm({
      title: article.latestRevision.title,
      excerpt: article.latestRevision.excerpt,
      contentMarkdown: article.latestRevision.contentMarkdown,
      category: isEditorialCategory(article.category)
        ? article.category
        : 'news',
      sources: article.latestRevision.sources
        .map((source) => source.url)
        .join('\n'),
    });
    setAdvancedOpen(true);
    window.setTimeout(
      () =>
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth',
        }),
      0,
    );
  };

  const toggleSelection = (card: ReviewCard) => {
    const key = reviewKey(card.article.id, card.revision.id);
    const selected = activeSelectedKeys.includes(key);
    if (!selected && activeSelectedKeys.length >= openSlots.length) {
      setNotice(
        openSlots.length
          ? 'Hôm nay không còn vị trí đăng trống.'
          : 'Ba vị trí hôm nay đã được xếp lịch.',
      );
      return;
    }
    setSelectedKeys((current) =>
      selected ? current.filter((item) => item !== key) : [...current, key],
    );
    setAssignments((current) => {
      if (selected) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      const reserved = new Set(
        Object.entries(current)
          .filter(([existingKey]) => activeSelectedKeys.includes(existingKey))
          .map(([, slot]) => slot),
      );
      const nextSlot = openSlots.find((slot) => !reserved.has(slot.slot));
      return nextSlot ? { ...current, [key]: nextSlot.slot } : current;
    });
  };

  const approveSelected = async () => {
    if (!selectedCards.length) {
      setNotice('Chọn ít nhất một bản nháp để duyệt.');
      return;
    }
    const approvals = selectedCards.map(({ article, revision }) => ({
      articleId: article.id,
      revisionId: revision.id,
      slot: assignments[reviewKey(article.id, revision.id)],
    }));
    if (approvals.some((approval) => !approval.slot)) {
      setNotice('Chọn một giờ đăng cho từng bài đã chọn.');
      return;
    }
    const uniqueSlots = new Set(approvals.map((approval) => approval.slot));
    if (
      uniqueSlots.size !== approvals.length ||
      approvals.some(
        (approval) => !openSlots.some((slot) => slot.slot === approval.slot),
      )
    ) {
      setNotice('Mỗi bài cần một vị trí trống khác nhau trong hôm nay.');
      return;
    }
    const ok = await request({
      action: 'approve_schedule',
      approvals,
      date: today,
    });
    if (ok) {
      setSelectedKeys([]);
      setAssignments({});
    }
  };

  const requestChanges = async (card: ReviewCard) => {
    const key = reviewKey(card.article.id, card.revision.id);
    const note = reviewNotes[key]?.trim();
    if (!note) {
      setNotice('Nhập góp ý trước khi yêu cầu AI sửa bài.');
      return;
    }
    const ok = await request({
      action: 'request_changes',
      articleId: card.article.id,
      revisionId: card.revision.id,
      note,
    });
    if (ok) setReviewNotes((current) => ({ ...current, [key]: '' }));
  };

  const changeCover = async (
    card: ReviewCard,
    source: 'brand-library' | 'admin-upload',
  ) => {
    const key = reviewKey(card.article.id, card.revision.id);
    const formData = new FormData();
    formData.append('revisionId', card.revision.id);
    formData.append('source', source);
    if (coverAlts[key]?.trim()) formData.append('alt', coverAlts[key].trim());
    if (coverDisclosures[key]?.trim())
      formData.append('disclosure', coverDisclosures[key].trim());
    if (source === 'brand-library') {
      formData.append('coverId', coverSelections[key] ?? '');
    } else {
      const file = coverFiles[key];
      if (!file) {
        setNotice('Chọn ảnh trước khi tải lên.');
        return;
      }
      formData.append('file', file);
    }
    setLoadingAction('cover');
    setNotice('');
    try {
      const response = await fetch(
        `/api/admin/articles/${card.article.id}/cover`,
        {
          method: 'POST',
          body: formData,
        },
      );
      const result = await readResponseJson(response);
      if (!response.ok)
        throw new Error(readApiError(result) ?? 'Không thể đổi ảnh.');
      setNotice('Đã cập nhật ảnh bìa.');
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Không thể đổi ảnh.');
    } finally {
      setLoadingAction(null);
    }
  };

  const skipSlot = async (slot: EditorialSlot) => {
    await request({ action: 'skip_slot', slot: slot.slot, date: today });
  };

  return (
    <div className="space-y-7">
      <section
        className="glass-panel rounded-[20px] p-4 sm:p-5"
        aria-labelledby="editorial-today-title"
      >
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <p className="tool-eyebrow">
              <span aria-hidden="true" />
              Hàng chờ hôm nay
            </p>
            <h2
              id="editorial-today-title"
              className="mt-2 font-heading text-2xl font-semibold"
            >
              Duyệt bài trước khi đăng
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Chọn các bản nháp đã kiểm tra nguồn, duyệt một lần rồi xếp lịch
              cho ba vị trí trong ngày.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingAction !== null}
            onClick={() => void load()}
          >
            Làm mới
          </Button>
        </div>

        <div
          className="mt-5 grid gap-3 md:grid-cols-3"
          aria-label="Lịch đăng hôm nay"
        >
          {todaySlots.map((slot) => {
            const linkedArticle = data?.articles.find(
              (article) => article.id === slot.articleId,
            );
            const linkedRevision =
              linkedArticle?.revisions.find(
                (revision) => revision.id === slot.revisionId,
              ) ?? linkedArticle?.latestRevision;
            const open = isOpenSlot(slot);
            return (
              <article
                key={slot.slot}
                className="rounded-[16px] border border-border/80 bg-card/55 p-3.5 shadow-[inset_0_1px_0_rgb(255_255_255_/_45%)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{slotName(slot)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {slotStatusLabel(slot.status)}
                    </p>
                  </div>
                  {open ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      Trống
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 min-h-10 text-sm text-muted-foreground">
                  {linkedRevision?.title ??
                    (open
                      ? 'Chưa chọn bài cho vị trí này.'
                      : 'Đang cập nhật trạng thái bài viết.')}
                </p>
                {slot.failureMessage ? (
                  <p className="mt-2 text-xs text-destructive">
                    {slot.failureMessage}
                  </p>
                ) : null}
                {open ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={loadingAction !== null}
                    className="mt-2"
                    onClick={() => void skipSlot(slot)}
                  >
                    Bỏ qua vị trí
                  </Button>
                ) : null}
              </article>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border/70 bg-background/30 px-3 py-2.5 text-xs">
          <span className="text-muted-foreground">
            Lịch QStash:{' '}
            {data?.automation?.configured && data.automation.enabled
              ? 'sẵn sàng bật'
              : 'cần cấu hình trên Vercel'}
          </span>
          {data?.automation?.configured && data.automation.enabled ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loadingAction !== null}
              onClick={() => void request({ action: 'setup_automation' })}
            >
              Cập nhật lịch tự động
            </Button>
          ) : null}
        </div>
      </section>

      <section
        className="glass-panel rounded-[20px] p-4 sm:p-5"
        aria-labelledby="editorial-provider-title"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="tool-eyebrow">
              <span aria-hidden="true" />
              Provider biên tập
            </p>
            <h2
              id="editorial-provider-title"
              className="mt-2 font-heading text-xl font-semibold"
            >
              Gemini account riêng
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Không dùng key của chatbot
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[...(data?.providers ?? []), data?.imageProvider]
            .filter((provider): provider is EditorialProviderStatus =>
              Boolean(provider),
            )
            .map((provider) => (
              <div
                key={provider.provider}
                className="rounded-[14px] border border-border/70 bg-background/30 px-3 py-2.5 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">
                    {provider.provider === 'gemini-image'
                      ? 'Ảnh Gemini'
                      : provider.provider === 'brand-library'
                        ? 'Ảnh thương hiệu'
                        : 'Văn bản Gemini'}
                  </span>
                  <span
                    className={
                      provider.configured
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-destructive'
                    }
                  >
                    {provider.configured ? 'Sẵn sàng' : 'Thiếu cấu hình'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Model: {provider.model ?? '—'}
                  {provider.missing.length
                    ? ` · Thiếu: ${provider.missing.join(', ')}`
                    : ''}
                </p>
              </div>
            ))}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-[16px] border border-border bg-card/55 p-4">
          <p className="text-xs text-muted-foreground">Tháng này</p>
          <p className="mt-1 font-semibold">
            {formatVnd(data?.budget.monthUsedVnd ?? null)}
          </p>
          <p className="text-xs text-muted-foreground">
            Còn {formatVnd(data?.budget.monthRemainingVnd ?? null)}
          </p>
        </div>
        <div className="rounded-[16px] border border-border bg-card/55 p-4">
          <p className="text-xs text-muted-foreground">Hôm nay</p>
          <p className="mt-1 font-semibold">
            {formatVnd(data?.budget.dayUsedVnd ?? null)}
          </p>
          <p className="text-xs text-muted-foreground">
            Còn {formatVnd(data?.budget.dayRemainingVnd ?? null)}
          </p>
        </div>
        <div className="rounded-[16px] border border-border bg-card/55 p-4 sm:col-span-2">
          <p className="text-xs text-muted-foreground">Quy tắc đăng bài</p>
          <p className="mt-1 text-sm">
            AI chỉ chuẩn bị bản nháp. Nội dung, ảnh và SEO chỉ được lên lịch sau
            khi Admin duyệt.
          </p>
        </div>
      </div>

      {notice ? (
        <output
          aria-live="polite"
          className="rounded-[14px] border border-primary/20 bg-primary/8 px-3 py-2 text-sm text-primary"
        >
          {notice}
        </output>
      ) : null}

      <section
        className="glass-panel rounded-[20px] p-4 sm:p-5"
        aria-labelledby="editorial-review-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="tool-eyebrow">
              <span aria-hidden="true" />
              Bản nháp cần duyệt
            </p>
            <h2
              id="editorial-review-title"
              className="mt-2 font-heading text-xl font-semibold"
            >
              {reviewCards.length
                ? `${reviewCards.length} bài đang chờ`
                : 'Chưa có bài chờ duyệt'}
            </h2>
          </div>
          {selectedCards.length ? (
            <p className="text-sm text-muted-foreground">
              Đã chọn {selectedCards.length}/{openSlots.length || 3} bài
            </p>
          ) : null}
        </div>

        {reviewCards.length ? (
          <div className="mt-5 space-y-4">
            {reviewCards.map((card) => {
              const key = reviewKey(card.article.id, card.revision.id);
              const isSelected = activeSelectedKeys.includes(key);
              const claimedSlots = new Set(
                Object.entries(assignments)
                  .filter(
                    ([otherKey]) =>
                      otherKey !== key && activeSelectedKeys.includes(otherKey),
                  )
                  .map(([, slot]) => slot),
              );
              const coverOptions = (data?.brandCovers ?? []).filter(
                (cover) => cover.category === card.article.category,
              );
              const selectedCoverId =
                coverSelections[key] ?? coverOptions[0]?.id ?? '';
              return (
                <article
                  key={key}
                  className="rounded-[18px] border border-border bg-card/55 p-4 shadow-[inset_0_1px_0_rgb(255_255_255_/_45%)] sm:p-5"
                >
                  <div className="flex gap-3">
                    <input
                      id={`review-${card.revision.id}`}
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelection(card)}
                      disabled={loadingAction !== null}
                      className="mt-1 size-5 shrink-0 cursor-pointer accent-primary"
                      aria-describedby={`review-${card.revision.id}-summary`}
                    />
                    <div
                      id={`review-${card.revision.id}-summary`}
                      className="min-w-0 flex-1"
                    >
                      <ArticleSummary {...card} />
                      <ReviewDetails revision={card.revision} />
                      <div className="mt-3 rounded-[14px] border border-border/70 bg-background/25 p-3">
                        <p className="text-xs font-semibold">Ảnh bìa</p>
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                          <select
                            aria-label={`Ảnh thương hiệu cho ${card.revision.title}`}
                            value={selectedCoverId}
                            onChange={(event) =>
                              setCoverSelections((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
                            disabled={
                              loadingAction !== null || !coverOptions.length
                            }
                          >
                            {coverOptions.map((cover) => (
                              <option key={cover.id} value={cover.id}>
                                {cover.alt}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              loadingAction !== null || !selectedCoverId
                            }
                            onClick={() =>
                              void changeCover(card, 'brand-library')
                            }
                          >
                            Dùng ảnh thương hiệu
                          </Button>
                        </div>
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            aria-label={`Tải ảnh lên cho ${card.revision.title}`}
                            disabled={loadingAction !== null}
                            onChange={(event) =>
                              setCoverFiles((current) => ({
                                ...current,
                                [key]: event.target.files?.[0] ?? null,
                              }))
                            }
                            className="min-w-0 flex-1 text-xs"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              loadingAction !== null || !coverFiles[key]
                            }
                            onClick={() =>
                              void changeCover(card, 'admin-upload')
                            }
                          >
                            Tải ảnh lên
                          </Button>
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <Input
                            value={coverAlts[key] ?? ''}
                            onChange={(event) =>
                              setCoverAlts((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                            placeholder="Alt ảnh (mô tả ngắn)"
                            aria-label={`Alt ảnh cho ${card.revision.title}`}
                            disabled={loadingAction !== null}
                          />
                          <Input
                            value={coverDisclosures[key] ?? ''}
                            onChange={(event) =>
                              setCoverDisclosures((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                            placeholder="Chú thích nguồn / tác giả (nếu có)"
                            aria-label={`Chú thích ảnh cho ${card.revision.title}`}
                            disabled={loadingAction !== null}
                          />
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          JPG, PNG hoặc WebP · tối đa 4 MB · hệ thống chuẩn hóa
                          về 1200×675.
                        </p>
                      </div>
                      <details className="mt-3 rounded-[14px] border border-border/70 p-3">
                        <summary className="cursor-pointer text-sm font-semibold">
                          Yêu cầu AI sửa
                        </summary>
                        <label
                          htmlFor={`review-note-${card.revision.id}`}
                          className="mt-3 block text-xs font-semibold"
                        >
                          Góp ý cho phiên bản tiếp theo
                          <Textarea
                            id={`review-note-${card.revision.id}`}
                            value={reviewNotes[key] ?? ''}
                            onChange={(event) =>
                              setReviewNotes((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                            className="mt-1.5 min-h-20 text-sm"
                            placeholder="Ví dụ: Làm rõ tác động tới chênh lệch giá vàng SJC trong nước."
                          />
                        </label>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-3"
                          disabled={loadingAction !== null}
                          onClick={() => void requestChanges(card)}
                        >
                          Gửi góp ý
                        </Button>
                      </details>
                    </div>
                  </div>
                  {isSelected ? (
                    <label
                      htmlFor={`review-slot-${card.revision.id}`}
                      className="mt-4 block border-t border-border/70 pt-4 text-xs font-semibold"
                    >
                      Lịch đăng
                      <select
                        id={`review-slot-${card.revision.id}`}
                        value={assignments[key] ?? ''}
                        onChange={(event) =>
                          setAssignments((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        className="mt-1.5 h-10 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 text-sm shadow-[inset_0_1px_2px_rgb(35_51_74_/_5%)] sm:max-w-xs"
                      >
                        <option value="">Chọn giờ đăng</option>
                        {openSlots.map((slot) => (
                          <option
                            key={slot.slot}
                            value={slot.slot}
                            disabled={claimedSlots.has(slot.slot)}
                          >
                            {slotName(slot)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 rounded-[16px] border border-dashed border-border bg-card/35 p-5 text-sm text-muted-foreground">
            Khi tác vụ biên tập hoàn tất, bản nháp có nguồn, dữ kiện, SEO và ảnh
            sẽ xuất hiện ở đây để duyệt.
          </p>
        )}

        {selectedCards.length ? (
          <div className="sticky bottom-3 z-10 mt-5 rounded-[18px] border border-primary/25 bg-[var(--glass-frost)] p-3 shadow-[var(--glass-shadow-active)] backdrop-blur-xl sm:flex sm:items-center sm:justify-between sm:gap-4">
            <p className="text-sm">
              Duyệt {selectedCards.length} bài cho ngày <strong>{today}</strong>
              .
            </p>
            <Button
              type="button"
              className="mt-3 w-full sm:mt-0 sm:w-auto"
              disabled={loadingAction !== null}
              onClick={() => void approveSelected()}
            >
              {loadingAction === 'approve_schedule'
                ? 'Đang lên lịch…'
                : 'Duyệt và lên lịch'}
            </Button>
          </div>
        ) : null}
      </section>

      <details
        className="glass-panel rounded-[20px] p-4 sm:p-5"
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer font-heading text-xl font-semibold">
          Soạn thủ công và công cụ nâng cao
        </summary>
        <div className="mt-5 space-y-7">
          <section aria-labelledby="editorial-draft-title">
            <h2
              id="editorial-draft-title"
              className="font-heading text-xl font-semibold"
            >
              {editingId ? 'Tạo phiên bản mới' : 'Soạn bài'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Nguồn nhập mỗi dòng một URL thuộc danh sách cho phép.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label
                htmlFor="editorial-manual-title"
                className="text-xs font-semibold"
              >
                Tiêu đề
                <Input
                  id="editorial-manual-title"
                  value={form.title}
                  onChange={(event) =>
                    setForm({ ...form, title: event.target.value })
                  }
                  className="mt-1.5"
                />
              </label>
              <label
                htmlFor="editorial-manual-category"
                className="text-xs font-semibold"
              >
                Tuyến nội dung
                <select
                  id="editorial-manual-category"
                  value={form.category}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      category: event.target.value as EditorialCategory,
                    })
                  }
                  className="mt-1.5 h-10 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 text-sm shadow-[inset_0_1px_2px_rgb(35_51_74_/_5%)]"
                >
                  {Object.entries(editorialCategoryLabels).map(
                    ([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <label
              htmlFor="editorial-manual-excerpt"
              className="mt-3 block text-xs font-semibold"
            >
              Đoạn dẫn
              <Textarea
                id="editorial-manual-excerpt"
                value={form.excerpt}
                onChange={(event) =>
                  setForm({ ...form, excerpt: event.target.value })
                }
                className="mt-1.5 min-h-20 text-sm"
              />
            </label>
            <label
              htmlFor="editorial-manual-markdown"
              className="mt-3 block text-xs font-semibold"
            >
              Markdown
              <Textarea
                id="editorial-manual-markdown"
                value={form.contentMarkdown}
                onChange={(event) =>
                  setForm({ ...form, contentMarkdown: event.target.value })
                }
                className="mt-1.5 min-h-64 font-mono text-sm"
              />
            </label>
            <label
              htmlFor="editorial-manual-sources"
              className="mt-3 block text-xs font-semibold"
            >
              Nguồn
              <Textarea
                id="editorial-manual-sources"
                value={form.sources}
                onChange={(event) =>
                  setForm({ ...form, sources: event.target.value })
                }
                placeholder="https://sjc.com.vn/..."
                className="mt-1.5 min-h-20 text-sm"
              />
            </label>
            <details className="mt-4 rounded-[14px] border border-border/70 p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Xem trước desktop / mobile
              </summary>
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                <article className="editorial-prose mt-0 rounded-[12px] border border-border bg-background/60 p-4">
                  <h2 className="mt-0">{form.title || 'Tiêu đề bài viết'}</h2>
                  <p className="text-sm text-muted-foreground">
                    {form.excerpt || 'Đoạn dẫn sẽ xuất hiện ở đây.'}
                  </p>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {form.contentMarkdown ||
                      'Nội dung Markdown sẽ xuất hiện ở đây.'}
                  </ReactMarkdown>
                </article>
                <article className="editorial-prose mt-0 max-w-[360px] rounded-[20px] border border-border bg-background/60 p-4 text-sm">
                  <h2 className="mt-0 text-xl">
                    {form.title || 'Tiêu đề bài viết'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {form.excerpt || 'Đoạn dẫn sẽ xuất hiện ở đây.'}
                  </p>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {form.contentMarkdown ||
                      'Nội dung Markdown sẽ xuất hiện ở đây.'}
                  </ReactMarkdown>
                </article>
              </div>
            </details>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={loadingAction !== null}
                onClick={() => void saveDraft()}
              >
                {editingId ? 'Lưu phiên bản nháp' : 'Lưu bản nháp'}
              </Button>
              {editingId ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={loadingAction !== null}
                  onClick={() => {
                    setEditingId(null);
                    setForm(initialForm);
                  }}
                >
                  Hủy sửa
                </Button>
              ) : null}
            </div>
          </section>

          <section
            className="rounded-[18px] border border-primary/20 bg-primary/5 p-4"
            aria-labelledby="editorial-ai-title"
          >
            <h2
              id="editorial-ai-title"
              className="font-heading text-xl font-semibold"
            >
              AI soạn từ chủ đề
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Bản nháp tự động sẽ quay về hàng chờ duyệt; không được đăng thẳng.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="Ví dụ: Biên mua bán vàng hôm nay có ý nghĩa gì?"
              />
              <Button
                type="button"
                disabled={loadingAction !== null || !topic.trim()}
                onClick={() => void generate()}
              >
                Tạo bản nháp
              </Button>
            </div>
          </section>

          <section aria-labelledby="editorial-list-title">
            <h2
              id="editorial-list-title"
              className="font-heading text-xl font-semibold"
            >
              Bài viết và phiên bản
            </h2>
            <div className="mt-4 space-y-3">
              {data?.articles.map((article) => (
                <article
                  key={article.id}
                  className="rounded-[18px] border border-border bg-card/55 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                        {categoryLabel(article.category)} · {article.status}
                      </p>
                      <h3 className="mt-1 font-heading text-lg font-semibold">
                        {article.latestRevision?.title ?? article.slug}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        /{article.slug}
                      </p>
                      {article.latestRevision ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          English: {englishTranslation(article)?.status ?? 'chưa xếp hàng'}
                          {englishTranslation(article)?.errorMessage
                            ? ` · ${englishTranslation(article)?.errorMessage}`
                            : ''}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {article.latestRevision ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={loadingAction !== null}
                          onClick={() => edit(article)}
                        >
                          Sửa
                        </Button>
                      ) : null}
                      {article.status === 'published' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={loadingAction !== null}
                          onClick={() =>
                            void request({
                              action: 'unpublish',
                              articleId: article.id,
                            })
                          }
                        >
                          Gỡ bài
                        </Button>
                      ) : null}
                      {article.latestRevision ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={loadingAction !== null}
                          onClick={() =>
                            void request({
                              action: 'translate',
                              revisionId: article.latestRevision!.id,
                            })
                          }
                        >
                          Dịch lại EN
                        </Button>
                      ) : null}
                      {englishTranslation(article)?.status === 'ready' &&
                      article.latestRevision ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={loadingAction !== null}
                          onClick={() =>
                            void request({
                              action: 'hide_translation',
                              revisionId: article.latestRevision!.id,
                            })
                          }
                        >
                          Ẩn EN
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {article.revisions.length > 1 ? (
                    <details className="mt-3 rounded-[12px] border border-border/70 p-3">
                      <summary className="cursor-pointer text-xs font-semibold">
                        Phiên bản cũ ({article.revisions.length - 1})
                      </summary>
                      <div className="mt-2 space-y-2">
                        {article.revisions.slice(1).map((revision) => (
                          <div
                            key={revision.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <span>
                              {revision.title} · {approvalLabel(revision)}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={loadingAction !== null}
                              onClick={() =>
                                void request({
                                  action: 'restore',
                                  articleId: article.id,
                                  revisionId: revision.id,
                                })
                              }
                            >
                              Khôi phục thành nháp
                            </Button>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </article>
              )) ?? (
                <p className="text-sm text-muted-foreground">
                  Chưa có bài viết.
                </p>
              )}
            </div>
          </section>

          <section aria-labelledby="editorial-jobs-title">
            <h2
              id="editorial-jobs-title"
              className="font-heading text-xl font-semibold"
            >
              Job biên tập gần đây
            </h2>
            <div className="mt-3 space-y-2">
              {data?.jobs.map((job) => (
                <p
                  key={job.id}
                  className="rounded-[14px] border border-border bg-card/40 p-3 text-sm"
                >
                  <strong>{job.status}</strong> · {job.topic} ·{' '}
                  {formatVnd(job.costVnd)}
                  {job.provider
                    ? ` · ${job.provider}${job.model ? ` / ${job.model}` : ''}`
                    : ''}
                </p>
              )) ?? (
                <p className="text-sm text-muted-foreground">
                  Chưa có tác vụ biên tập.
                </p>
              )}
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}
