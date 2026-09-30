import { expect, test } from '@playwright/test';

const compareFixture = {
  set: 'sjc-bar',
  label: 'Vàng miếng SJC',
  unit: 'luong',
  comparisonMode: 'same-group',
  generatedAt: '2026-09-09T10:00:00.000Z',
  rows: [
    {
      id: 'sjc:bar-1l',
      companyId: 'sjc',
      productId: 'bar-1l',
      company: 'SJC',
      product: 'Miếng 1 lượng',
      group: 'bar',
      productGroup: 'bar',
      category: 'bar',
      purity: '9999',
      region: 'TP.HCM',
      latest: { buy: 145, sell: 148, spread: 3 },
      mode: 'live',
      availability: 'available',
      unavailableReason: null,
      observedAt: '2026-09-09T10:00:00.000Z',
      source: { provider: 'SJC', url: null, official: true },
      rankingEligible: true,
    },
    {
      id: 'pnj:pnj-sjc-hcm',
      companyId: 'pnj',
      productId: 'pnj-sjc-hcm',
      company: 'PNJ',
      product: 'Miếng SJC',
      group: 'bar',
      productGroup: 'bar',
      category: 'bar',
      purity: '9999',
      region: 'TP.HCM',
      latest: { buy: 144, sell: 147, spread: 3 },
      mode: 'live',
      availability: 'available',
      unavailableReason: null,
      observedAt: '2026-09-09T10:00:00.000Z',
      source: { provider: 'PNJ', url: null, official: true },
      rankingEligible: true,
    },
  ],
};

const allRowsCompareFixture = {
  ...compareFixture,
  rows: [
    ...compareFixture.rows,
    {
      ...compareFixture.rows[0],
      id: 'btmc:bar-1l',
      companyId: 'btmc',
      productId: 'bar-1l',
      company: 'Bảo Tín Minh Châu',
      product: 'Vàng miếng SJC',
      latest: { buy: 143, sell: 146, spread: 3 },
    },
    {
      ...compareFixture.rows[0],
      id: 'phu-quy:bar-1l',
      companyId: 'phu-quy',
      productId: 'bar-1l',
      company: 'Phú Quý',
      product: 'Vàng miếng SJC',
      latest: { buy: 142, sell: 145, spread: 3 },
    },
  ],
};

test('shows every comparable row by default on the gold tools route', async ({
  page,
}) => {
  await page.route('**/api/compare*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(allRowsCompareFixture),
    }),
  );
  await page.goto('/cong-cu-vang');

  const comparison = page.locator('#so-sanh');
  await expect(
    comparison.getByRole('button', { name: 'Chỉ hiện đã chọn', exact: true }),
  ).toBeVisible();
  await expect(comparison.locator('.compare-table tbody tr')).toHaveCount(4);
});

test('starts with a plain-language intent picker and focuses one tool for a first-time user', async ({
  page,
}) => {
  await page.route('**/api/compare*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(compareFixture),
    }),
  );
  await page.route('**/api/sjc*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        buy: 142_000_000,
        sell: 145_000_000,
        observedAt: '2026-09-09T10:00:00.000Z',
        mode: 'live',
        availability: 'available',
        company: { id: 'sjc' },
        product: { id: 'bar-1l' },
        source: { provider: 'SJC', url: null },
      }),
    }),
  );
  await page.goto('/cong-cu-vang');

  await expect(
    page.getByRole('heading', { name: 'Bạn muốn làm gì với vàng?', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Tôi muốn mua vàng/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Tôi muốn bán vàng/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Tính lời hoặc lỗ/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Tính lãi/lỗ và hòa vốn', exact: true }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: /Tính lời hoặc lỗ/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Tính lãi/lỗ và hòa vốn', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#so-sanh')).toBeHidden();
  await expect(page.locator('#purchase-1-quantity')).toBeVisible();
});

test('keeps the first-time mobile flow readable without horizontal scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/compare*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(compareFixture),
    }),
  );
  await page.goto('/cong-cu-vang');

  await expect(
    page.getByRole('heading', { name: 'Bạn muốn làm gì với vàng?', exact: true }),
  ).toBeVisible();
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewport + 1);
  await expect(page.getByRole('button', { name: /Tôi muốn mua vàng/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('does not show a zero result before a calculator input is complete', async ({
  page,
}) => {
  await page.route('**/api/sjc*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        buy: 140_000_000,
        sell: 145_000_000,
        observedAt: '2026-09-09T10:00:00.000Z',
        timestampKind: 'source',
        mode: 'live',
        availability: 'available',
        company: { id: 'sjc' },
        product: { id: 'bar-1l' },
        source: { provider: 'SJC', url: null },
      }),
    }),
  );
  await page.goto('/cong-cu-vang?tool=lai-lo');

  await expect(
    page.getByText('Nhập khối lượng và tổng tiền đã trả để xem kết quả.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('Hòa vốn 0đ', { exact: true })).toHaveCount(0);

  await page.locator('#purchase-1-quantity').fill('2');
  await page.locator('#purchase-1-price').fill('29000000');
  await expect(
    page.getByText('Tiền bạn nhận sau phí', { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[aria-live="polite"]').filter({ hasText: 'Tiền bạn nhận sau phí' }).last(),
  ).toContainText('29.000.000 đ');
});

test('merges comparison and calculator into one route', async ({ page }) => {
  await page.route('**/api/compare*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(compareFixture),
    }),
  );
  await page.goto('/cong-cu-vang?tool=so-sanh');

  await expect(page.locator('#tool-page-title').first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'So sánh giá vàng', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Tính lãi/lỗ và hòa vốn', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('.glass-nav--desktop')
      .getByRole('link', { name: 'Công cụ', exact: true }),
  ).toHaveAttribute('aria-current', 'page');

  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewport);

  await page
    .locator('#so-sanh')
    .getByRole('link', { name: 'Tính lãi/lỗ và hòa vốn', exact: true })
    .click();
  await expect.poll(() => new URL(page.url()).hash).toBe('#hoa-von');
  const linkedUrl = new URL(page.url());
  expect(linkedUrl.pathname).toBe('/cong-cu-vang');
  expect(linkedUrl.searchParams.get('tool')).toBe('lai-lo');
  expect(linkedUrl.searchParams.get('company')).toBe('pnj');
  expect(linkedUrl.searchParams.get('product')).toBe('pnj-sjc-hcm');
  expect(linkedUrl.searchParams.get('quantity')).toBe('1');
  expect(linkedUrl.searchParams.get('unit')).toBe('luong');
});

