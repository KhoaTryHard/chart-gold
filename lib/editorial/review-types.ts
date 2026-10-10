import type {
  EditorialCategory,
  EditorialEvidence,
  EditorialSource,
} from './types';

export type ReviewGroup = 'pending' | 'approved' | 'scheduled' | 'attention';
export type ReviewSummary = {
  approvalOrigin?: 'telegram';
  articleId: string;
  revisionId: string;
  slug: string;
  title: string;
  excerpt: string;
  category: EditorialCategory;
  articleStatus: string;
  approvalStatus: string;
  revisionStatus: string;
  createdAt: string;
  approvedAt: string | null;
  reviewNote: string | null;
  sourceCount: number;
  evidenceCount: number;
  coverImageUrl: string | null;
  version: string;
  readiness: { ready: boolean; blockers: string[]; warnings: string[] };
};
export type ReviewDetail = ReviewSummary & {
  contentMarkdown: string;
  sources: EditorialSource[];
  evidence: EditorialEvidence[];
  seoTitle: string | null;
  seoDescription: string | null;
  coverAlt: string | null;
  coverImageAlt: string | null;
  coverImageDisclosure: string | null;
};
export type ReviewSlot = {
  id: string | null;
  localDate: string;
  slot: 'morning' | 'noon' | 'evening';
  scheduledAt: string;
  status: string;
  articleId: string | null;
  revisionId: string | null;
  title: string | null;
  failureMessage: string | null;
  revisionVersion: string | null;
};
export type ReviewInbox = {
  items: ReviewSummary[];
  counts: Record<ReviewGroup, number>;
  slots: ReviewSlot[];
  localDate: string;
  serverNow: string;
  hasActiveJobs: boolean;
  page: number;
  total: number;
  pageSize: number;
};
export type ReviewTarget = {
  articleId: string;
  revisionId: string;
  version: string;
};
export type ReviewResult = ReviewTarget & {
  ok: boolean;
  error?: string;
  status?: number;
  item?: ReviewSummary;
  slot?: ReviewSlot;
};
