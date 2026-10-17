import { expect, test, type Page } from '@playwright/test';

const points = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 8, 15 + index))
    .toISOString()
    .slice(0, 10);
  const open = 140 + index / 10;
  return {
    date,
    buy: { open, high: open + 1, low: open - 1, close: open + 0.5 },
    sell: { open: open + 3, high: open + 4, low: open + 2, close: open + 3.5 },
    updatedAt: `${date}T08:00:00Z`,
    observations: 4,
  };
});
const daily = points.map((p) => ({
  date: p.date,
  buy: p.buy.close,
  sell: p.sell.close,
  spread: 3,
  eventId: null,
}));
const quote = {
  mode: 'live',
  availability: 'available',
  unavailableReason: null,
  company: {
    id: 'sjc',
    name: 'SJC',
    shortName: 'SJC',
    adapter: 'sjc-official',
    supportsOfficialQuote: true,
    maxHistoryDays: 365,
  },
  product: {
    id: 'bar-1l',
    shortLabel: 'Miếng 1 lượng',
    label: 'Vàng miếng SJC 1 lượng',
    group: 'Vàng miếng SJC',
    unitLabel: '1 lượng',
    weightInLuong: 1,
  },
  records: daily,
  latest: daily.at(-1),
  observedAt: '2026-10-14T08:00:00Z',
  generatedAt: '2026-10-14T08:00:00Z',
  source: { provider: 'SJC', url: 'https://sjc.com.vn', official: true },
  historySource: { provider: 'Daily test source', url: 'https://sjc.com.vn' },
};
function candleResponse(range: string | null, productId = 'bar-1l') {
  const records = range === '7N' ? points.slice(-7) : points;
  return {
    companyId: 'sjc',
    productId,
    range,
    records,
    status: 'ready',
    unit: 'million-vnd-per-luong',
    source: {
      provider: 'Vàng.Today',
      url: 'https://www.vang.today/vi/chi-tiet/SJL1L10',
      official: false,
      referenceGroup: 'bar',
    },
    requestedStart: records[0].date,
    requestedEnd: records.at(-1)!.date,
    missingDates: [],
    updatedAt: records.at(-1)!.updatedAt,
  };
}
async function mock(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-14T08:00:00Z'));
  await page.route('**/api/sjc?*', (route) => route.fulfill({ json: quote }));
  await page.route('**/api/market-candles?*', (route) =>
    route.fulfill({
      json: candleResponse(
        new URL(route.request().url()).searchParams.get('range'),
      ),
    }),
  );
  await page.route('https://s3.tradingview.com/**', (route) => route.abort());
}

test.beforeEach(async ({ page }) => {
  await mock(page);
});

test('defaults to domestic buy/sell lines and lets users choose genuine candles', async ({
  page,
}) => {
  await page.goto('/');
  const chart = page.getByTestId('domestic-chart');
  await expect(chart).toHaveAttribute('data-chart-mode', 'line');
  await expect(
    chart.getByRole('button', { name: '1 năm', exact: true }),
  ).toHaveCount(0);
  const readout = chart.getByTestId('chart-readout');
  await expect(readout).toContainText('146,40');
  await expect(readout).toContainText('143,40');
  await chart.getByRole('button', { name: 'Nến', exact: true }).click();
  await expect(chart).toHaveAttribute('data-chart-mode', 'candles');
  await chart.getByRole('button', { name: 'Mua vào', exact: true }).click();
  await expect(readout).toContainText('143,40');
  await page.getByRole('button', { name: 'Chỉ', exact: true }).click();
  await expect(readout).toContainText('14,34');
  await chart.getByRole('button', { name: 'Đường', exact: true }).click();
  await expect(chart).toHaveAttribute('data-chart-mode', 'line');
  await expect(readout).toContainText('14,64');
  await expect(readout).toContainText('14,34');
  const canvas = chart.getByRole('slider');
  await canvas.focus();
  await canvas.press('Home');
  await expect(readout).toContainText('15/09/2026');
  await canvas.press('ArrowRight');
  await expect(readout).toContainText('16/09/2026');
  await canvas.press('End');
  await expect(readout).toContainText('14/10/2026');
  await canvas.press('Escape');
  await chart.getByText('Xem dữ liệu', { exact: true }).click();
  await expect(chart.getByRole('table')).toBeVisible();
  await expect(chart.getByRole('row')).toHaveCount(31);
  await chart.getByRole('button', { name: '7 ngày', exact: true }).click();
  await expect(chart).toContainText('7 phiên đang xem');
  await expect(chart.getByRole('row')).toHaveCount(8);
});

