// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { chromium, type Browser } from '@playwright/test';
import { EditorialCover } from '@/components/editorial/editorial-cover';
import { ArticleCard } from '@/components/editorial/article-card';
import type { PublicArticle, PublicArticleCard } from '@/lib/editorial/types';

const mocks = vi.hoisted(() => ({
  locale: 'vi' as 'vi' | 'en',
  getPublishedArticle: vi.fn(),
}));
vi.mock('@/components/locale-provider', () => ({
  useLocale: () => ({ locale: mocks.locale }),
}));
vi.mock('@/lib/editorial/content', () => ({
  getPublishedArticle: mocks.getPublishedArticle,
  listPublishedArticles: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/request-locale', () => ({
  getRequestLocale: vi.fn().mockResolvedValue('vi'),
}));

const title = 'Giá vàng biến động theo thị trường thế giới';
const disclosure = 'Ảnh minh họa được tạo bằng AI.';
const imageUrl = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#f7f6f2"/><rect x="6" y="6" width="1188" height="663" fill="none" stroke="#a78646" stroke-width="12"/></svg>')}`;
const article = {
  id: 'article',
  revisionId: 'revision',
  slug: 'gia-vang-bien-dong',
  title,
  excerpt: 'Diễn biến giá vàng và các yếu tố cần theo dõi.',
  category: 'news',
  authorName: 'Kim Tuyến',
  authorUrl: null,
  coverLabel: 'Bản tin vàng',
  coverAlt: null,
  seoTitle: null,
  seoDescription: null,
  coverImageUrl: imageUrl,
  coverImageAlt: 'Minh họa diễn biến giá vàng',
  coverImageDisclosure: disclosure,
  publishedAt: '2026-10-15T01:00:00.000Z',
  updatedAt: '2026-10-15T01:00:00.000Z',
  locale: 'vi',
  translationStatus: 'source',
  readingMinutes: 3,
} satisfies PublicArticleCard;

function documentFor(markup: string) {
  const container = document.createElement('div');
  container.innerHTML = markup;
  return container;
}

describe('editorial covers', () => {
  it.each([false, true])('shows the real image without a second title or logo (compact=%s)', (compact) => {
    const node = documentFor(renderToStaticMarkup(createElement(EditorialCover, {
      title, compact, imageUrl, imageDisclosure: disclosure,
    })));
    const frame = node.querySelector('.editorial-cover')!;
    const caption = node.querySelector('figcaption')!;
    expect(frame.classList.contains('editorial-cover--image')).toBe(true);
    expect(frame.querySelector('img')?.alt).toBe(`Ảnh minh họa: ${title}`);
    expect(frame.querySelector('svg, strong, .editorial-cover__content, .editorial-cover__scrim')).toBeNull();
    expect(frame.textContent).toBe('');
    expect(caption.textContent).toBe(disclosure);
    expect(caption.previousElementSibling).toBe(frame);
    expect(frame.contains(caption)).toBe(false);
  });

  it('preserves the branded fallback and hides its decorative mark from assistive technology', () => {
    const node = documentFor(renderToStaticMarkup(createElement(EditorialCover, { title })));
    expect(node.querySelector('img')).toBeNull();
    expect(node.querySelector('.editorial-cover--image')).toBeNull();
    expect(node.querySelector('.editorial-cover__mark')?.getAttribute('aria-hidden')).toBe('true');
    expect(node.querySelector('.editorial-cover__content strong')?.textContent).toBe(title);
    expect(node.querySelector('.editorial-cover__content span')?.textContent).toBe('Nhịp vàng');
    expect(node.querySelector('figcaption')).toBeNull();
  });

  it('keeps the compact fallback label and supports English alternative text', () => {
    const fallback = documentFor(renderToStaticMarkup(createElement(EditorialCover, {
      title, compact: true, label: 'Bản tin vàng',
    })));
    expect(fallback.querySelector('.editorial-cover__content span')?.textContent).toBe('Bản tin vàng');
    expect(fallback.querySelector('strong')).toBeNull();
    mocks.locale = 'en';
    try {
      const node = documentFor(renderToStaticMarkup(createElement(EditorialCover, { title, imageUrl })));
      expect(node.querySelector('img')?.alt).toBe(`Illustration: ${title}`);
    } finally {
      mocks.locale = 'vi';
    }
  });

  it.each([false, true])('keeps the article heading outside its real cover (featured=%s)', (featured) => {
    const node = documentFor(renderToStaticMarkup(createElement(ArticleCard, { article, featured })));
    expect(node.querySelectorAll('h2')).toHaveLength(1);
    expect(node.querySelector('h2')?.textContent).toBe(title);
    expect(node.querySelector('.editorial-cover')?.contains(node.querySelector('h2'))).toBe(false);
    expect(node.querySelector('.editorial-cover__content')).toBeNull();
  });
});

