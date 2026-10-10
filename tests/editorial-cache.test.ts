import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  entries: new Map<string, Promise<unknown>>(),
  rows: [] as Record<string, unknown>[],
  reads: vi.fn(),
  paths: vi.fn(),
  tags: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  unstable_cache: (read: (...args: unknown[]) => Promise<unknown>, key: string[]) =>
    (...args: unknown[]) => {
      const id = JSON.stringify([key, args]);
      if (!state.entries.has(id)) state.entries.set(id, read(...args));
      return state.entries.get(id);
    },
  revalidatePath: state.paths,
  revalidateTag: (tag: string, profile: unknown) => {
    state.tags(tag, profile);
    state.entries.clear();
  },
}));
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: () => {
      const result = Promise.resolve().then(() => {
        state.reads();
        return structuredClone(state.rows);
      });
      const query = Object.assign(result, {
        from: () => query,
        leftJoin: () => query,
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        offset: () => result,
      });
      return query;
    },
  }),
}));

import { getPublishedArticle, listPublishedArticles } from '@/lib/editorial/content';
import { revalidateEditorialPublicContent } from '@/lib/editorial/public-cache';

function articleRow() {
  const now = new Date('2026-10-04T00:00:00Z');
  return {
    article: { id: 'article', slug: 'gold', category: 'news', publishedCategory: 'news', authorName: 'Author', publishedAt: now, updatedAt: now },
    revision: { id: 'revision-1', title: 'Vietnamese title', excerpt: 'Vietnamese excerpt', contentMarkdown: 'Vietnamese published body', sources: [], evidence: [] },
    translation: { status: 'ready', title: 'English title', excerpt: 'English excerpt', contentMarkdown: 'English published body' },
  };
}

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgresql://local/editorial_test');
  state.entries.clear();
  vi.clearAllMocks();
  state.rows = [articleRow()];
});

describe('public editorial cache keys and invalidation', () => {
  it('normalizes list arguments while keeping locale, category, page and limit isolated', async () => {
    await listPublishedArticles();
    await listPublishedArticles({ limit: 12, page: 1, locale: 'vi' });
    await listPublishedArticles({ page: Number.NaN, limit: Number.POSITIVE_INFINITY });
    expect(state.reads).toHaveBeenCalledTimes(1);
    await listPublishedArticles({ locale: 'en' });
    await listPublishedArticles({ category: 'news' });
    await listPublishedArticles({ page: 2 });
    await listPublishedArticles({ limit: 4 });
    expect(state.reads).toHaveBeenCalledTimes(5);
  });

  it('separates translated detail and list data and expires both immediately', async () => {
    expect((await getPublishedArticle('gold', 'vi'))?.title).toBe('Vietnamese title');
    expect((await getPublishedArticle('gold', 'en'))?.title).toBe('English title');
    expect((await listPublishedArticles({ locale: 'en' }))[0].title).toBe('English title');
    state.rows[0] = { ...articleRow(), translation: { status: 'hidden' } };
    expect((await getPublishedArticle('gold', 'en'))?.title).toBe('English title');

    revalidateEditorialPublicContent('gold');
    expect(state.tags).toHaveBeenCalledWith('editorial-public', { expire: 0 });
    expect((await getPublishedArticle('gold', 'en'))?.title).toBe('Vietnamese title');
    expect((await getPublishedArticle('gold', 'en'))?.translationStatus).toBe('hidden');
    expect((await listPublishedArticles({ locale: 'en' }))[0].title).toBe('Vietnamese title');
    for (const path of ['/', '/nhip-vang', '/nhip-vang/gold', '/sitemap.xml', '/news-sitemap.xml']) {
      expect(state.paths).toHaveBeenCalledWith(path);
    }
  });

  it('expires missing-article and populated entries on publication and withdrawal', async () => {
    state.rows = [];
    expect(await getPublishedArticle('gold')).toBeNull();
    state.rows = [articleRow()];
    expect(await getPublishedArticle('gold')).toBeNull();
    revalidateEditorialPublicContent('gold');
    expect((await getPublishedArticle('gold'))?.revisionId).toBe('revision-1');
    await listPublishedArticles();
    state.rows = [];
    revalidateEditorialPublicContent('gold');
    expect(await getPublishedArticle('gold')).toBeNull();
    expect(await listPublishedArticles()).toEqual([]);
  });

  it('does not cache an unconfigured deployment as an empty database result', async () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(await listPublishedArticles()).toEqual([]);
    expect(await getPublishedArticle('gold')).toBeNull();
    expect(state.reads).not.toHaveBeenCalled();
    vi.stubEnv('DATABASE_URL', 'postgresql://local/editorial_test');
    expect((await getPublishedArticle('gold'))?.title).toBe('Vietnamese title');
  });
});
