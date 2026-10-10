'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  editorialCategoryLabels,
  type EditorialCategory,
  type EditorialSource,
  type EditorialEvidence,
} from '@/lib/editorial/types';
import { getBrandCover } from '@/lib/editorial/brand-covers';
import type {
  ReviewDetail,
  ReviewGroup,
  ReviewInbox,
  ReviewResult,
  ReviewSlot,
  ReviewSummary,
  ReviewTarget,
} from '@/lib/editorial/review-types';

const groups: { id: ReviewGroup; label: string }[] = [
  { id: 'pending', label: 'Chờ duyệt' },
  { id: 'approved', label: 'Đã duyệt' },
  { id: 'scheduled', label: 'Lịch đăng' },
  { id: 'attention', label: 'Cần xử lý' },
];
const slotLabels = {
  morning: 'Sáng · 08:30',
  noon: 'Trưa · 12:00',
  evening: 'Chiều · 17:00',
};
const target = (item: ReviewSummary): ReviewTarget => ({
  articleId: item.articleId,
  revisionId: item.revisionId,
  version: item.version,
});
const categoryKeys = Object.keys(
  editorialCategoryLabels,
) as EditorialCategory[];
function nextDate(date: string) {
  return new Date(Date.parse(date + 'T00:00:00Z') + 86_400_000)
    .toISOString()
    .slice(0, 10);
}
function time(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Chưa rõ ngày';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}
async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(body?.error ?? 'Không thể xử lý yêu cầu. Hãy thử lại.');
  return body as T;
}
function Content({ markdown }: { markdown: string }) {
  return (
    <div className="editorial-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            href?.startsWith('/') || /^https?:\/\//i.test(href ?? '') ? (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          table: ({ children }) => (
            <div className="editorial-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
type EditForm = {
  title: string;
  excerpt: string;
  contentMarkdown: string;
  category: EditorialCategory;
  sources: string;
  seoTitle: string;
  seoDescription: string;
  evidence: EditorialEvidence[];
  coverAlt: string;
};
function editForm(item: ReviewDetail): EditForm {
  return {
    title: item.title,
    excerpt: item.excerpt,
    contentMarkdown: item.contentMarkdown,
    category: item.category,
    sources: item.sources.map((source) => source.url).join('\n'),
    seoTitle: item.seoTitle ?? '',
    seoDescription: item.seoDescription ?? '',
    evidence: item.evidence.map((value) => ({ ...value })),
    coverAlt: item.coverImageAlt ?? item.coverAlt ?? '',
  };
}
/** Unchanged sources retain their original title and observation dates. */
export function editedSources(text: string, previous: EditorialSource[]) {
  return text
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value).toString();
      return (
        previous.find((source) => new URL(source.url).toString() === url) ?? {
          title: new URL(url).hostname,
          url,
          accessedAt: new Date().toISOString(),
        }
      );
    });
}
type Operations = {
  jobs: {
    id: string;
    topic: string;
    status: string;
    stage: string;
    retryAt: string | null;
    errorMessage: string | null;
  }[];
  budget: {
    dayRemainingVnd: number;
    monthRemainingVnd: number;
    unavailable?: boolean;
  };
  automation: { enabled: boolean; configured: boolean };
};

