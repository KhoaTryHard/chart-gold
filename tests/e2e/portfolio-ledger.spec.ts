import { expect, test } from '@playwright/test';
import { encode } from 'next-auth/jwt';

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
    .getByRole('textbox', { name: 'Giá thực tế / lượng (đ)', exact: true })
    .fill('150000000');
  await entry.getByRole('button', { name: 'Lưu giao dịch' }).click();
  await expect(
    page.getByRole('heading', { name: 'Tài sản đang giữ' }),
  ).toBeVisible();
  await expect(page.getByText('1/1 giao dịch đang hiện')).toBeVisible();

  await page.getByRole('button', { name: 'Sửa giao dịch' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sửa giao dịch' }),
  ).toBeVisible();
  await page.getByLabel('Ghi chú (không bắt buộc)').fill('Giữ dài hạn');
  await page.getByRole('button', { name: 'Cập nhật giao dịch' }).click();

  const history = page.locator(
    'section[aria-labelledby="portfolio-history-title"]',
  );
  await history.getByRole('combobox').first().selectOption('sell');
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
    .getByRole('textbox', { name: 'Giá thực tế / lượng (đ)', exact: true })
    .fill('140000000');
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
