import type { EditorialCategory } from './types';

export type BrandCover = {
  id: string;
  category: EditorialCategory;
  url: string;
  alt: string;
  disclosure: string;
  version: string;
};

const brandCovers: readonly BrandCover[] = [
  {
    id: 'market-v1',
    category: 'news',
    url: '/brand/covers/news.webp',
    alt: 'Minh họa thương hiệu Kim Tuyến về bảng giá vàng',
    disclosure: 'Ảnh minh họa thương hiệu Kim Tuyến',
    version: 'brand-covers-v1',
  },
  {
    id: 'editorial-v1',
    category: 'explain',
    url: '/brand/covers/explain.webp',
    alt: 'Minh họa thương hiệu Kim Tuyến về góc nhìn thị trường vàng',
    disclosure: 'Ảnh minh họa thương hiệu Kim Tuyến',
    version: 'brand-covers-v1',
  },
  {
    id: 'tools-v1',
    category: 'practice',
    url: '/brand/covers/practice.webp',
    alt: 'Minh họa thương hiệu Kim Tuyến về công cụ vàng',
    disclosure: 'Ảnh minh họa thương hiệu Kim Tuyến',
    version: 'brand-covers-v1',
  },
];

export function getBrandCover(category: EditorialCategory, id?: string | null) {
  return (
    brandCovers.find(
      (cover) => cover.category === category && (!id || cover.id === id),
    ) ?? brandCovers.find((cover) => cover.category === category)!
  );
}

export function listBrandCovers() {
  return brandCovers;
}

export function isBrandCoverUrl(value: string | null | undefined) {
  return brandCovers.some((cover) => cover.url === value);
}