test('redirects old tool URLs once and preserves their query parameters', async ({
  page,
}) => {
  await page.goto(
    '/so-sanh?set=ring-9999&direction=sell&products=sjc:ring-1c&quantity=2&unit=chi',
  );
  const comparisonUrl = new URL(page.url());
  expect(comparisonUrl.pathname).toBe('/cong-cu-vang');
  expect(comparisonUrl.hash).toBe('#so-sanh');
  expect(comparisonUrl.searchParams.get('tool')).toBe('so-sanh');
  expect(comparisonUrl.searchParams.get('set')).toBe('ring-9999');
  expect(comparisonUrl.searchParams.get('direction')).toBe('sell');
  expect(comparisonUrl.searchParams.get('quantity')).toBe('2');
  expect(comparisonUrl.searchParams.get('unit')).toBe('chi');

  await page.goto(
    '/quy-doi?company=sjc&product=bar-1l&quantity=2&unit=chi&cost=140000000&buyback=138000000',
  );
  const calculatorUrl = new URL(page.url());
  expect(calculatorUrl.pathname).toBe('/cong-cu-vang');
  expect(calculatorUrl.hash).toBe('#hoa-von');
  expect(calculatorUrl.searchParams.get('tool')).toBe('lai-lo');
  expect(calculatorUrl.searchParams.get('company')).toBe('sjc');
  expect(calculatorUrl.searchParams.get('product')).toBe('bar-1l');
  expect(calculatorUrl.searchParams.get('cost')).toBe('140000000');
  expect(calculatorUrl.searchParams.get('buyback')).toBe('138000000');
});

test('infers the receiving tool from unqualified share parameters', async ({
  page,
}) => {
  await page.route('**/api/compare*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(compareFixture),
    }),
  );
  await page.route('**/api/sjc*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        buy: 145000000,
        sell: 148000000,
        observedAt: '2026-09-09T10:00:00.000Z',
      }),
    }),
  );
  await page.goto(
    '/cong-cu-vang?company=sjc&product=bar-1l&quantity=2&unit=chi&cost=140000000&buyback=138000000',
  );

  await expect(page.locator('#purchase-1-quantity')).toHaveValue('2');
  await expect(page.locator('#purchase-1-unit')).toHaveValue('chi');
  await expect(page.locator('#compare-quantity')).toHaveValue('1');
  await expect(page.locator('#compare-unit')).toHaveValue('luong');
});

test('asks before replacing an existing calculator draft from a comparison link', async ({
  page,
}) => {
  await page.route('**/api/compare*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(compareFixture),
    }),
  );
  await page.route('**/api/sjc*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        buy: 145000000,
        sell: 148000000,
        observedAt: '2026-09-09T10:00:00.000Z',
      }),
    }),
  );
  await page.goto('/cong-cu-vang?tool=so-sanh');
  await page.locator('#purchase-1-quantity').fill('3');
  await page.locator('#purchase-1-price').fill('140000000');
  await page
    .locator('#so-sanh')
    .getByRole('link', { name: 'Tính lãi/lỗ và hòa vốn', exact: true })
    .click();

  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Liên kết từ bảng so sánh có dữ liệu mới' }),
  ).toBeVisible();
  await expect(page.locator('#purchase-1-quantity')).toHaveValue('3');
  await page.getByRole('button', { name: 'Giữ bản tính', exact: true }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Liên kết từ bảng so sánh có dữ liệu mới' }),
  ).toHaveCount(0);
  await expect(page.locator('#purchase-1-quantity')).toHaveValue('3');
});

test('keeps the three specialist comparison pages available', async ({
  request,
}) => {
  for (const slug of [
    'nhan-9999',
    'vang-mieng-sjc',
    'nhan-9999-va-vang-mieng-sjc',
  ]) {
    const response = await request.get(`/so-sanh/${slug}`);
    expect(response.status(), slug).toBe(200);
  }
});