for (const width of [390, 768, 1280]) {
  test(`full-width layout and controls work at ${width}px in both themes`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({
      width,
      height: width < 640 ? 844 : width < 1024 ? 1024 : 900,
    });
    await page.route('**/api/sjc?*', (route) =>
      route.fulfill({
        json: {
          ...quote,
          timestampKind: 'source',
          sourcePublishedAt: '2026-10-14T06:00:00Z',
          fetchedAt: '2026-10-14T08:00:00Z',
        },
      }),
    );
    await page.goto('/');
    const chart = page.getByTestId('domestic-chart');
    await expect(
      chart.getByRole('button', { name: 'Nến', exact: true }),
    ).toBeEnabled();
    await expect(chart).toHaveAttribute('data-chart-mode', 'line');
    await expect(
      page.getByText('Nguồn công bố giá này 2 giờ trước.', { exact: false }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.getByTestId('domestic-chart-entry').evaluate((element) => {
          const headerBottom = document
            .querySelector('.site-header')!
            .getBoundingClientRect().bottom;
          return Math.abs(
            element.getBoundingClientRect().top - headerBottom - 12,
          );
        }),
      )
      .toBeLessThan(8);
    await expect(chart.getByRole('slider')).toBeInViewport({ ratio: 0.95 });
    const entryOrder = await page.evaluate(() => {
      const chart = document.querySelector('[data-testid="domestic-chart"]')!;
      const quote = document.querySelector('.metric-card--quote')!;
      const world = document.querySelector('#vang-the-gioi')!;
      return {
        chartBeforeQuote: Boolean(
          chart.compareDocumentPosition(quote) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        chartBeforeWorld: Boolean(
          chart.compareDocumentPosition(world) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        scrolledToChart: scrollY > 0,
      };
    });
    expect(entryOrder).toEqual({
      chartBeforeQuote: true,
      chartBeforeWorld: true,
      scrolledToChart: true,
    });
    await page.screenshot({
      path: testInfo.outputPath(`entry-${width}-light.png`),
      animations: 'disabled',
    });
    await chart.scrollIntoViewIfNeeded();
    const plot = chart.getByRole('slider');
    const plotBox = (await plot.boundingBox())!;
    const summaryBox = (await chart
      .getByRole('region', { name: 'Tóm tắt xu hướng' })
      .boundingBox())!;
    expect(summaryBox.y).toBeGreaterThan(plotBox.y + plotBox.height);
    expect(plotBox.height).toBe(width < 640 ? 360 : width < 1024 ? 480 : 560);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await chart.getByRole('button', { name: 'Phóng to', exact: true }).click();
    await chart.getByRole('button', { name: 'Thu nhỏ', exact: true }).click();
    await chart
      .getByRole('button', { name: 'Đặt lại biểu đồ', exact: true })
      .click();
    await chart.screenshot({
      path: testInfo.outputPath(`domestic-${width}-light.png`),
    });
    await page
      .getByRole('button', { name: 'Chuyển sang giao diện tối' })
      .click();
    await chart.scrollIntoViewIfNeeded();
    await expect(chart).toHaveAttribute('data-chart-mode', 'line');
    await chart.screenshot({
      path: testInfo.outputPath(`domestic-${width}-dark.png`),
    });
    expect(errors).toEqual([]);
  });
}

test('positions the loading chart once and preserves the user’s view on refresh', async ({
  page,
}) => {
  let releaseQuote!: () => void;
  const pendingQuote = new Promise<void>((resolve) => {
    releaseQuote = resolve;
  });
  await page.route('**/api/sjc?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('view') === 'quote')
      await pendingQuote;
    await route.fulfill({ json: quote });
  });
  await page.goto('/');
  await expect(page.getByTestId('domestic-chart-loading')).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByTestId('domestic-chart-entry')
        .evaluate((element) =>
          Math.abs(
            element.getBoundingClientRect().top -
              document.querySelector('.site-header')!.getBoundingClientRect()
                .bottom -
              12,
          ),
        ),
    )
    .toBeLessThan(8);
  releaseQuote();
  const chart = page.getByTestId('domestic-chart');
  await expect(chart).toHaveAttribute('data-chart-mode', 'line');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().includes('/api/sjc?') &&
      response.url().includes('view=quote'),
  );
  await page.getByRole('button', { name: 'Cập nhật giá', exact: true }).click();
  await refreshed;
  await expect(
    page.getByRole('button', { name: 'Cập nhật giá', exact: true }),
  ).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page
    .getByRole('button', { name: 'Chuyển sang giao diện tối', exact: true })
    .click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('keeps partial days explicit and falls back to lines when the candle source fails', async ({
  page,
}) => {
  await page.route('**/api/market-candles?*', (route) => {
    const response = candleResponse('1T');
    return route.fulfill({
      json: {
        ...response,
        status: 'partial',
        records: response.records.slice(1),
        missingDates: [response.records[0].date],
      },
    });
  });
  await page.goto('/');
  const chart = page.getByTestId('domestic-chart');
  await expect(chart).toContainText('Lịch sử chưa đầy đủ: 29/30 ngày');
  await expect(chart).toHaveAttribute('data-chart-mode', 'line');
  await chart.getByRole('button', { name: 'Nến', exact: true }).click();
  await expect(chart).toHaveAttribute('data-chart-mode', 'candles');
  await page.route('**/api/market-candles?*', (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await chart.getByRole('button', { name: '7 ngày', exact: true }).click();
  await expect(chart).toHaveAttribute('data-chart-mode', 'line');
  await expect(chart).toContainText('Chưa có dữ liệu nến');
  await expect(
    chart.getByRole('button', { name: 'Nến', exact: true }),
  ).toBeDisabled();
  await expect(
    chart.getByRole('button', { name: 'Thử lại', exact: true }),
  ).toBeVisible();
});

test('ignores a delayed response for an obsolete range', async ({ page }) => {
  await page.route('**/api/market-candles?*', async (route) => {
    const range = new URL(route.request().url()).searchParams.get('range');
    if (range === '7N')
      await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({ json: candleResponse(range) });
  });
  await page.goto('/');
  const chart = page.getByTestId('domestic-chart');
  await expect(chart).toHaveAttribute('data-chart-mode', 'line');
  await chart.getByRole('button', { name: '7 ngày', exact: true }).click();
  await chart.getByRole('button', { name: '1 tháng', exact: true }).click();
  await expect(chart).toContainText('30 phiên đang xem');
  await page.waitForTimeout(500);
  await expect(chart).toContainText('30 phiên đang xem');
  await expect(
    chart.getByRole('button', { name: '1 tháng', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('changing the product clears the previous candle selection', async ({
  page,
}) => {
  await page.route('**/api/sjc?*', (route) => {
    const productId =
      new URL(route.request().url()).searchParams.get('product') ?? 'bar-1l';
    return route.fulfill({
      json: { ...quote, product: { ...quote.product, id: productId } },
    });
  });
  await page.route('**/api/market-candles?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({
      json: candleResponse(params.get('range'), params.get('product')!),
    });
  });
  await page.goto('/');
  const chart = page.getByTestId('domestic-chart');
  await expect(chart).toHaveAttribute('data-chart-mode', 'line');
  await chart.getByRole('button', { name: 'Nến', exact: true }).click();
  await chart.getByRole('slider').focus();
  await chart.getByRole('slider').press('Home');
  await expect(chart.getByTestId('chart-readout')).toContainText('15/09/2026');
  await page.getByRole('combobox', { name: 'Chọn loại vàng SJC' }).click();
  await page
    .getByRole('option', { name: 'Vàng miếng SJC 5 chỉ', exact: true })
    .click();
  await expect(chart).toHaveAttribute('data-chart-mode', 'line');
  await expect(chart.getByTestId('chart-readout')).toContainText('14/10/2026');
});

test('preserves the visible month when resizing from desktop to mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  const chart = page.getByTestId('domestic-chart');
  await expect(chart).toHaveAttribute('data-chart-mode', 'line');
  await page.setViewportSize({ width: 390, height: 1000 });
  await chart.getByRole('slider').hover({ position: { x: 30, y: 150 } });
  await expect(chart.getByTestId('chart-readout')).toContainText('/09/2026');
  await expect(
    chart.getByRole('button', { name: '1 tháng', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test.describe('touch interaction', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  test('tapping a candle updates the readout and page scrolling remains available', async ({
    page,
  }) => {
    await page.goto('/');
    const chart = page.getByTestId('domestic-chart');
    await expect(chart).toHaveAttribute('data-chart-mode', 'line');
    await chart.getByRole('button', { name: 'Nến', exact: true }).click();
    await expect(chart).toHaveAttribute('data-chart-mode', 'candles');
    const plot = chart.getByRole('slider');
    await plot.scrollIntoViewIfNeeded();
    const before = await chart.getByTestId('chart-readout').innerText();
    await plot.tap({ position: { x: 140, y: 150 } });
    await expect(chart.getByTestId('chart-readout')).not.toHaveText(before);
    const scroll = await page.evaluate(() => window.scrollY);
    const box = (await plot.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const x = box.x + 150;
    const y = Math.min(650, box.y + 250);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 5; step++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - step * 35 }],
      });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(scroll);
  });
});
