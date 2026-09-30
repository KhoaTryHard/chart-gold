import type { Metadata } from 'next';

// Keep canonical URLs stable across preview deployments and local development.
export const siteUrl = new URL(
  process.env.SITE_URL || 'https://vanghomnay.online',
).origin;

export const publicPages = [
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
] as const;

export function pageMetadata(path: string, title: string, description: string): Metadata {
  const fullTitle = `${title} — Kim Tuyến`;
  return {
    title: { absolute: fullTitle },
    description,
    alternates: { canonical: new URL(path, siteUrl).href },
    openGraph: {
      type: 'website', locale: 'vi_VN', siteName: 'Kim Tuyến',
      url: new URL(path, siteUrl).href, title: fullTitle, description,
      images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Kim Tuyến — Giá vàng Việt Nam' }],
    },
    twitter: { card: 'summary_large_image', title: fullTitle, description, images: ['/og.png'] },
  };
}
