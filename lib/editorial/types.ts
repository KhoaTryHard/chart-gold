export type EditorialCategory = 'news' | 'explain' | 'practice';
export type EditorialLocale = 'vi' | 'en';
export type EditorialTranslationStatus =
  | 'source'
  | 'queued'
  | 'ready'
  | 'failed'
  | 'hidden';
export type EditorialArticleStatus = 'draft' | 'published' | 'archived';
export type EditorialRevisionStatus =
  | 'draft'
  | 'reviewed'
  | 'published'
  | 'superseded';

export const editorialPublicationSlots = [
  'morning',
  'noon',
  'evening',
] as const;
export type EditorialPublicationSlot =
  (typeof editorialPublicationSlots)[number];

export const editorialPublicationSlotStatuses = [
  'open',
  'scheduled',
  'publishing',
  'published',
  'missed',
  'failed',
  'skipped',
  'cancelled',
] as const;
export type EditorialPublicationSlotStatus =
  (typeof editorialPublicationSlotStatuses)[number];

export const editorialRevisionApprovalStatuses = [
  'pending',
  'approved',
  'changes_requested',
  'revoked',
] as const;
export type EditorialRevisionApprovalStatus =
  (typeof editorialRevisionApprovalStatuses)[number];

export const editorialEventStatuses = [
  'candidate',
  'selected',
  'dismissed',
  'stale',
  'blocked',
] as const;
export type EditorialEventStatus = (typeof editorialEventStatuses)[number];

export const editorialSourceItemStatuses = [
  'queued',
  'fetched',
  'failed',
  'blocked',
  'duplicate',
] as const;
export type EditorialSourceItemStatus =
  (typeof editorialSourceItemStatuses)[number];

export const editorialJobAttemptStatuses = [
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type EditorialJobAttemptStatus =
  (typeof editorialJobAttemptStatuses)[number];

export const editorialCostLedgerStatuses = [
  'reserved',
  'settled',
  'released',
  'failed',
] as const;
export type EditorialCostLedgerStatus =
  (typeof editorialCostLedgerStatuses)[number];

export function isEditorialPublicationSlot(
  value: string | null | undefined,
): value is EditorialPublicationSlot {
  return Boolean(
    value &&
    editorialPublicationSlots.includes(value as EditorialPublicationSlot),
  );
}

export function isEditorialRevisionApprovalStatus(
  value: string | null | undefined,
): value is EditorialRevisionApprovalStatus {
  return Boolean(
    value &&
    editorialRevisionApprovalStatuses.includes(
      value as EditorialRevisionApprovalStatus,
    ),
  );
}

export type EditorialSource = {
  title: string;
  url: string;
  publishedAt?: string;
  accessedAt: string;
};

export type EditorialEvidence = {
  label: string;
  value: string;
  sourceUrl?: string;
  observedAt?: string;
};

export type PublicArticleRevisionData = {
  revisionId: string;
  publicationCategory: EditorialCategory;
  title: string;
  excerpt: string;
  contentMarkdown: string;
  coverLabel: string | null;
  coverAlt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  coverImageDisclosure: string | null;
  sources: EditorialSource[];
  evidence: EditorialEvidence[];
};

export type EditorialPublicationSlotRecord = {
  id: string;
  localDate: string;
  slot: EditorialPublicationSlot;
  scheduledAt: string;
  status: EditorialPublicationSlotStatus;
  articleId: string | null;
  revisionId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  failureCount: number;
  failureMessage: string | null;
};

export type PublicArticle = Omit<
  PublicArticleRevisionData,
  'revisionId' | 'publicationCategory'
> & {
  id: string;
  slug: string;
  category: EditorialCategory;
  authorName: string;
  authorUrl: string | null;
  revisionId: string;
  publishedAt: string;
  updatedAt: string;
  locale: EditorialLocale;
  translationStatus: EditorialTranslationStatus;
};

export type PublicArticleCard = Omit<
  PublicArticle,
  'contentMarkdown' | 'sources' | 'evidence'
> & {
  contentMarkdown?: string;
  readingMinutes: number;
};

export const editorialCategoryLabels: Record<EditorialCategory, string> = {
  news: 'Bản tin vàng',
  explain: 'Giải mã thị trường',
  practice: 'Kinh nghiệm giao dịch',
};

export function isEditorialCategory(
  value: string | null | undefined,
): value is EditorialCategory {
  return value === 'news' || value === 'explain' || value === 'practice';
}
