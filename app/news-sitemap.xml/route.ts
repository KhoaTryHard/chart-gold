import { listRecentNewsArticleSlugs } from '@/lib/editorial/content';
import { siteUrl } from '@/lib/seo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const articles = await listRecentNewsArticleSlugs();
  const urls = articles
    .filter((article) => article.publishedAt && article.title)
    .map(
      (article) =>
        `<url><loc>${escapeXml(new URL(`/nhip-vang/${article.slug}`, siteUrl).href)}</loc><news:news><news:publication><news:name>Kim Tuyến</news:name><news:language>vi</news:language></news:publication><news:publication_date>${article.publishedAt!.toISOString()}</news:publication_date><news:title>${escapeXml(article.title!)}</news:title></news:news></url>`,
    )
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${urls}</urlset>`,
    {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    },
  );
}
