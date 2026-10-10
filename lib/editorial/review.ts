import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isBrandCoverUrl } from './brand-covers';
import type { EditorialEvidence, EditorialSource } from './types';

export class EditorialStateError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 409,
  ) {
    super(message);
  }
}

export type ReviewableContent = {
  title: string;
  excerpt: string;
  contentMarkdown: string;
  publicationCategory: string | null;
  sources: EditorialSource[];
  evidence: EditorialEvidence[];
  seoTitle: string | null;
  seoDescription: string | null;
  coverAlt: string | null;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  coverImageStorageKey: string | null;
  coverImageDisclosure: string | null;
  coverImageProvider: string | null;
  coverImageModel: string | null;
  reviewNote?: string | null;
};

/** Content identity excludes changing workflow state and timestamps. */
export function revisionVersion(revision: ReviewableContent) {
  const fields: (keyof ReviewableContent)[] = [
    'title',
    'excerpt',
    'contentMarkdown',
    'publicationCategory',
    'sources',
    'evidence',
    'seoTitle',
    'seoDescription',
    'coverAlt',
    'coverImageUrl',
    'coverImageAlt',
    'coverImageStorageKey',
    'coverImageDisclosure',
    'coverImageProvider',
    'coverImageModel',
    'reviewNote',
  ];
  return createHash('sha256')
    .update(JSON.stringify(fields.map((field) => revision[field])))
    .digest('hex');
}

export function assertRevisionVersion(
  revision: ReviewableContent,
  expected?: string,
) {
  if (expected && revisionVersion(revision) !== expected)
    throw new EditorialStateError(
      'Phiên bản đã thay đổi. Hãy mở lại bài trước khi tiếp tục.',
    );
}

export function validEditorialTimestamp(value: string) {
  return (
    z.iso.datetime({ offset: true }).safeParse(value).success &&
    Number.isFinite(Date.parse(value))
  );
}

export function editorialReadiness(revision: ReviewableContent) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (
    !revision.title.trim() ||
    !revision.excerpt.trim() ||
    !revision.contentMarkdown.trim()
  )
    blockers.push('Bài chưa đủ tiêu đề, đoạn dẫn và nội dung.');
  if (!revision.sources.length && !revision.evidence.length)
    blockers.push('Cần ít nhất một nguồn hoặc gói dữ kiện.');
  if (
    revision.sources.some(
      (source) => !source.title.trim() || !source.url.trim(),
    )
  )
    blockers.push('Nguồn thiếu tên hoặc URL.');
  if (
    revision.evidence.some((item) => !item.label.trim() || !item.value.trim())
  )
    blockers.push('Dữ kiện thiếu tên hoặc giá trị.');
  if (
    revision.evidence.some(
      (item) => item.observedAt && !validEditorialTimestamp(item.observedAt),
    )
  )
    blockers.push('Ngày ghi nhận dữ kiện không hợp lệ.');
  const brand =
    revision.coverImageProvider === 'brand-library' &&
    isBrandCoverUrl(revision.coverImageUrl);
  if (!revision.coverImageUrl || (!brand && !revision.coverImageStorageKey))
    blockers.push('Cần ảnh bìa hợp lệ.');
  if (!revision.seoTitle || !revision.seoDescription)
    warnings.push('SEO sẽ dùng tiêu đề và đoạn dẫn của bài.');
  if (!revision.sources.length && revision.evidence.length)
    warnings.push(
      'Bài sử dụng dữ kiện nội bộ; đối chiếu gói dữ kiện trước khi duyệt.',
    );
  return { ready: blockers.length === 0, blockers, warnings };
}
