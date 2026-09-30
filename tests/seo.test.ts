import { describe, expect, it } from 'vitest';

import { pageMetadata, publicPages, siteUrl } from '@/lib/seo';

describe('public SEO metadata', () => {
  it('keeps canonical URLs on the production origin', () => {
    const metadata = pageMetadata(
      '/cong-cu-vang',
      'So sánh giá vàng',
      'Đối chiếu giá vàng Việt Nam.',
    );

    expect(metadata.alternates?.canonical).toBe(`${siteUrl}/cong-cu-vang`);
    expect(metadata.openGraph?.url).toBe(`${siteUrl}/cong-cu-vang`);
    expect(metadata.description).toContain('Đối chiếu');
  });

  it('lists only public, indexable pages in the sitemap source', () => {
    expect(publicPages).toEqual([
      '/',
      '/phan-tich',
      '/nhip-vang',
      '/bien-tap',
      '/cong-cu-vang',
      '/so-vang',
      '/so-sanh/nhan-9999',
      '/so-sanh/vang-mieng-sjc',
      '/so-sanh/nhan-9999-va-vang-mieng-sjc',
      '/huong-dan',
      '/donate',
      '/privacy',
      '/terms',
    ]);
    expect(publicPages as readonly string[]).not.toContain('/admin/billing');
  });
});
