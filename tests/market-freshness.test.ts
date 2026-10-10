import { describe, expect, it } from 'vitest';
import { formatMarketAge, getMarketFreshness } from '@/lib/market-freshness';

describe('market record and publication freshness', () => {
  const now = Date.parse('2026-10-04T08:30:00Z');

  it('distinguishes a newly generated Sunday record from a Saturday publication', () => {
    expect(getMarketFreshness({
      fetchedAt: '2026-10-04T08:29:00Z',
      sourcePublishedAt: '2026-10-03T00:57:00Z',
      observedAt: '2026-10-04T08:29:00Z',
      timestampKind: 'source',
    }, now)).toEqual({
      evaluatedAt: '2026-10-04T08:30:00.000Z',
      recordAgeSeconds: 60,
      sourceAgeSeconds: 113_580,
    });
  });

  it('does not turn retrieval timestamps into publication timestamps', () => {
    expect(getMarketFreshness({
      generatedAt: '2026-10-04T08:29:00Z',
      observedAt: '2026-10-04T08:28:00Z',
      sourcePublishedAt: '2026-10-04T08:28:00Z',
      timestampKind: 'retrieval-or-date',
    }, now)).toMatchObject({ recordAgeSeconds: 60, sourceAgeSeconds: null });
    expect(getMarketFreshness({}, now)).toMatchObject({ recordAgeSeconds: null, sourceAgeSeconds: null });
  });

  it('returns unknown age for malformed or future times and advances across cached responses', () => {
    for (const timestamp of ['invalid', '2026-10-05T00:00:00Z']) {
      expect(getMarketFreshness({ fetchedAt: timestamp, observedAt: timestamp, timestampKind: 'source' }, now))
        .toMatchObject({ recordAgeSeconds: null, sourceAgeSeconds: null });
    }
    const timing = { generatedAt: '2026-10-04T08:29:00Z' };
    expect(getMarketFreshness(timing, now + 120_000).recordAgeSeconds).toBe(180);
  });

  it('describes elapsed time without claiming a publication schedule', () => {
    expect(formatMarketAge(15, false)).toBe('vừa xong');
    expect(formatMarketAge(125, false)).toBe('2 phút trước');
    expect(formatMarketAge(86_400, false)).toBe('1 ngày trước');
    expect(formatMarketAge(3_600, true)).toBe('1 hour ago');
  });
});