describe('article sharing image metadata', () => {
  it.each([
    { coverImageUrl: '/article-cover.png', height: 675 },
    { coverImageUrl: null, height: 630 },
  ])('describes the actual dimensions for $coverImageUrl', async ({ coverImageUrl, height }) => {
    mocks.getPublishedArticle.mockResolvedValue({
      ...article, coverImageUrl, contentMarkdown: 'Nội dung bài viết', sources: [], evidence: [],
    } satisfies PublicArticle);
    const { generateMetadata } = await import('@/app/nhip-vang/[slug]/page');
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: article.slug }) });
    expect(metadata.openGraph?.images).toEqual([expect.objectContaining({
      url: coverImageUrl ?? '/og.png', width: 1200, height,
    })]);
    expect(metadata.twitter?.images).toEqual([coverImageUrl ?? '/og.png']);
  });
});

// Opt in for the real browser checks so ordinary unit runs do not require a
// Playwright browser installation. Run with EDITORIAL_COVER_BROWSER_TESTS=1.
describe.skipIf(process.env.EDITORIAL_COVER_BROWSER_TESTS !== '1')('editorial cover browser geometry', () => {
  let browser: Browser;
  const css = readFileSync(`${process.cwd()}/node_modules/tailwindcss/preflight.css`, 'utf8')
    + readFileSync(`${process.cwd()}/app/globals.css`, 'utf8')
      .replace(/^@import[^;]+;/gm, '');

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });

  for (const viewportWidth of [390, 1280]) {
    it(`preserves the branded fallback sizing at ${viewportWidth}px`, async () => {
      const page = await browser.newPage({ viewport: { width: viewportWidth, height: 900 } });
      try {
        const markup = [false, true].map((compact) => renderToStaticMarkup(
          createElement(EditorialCover, { title, compact }),
        )).join('');
        await page.setContent(`<style>${css}</style><main style="max-width:760px">${markup}</main>`);
        const covers = await page.locator('.editorial-cover').evaluateAll((frames) => frames.map((frame) => ({
          height: frame.getBoundingClientRect().height,
          minHeight: parseFloat(getComputedStyle(frame).minHeight),
          marks: frame.querySelectorAll('svg').length,
          image: Boolean(frame.querySelector('img')),
        })));
        expect(covers.map(({ height: _height, ...cover }) => cover)).toEqual([
          { minHeight: viewportWidth === 390 ? 220 : 260, marks: 2, image: false },
          { minHeight: viewportWidth === 390 ? 96 : 110, marks: 2, image: false },
        ]);
        for (const cover of covers) expect(cover.height).toBeGreaterThanOrEqual(cover.minHeight);
      } finally {
        await page.close();
      }
    });

    for (const variant of ['detail', 'featured', 'compact'] as const) {
      it(`shows the entire 16:9 image and an external caption at ${viewportWidth}px (${variant})`, async () => {
        const page = await browser.newPage({ viewport: { width: viewportWidth, height: 900 } });
        try {
          const markup = variant === 'detail'
            ? renderToStaticMarkup(createElement(EditorialCover, { title, imageUrl, imageDisclosure: disclosure }))
            : renderToStaticMarkup(createElement(ArticleCard, { article, featured: variant === 'featured' }));
          const width = viewportWidth === 390 ? '100%' : variant === 'compact' ? '320px' : '760px';
          await page.setContent(`<style>${css}</style><main style="width:${width};max-width:100%">${markup}</main>`);
          await page.locator('.editorial-cover__image').evaluate(async (image: HTMLImageElement) => image.decode());
          const geometry = await page.locator('.editorial-cover-figure').evaluate((figure) => {
            const frame = figure.querySelector('.editorial-cover')!.getBoundingClientRect();
            const image = figure.querySelector('img')!;
            const bounds = image.getBoundingClientRect();
            const caption = figure.querySelector('figcaption')!.getBoundingClientRect();
            return {
              ratio: frame.width / frame.height,
              imageWidth: bounds.width,
              frameWidth: frame.width,
              imageHeight: bounds.height,
              frameHeight: frame.height,
              objectFit: getComputedStyle(image).objectFit,
              captionTop: caption.top,
              frameBottom: frame.bottom,
              overflow: document.documentElement.scrollWidth > window.innerWidth,
            };
          });
          expect(geometry.ratio).toBeCloseTo(16 / 9, 2);
          expect(geometry.imageWidth).toBeCloseTo(geometry.frameWidth, 1);
          expect(geometry.imageHeight).toBeCloseTo(geometry.frameHeight, 1);
          expect(geometry.objectFit).toBe('contain');
          expect(geometry.captionTop).toBeGreaterThanOrEqual(geometry.frameBottom);
          expect(geometry.overflow).toBe(false);
          expect(await page.locator('.editorial-cover__content, .editorial-cover__scrim').count()).toBe(0);
        } finally {
          await page.close();
        }
      });
    }
  }
});
