import { describe, expect, it } from 'vitest';

import {
  editorialEventFingerprint,
  parseRssItems,
  scoreEditorialRelevance,
} from '@/lib/editorial/scouting';

describe('editorial scouting primitives', () => {
  it('normalizes equivalent Vietnamese event titles for durable deduplication', () => {
    expect(editorialEventFingerprint('NHNN: Tỷ giá USD hôm nay')).toBe(
      editorialEventFingerprint('NHNN - Ty gia USD hom nay'),
    );
  });

  it('keeps only allowed RSS links and scores gold-relevant items', () => {
    const source = {
      name: 'Federal Reserve',
      lane: 'global' as const,
      sourceType: 'official' as const,
      feedUrl: 'https://www.federalreserve.gov/feeds/press_monetary.xml',
      allowedHosts: ['federalreserve.gov'],
      format: 'rss' as const,
    };
    const xml = `<rss><channel><item><title>FOMC statement on interest rates</title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20260910a.htm</link><description>Interest rate policy</description></item><item><title>Other</title><link>https://example.test/other</link></item></channel></rss>`;
    const items = parseRssItems(xml, source);
    expect(items).toHaveLength(1);
    expect(items[0]?.relevanceScore).toBeGreaterThan(
      scoreEditorialRelevance('Other'),
    );
  });
});
