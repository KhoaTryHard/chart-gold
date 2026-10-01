import { expect, test } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { shiftDate, vietnamDate } from '@/lib/analysis/dates';

const quoteFixture = {
  availability: 'available',
  mode: 'live',
  company: { id: 'sjc' },
  product: { id: 'bar-1l' },
  latest: { buy: 150, sell: 153 },
  observedAt: '2026-09-16T10:00:00.000Z',
};

let remoteLedger = {
  version: 1,
  transactions: [] as Array<Record<string, unknown>>,
};
let remoteVersion = 1;

async function login(page: import('@playwright/test').Page) {
  const token = await encode({
    secret: process.env.E2E_AUTH_SECRET ?? 'e2e-auth-secret',
    salt: 'authjs.session-token',
    token: {
      sub: 'e2e-ledger-flow',
      email: process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.test',
      name: 'Ledger Test',
    },
  });
  await page.context().addCookies([
    {
      name: 'authjs.session-token',
      value: token,
      url: 'http://127.0.0.1:3000',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

test.beforeEach(async ({ page }) => {
  remoteVersion = 1;
  remoteLedger = { version: 1, transactions: [] };
  await login(page);
  await page.route('**/api/sjc*', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...quoteFixture,
        company: { id: url.searchParams.get('company') ?? 'sjc' },
        product: { id: url.searchParams.get('product') ?? 'bar-1l' },
      }),
    });
  });
  await page.route('**/api/market-quote*', (route) => {
    const url = new URL(route.request().url());
    const companyId = url.searchParams.get('company') ?? 'sjc';
    const productId = url.searchParams.get('product') ?? 'bar-1l';
    const date = url.searchParams.get('date') ?? '';
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const status =
      date > today ? 'unavailable' : date === today ? 'current' : 'historical';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        companyId,
        productId,
        requestedDate: date,
        quoteDate: status === 'unavailable' ? null : date,
        buyVndPerLuong:
          status === 'unavailable'
            ? null
            : companyId === 'btmh'
              ? 140_000_000
              : 150_000_000,
        sellVndPerLuong:
          status === 'unavailable'
            ? null
            : companyId === 'btmh'
              ? 145_000_000
              : 153_000_000,
        status,
        source: {
          provider: companyId === 'btmh' ? 'BTMH official' : 'SJC official',
          url: 'https://example.test/quote',
          official: true,
        },
        observedAt: `${date}T02:00:00.000Z`,
        expiresAt: new Date(Date.now() + 240_000).toISOString(),
        reason:
          status === 'unavailable'
            ? 'Ngày giao dịch ở tương lai chưa có báo giá.'
            : null,
      }),
    });
  });
  await page.route('**/api/portfolio/ledger', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: { version: remoteVersion, ledger: remoteLedger },
      });
    const body = route.request().postDataJSON() as {
      ledger: typeof remoteLedger;
    };
    remoteVersion += 1;
    remoteLedger = body.ledger;
    return route.fulfill({
      json: { saved: true, version: remoteVersion, ledger: remoteLedger },
    });
  });
});

test('records, edits, filters, and deletes an account ledger transaction', async ({
  page,
}) => {
  await page.goto('/so-vang?company=sjc&product=bar-1l&side=buy#so-vang-entry');
  await expect(
    page.getByRole('heading', { name: 'Sổ vàng tích sản', exact: true }),
  ).toBeVisible();
  const entry = page.locator('#so-vang-entry');
  await entry
    .getByRole('textbox', { name: 'Khối lượng chỉ', exact: true })
    .fill('2');
  await entry
    .getByRole('textbox', { name: 'Giá thực tế / chỉ (đ)', exact: true })
    .fill('15000000');
  await entry.getByRole('button', { name: 'Lưu giao dịch' }).click();
  await expect(
    page.getByRole('heading', { name: 'Tài sản đang giữ' }),
  ).toBeVisible();
  await expect(page.getByText('1/1 giao dịch đang hiện')).toBeVisible();
  await expect(
    page.getByRole('textbox', {
      name: 'Giá thực tế / chỉ (đ)',
      exact: true,
    }),
  ).toHaveValue('');

  await page.getByRole('button', { name: 'Sửa giao dịch' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sửa giao dịch' }),
  ).toBeVisible();
  await page.getByLabel('Ghi chú (không bắt buộc)').fill('Giữ dài hạn');
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Cập nhật giao dịch' }).click(),
  ]);

  const history = page.locator(
    'section[aria-labelledby="portfolio-history-title"]',
  );
  const historySide = history.getByRole('combobox').first();
  await historySide.selectOption('sell');
  await expect(historySide).toHaveValue('sell');
  await expect(
    page.getByText('Không có giao dịch phù hợp với bộ lọc.'),
  ).toBeVisible();
  await history.getByRole('combobox').first().selectOption('all');
  await page.getByRole('button', { name: 'Xóa giao dịch' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Xóa giao dịch' }).click();
  await page
    .getByRole('button', { name: 'Xóa giao dịch', exact: true })
    .last()
    .click();
  await expect(
    page.getByText(
      'Chưa có giao dịch. Hãy thêm lần mua đầu tiên ở trên hoặc khôi phục bản sao lưu bên dưới.',
    ),
  ).toBeVisible();
});

test('keeps the ledger entry point visible on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page
      .locator('.glass-bottom-nav')
      .getByRole('link', { name: 'Sổ vàng', exact: true }),
  ).toBeVisible();
});

