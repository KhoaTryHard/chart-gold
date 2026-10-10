import { expect, test } from '@playwright/test';

const company = {
  id: 'sjc',
  name: 'SJC',
  shortName: 'SJC',
  websiteUrl: 'https://sjc.com.vn',
  sourceUrl: 'https://www.vang.today/vi/api',
  officialSourceUrl: 'https://sjc.com.vn/xml/tygiavang.xml',
  provider: 'SJC official + Vang.Today history',
  supportsOfficialQuote: true,
  maxHistoryDays: 365,
  adapter: 'sjc-official',
};

const product = {
  id: 'bar-1l',
  group: 'Vàng miếng SJC',
  label: 'Vàng miếng SJC 1 lượng',
  shortLabel: 'Miếng 1 lượng',
  unitLabel: '1 lượng',
  upstreamCode: 'SJL1L10',
  seriesId: 'bar',
  weightInLuong: 1,
  officialMatch: 'Vàng SJC 1L - 10L',
};

const historyRecords = Array.from({ length: 30 }, (_, index) => {
  const day = String(index + 1).padStart(2, '0');
  const buy = 140 + index / 10;
  const sell = buy + 3;
  return {
    date: `2026-08-${day}`,
    buy,
    sell,
    spread: 3,
    eventId: null,
  };
});

const historyResponse = {
  mode: 'delayed',
  availability: 'available',
  unavailableReason: null,
  company,
  product,
  products: [product],
  records: historyRecords,
  latest: historyRecords.at(-1),
  observedAt: '2026-08-30T12:00:00+07:00',
  source: {
    provider: 'Vàng.Today',
    url: 'https://www.vang.today/vi/api',
    official: false,
  },
  historySource: {
    provider: 'Vàng.Today',
    url: 'https://www.vang.today/vi/api',
  },
  generatedAt: '2026-08-30T12:00:00+07:00',
  expiresAt: '2026-08-30T12:04:00+07:00',
};

const quoteResponse = {
  ...historyResponse,
  mode: 'live',
  records: [
    {
      date: '2026-08-30',
      buy: 145,
      sell: 148,
      spread: 3,
      eventId: null,
    },
  ],
  latest: {
    date: '2026-08-30',
    buy: 145,
    sell: 148,
    spread: 3,
    eventId: null,
  },
  observedAt: '2026-08-30T13:00:00+07:00',
  source: { provider: 'SJC', url: 'https://sjc.com.vn', official: true },
};

test('separates Sunday retrieval from Saturday publication without assuming a source outage', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-04T08:30:00Z'));
  await page.route('**/api/sjc?*', (route) => route.fulfill({ json: {
    ...quoteResponse,
    timestampKind: 'source',
    observedAt: '2026-10-03T00:57:00Z',
    sourcePublishedAt: '2026-10-03T00:57:00Z',
    fetchedAt: '2026-10-04T08:29:00Z',
    // Deliberately stale computed metadata: UI must use timestamps instead.
    freshness: { evaluatedAt: '2026-10-03T00:57:00Z', recordAgeSeconds: 0, sourceAgeSeconds: 0 },
  } }));
  await page.goto('/');
  const status = page.getByLabel('Trạng thái nguồn giá');
  await expect(status).toContainText('Giá công bố gần nhất');
  await expect(status).toContainText('Nguồn công bố');
  await expect(status).toContainText('1 ngày trước');
  await expect(status).toContainText('Hệ thống lấy dữ liệu');
  await expect(status).toContainText(/03[/-]10/);
  await expect(status).toContainText(/04[/-]10/);
  await expect(page.getByText('Nguồn đang trễ', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Nguồn giá đang cập nhật chậm hơn bình thường/)).toHaveCount(0);
});

test('does not label retrieval-only time as source publication', async ({ page }) => {
  await page.route('**/api/sjc?*', (route) => route.fulfill({ json: {
    ...quoteResponse, timestampKind: 'retrieval-or-date', fetchedAt: quoteResponse.generatedAt,
  } }));
  await page.goto('/');
  const status = page.getByLabel('Trạng thái nguồn giá');
  await expect(status).toContainText('Ghi nhận');
  await expect(status).toContainText('Hệ thống lấy dữ liệu');
  await expect(status).not.toContainText('Nguồn công bố');
});

test('explains the price page before the picker and updates prices and chart units together', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/sjc?*', (route) =>
    route.fulfill({ json: historyResponse }),
  );
  await page.goto('/');

  const dashboard = page.locator('.market-main:visible').first();
  const title = dashboard.getByRole('heading', { name: 'Giá vàng hôm nay', exact: true });
  const picker = dashboard.locator('.market-selection:visible');
  await expect(title).toBeVisible();
  await expect(dashboard.locator('.market-intro p').first()).toContainText('Xem số tiền bạn cần trả khi mua và khoản có thể nhận khi bán.');
  const titleTop = await title.evaluate((element) => element.getBoundingClientRect().top);
  const pickerTop = await picker.evaluate((element) => element.getBoundingClientRect().top);
  expect(titleTop).toBeLessThan(pickerTop);
  await expect(dashboard.locator('.metric-card--quote .metric-value__unit').first()).toHaveText('đ / lượng');

  await dashboard.getByRole('button', { name: 'Chỉ', exact: true }).click();
  await expect(dashboard.locator('.metric-card--quote .metric-value__unit').first()).toHaveText('đ / chỉ');
  const chart = dashboard.locator('.glass-panel:visible').filter({
    has: page.getByRole('heading', { name: /Biểu đồ giá/ }),
  });
  await expect(chart.getByText('triệu đồng / chỉ', { exact: false })).toBeVisible();
});

test('keeps one-month history after a delayed quote response arrives', async ({
  page,
}) => {
  let quoteFulfilled = false;
  await page.route('**/api/sjc?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('view') === 'history') {
      await route.fulfill({ json: historyResponse });
      return;
    }
    if (url.searchParams.get('view') === 'quote') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      quoteFulfilled = true;
      await route.fulfill({ json: quoteResponse });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await expect.poll(() => quoteFulfilled).toBe(true);
  const chart = page.getByLabel('Biểu đồ giá miếng 1 lượng trong 1 tháng');
  await expect(chart.getByText(/30 phiên đang xem/)).toBeVisible();
});
