import type { MetadataRoute } from 'next';
import { publicPages, siteUrl } from '@/lib/seo';
import { listArticleSlugs } from '@/lib/editorial/content';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = await listArticleSlugs();
  return [
    ...publicPages.map((path) => ({ url: new URL(path, siteUrl).href })),
    ...articles.map((article) => ({ url: new URL(`/nhip-vang/${article.slug}`, siteUrl).href, lastModified: article.updatedAt })),
  ];
}