test('records a BTMH product from the shared catalogue and disables buy-only products', async ({
  page,
}) => {
  await page.goto(
    '/so-vang?company=btmh&product=btmh-kgb&side=buy#so-vang-entry',
  );
  const entry = page.locator('#so-vang-entry');
  const brand = entry.getByRole('combobox', { name: 'Thương hiệu' });
  const product = entry.getByRole('combobox', { name: 'Sản phẩm' });

  await expect(brand).toHaveValue('btmh');
  await expect(product).toHaveValue('btmh-kgb');
  await expect(product.locator('option[value="btmh-bt-tkc"]')).toBeEnabled();
  await expect(product.locator('option[value="btmh-kgbg"]')).toBeEnabled();
  await expect(product.locator('option[value="btmh-khs"]')).toBeEnabled();
  await expect(product.locator('option[value="btmh-sjc9999"]')).toBeEnabled();
  await expect(product.locator('option[value="btmh-9999"]')).toBeEnabled();
  await expect(product.locator('option[value="btmh-999"]')).toBeEnabled();
  for (const id of ['btmh-bt24k', 'btmh-vrtl', 'btmh-nl9999', 'btmh-nl999'])
    await expect(product.locator(`option[value="${id}"]`)).toHaveAttribute(
      'disabled',
      '',
    );

  await entry
    .getByRole('textbox', { name: 'Khối lượng chỉ', exact: true })
    .fill('1');
  await entry
    .getByRole('textbox', { name: 'Giá thực tế / chỉ (đ)', exact: true })
    .fill('14000000');
  await entry.getByRole('button', { name: 'Lưu giao dịch' }).click();

  await expect
    .poll(() => remoteLedger.transactions[0])
    .toMatchObject({
      companyId: 'btmh',
      productId: 'btmh-kgb',
      unitPriceVnd: 140_000_000,
    });
  await expect(
    entry.getByRole('combobox', { name: 'Thương hiệu' }),
  ).toHaveValue('btmh');
  await expect(entry.getByRole('combobox', { name: 'Sản phẩm' })).toHaveValue(
    'btmh-kgb',
  );
});

test('autofills the selected dealer side, converts units, and keeps manual edits', async ({
  page,
}) => {
  await page.goto(
    '/so-vang?company=btmh&product=btmh-kgb&side=buy#so-vang-entry',
  );
  const entry = page.locator('#so-vang-entry');
  const side = entry.getByRole('combobox', { name: 'Loại' });
  const unit = entry.getByRole('combobox', { name: 'Đơn vị' });
  const priceChi = entry.getByRole('textbox', {
    name: 'Giá thực tế / chỉ (đ)',
    exact: true,
  });

  await expect(unit.locator('option')).toHaveCount(2);
  await expect(unit.locator('option')).toHaveText(['chỉ', 'lượng']);
  await entry
    .getByRole('textbox', { name: 'Khối lượng chỉ', exact: true })
    .fill('1');
  await expect(priceChi).toHaveValue('14.500.000');
  await expect(entry.getByText(/giá cửa hàng bán ra/)).toBeVisible();

  await unit.selectOption('luong');
  const priceLuong = entry.getByRole('textbox', {
    name: 'Giá thực tế / lượng (đ)',
    exact: true,
  });
  await expect(priceLuong).toHaveValue('145.000.000');
  await side.selectOption('sell');
  await expect(priceLuong).toHaveValue('140.000.000');
  await priceLuong.fill('130000000');
  await side.selectOption('buy');
  await expect(priceLuong).toHaveValue('130000000');

  await entry.getByRole('button', { name: 'Dùng giá niêm yết' }).click();
  await expect(priceLuong).toHaveValue('145.000.000');
});

