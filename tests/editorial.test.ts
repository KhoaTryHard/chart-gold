import { describe, expect, it } from 'vitest';
import { editorialSlug } from '@/lib/editorial/slug';
import { editorialCategoryLabels, isEditorialCategory } from '@/lib/editorial/types';

describe('Nhịp vàng editorial primitives', () => {
  it('creates stable Vietnamese SEO slugs', () => {
    expect(editorialSlug('USD tăng: Vàng & lãi suất')).toBe('usd-tang-vang-lai-suat');
    expect(editorialSlug('')).toMatch(/^nhip-vang-/);
  });

  it('keeps the three editorial lanes explicit', () => {
    expect(Object.keys(editorialCategoryLabels)).toEqual(['news', 'explain', 'practice']);
    expect(isEditorialCategory('news')).toBe(true);
    expect(isEditorialCategory('opinion')).toBe(false);
  });
});
