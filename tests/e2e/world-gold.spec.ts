import { expect, test } from '@playwright/test';

const widgetScript = `
  (() => {
    const script = document.currentScript;
    const iframe = document.createElement('iframe');
    iframe.title = 'TradingView OANDA:XAUUSD chart';
    iframe.dataset.mockTradingview = 'true';
    script?.parentElement?.appendChild(iframe);
  })();
`;

async function activeElement(
  page: import('@playwright/test').Page,
  selector: string,
) {
  const candidates = page.locator(selector);
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const box = await candidates.nth(index).boundingBox();
    if (box && box.width > 0 && box.height > 0) return candidates.nth(index);
  }
  throw new Error(`Không tìm thấy phần tử đang hiển thị: ${selector}`);
}

async function activeWidget(page: import('@playwright/test').Page) {
  return activeElement(page, '[data-widget-symbol="OANDA:XAUUSD"]');
}

test('lazy-loads one TradingView XAU/USD widget near the viewport', async ({
  page,
}) => {
  let scriptLoads = 0;
  await page.route(
    'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js',
    async (route) => {
      scriptLoads += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: widgetScript,
      });
    },
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });
  const section = await activeElement(page, '#vang-the-gioi');
  const widget = await activeWidget(page);
  await expect(section).toBeVisible();
  await expect.poll(() => scriptLoads).toBe(0);

  await section.scrollIntoViewIfNeeded();
  await expect.poll(() => scriptLoads).toBe(1);
  await expect(widget).toHaveAttribute('data-widget-interval', 'D');
  await expect(widget).toHaveAttribute('data-widget-range', '6M');
  await expect(
    widget.locator('iframe[data-mock-tradingview="true"]'),
  ).toHaveCount(1);
  await expect(widget).toContainText('Mở trên TradingView');
});

test('recreates the widget once when the theme changes without duplicating iframes', async ({
  page,
}) => {
  let scriptLoads = 0;
  await page.route(
    'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js',
    async (route) => {
      scriptLoads += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: widgetScript,
      });
    },
  );

  await page.goto('/');
  const section = await activeElement(page, '#vang-the-gioi');
  await section.scrollIntoViewIfNeeded();
  const widget = await activeWidget(page);
  await expect.poll(() => scriptLoads).toBe(1);
  await expect(
    widget.locator('iframe[data-mock-tradingview="true"]'),
  ).toHaveCount(1);

  await page.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click();
  await expect.poll(() => scriptLoads).toBe(2);
  await expect(
    widget.locator('iframe[data-mock-tradingview="true"]'),
  ).toHaveCount(1);
});

test('shows a retry action when the TradingView script fails', async ({
  page,
}) => {
  await page.route(
    'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js',
    (route) => route.abort(),
  );
  await page.goto('/');
  const widget = await activeWidget(page);
  await widget.scrollIntoViewIfNeeded();
  await expect(widget).toContainText('Không tải được biểu đồ');
  await expect(widget.getByRole('button', { name: 'Thử lại' })).toBeVisible();
  await expect(
    widget.getByRole('link', { name: 'Mở trên TradingView' }).first(),
  ).toHaveAttribute(
    'href',
    'https://www.tradingview.com/symbols/XAUUSD/?exchange=OANDA',
  );
});

test('keeps the world chart before Nhịp vàng and supports the direct anchor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#vang-the-gioi');
  await expect(page).toHaveURL(/\/#vang-the-gioi$/);
  const world = page.locator('#vang-the-gioi').first();
  await expect(world).toBeVisible();
  const order = await page.evaluate(() => {
    const world = document.querySelector('#vang-the-gioi');
    const editorial = document.querySelector('#nhip-vang');
    return {
      worldTop: world?.getBoundingClientRect().top ?? 0,
      editorialTop: editorial?.getBoundingClientRect().top ?? 0,
      scrollWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });
  expect(order.worldTop).toBeLessThan(order.editorialTop);
  expect(order.scrollWidth).toBeLessThanOrEqual(order.viewport);
});

test('keeps the world chart shell when the domestic quote request fails', async ({
  page,
}) => {
  await page.route('**/api/sjc?*', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#vang-the-gioi').first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Vàng thế giới', exact: true }).first(),
  ).toBeVisible();
});