test('autofills an exact historical date and does not substitute another day', async ({
  page,
}) => {
  await page.goto(
    '/so-vang?company=btmh&product=btmh-kgb&side=buy#so-vang-entry',
  );
  const entry = page.locator('#so-vang-entry');
  await entry
    .getByRole('textbox', { name: 'Khối lượng chỉ', exact: true })
    .fill('1');
  await entry.getByLabel('Ngày').fill('2026-09-29');
  const price = entry.getByRole('textbox', {
    name: 'Giá thực tế / chỉ (đ)',
    exact: true,
  });
  await expect(price).toHaveValue('14.500.000');
  await expect(entry.getByText(/Giá lịch sử/)).toBeVisible();
});

test('does not keep today’s quote when the selected date has no quote', async ({
  page,
}) => {
  await page.goto(
    '/so-vang?company=btmh&product=btmh-kgb&side=buy#so-vang-entry',
  );
  const entry = page.locator('#so-vang-entry');
  const price = entry.getByRole('textbox', {
    name: 'Giá thực tế / chỉ (đ)',
    exact: true,
  });
  await entry
    .getByRole('textbox', { name: 'Khối lượng chỉ', exact: true })
    .fill('1');
  await expect(price).toHaveValue('14.500.000');
  await entry.getByLabel('Ngày').fill(shiftDate(vietnamDate(), 1));
  await expect(price).toHaveValue('');
  await expect(entry.getByText(/Ngày giao dịch ở tương lai/)).toBeVisible();
});

test('keeps a manual price entered while the quote is still loading', async ({
  page,
}) => {
  await page.route('**/api/market-quote*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('company') === 'btmh')
      await new Promise((resolve) => setTimeout(resolve, 350));
    const companyId = url.searchParams.get('company') ?? 'btmh';
    const productId = url.searchParams.get('product') ?? 'btmh-kgb';
    const date = url.searchParams.get('date') ?? '2026-09-30';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: {
        companyId,
        productId,
        requestedDate: date,
        quoteDate: date,
        buyVndPerLuong: 140_000_000,
        sellVndPerLuong: 145_000_000,
        status: 'current',
        source: { provider: 'BTMH official', url: null, official: true },
        observedAt: `${date}T02:00:00.000Z`,
        expiresAt: new Date(Date.now() + 240_000).toISOString(),
        reason: null,
      },
    });
  });
  await page.goto(
    '/so-vang?company=btmh&product=btmh-kgb&side=buy#so-vang-entry',
  );
  const entry = page.locator('#so-vang-entry');
  const price = entry.getByRole('textbox', {
    name: 'Giá thực tế / chỉ (đ)',
    exact: true,
  });
  await entry
    .getByRole('textbox', { name: 'Khối lượng chỉ', exact: true })
    .fill('1');
  await price.fill('13000000');
  await expect(price).toHaveValue('13000000');
  await page.waitForTimeout(500);
  await expect(price).toHaveValue('13000000');
});

test('keeps the autofill controls usable on a mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    '/so-vang?company=btmh&product=btmh-kgb&side=buy#so-vang-entry',
  );
  const entry = page.locator('#so-vang-entry');
  await entry
    .getByRole('textbox', { name: 'Khối lượng chỉ', exact: true })
    .fill('1');
  await expect(
    entry.getByRole('textbox', {
      name: 'Giá thực tế / chỉ (đ)',
      exact: true,
    }),
  ).toHaveValue('14.500.000');
  await expect(
    entry.getByRole('button', { name: 'Dùng giá niêm yết' }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test('editing a legacy transaction preserves its canonical VND per-lượng price', async ({
  page,
}) => {
  remoteLedger = {
    version: 1,
    transactions: [
      {
        id: 'btmh-legacy-price',
        date: vietnamDate(),
        side: 'buy',
        companyId: 'btmh',
        productId: 'btmh-kgb',
        quantityLuong: 0.1,
        unitPriceVnd: 150_000_001,
        feesVnd: 0,
        note: '',
      },
    ],
  };
  await page.goto('/so-vang#so-vang-entry');
  await page.getByRole('button', { name: 'Sửa giao dịch' }).click();
  const price = page.getByRole('textbox', {
    name: 'Giá thực tế / chỉ (đ)',
    exact: true,
  });
  await expect(price).toHaveValue('15.000.000');
  await page.getByRole('button', { name: 'Cập nhật giao dịch' }).click();
  await expect
    .poll(() => remoteLedger.transactions[0]?.unitPriceVnd)
    .toBe(150_000_001);
});