export function AdminReviewPanel() {
  const [group, setGroup] = useState<ReviewGroup>('pending');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [date, setDate] = useState('');
  const [data, setData] = useState<ReviewInbox | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Record<string, ReviewTarget>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<ReviewSummary | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [smallScreen, setSmallScreen] = useState(false);
  const [edit, setEdit] = useState<EditForm | null>(null);
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<
    { id: string; title: string; createdAt: string }[] | null
  >(null);
  const [chosenSlot, setChosenSlot] = useState('');
  const [topic, setTopic] = useState('');
  const [draftCategory, setDraftCategory] = useState<EditorialCategory>('news');
  const [manual, setManual] = useState({
    title: '',
    excerpt: '',
    contentMarkdown: '',
    sources: '',
  });
  const [operations, setOperations] = useState<Operations | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const listSequence = useRef(0);
  const detailRequest = useRef<AbortController | null>(null);
  const activeRef = useRef<ReviewSummary | null>(null);
  const editedRef = useRef(false);
  const detailSequence = useRef(0);
  const busyRef = useRef<Record<string, boolean>>({});
  const currentGroup = useRef<ReviewGroup>(group);
  const refreshRef = useRef<((quiet?: boolean) => Promise<void>) | null>(null);
  useEffect(() => {
    editedRef.current = Boolean(edit);
    activeRef.current = active;
  }, [edit, active]);
  useEffect(() => {
    currentGroup.current = group;
  }, [group]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1279px)');
    const update = () => setSmallScreen(media.matches);
    const initial = setTimeout(update, 0);
    media.addEventListener('change', update);
    return () => {
      clearTimeout(initial);
      media.removeEventListener('change', update);
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const load = useCallback(
    async (quiet = false) => {
      listRequest.current?.abort();
      const controller = new AbortController();
      listRequest.current = controller;
      const sequence = ++listSequence.current;
      if (!quiet) setLoading(true);
      const params = new URLSearchParams({ group, page: String(page) });
      if (category) params.set('category', category);
      if (query) params.set('search', query);
      if (date) params.set('date', date);
      try {
        const inbox = await json<ReviewInbox>(
          await fetch('/api/admin/articles?' + params, {
            cache: 'no-store',
            signal: controller.signal,
          }),
        );
        if (sequence !== listSequence.current || controller.signal.aborted)
          return;
        setData(inbox);
        setStale('');
        if (
          group === 'approved' &&
          (!date || date === inbox.localDate) &&
          !inbox.slots.some(
            (slot) =>
              slot.status === 'open' &&
              Date.parse(slot.scheduledAt) > Date.parse(inbox.serverNow),
          )
        ) {
          setDate(nextDate(inbox.localDate));
          setChosenSlot('');
        } else if (!date || date < inbox.localDate) {
          setDate(inbox.localDate);
          setChosenSlot('');
        }
        setSelected((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([id, selectedItem]) =>
              inbox.items.some(
                (item) =>
                  item.revisionId === id &&
                  item.version === selectedItem.version,
              ),
            ),
          ),
        );
        const current = activeRef.current;
        const incoming =
          current &&
          inbox.items.find((item) => item.articleId === current.articleId);
        if (
          incoming &&
          (incoming.revisionId !== current.revisionId ||
            incoming.version !== current.version)
        )
          setNotice(
            'Bài đang xem đã thay đổi. Mở lại phiên bản mới trước khi lưu hoặc duyệt.',
          );
      } catch (error) {
        if (!controller.signal.aborted && sequence === listSequence.current)
          setStale(
            error instanceof Error ? error.message : 'Không tải được hàng chờ.',
          );
      } finally {
        if (sequence === listSequence.current) setLoading(false);
      }
    },
    [group, category, query, page, date],
  );
  useEffect(() => {
    refreshRef.current = load;
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    const initial = window.setTimeout(() => {
      if (document.visibilityState === 'visible') void load();
    }, 0);
    const interval = window.setInterval(
      refresh,
      data?.hasActiveJobs ? 10_000 : 60_000,
    );
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      listRequest.current?.abort();
    };
  }, [load, data?.hasActiveJobs]);
  useEffect(
    () => () => {
      detailRequest.current?.abort();
    },
    [],
  );

  const open = useCallback(async (item: ReviewSummary) => {
    if (editedRef.current) {
      setNotice('Lưu hoặc hủy phần đang sửa trước khi chuyển bài.');
      return;
    }
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    const sequence = ++detailSequence.current;
    setActive(item);
    setDetail(null);
    setDetailLoading(true);
    setDetailError('');
    setNote('');
    setHistory(null);
    setMobileOpen(true);
    try {
      const result = await json<{ item: ReviewDetail }>(
        await fetch(
          `/api/admin/articles/${item.articleId}?revisionId=${item.revisionId}`,
          { cache: 'no-store', signal: controller.signal },
        ),
      );
      if (sequence !== detailSequence.current || controller.signal.aborted)
        return;
      setDetail(result.item);
      setActive(result.item);
    } catch (error) {
      if (!controller.signal.aborted)
        setDetailError(
          error instanceof Error ? error.message : 'Không tải được nội dung.',
        );
    } finally {
      if (sequence === detailSequence.current) setDetailLoading(false);
    }
  }, []);

  const invalidateList = () => {
    listRequest.current?.abort();
    ++listSequence.current;
    setLoading(false);
  };
  const mutate = async (
    keys: string[],
    body: Record<string, unknown> | FormData,
    path = '/api/admin/articles',
    method = 'POST',
  ) => {
    if (keys.some((key) => busyRef.current[key])) return null;
    keys.forEach((key) => {
      busyRef.current[key] = true;
    });
    setBusy({ ...busyRef.current });
    setNotice('');
    invalidateList();
    try {
      const result = await json<{
        item?: ReviewDetail;
        results?: ReviewResult[];
        slot?: ReviewSlot;
        message?: string;
      }>(
        await fetch(path, {
          method,
          ...(body instanceof FormData
            ? { body }
            : {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              }),
        }),
      );
      invalidateList();
      if (
        result.item &&
        activeRef.current?.articleId === result.item.articleId
      ) {
        setDetail(result.item);
        setActive(result.item);
      }
      setNotice(result.message ?? 'Đã lưu thay đổi.');
      void refreshRef.current?.(true);
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Không thể lưu.');
      void refreshRef.current?.(true);
      return null;
    } finally {
      keys.forEach((key) => {
        busyRef.current[key] = false;
      });
      setBusy({ ...busyRef.current });
    }
  };
  const approve = async (items: ReviewTarget[], next = false) => {
    const nextItem = next
      ? data?.items.find(
          (item) =>
            !items.some(
              (selectedItem) => selectedItem.revisionId === item.revisionId,
            ),
        )
      : undefined;
    const result = await mutate(
      items.map((item) => item.articleId),
      { action: 'approve', targets: items },
    );
    if (!result?.results) return;
    const succeeded = result.results.filter((item) => item.ok);
    const errors = result.results.filter((item) => !item.ok);
    setSelected((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([id]) => !succeeded.some((item) => item.revisionId === id),
        ),
      ),
    );
    if (
      currentGroup.current === 'pending' ||
      currentGroup.current === 'attention'
    )
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.filter(
                (item) =>
                  !succeeded.some(
                    (result) => result.revisionId === item.revisionId,
                  ),
              ),
            }
          : current,
      );
    const updated = succeeded.find(
      (item) => item.articleId === activeRef.current?.articleId,
    )?.item;
    if (updated) {
      setActive(updated);
      setDetail((current) => (current ? { ...current, ...updated } : null));
    }
    setNotice(
      `Đã duyệt ${succeeded.length} bài.${errors.length ? ' ' + errors.map((item) => item.error).join(' ') : ' Chọn Đã duyệt để xếp lịch.'}`,
    );
    if (
      next &&
      nextItem &&
      succeeded.some((item) => item.articleId === activeRef.current?.articleId)
    )
      void open(nextItem);
  };
  const save = async () => {
    if (!detail || !edit) return;
    try {
      const body: Record<string, unknown> = { ...target(detail) };
      for (const field of [
        'title',
        'excerpt',
        'contentMarkdown',
        'category',
      ] as const)
        if (edit[field] !== detail[field]) body[field] = edit[field];
      if (
        edit.sources !== detail.sources.map((source) => source.url).join('\n')
      )
        body.sources = editedSources(edit.sources, detail.sources);
      if (edit.seoTitle !== (detail.seoTitle ?? ''))
        body.seoTitle = edit.seoTitle.trim() || null;
      if (edit.seoDescription !== (detail.seoDescription ?? ''))
        body.seoDescription = edit.seoDescription.trim() || null;
      if (JSON.stringify(edit.evidence) !== JSON.stringify(detail.evidence))
        body.evidence = edit.evidence;
      if (edit.coverAlt !== (detail.coverImageAlt ?? detail.coverAlt ?? ''))
        body.coverAlt = edit.coverAlt.trim() || null;
      if (Object.keys(body).length === 3) {
        setEdit(null);
        return;
      }
      const result = await mutate(
        [detail.articleId],
        body,
        '/api/admin/articles/' + detail.articleId,
        'PATCH',
      );
      if (result?.item) {
        setEdit(null);
        setSelected({});
        setNotice('Đã lưu phiên bản mới. Lịch cũ đã hủy; cần duyệt lại.');
      }
    } catch {
      setNotice('Nguồn phải là các URL hợp lệ, mỗi dòng một URL.');
    }
  };
  const serverTime = data ? Date.parse(data.serverNow) : 0;
  const availableSlots =
    data?.slots.filter(
      (slot) =>
        slot.status === 'open' && Date.parse(slot.scheduledAt) > serverTime,
    ) ?? [];
  const suggestedSlot =
    availableSlots.find((slot) => slot.slot === chosenSlot) ??
    availableSlots[0];
  const selectedItems = Object.values(selected);
  const itemBusy = Boolean(active && busy[active.articleId]);
  const canApprove =
    detail?.readiness.ready &&
    !detail.approvalOrigin &&
    detail.articleStatus !== 'archived' &&
    !['published', 'superseded'].includes(detail.revisionStatus) &&
    detail.approvalStatus !== 'approved';

  const slots = (
    <section className="space-y-3" aria-label="Lịch đăng">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold" htmlFor="editorial-field-1">
          Ngày đăng (giờ Việt Nam)
          <Input
            id="editorial-field-1"
            className="mt-1"
            aria-label="Ngày đăng"
            type="date"
            value={date}
            min={data?.localDate}
            onChange={(event) => {
              setDate(event.target.value);
              setChosenSlot('');
            }}
          />
        </label>
        <Button
          variant="outline"
          onClick={() => {
            if (date || data?.localDate)
              setDate(nextDate(date || data!.localDate));
            setChosenSlot('');
          }}
        >
          Ngày tiếp theo
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {data?.slots.map((slot) => (
          <article
            key={slot.slot}
            className="rounded-xl border border-border p-3"
          >
            <p className="font-semibold">{slotLabels[slot.slot]}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {(
                {
                  open: 'Trống',
                  scheduled: 'Đã xếp lịch',
                  published: 'Đã đăng',
                  failed: 'Cần xử lý',
                  skipped: 'Đã bỏ qua',
                } as Record<string, string>
              )[slot.status] ?? slot.status}
            </p>
            <p className="mt-2 text-sm">
              {slot.title ??
                (Date.parse(slot.scheduledAt) <= serverTime
                  ? 'Khung giờ đã qua'
                  : 'Chưa chọn bài')}
            </p>
            {slot.failureMessage && (
              <p className="mt-2 text-xs text-destructive">
                {slot.failureMessage}
              </p>
            )}
            {slot.status === 'scheduled' &&
              slot.articleId &&
              slot.revisionId &&
              slot.revisionVersion && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={busy[slot.articleId]}
                  onClick={() =>
                    void mutate([slot.articleId!], {
                      action: 'unschedule',
                      articleId: slot.articleId,
                      revisionId: slot.revisionId,
                      version: slot.revisionVersion,
                      date: slot.localDate,
                      slot: slot.slot,
                    })
                  }
                >
                  Hủy lịch
                </Button>
              )}
            {['failed', 'skipped', 'cancelled', 'missed'].includes(
              slot.status,
            ) &&
              Date.parse(slot.scheduledAt) > serverTime && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={busy[slot.id ?? slot.slot]}
                  onClick={() =>
                    void mutate([slot.id ?? slot.slot], {
                      action: 'reopen_slot',
                      date: slot.localDate,
                      slot: slot.slot,
                    })
                  }
                >
                  Mở lại khung giờ
                </Button>
              )}
          </article>
        ))}
      </div>
    </section>
  );
  const preview = (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-4">
        <h2 className="font-heading text-xl font-semibold">
          {edit ? 'Sửa nhanh' : 'Xem bài'}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (edit) {
              setNotice('Lưu hoặc hủy phần đang sửa trước khi đóng.');
              return;
            }
            setMobileOpen(false);
            setActive(null);
            setDetail(null);
            detailRequest.current?.abort();
            ++detailSequence.current;
          }}
        >
          Đóng
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {detailLoading && <output>Đang tải nội dung…</output>}
        {detailError && (
          <div role="alert">
            <p>{detailError}</p>
            {active && (
              <Button variant="outline" onClick={() => void open(active)}>
                Thử lại
              </Button>
            )}
          </div>
        )}
        {detail && (
          <>
            <p className="text-xs text-muted-foreground">
              {editorialCategoryLabels[detail.category]} ·{' '}
              {time(detail.createdAt)}
            </p>
            {detail.reviewNote && (
              <p className="my-3 rounded-lg bg-muted p-3 text-sm">
                Góp ý trước: {detail.reviewNote}
              </p>
            )}
            {detail.approvalOrigin && <p className="my-3 rounded-lg bg-muted p-3 text-sm">Gói Website + Facebook: duyệt đúng bản trong Telegram. Sửa ở đây sẽ làm bản duyệt cũ mất hiệu lực.</p>}
            {detail.readiness.blockers.map((reason) => (
              <p key={reason} className="mt-2 text-sm text-destructive">
                {reason}
              </p>
            ))}
            {detail.readiness.warnings.map((reason) => (
              <p key={reason} className="mt-2 text-xs text-muted-foreground">
                {reason}
              </p>
            ))}
            {edit ? (
              <fieldset disabled={itemBusy} className="mt-4 space-y-4">
                <label
                  className="block text-sm font-semibold"
                  htmlFor="editorial-field-2"
                >
                  Tiêu đề
                  <Input
                    id="editorial-field-2"
                    className="mt-1"
                    value={edit.title}
                    onChange={(event) =>
                      setEdit({ ...edit, title: event.target.value })
                    }
                  />
                </label>
                <label
                  className="block text-sm font-semibold"
                  htmlFor="editorial-field-3"
                >
                  Chuyên mục
                  <select
                    id="editorial-field-3"
                    className="mt-1 block h-10 w-full rounded-lg border bg-background px-3"
                    value={edit.category}
                    onChange={(event) =>
                      setEdit({
                        ...edit,
                        category: event.target.value as EditorialCategory,
                      })
                    }
                  >
                    {categoryKeys.map((key) => (
                      <option key={key} value={key}>
                        {editorialCategoryLabels[key]}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  className="block text-sm font-semibold"
                  htmlFor="editorial-field-4"
                >
                  Đoạn dẫn
                  <Textarea
                    id="editorial-field-4"
                    className="mt-1 min-h-24"
                    value={edit.excerpt}
                    onChange={(event) =>
                      setEdit({ ...edit, excerpt: event.target.value })
                    }
                  />
                </label>
                <label
                  className="block text-sm font-semibold"
                  htmlFor="editorial-field-5"
                >
                  Nội dung Markdown
                  <Textarea
                    id="editorial-field-5"
                    className="mt-1 min-h-72 font-mono"
                    value={edit.contentMarkdown}
                    onChange={(event) =>
                      setEdit({ ...edit, contentMarkdown: event.target.value })
                    }
                  />
                </label>
                <label
                  className="block text-sm font-semibold"
                  htmlFor="editorial-field-6"
                >
                  Nguồn (mỗi dòng một URL)
                  <Textarea
                    id="editorial-field-6"
                    className="mt-1"
                    value={edit.sources}
                    onChange={(event) =>
                      setEdit({ ...edit, sources: event.target.value })
                    }
                  />
                </label>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">
                    Sửa dữ kiện và ngày ghi nhận
                  </summary>
                  {edit.evidence.map((item, index) => (
                    <div
                      key={index}
                      className="mt-3 space-y-2 rounded-lg border p-3"
                    >
                      <label
                        htmlFor={`evidence-label-${index}`}
                        className="block text-sm"
                      >
                        Tên dữ kiện
                        <Input
                          id={`evidence-label-${index}`}
                          value={item.label}
                          onChange={(event) =>
                            setEdit({
                              ...edit,
                              evidence: edit.evidence.map((value, position) =>
                                position === index
                                  ? { ...value, label: event.target.value }
                                  : value,
                              ),
                            })
                          }
                        />
                      </label>
                      <label
                        htmlFor={`evidence-value-${index}`}
                        className="block text-sm"
                      >
                        Giá trị
                        <Textarea
                          id={`evidence-value-${index}`}
                          value={item.value}
                          onChange={(event) =>
                            setEdit({
                              ...edit,
                              evidence: edit.evidence.map((value, position) =>
                                position === index
                                  ? { ...value, value: event.target.value }
                                  : value,
                              ),
                            })
                          }
                        />
                      </label>
                      <label
                        htmlFor={`evidence-date-${index}`}
                        className="block text-sm"
                      >
                        Ngày ghi nhận (ISO, có múi giờ)
                        <Input
                          id={`evidence-date-${index}`}
                          value={item.observedAt ?? ''}
                          placeholder="2026-10-02T08:00:00+07:00"
                          onChange={(event) =>
                            setEdit({
                              ...edit,
                              evidence: edit.evidence.map((value, position) =>
                                position === index
                                  ? {
                                      ...value,
                                      observedAt:
                                        event.target.value || undefined,
                                    }
                                  : value,
                              ),
                            })
                          }
                        />
                      </label>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEdit({
                            ...edit,
                            evidence: edit.evidence.filter(
                              (_, position) => position !== index,
                            ),
                          })
                        }
                      >
                        Xóa dữ kiện này
                      </Button>
                    </div>
                  ))}
                </details>
                <label htmlFor="editorial-cover-alt" className="block text-sm">
                  Mô tả ảnh bìa
                  <Input
                    id="editorial-cover-alt"
                    value={edit.coverAlt}
                    onChange={(event) =>
                      setEdit({ ...edit, coverAlt: event.target.value })
                    }
                  />
                </label>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">
                    SEO
                  </summary>
                  <label
                    className="mt-3 block text-sm"
                    htmlFor="editorial-field-7"
                  >
                    Tiêu đề SEO
                    <Input
                      id="editorial-field-7"
                      value={edit.seoTitle}
                      onChange={(event) =>
                        setEdit({ ...edit, seoTitle: event.target.value })
                      }
                    />
                  </label>
                  <label
                    className="mt-3 block text-sm"
                    htmlFor="editorial-field-8"
                  >
                    Mô tả SEO
                    <Textarea
                      id="editorial-field-8"
                      value={edit.seoDescription}
                      onChange={(event) =>
                        setEdit({ ...edit, seoDescription: event.target.value })
                      }
                    />
                  </label>
                </details>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">
                    Xem trước phần đang sửa
                  </summary>
                  <Content markdown={edit.contentMarkdown} />
                </details>
              </fieldset>
            ) : (
              <>
                <h3 className="mt-4 font-heading text-2xl font-semibold">
                  {detail.title}
                </h3>
                <p className="my-4 text-muted-foreground">{detail.excerpt}</p>
                {detail.coverImageUrl && (
                  <figure className="my-5">
                    <Image
                      src={detail.coverImageUrl}
                      alt={detail.coverImageAlt ?? detail.title}
                      width={1200}
                      height={675}
                      unoptimized
                      className="h-auto w-full rounded-xl"
                    />
                    <figcaption className="mt-1 text-xs text-muted-foreground">
                      {detail.coverImageDisclosure}
                    </figcaption>
                  </figure>
                )}
                <Content markdown={detail.contentMarkdown} />
              </>
            )}
            <details className="mt-6 rounded-xl border border-border p-3">
              <summary className="cursor-pointer font-semibold">
                Nguồn, dữ kiện và SEO
              </summary>
              <ul className="mt-3 space-y-3">
                {detail.sources.map((source) => (
                  <li key={source.url} className="text-sm">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      {source.title}
                    </a>
                    <p className="text-xs text-muted-foreground">
                      Công bố: {time(source.publishedAt ?? null)} · Đã đọc:{' '}
                      {time(source.accessedAt)}
                    </p>
                  </li>
                ))}
              </ul>
              {detail.evidence.map((item, index) => (
                <div
                  key={index}
                  className="mt-3 rounded-lg bg-muted/50 p-3 text-sm"
                >
                  <strong>{item.label}</strong>
                  <p className="mt-1 whitespace-pre-wrap">{item.value}</p>
                  <p className="mt-1 text-xs">
                    Ghi nhận: {time(item.observedAt ?? null)}
                  </p>
                  {item.sourceUrl && (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      Mở bằng chứng
                    </a>
                  )}
                </div>
              ))}
              <p className="mt-4 text-sm font-semibold">
                {detail.seoTitle ?? detail.title}
              </p>
              <p className="text-sm text-muted-foreground">
                {detail.seoDescription ?? detail.excerpt}
              </p>
            </details>
            {!edit && (
              <>
                <details className="mt-3 rounded-xl border border-border p-3">
                  <summary className="cursor-pointer font-semibold">
                    Ảnh bìa
                  </summary>
                  {detail.approvalStatus === 'approved' ||
                  detail.revisionStatus === 'published' ? (
                    <p className="mt-2 text-sm">
                      Lưu một thay đổi bằng Sửa nhanh để tạo phiên bản mới trước
                      khi đổi ảnh.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={itemBusy}
                        onClick={() => {
                          const form = new FormData();
                          form.set('revisionId', detail.revisionId);
                          form.set('version', detail.version);
                          form.set('source', 'brand-library');
                          form.set(
                            'coverId',
                            getBrandCover(detail.category).id,
                          );
                          void mutate(
                            [detail.articleId],
                            form,
                            `/api/admin/articles/${detail.articleId}/cover`,
                          );
                        }}
                      >
                        Dùng ảnh thương hiệu
                      </Button>
                      <label
                        className="block text-sm"
                        htmlFor="editorial-field-9"
                      >
                        Tải ảnh JPG, PNG, WebP · tối đa 4 MB
                        <input
                          id="editorial-field-9"
                          className="mt-2 block w-full text-xs"
                          aria-label="Tải ảnh bìa"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          disabled={itemBusy}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            if (file.size > 4 * 1024 * 1024) {
                              setNotice('Ảnh tối đa 4 MB.');
                              return;
                            }
                            const form = new FormData();
                            form.set('revisionId', detail.revisionId);
                            form.set('version', detail.version);
                            form.set('source', 'admin-upload');
                            form.set('file', file);
                            void mutate(
                              [detail.articleId],
                              form,
                              `/api/admin/articles/${detail.articleId}/cover`,
                            );
                            event.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  )}
                </details>
                <details className="mt-3 rounded-xl border border-border p-3">
                  <summary className="cursor-pointer font-semibold">
                    Yêu cầu sửa
                  </summary>
                  <label
                    className="mt-3 block text-sm"
                    htmlFor="editorial-field-10"
                  >
                    Góp ý
                    <Textarea
                      id="editorial-field-10"
                      value={note}
                      disabled={itemBusy}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Chỉ rõ câu hoặc dữ kiện cần sửa…"
                    />
                  </label>
                  <Button
                    className="mt-3"
                    variant="outline"
                    disabled={itemBusy || note.trim().length < 3}
                    onClick={() =>
                      void mutate([detail.articleId], {
                        action: 'request_changes',
                        ...target(detail),
                        note,
                      }).then((result) => {
                        if (result) {
                          setNote('');
                          setNotice(
                            'Đã gửi góp ý và hủy lịch cũ. AI đang chuẩn bị bản nháp mới.',
                          );
                        }
                      })
                    }
                  >
                    Yêu cầu AI sửa
                  </Button>
                </details>
                {detail.approvalStatus === 'approved' &&
                  detail.revisionStatus === 'reviewed' && (
                    <section
                      className="mt-5 space-y-3 rounded-xl border border-primary/30 p-3"
                      aria-label="Xếp lịch bài đã duyệt"
                    >
                      <h4 className="font-semibold">Xếp lịch sau khi duyệt</h4>
                      {slots}
                      {availableSlots.length ? (
                        <>
                          <label
                            className="block text-sm"
                            htmlFor="editorial-field-11"
                          >
                            Giờ đăng
                            <select
                              id="editorial-field-11"
                              className="mt-1 block h-10 w-full rounded-lg border bg-background px-2"
                              aria-label="Giờ đăng"
                              value={suggestedSlot?.slot ?? ''}
                              onChange={(event) =>
                                setChosenSlot(event.target.value)
                              }
                            >
                              {availableSlots.map((slot) => (
                                <option key={slot.slot} value={slot.slot}>
                                  {slotLabels[slot.slot]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <p className="text-sm">
                            {detail.title} → {date} ·{' '}
                            {suggestedSlot && slotLabels[suggestedSlot.slot]}
                          </p>
                          <Button
                            disabled={itemBusy || !suggestedSlot || loading}
                            onClick={() =>
                              void mutate([detail.articleId], {
                                action: 'schedule',
                                ...target(detail),
                                date,
                                slot: suggestedSlot?.slot,
                              })
                            }
                          >
                            Xác nhận xếp lịch
                          </Button>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Ngày này không còn giờ trống trong tương lai. Chọn
                          ngày tiếp theo.
                        </p>
                      )}
                    </section>
                  )}
                <details
                  className="mt-3 rounded-xl border border-border p-3"
                  onToggle={(event) => {
                    if (event.currentTarget.open && !history)
                      void fetch(
                        `/api/admin/articles/${detail.articleId}?mode=history`,
                      )
                        .then((response) =>
                          json<{ history: NonNullable<typeof history> }>(
                            response,
                          ),
                        )
                        .then((result) => setHistory(result.history))
                        .catch((error) => setNotice(error.message));
                  }}
                >
                  <summary className="cursor-pointer font-semibold">
                    Lịch sử phiên bản
                  </summary>
                  {history?.map((item) => (
                    <div
                      key={item.id}
                      className="mt-3 flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span>
                        {time(item.createdAt)} · {item.title}
                      </span>
                      {item.id !== detail.revisionId && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={itemBusy}
                          onClick={() =>
                            void mutate([detail.articleId], {
                              action: 'restore',
                              articleId: detail.articleId,
                              revisionId: item.id,
                              currentRevisionId: detail.revisionId,
                              version: detail.version,
                            }).then((result) => {
                              if (result) {
                                setDetail(null);
                                setActive(null);
                                setMobileOpen(false);
                                setNotice(
                                  'Đã khôi phục thành bản nháp mới, cần duyệt lại.',
                                );
                              }
                            })
                          }
                        >
                          Khôi phục thành nháp
                        </Button>
                      )}
                    </div>
                  ))}
                </details>
                <details className="mt-3 rounded-xl border border-border p-3">
                  <summary className="cursor-pointer text-sm font-semibold">
                    Gỡ bài
                  </summary>
                  <p className="mt-2 text-sm">
                    Ẩn bài công khai và hủy các lịch chưa đăng.
                  </p>
                  <Button
                    className="mt-3"
                    variant="destructive"
                    disabled={itemBusy}
                    onClick={() =>
                      void mutate([detail.articleId], {
                        action: 'unpublish',
                        ...target(detail),
                      }).then((result) => {
                        if (result) {
                          setActive(null);
                          setDetail(null);
                          setMobileOpen(false);
                        }
                      })
                    }
                  >
                    Gỡ bài và hủy lịch
                  </Button>
                </details>
              </>
            )}
          </>
        )}
      </div>
      {detail && (
        <footer className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-wrap gap-2">
            {edit ? (
              <>
                <Button disabled={itemBusy} onClick={() => void save()}>
                  {itemBusy ? 'Đang lưu…' : 'Lưu phiên bản mới'}
                </Button>
                <Button
                  variant="outline"
                  disabled={itemBusy}
                  onClick={() => setEdit(null)}
                >
                  Hủy sửa
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={itemBusy}
                  onClick={() => setEdit(editForm(detail))}
                >
                  Sửa nhanh
                </Button>
                {(detail.approvalStatus === 'approved' ||
                  detail.articleStatus === 'archived' ||
                  detail.revisionStatus === 'published') && (
                  <Button
                    variant="outline"
                    disabled={itemBusy}
                    onClick={() =>
                      void mutate(
                        [detail.articleId],
                        { ...target(detail) },
                        '/api/admin/articles/' + detail.articleId,
                        'PATCH',
                      )
                    }
                  >
                    Tạo nháp để đổi ảnh
                  </Button>
                )}
                {canApprove && (
                  <>
                    <Button
                      disabled={itemBusy}
                      onClick={() => void approve([target(detail)])}
                    >
                      Duyệt
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={itemBusy}
                      onClick={() => void approve([target(detail)], true)}
                    >
                      Duyệt và xem bài tiếp
                    </Button>
                  </>
                )}
                {!canApprove && detail.approvalStatus === 'approved' && (
                  <span className="self-center text-sm text-primary">
                    Đã duyệt
                  </span>
                )}
              </>
            )}
          </div>
          {notice && <output className="mt-2 text-sm">{notice}</output>}
        </footer>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-semibold">
            Duyệt nội dung trước, xếp lịch sau
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Mở bài để đọc toàn văn, kiểm tra ảnh và nguồn. Bài đã duyệt được xếp
            lịch ở bước riêng.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void load()}
        >
          Làm mới
        </Button>
      </div>
      {stale && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 p-3 text-sm"
        >
          {stale} Dữ liệu hiển thị có thể chưa mới.{' '}
          <button className="underline" onClick={() => void load()}>
            Thử lại
          </button>
        </div>
      )}
      {notice && !smallScreen && (
        <output className="rounded-xl bg-muted p-3 text-sm">{notice}</output>
      )}
      {notice && smallScreen && !mobileOpen && (
        <output className="rounded-xl bg-muted p-3 text-sm">{notice}</output>
      )}
      <nav className="flex flex-wrap gap-2" aria-label="Trạng thái bài viết">
        {groups.map((item) => (
          <Button
            key={item.id}
            variant={group === item.id ? 'default' : 'outline'}
            onClick={() => {
              setGroup(item.id);
              setPage(1);
              setSelected({});
            }}
            aria-current={group === item.id ? 'page' : undefined}
          >
            {item.label} <span>{data?.counts[item.id] ?? 0}</span>
          </Button>
        ))}
      </nav>
      <div className="flex flex-wrap gap-3">
        <Input
          className="min-w-0 flex-1 sm:max-w-sm"
          aria-label="Tìm bài theo tiêu đề"
          placeholder="Tìm bài theo tiêu đề…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Lọc chuyên mục"
          className="h-10 rounded-lg border bg-background px-3 text-sm"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Tất cả chuyên mục</option>
          {categoryKeys.map((key) => (
            <option key={key} value={key}>
              {editorialCategoryLabels[key]}
            </option>
          ))}
        </select>
      </div>
      {group === 'scheduled' && slots}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 space-y-3">
          {loading && !data && <output>Đang tải hàng chờ…</output>}
          {data?.items.map((item) => (
            <article
              key={item.revisionId}
              className={`rounded-xl border p-4 ${active?.revisionId === item.revisionId ? 'border-primary bg-primary/5' : 'border-border'}`}
            >
              <div className="flex items-start gap-3">
                {(group === 'pending' || group === 'attention') && (
                  <input
                    type="checkbox"
                    className="mt-1 size-5 shrink-0 accent-primary"
                    aria-label={`Chọn ${item.title}`}
                    checked={Boolean(selected[item.revisionId])}
                    disabled={busy[item.articleId] || !item.readiness.ready || Boolean(item.approvalOrigin)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = { ...current };
                        if (next[item.revisionId]) delete next[item.revisionId];
                        else if (Object.keys(next).length < 20)
                          next[item.revisionId] = target(item);
                        return next;
                      })
                    }
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    {editorialCategoryLabels[item.category]} ·{' '}
                    {time(item.createdAt)}
                  </p>
                  <h3 className="mt-1 font-heading text-lg font-semibold">
                    {item.title}
                  </h3>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    {item.excerpt}
                  </p>
                  <p className="mt-2 text-xs">
                    {item.sourceCount} nguồn · {item.evidenceCount} dữ kiện ·{' '}
                    {item.readiness.ready
                      ? 'Đủ điều kiện nội dung'
                      : 'Cần bổ sung'}
                  </p>
                  {item.readiness.blockers.map((reason) => (
                    <p key={reason} className="mt-1 text-xs text-destructive">
                      {reason}
                    </p>
                  ))}
                  {busy[item.articleId] && (
                    <output className="mt-2 text-xs">
                      Đang xử lý bài này…
                    </output>
                  )}
                  <Button
                    className="mt-3"
                    variant="outline"
                    onClick={() => void open(item)}
                  >
                    Xem bài
                  </Button>
                </div>
              </div>
            </article>
          ))}
          {data && !data.items.length && (
            <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              Không có bài trong nhóm này.
            </p>
          )}
          {selectedItems.length > 0 && (
            <div className="sticky bottom-3 z-10 rounded-xl border border-primary/30 bg-background p-3 shadow-lg">
              <p className="mb-2 text-sm">
                Đã chọn {selectedItems.length}/20 bài; việc duyệt không phụ
                thuộc lịch trống.
              </p>
              <Button
                disabled={selectedItems.some((item) => busy[item.articleId])}
                onClick={() => void approve(selectedItems)}
              >
                Duyệt {selectedItems.length} bài
              </Button>
              <Button variant="ghost" onClick={() => setSelected({})}>
                Bỏ chọn
              </Button>
            </div>
          )}
          {data && (
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                disabled={page === 1 || loading}
                onClick={() => {
                  setPage(page - 1);
                  setSelected({});
                }}
              >
                Trang trước
              </Button>
              <span className="text-xs">
                Trang {page} · {data.total} bài
              </span>
              <Button
                variant="outline"
                disabled={page * 20 >= data.total || loading}
                onClick={() => {
                  setPage(page + 1);
                  setSelected({});
                }}
              >
                Trang sau
              </Button>
            </div>
          )}
        </div>
        <aside
          className="sticky top-5 hidden h-[calc(100dvh-7rem)] min-w-0 overflow-hidden rounded-xl border border-border xl:block"
          aria-label="Bản xem trước"
        >
          {active && !smallScreen ? (
            preview
          ) : (
            <p className="p-6 text-muted-foreground">
              Chọn Xem bài để đọc nội dung và duyệt.
            </p>
          )}
        </aside>
      </div>
      <Sheet
        open={smallScreen && mobileOpen && Boolean(active)}
        onOpenChange={(value) => {
          if (!value && edit) {
            setNotice('Lưu hoặc hủy phần đang sửa trước khi đóng.');
            return;
          }
          setMobileOpen(value);
        }}
      >
        <SheetContent
          side="right"
          className="max-w-none gap-0 p-0 data-[side=right]:h-dvh data-[side=right]:w-full data-[side=right]:sm:max-w-none"
          showCloseButton={false}
        >
          <SheetTitle className="sr-only">Duyệt bài Tin vàng</SheetTitle>
          {smallScreen && preview}
        </SheetContent>
      </Sheet>
      <details className="rounded-xl border border-border p-4">
        <summary className="cursor-pointer font-semibold">
          Soạn bài / yêu cầu AI tạo nháp
        </summary>
        <div className="mt-4 space-y-3">
          <label className="block text-sm" htmlFor="editorial-field-12">
            Chuyên mục
            <select
              id="editorial-field-12"
              className="ml-3 rounded-lg border bg-background p-2"
              value={draftCategory}
              onChange={(event) =>
                setDraftCategory(event.target.value as EditorialCategory)
              }
            >
              {categoryKeys.map((key) => (
                <option key={key} value={key}>
                  {editorialCategoryLabels[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm" htmlFor="editorial-field-13">
            Chủ đề AI
            <Input
              id="editorial-field-13"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Chủ đề và các dữ kiện cần giải thích…"
              disabled={busy.generate}
            />
          </label>
          <Button
            disabled={busy.generate || topic.trim().length < 5}
            onClick={() =>
              void mutate(['generate'], {
                action: 'generate',
                topic,
                category: draftCategory,
              }).then((result) => {
                if (result) setTopic('');
              })
            }
          >
            Yêu cầu AI tạo nháp
          </Button>
          <details>
            <summary className="cursor-pointer text-sm font-semibold">
              Soạn thủ công
            </summary>
            <fieldset className="mt-3 space-y-3" disabled={busy.create}>
              <label className="block text-sm" htmlFor="editorial-field-14">
                Tiêu đề
                <Input
                  id="editorial-field-14"
                  value={manual.title}
                  onChange={(event) =>
                    setManual({ ...manual, title: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm" htmlFor="editorial-field-15">
                Đoạn dẫn
                <Textarea
                  id="editorial-field-15"
                  value={manual.excerpt}
                  onChange={(event) =>
                    setManual({ ...manual, excerpt: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm" htmlFor="editorial-field-16">
                Nội dung Markdown
                <Textarea
                  id="editorial-field-16"
                  className="min-h-48"
                  value={manual.contentMarkdown}
                  onChange={(event) =>
                    setManual({
                      ...manual,
                      contentMarkdown: event.target.value,
                    })
                  }
                />
              </label>
              <label className="block text-sm" htmlFor="editorial-field-17">
                Nguồn
                <Textarea
                  id="editorial-field-17"
                  value={manual.sources}
                  onChange={(event) =>
                    setManual({ ...manual, sources: event.target.value })
                  }
                />
              </label>
              <Button
                onClick={() => {
                  try {
                    void mutate(['create'], {
                      action: 'create',
                      ...manual,
                      category: draftCategory,
                      sources: editedSources(manual.sources, []),
                    }).then((result) => {
                      if (result)
                        setManual({
                          title: '',
                          excerpt: '',
                          contentMarkdown: '',
                          sources: '',
                        });
                    });
                  } catch {
                    setNotice('URL nguồn không hợp lệ.');
                  }
                }}
              >
                Lưu bản nháp
              </Button>
            </fieldset>
          </details>
        </div>
      </details>
      <details
        className="rounded-xl border border-border p-4"
        onToggle={(event) => {
          if (event.currentTarget.open && !operations)
            void fetch('/api/admin/articles?mode=operations')
              .then((response) => json<Operations>(response))
              .then(setOperations)
              .catch((error) => setNotice(error.message));
        }}
      >
        <summary className="cursor-pointer font-semibold">
          Vận hành, ngân sách và job
        </summary>
        {operations && (
          <div className="mt-4 space-y-3 text-sm">
            <p>
              {operations.budget.unavailable
                ? 'Chưa đọc được ngân sách.'
                : `Còn lại hôm nay: ${operations.budget.dayRemainingVnd.toLocaleString('vi-VN')} đ · Tháng: ${operations.budget.monthRemainingVnd.toLocaleString('vi-VN')} đ`}
            </p>
            <Button
              variant="outline"
              onClick={() =>
                void fetch('/api/admin/articles?mode=operations')
                  .then((response) => json<Operations>(response))
                  .then(setOperations)
                  .catch((error) => setNotice(error.message))
              }
            >
              Làm mới vận hành
            </Button>
            {operations.automation.enabled &&
              operations.automation.configured && (
                <Button
                  variant="outline"
                  disabled={busy.automation}
                  onClick={() =>
                    void mutate(['automation'], { action: 'setup_automation' })
                  }
                >
                  Cập nhật lịch tự động
                </Button>
              )}
            {operations.jobs.map((job) => (
              <div key={job.id} className="rounded-lg border p-3">
                <strong>{job.status}</strong> · {job.stage} · {job.topic}
                {job.retryAt && <p>Thử lại: {time(job.retryAt)}</p>}
                {job.errorMessage && (
                  <p className="mt-1 text-destructive">{job.errorMessage}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </details>
    </div>
  );
}
