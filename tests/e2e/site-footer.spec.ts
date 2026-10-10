import { expect, test } from '@playwright/test';

const routes = [
  '/',
  '/so-vang',
  '/phan-tich',
  '/nhip-vang',
  '/cong-cu-vang',
  '/terms',
  '/admin/bai-viet',
  '/trang-khong-ton-tai',
] as const;
const links = [
  ['Bảng giá vàng', '/'],
  ['Sổ vàng', '/so-vang'],
  ['Công cụ vàng', '/cong-cu-vang'],
  ['Nhịp vàng', '/nhip-vang'],
  ['Phân tích AI', '/phan-tich'],
  ['Hướng dẫn sử dụng', '/huong-dan'],
  ['Phương pháp biên tập', '/bien-tap'],
  ['Ủng hộ dự án', '/donate'],
  ['Liên hệ & góp ý', '/terms#lien-he'],
  ['Miễn trừ trách nhiệm', '/terms#mien-tru-trach-nhiem'],
  ['Chính sách bảo mật', '/privacy'],
  ['Điều khoản sử dụng', '/terms'],
] as const;
const notice =
  'Giá vàng, bài viết, phép tính và nội dung AI chỉ để tham khảo, không phải tư vấn đầu tư.';
const viewports = [
  { width: 320, height: 844 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 900 },
  { width: 1280, height: 900 },
  { width: 1440, height: 960 },
] as const;

for (const route of routes) {
  test(`renders one compact global footer on ${route}`, async ({ page }) => {
    await page.goto(route);
    const footer = page.getByRole('contentinfo');
    await expect(footer).toHaveCount(1);
    await expect(footer.locator('a')).toHaveCount(13);
    await expect(footer.getByText(notice, { exact: true })).toBeVisible();
    await expect(
      footer.getByText('Thông tin tham khảo & AI', { exact: true }),
    ).toHaveCount(0);
    await expect(
      footer.getByText('Tất cả bài viết', { exact: true }),
    ).toHaveCount(0);
    await expect(
      footer.getByText('Biểu đồ vàng thế giới', { exact: true }),
    ).toHaveCount(0);
    for (const [name, href] of links) {
      await expect(
        footer.getByRole('link', { name, exact: true }),
      ).toHaveAttribute('href', href);
    }
    await expect(footer.locator('.site-footer__brand-link')).toHaveAttribute(
      'href',
      '/',
    );
  });
}

test('keeps policy links crawlable without prefetch on hover', async ({
  page,
}) => {
  await page.goto('/terms');
  await page.waitForLoadState('networkidle');
  const prefetched: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/privacy' && url.searchParams.has('_rsc'))
      prefetched.push(url.href);
  });
  await page
    .getByRole('contentinfo')
    .getByRole('link', { name: 'Chính sách bảo mật', exact: true })
    .hover();
  await page.waitForLoadState('networkidle');
  expect(prefetched).toEqual([]);
});

test('keyboard navigation follows the footer reading order', async ({
  page,
}) => {
  await page.goto('/terms');
  const footerLinks = page.getByRole('contentinfo').locator('a');
  await expect(footerLinks).toHaveCount(13);
  expect(
    await footerLinks.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('tabindex')),
    ),
  ).toEqual(Array(13).fill(null));
  await footerLinks.first().focus();
  for (let index = 0; index < 13; index++) {
    const link = footerLinks.nth(index);
    await expect(link).toBeFocused();
    if (index > 0)
      await expect(link).toHaveAttribute('href', links[index - 1][1]);
    expect(
      await link.evaluate((element) => getComputedStyle(element).outlineStyle),
    ).toBe('solid');
    if (index < 12) await page.keyboard.press('Tab');
  }
});

