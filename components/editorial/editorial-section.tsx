import { Newspaper } from 'lucide-react';
import { listPublishedArticles } from '@/lib/editorial/content';
import type { PublicArticleCard } from '@/lib/editorial/types';
import { EditorialHomeClient } from './editorial-home-client';

export async function LatestEditorialSection() {
  const [vietnameseArticles, englishArticles] = await Promise.all([
    listPublishedArticles({ limit: 4, locale: 'vi' }),
    listPublishedArticles({ limit: 4, locale: 'en' }),
  ]);
  return (
    <EditorialHomeClient
      vietnameseArticles={vietnameseArticles}
      englishArticles={englishArticles}
    />
  );
}

export function EditorialEmptyState({ locale = 'vi' }: { locale?: 'vi' | 'en' }) {
  return (
    <div className="editorial-empty">
      <Newspaper className="size-5 text-primary" aria-hidden="true" />
      <p>
        {locale === 'en'
          ? 'Gold Pulse is preparing its first articles from reviewed data and sources.'
          : 'Nhịp vàng đang chuẩn bị các bài viết đầu tiên từ dữ liệu và nguồn đã kiểm tra.'}
      </p>
    </div>
  );
}

export type EditorialHomeArticles = {
  vietnameseArticles: PublicArticleCard[];
  englishArticles: PublicArticleCard[];
};
