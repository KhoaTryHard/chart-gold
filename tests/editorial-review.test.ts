import { describe, expect, it } from 'vitest';
import {
  assertRevisionVersion,
  editorialReadiness,
  revisionVersion,
  validEditorialTimestamp,
} from '@/lib/editorial/review';

const content = {
  title: 'Tin vàng có dữ kiện',
  excerpt: 'Đoạn dẫn có nguồn kiểm chứng.',
  contentMarkdown: '## Dữ kiện\nNội dung.',
  publicationCategory: 'news',
  sources: [],
  evidence: [
    {
      label: 'Giá tham chiếu',
      value: '100',
      observedAt: '2026-10-01T08:00:00+07:00',
    },
  ],
  seoTitle: null,
  seoDescription: null,
  coverAlt: 'Ảnh thương hiệu',
  coverImageUrl: '/brand/covers/news.webp',
  coverImageAlt: 'Vàng',
  coverImageStorageKey: null,
  coverImageDisclosure: null,
  coverImageProvider: 'brand-library',
  coverImageModel: 'v1',
};
describe('editorial review identity and readiness', () => {
  it('allows evidence-only content and reports SEO as a warning', () => {
    const result = editorialReadiness(content);
    expect(result.ready).toBe(true);
    expect(result.warnings).toHaveLength(2);
  });
  it('does not treat alt text or an image prompt as a ready cover', () => {
    expect(editorialReadiness({ ...content, coverImageUrl: null }).ready).toBe(
      false,
    );
  });
  it('blocks malformed evidence dates before approval', () => {
    expect(
      editorialReadiness({
        ...content,
        evidence: [{ label: 'Giá', value: '100', observedAt: 'bad-date' }],
      }).blockers,
    ).toContain('Ngày ghi nhận dữ kiện không hợp lệ.');
    expect(validEditorialTimestamp('bad-date')).toBe(false);
    expect(validEditorialTimestamp('2026-10-01T08:00:00+07:00')).toBe(true);
  });
  it.each(['title', 'contentMarkdown', 'coverImageAlt', 'seoTitle'] as const)(
    'rejects a changed %s on the same revision id',
    (field) => {
      const version = revisionVersion(content);
      expect(() =>
        assertRevisionVersion({ ...content, [field]: 'Changed' }, version),
      ).toThrow('Phiên bản đã thay đổi');
    },
  );
  it('keeps identity stable when only workflow timestamps/status change', () => {
    expect(
      revisionVersion({
        ...content,
        status: 'reviewed',
        approvedAt: new Date(),
      } as typeof content),
    ).toBe(revisionVersion(content));
  });
});