for (const [name, hash] of [
  ['Miễn trừ trách nhiệm', 'mien-tru-trach-nhiem'],
  ['Liên hệ & góp ý', 'lien-he'],
] as const) {
  test(`opens the correct section for ${name}`, async ({ page }) => {
    await page.goto('/cong-cu-vang');
    await page
      .getByRole('contentinfo')
      .getByRole('link', { name, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/terms#${hash}$`));
    await expect(page.locator(`#${hash}`)).toBeInViewport();
  });
}

test('parent pages retain links to comparison pages and article categories', async ({
  page,
}) => {
  await page.goto('/cong-cu-vang');
  for (const slug of [
    'nhan-9999',
    'vang-mieng-sjc',
    'nhan-9999-va-vang-mieng-sjc',
  ]) {
    await expect(
      page.locator(`main a[href="/so-sanh/${slug}"]`).first(),
    ).toBeVisible();
  }
  await page.goto('/nhip-vang');
  const filters = page.getByRole('navigation', { name: 'Lọc bài viết' });
  await expect(filters.getByRole('link')).toHaveCount(4);
  await expect(
    filters.getByRole('link', { name: 'Tất cả', exact: true }),
  ).toHaveAttribute('href', '/nhip-vang');
  for (const category of ['news', 'explain', 'practice']) {
    await expect(
      filters.locator(`a[href="/nhip-vang?category=${category}"]`),
    ).toBeVisible();
  }
});

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of viewports) {
    test(`footer fits at ${viewport.width}px in ${theme} mode`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(
        (value) => localStorage.setItem('kim-tuyen-theme', value),
        theme,
      );
      await page.goto('/terms');
      await page.evaluate(() => document.fonts.ready);
      const footer = page.getByRole('contentinfo');
      await footer
        .getByRole('link', { name: 'Điều khoản sử dụng', exact: true })
        .scrollIntoViewIfNeeded();
      const layout = await footer.evaluate((element) => {
        const grid = element.querySelector('.site-footer__grid')!;
        const brand = element.querySelector('.site-footer__brand')!;
        const nav = element.querySelector('.site-footer__grid nav')!;
        const meta = element.querySelector('.site-footer__meta')!;
        const notice = element.querySelector('.site-footer__notice')!;
        const bottom = element.querySelector('.site-footer__bottom')!;
        const bottomNav = document.querySelector('.glass-bottom-nav');
        const lastLink = element.querySelector(
          '.site-footer__policies a:last-child',
        )!;
        const footerLinks = Array.from(element.querySelectorAll('a'));
        const overlappingLinks: string[][] = [];
        const clippedText: string[] = [];
        for (const [index, link] of footerLinks.entries()) {
          const bounds = link.getBoundingClientRect();
          for (const other of footerLinks.slice(index + 1)) {
            const otherBounds = other.getBoundingClientRect();
            if (
              Math.min(bounds.right, otherBounds.right) -
                Math.max(bounds.left, otherBounds.left) >
                0.5 &&
              Math.min(bounds.bottom, otherBounds.bottom) -
                Math.max(bounds.top, otherBounds.top) >
                0.5
            )
              overlappingLinks.push([
                link.textContent!.trim(),
                other.textContent!.trim(),
              ]);
          }
          const textNodes = document.createTreeWalker(
            link,
            NodeFilter.SHOW_TEXT,
          );
          while (textNodes.nextNode()) {
            if (!textNodes.currentNode.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(textNodes.currentNode);
            for (const textBounds of range.getClientRects()) {
              if (
                textBounds.left < bounds.left - 1 ||
                textBounds.right > bounds.right + 1 ||
                textBounds.top < bounds.top - 1 ||
                textBounds.bottom > bounds.bottom + 1
              )
                clippedText.push(textNodes.currentNode.textContent!.trim());
            }
          }
        }
        const fontSize = (selector: string) =>
          getComputedStyle(element.querySelector(selector)!).fontSize;
        return {
          scrollWidth: document.documentElement.scrollWidth,
          height: element.getBoundingClientRect().height,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          brandBottom: brand.getBoundingClientRect().bottom,
          navTop: nav.getBoundingClientRect().top,
          groups: Array.from(
            element.querySelectorAll('.site-footer__links'),
            (list) => ({
              columns:
                getComputedStyle(list).gridTemplateColumns.split(' ').length,
              rowGap: getComputedStyle(list).rowGap,
              items: Array.from(list.querySelectorAll('li'), (item) => {
                const itemBounds = item.getBoundingClientRect();
                const linkBounds = item
                  .querySelector('a')!
                  .getBoundingClientRect();
                return {
                  x: linkBounds.x,
                  y: linkBounds.y,
                  width: linkBounds.width,
                  cellWidth: itemBounds.width,
                };
              }),
            }),
          ),
          linkHeights: Array.from(
            element.querySelectorAll('a'),
            (link) => link.getBoundingClientRect().height,
          ),
          noticeBackground: getComputedStyle(notice).backgroundColor,
          noticeBorder: getComputedStyle(notice).borderTopWidth,
          noticeMargin: getComputedStyle(notice).marginTop,
          metaBorder: getComputedStyle(meta).borderTopWidth,
          metaContainsRows: meta.contains(notice) && meta.contains(bottom),
          bottomBorder: getComputedStyle(bottom).borderTopWidth,
          bottomMargin: getComputedStyle(bottom).marginTop,
          bottomNavTop:
            bottomNav && getComputedStyle(bottomNav).display !== 'none'
              ? bottomNav.getBoundingClientRect().top
              : null,
          lastLinkBottom: lastLink.getBoundingClientRect().bottom,
          typography: {
            brand: fontSize('.site-footer__brand-name'),
            caption: fontSize('.site-footer__brand-caption'),
            heading: fontSize('.site-footer__heading'),
            headingWeight: getComputedStyle(
              element.querySelector('.site-footer__heading')!,
            ).fontWeight,
            description: fontSize('.site-footer__description'),
            notice: fontSize('.site-footer__notice p'),
            copyright: fontSize('.site-footer__bottom > span'),
            links: Array.from(
              element.querySelectorAll(
                '.site-footer__link, .site-footer__notice-link',
              ),
              (link) => getComputedStyle(link).fontSize,
            ),
          },
          logoWidth: element
            .querySelector('.site-footer__brand-mark')!
            .getBoundingClientRect().width,
          overlappingLinks,
          clippedText,
        };
      });
      expect(layout.scrollWidth).toBeLessThanOrEqual(viewport.width);
      expect(layout.columns).toBe(viewport.width >= 1024 ? 3 : 2);
      if (viewport.width < 1024)
        expect(layout.brandBottom).toBeLessThanOrEqual(layout.navTop);
      expect(Math.min(...layout.linkHeights)).toBeGreaterThanOrEqual(44);
      for (const group of layout.groups) {
        expect(group.columns).toBe(viewport.width >= 1024 ? 2 : 1);
        expect(group.rowGap).toBe('0px');
        for (const item of group.items) {
          expect(item.width).toBeGreaterThanOrEqual(44);
          expect(Math.abs(item.width - item.cellWidth)).toBeLessThanOrEqual(1);
        }
        for (let index = 1; index < group.items.length; index++) {
          const previous = group.items[index - 1];
          const current = group.items[index];
          if (viewport.width >= 1024 && index % 2 === 1) {
            expect(Math.abs(current.y - previous.y)).toBeLessThanOrEqual(1);
            expect(current.x).toBeGreaterThan(previous.x);
          } else {
            expect(current.y).toBeGreaterThan(previous.y);
            expect(Math.abs(current.x - group.items[0].x)).toBeLessThanOrEqual(
              1,
            );
          }
        }
      }
      expect(layout.noticeBackground).toBe('rgba(0, 0, 0, 0)');
      expect(layout.noticeBorder).toBe('0px');
      expect(layout.noticeMargin).toBe('0px');
      expect(layout.metaBorder).toBe('1px');
      expect(layout.metaContainsRows).toBe(true);
      expect(layout.bottomBorder).toBe('0px');
      expect(layout.bottomMargin).toBe('0px');
      expect(layout.typography).toEqual({
        brand: '20px',
        caption: '11px',
        heading: '16px',
        headingWeight: '700',
        description: '14px',
        notice: '13px',
        copyright: '13px',
        links: Array(12).fill('15px'),
      });
      expect(layout.logoWidth).toBe(44);
      expect(layout.overlappingLinks).toEqual([]);
      expect(layout.clippedText).toEqual([]);
      if (layout.bottomNavTop !== null)
        expect(layout.lastLinkBottom).toBeLessThanOrEqual(layout.bottomNavTop);
      // Before this redesign, the /terms footer measured 436px at 1440px.
      if (viewport.width === 1440)
        expect(layout.height).toBeLessThanOrEqual(320);
      await footer
        .getByRole('link', { name: 'Điều khoản sử dụng', exact: true })
        .focus();
      await expect(
        footer.getByRole('link', { name: 'Điều khoản sử dụng', exact: true }),
      ).toBeFocused();
      expect(
        await footer
          .getByRole('link', { name: 'Điều khoản sử dụng', exact: true })
          .evaluate((element) => getComputedStyle(element).outlineStyle),
      ).toBe('solid');
      await footer.screenshot({
        path: `test-results/footer-${viewport.width}-${theme}.png`,
      });
    });
  }
}
