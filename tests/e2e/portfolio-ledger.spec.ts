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

let remoteLedger = { version: 1, transactions: [] as Array<Record<string, unknown>> };
let remoteVersion = 1;

async function login(page: import('@playwright/test').Page) {
  const token = await encode({
    secret: process.env.E2E_AUTH_SECRET ?? 'e2e-auth-secret',
    salt: 'authjs.session-token',
    token: { sub: 'e2e-ledger-flow', email: process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.test', name: 'Ledger Test' },
  });
  await page.context().addCookies([{ name: 'authjs.session-token', value: token, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }]);
}

test.beforeEach(async ({ page }) => {
  remoteVersion = 1;
  remoteLedger = { version: 1, transactions: [] };
  await login(page);
  await page.route('**/api/sjc*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(quoteFixture) }),
  );
  await page.route('**/api/portfolio/ledger', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { version: remoteVersion, ledger: remoteLedger } });
    const body = route.request().postDataJSON() as { ledger: typeof remoteLedger };
    remoteVersion += 1;
    remoteLedger = body.ledger;
    return route.fulfill({ json: { saved: true, version: remoteVersion, ledger: remoteLedger } });
  });
});

test('records, edits, filters, and deletes an account ledger transaction', async ({ page }) => {
  await page.goto('/so-vang?company=sjc&product=bar-1l&side=buy#so-vang-entry');
  await expect(page.getByRole('heading', { name: 'Sổ vàng tích sản', exact: true })).toBeVisible();
  const entry = page.locator('#so-vang-entry');
  await entry.getByRole('textbox', { name: 'Khối lượng chỉ', exact: true }).fill('2');
  await entry.getByRole('textbox', { name: 'Giá thực tế / lượng (đ)', exact: true }).fill('150000000');
  await entry.getByRole('button', { name: 'Lưu giao dịch' }).click();
  await expect(page.getByRole('heading', { name: 'Tài sản đang giữ' })).toBeVisible();
  await expect(page.getByText('1/1 giao dịch đang hiện')).toBeVisible();

  await page.getByRole('button', { name: 'Sửa giao dịch' }).click();
  await expect(page.getByRole('heading', { name: 'Sửa giao dịch' })).toBeVisible();
  await page.getByLabel('Ghi chú (không bắt buộc)').fill('Giữ dài hạn');
  await page.getByRole('button', { name: 'Cập nhật giao dịch' }).click();

  const history = page.locator('section[aria-labelledby="portfolio-history-title"]');
  await history.getByRole('combobox').first().selectOption('sell');
  await expect(page.getByText('Không có giao dịch phù hợp với bộ lọc.')).toBeVisible();
  await history.getByRole('combobox').first().selectOption('all');
  await page.getByRole('button', { name: 'Xóa giao dịch' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Xóa giao dịch' }).click();
  await page.getByRole('button', { name: 'Xóa giao dịch', exact: true }).last().click();
  await expect(page.getByText('Chưa có giao dịch. Hãy thêm lần mua đầu tiên ở trên hoặc khôi phục bản sao lưu bên dưới.')).toBeVisible();
});

test('keeps the ledger entry point visible on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.glass-bottom-nav').getByRole('link', { name: 'Sổ vàng', exact: true })).toBeVisible();
});
