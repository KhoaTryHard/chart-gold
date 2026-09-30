import { expect, test } from '@playwright/test';

const routes = [
  '/',
  '/phan-tich',
  '/nhip-vang',
  '/cong-cu-vang',
  '/terms',
  '/admin/bai-viet',
  '/trang-khong-ton-tai',
] as const;

const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
  { width: 1440, height: 960 },
] as const;

for (const route of routes) {
  test(`renders one global footer on ${route}`, async ({ page }) => {
    await page.goto(route);
    const footer = page.getByRole('contentinfo');
    await expect(footer).toHaveCount(1);
    await expect(
      footer.getByText('Thông tin tham khảo & AI', { exact: true }),
    ).toBeVisible();
    await expect(
      footer.getByRole('link', {
        name: 'Đọc đầy đủ về miễn trừ trách nhiệm',
        exact: true,
      }),
    ).toHaveAttribute('href', '/terms#mien-tru-trach-nhiem');
    await expect(
      footer.getByRole('link', { name: 'Liên hệ & góp ý', exact: true }),
    ).toHaveAttribute('href', '/terms#lien-he');
  });
}

test('keeps footer navigation links crawlable without prefetch requests', async ({
  page,
}) => {
  await page.goto('/');
  const footer = page.getByRole('contentinfo');
  await expect(
    footer.getByRole('link', { name: 'Nhịp vàng', exact: true }),
  ).toHaveAttribute('href', '/#nhip-vang');
  await expect(
    footer.getByRole('link', { name: 'Tính lãi/lỗ và hòa vốn', exact: true }),
  ).toHaveAttribute('href', '/cong-cu-vang#hoa-von');
  await expect(footer.locator('a')).toHaveCount(19);
});

for (const viewport of viewports) {
  test(`footer fits at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('contentinfo')).toBeVisible();
    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
  });
}
