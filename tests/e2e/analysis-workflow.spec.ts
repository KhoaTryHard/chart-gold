import { test, expect, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

async function login(page: Page) {
  const token = await encode({
    secret: process.env.E2E_AUTH_SECRET ?? 'e2e-auth-secret',
    salt: 'authjs.session-token',
    token: {
      sub: 'e2e-ai-flow',
      email: process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.test',
      name: 'AI Flow Test',
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
const adminAccess = {
  authenticated: true,
  canAnalyze: true,
  isAdmin: true,
  capabilities: ['standard', 'portfolio', 'research', 'deep'],
  remaining: null,
  unlimited: true,
  salesEnabled: false,
  message: 'Có quyền sử dụng AI.',
  code: null,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/portfolio/ledger', (route) =>
    route.fulfill({
      json: {
        version: 1,
        ledger: {
          version: 1,
          transactions: [{
            id: 'e2e-ledger-buy',
            date: '2026-09-25',
            side: 'buy',
            companyId: 'sjc',
            productId: 'bar-1l',
            quantityLuong: 1,
            unitPriceVnd: 145000000,
            feesVnd: 0,
            note: '',
          }],
        },
      },
    }),
  );
});

test('signed-in user completes prepare → analysis without another OAuth redirect', async ({
  page,
}) => {
  await login(page);
  let calls = 0;
  await page.route('**/api/analysis/prepare', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { access: adminAccess } });
    return route.fulfill({ json: { ready: true, authenticated: true, access: adminAccess, needs: [] } });
  });
  await page.route('**/api/analysis', async (route) => {
    calls++;
    expect(route.request().postDataJSON().goal).toBe('hold');
    await route.fulfill({
      contentType: 'text/event-stream',
      body: 'event: delta\ndata: {"type":"delta","delta":"Đã tính theo giá thu mua và phí đã khai."}\n\nevent: done\ndata: {"type":"done","model":"test","completion":"complete","requestId":"flow-test"}\n\n',
    });
  });
  await page.goto('/phan-tich');
  await expect(
    page.getByRole('button', { name: 'Mở menu tài khoản' }),
  ).toBeVisible();
  await expect(page.getByText('Thông tin lượt này', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Khoảng thời gian', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Phân tích', exact: true }).click();
  await expect(
    page.getByText('Đã tính theo giá thu mua và phí đã khai.', { exact: true }),
  ).toBeVisible();
  expect(calls).toBe(1);
  await expect(page).toHaveURL(/\/phan-tich$/);
});

test('places data notes after the explanation and keeps them collapsed by default', async ({
  page,
}) => {
  await login(page);
  await page.route('**/api/analysis/prepare', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { access: adminAccess } });
    return route.fulfill({
      json: {
        ready: true,
        authenticated: true,
        access: adminAccess,
        needs: [],
      },
    });
  });
  await page.route('**/api/analysis', async (route) => {
    await route.fulfill({
      contentType: 'text/event-stream',
      body: [
        'event: decision\ndata: {"type":"decision","payload":{"responseVersion":2,"headline":"Đủ dữ liệu để tham khảo.","stance":"review","summary":"Kết luận phụ thuộc vào các điều kiện hiển thị.","conditions":["Xác nhận lại giá mua vào."],"factKeys":[],"nextSteps":["So sánh giá mua vào"]}}\n\n',
        'event: delta\ndata: {"type":"delta","delta":"Giải thích từ AI."}\n\n',
        'event: done\ndata: {"type":"done","model":"test","completion":"complete"}\n\n',
      ].join(''),
    });
  });
  await page.goto('/phan-tich');
  await page.getByRole('button', { name: 'Phân tích', exact: true }).click();
  await expect(page.getByText('Giải thích từ AI.', { exact: true })).toBeVisible();

  const notes = page.locator('details').filter({ hasText: 'Lưu ý theo dữ liệu' });
  await expect(notes).toHaveCount(1);
  await expect(notes).not.toHaveAttribute('open');
  await expect(page.getByText('Đủ dữ liệu để tham khảo.', { exact: true })).toBeHidden();

  await notes.locator('summary').focus();
  await notes.locator('summary').press('Enter');
  await expect(notes).toHaveAttribute('open', '');
  await expect(page.getByText('Đủ dữ liệu để tham khảo.', { exact: true })).toBeVisible();
  await expect(page.getByText('Xác nhận lại giá mua vào.', { exact: true })).toBeVisible();
});

test('replaces an interrupted partial answer after the reset event', async ({ page }) => {
  await login(page);
  await page.route('**/api/analysis/prepare', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { access: adminAccess } });
    return route.fulfill({ json: { ready: true, authenticated: true, access: adminAccess, needs: [] } });
  });
  await page.route('**/api/analysis', async (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: [
        'data: {"type":"delta","delta":"Nội dung dở dang"}\n\n',
        'data: {"type":"reset","attempt":1,"message":"Kết nối AI bị gián đoạn, đang thử lại…"}\n\n',
        'data: {"type":"delta","delta":"Kết quả mới"}\n\n',
        'data: {"type":"done","model":"retry","completion":"complete","requestId":"retry-1"}\n\n',
      ].join(''),
    }),
  );
  await page.goto('/phan-tich');
  await page.getByRole('button', { name: 'Phân tích', exact: true }).click();
  await expect(page.getByText('Kết quả mới', { exact: true })).toBeVisible();
  await expect(page.getByText('Nội dung dở dang', { exact: true })).toHaveCount(0);
});

test('uses the signed-in account ledger for hold analysis without manual inputs', async ({ page }) => {
  await login(page);
  await page.route('**/api/portfolio/ledger', (route) =>
    route.fulfill({
      json: {
        version: 4,
        ledger: {
          version: 1,
          transactions: [{
            id: 'ledger-buy-1',
            date: '2026-09-25',
            side: 'buy',
            companyId: 'sjc',
            productId: 'bar-1l',
            quantityLuong: 0.1,
            unitPriceVnd: 145000000,
            feesVnd: 0,
            note: '',
          }],
        },
      },
    }),
  );
  await page.goto('/phan-tich?preset=hold');
  await expect(page.getByText('Sổ vàng của bạn', { exact: true })).toBeVisible();
  await expect(page.getByText(/Đang giữ 0\.1000 lượng/)).toBeVisible();
  await expect(page.getByLabel('Số lượng (lượng)', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Giá vốn (triệu/lượng)', { exact: true })).toHaveCount(0);
});

test('server session failure never triggers OAuth; retries and double clicks are bounded', async ({
  page,
}) => {
  await login(page);
  let posts = 0;
  let oauth = 0;
  page.on('request', (req) => {
    if (req.url().includes('/api/auth/signin')) oauth++;
  });
  await page.route('**/api/analysis/prepare', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { access: adminAccess } });
    posts++;
    await new Promise((resolve) => setTimeout(resolve, 150));
    return route.fulfill({
      status: 503,
      json: {
        code: 'SESSION_UNAVAILABLE',
        error: 'Không kiểm tra được phiên đăng nhập.',
      },
    });
  });
  await page.goto('/phan-tich');
  await expect(
    page.getByRole('button', { name: 'Mở menu tài khoản' }),
  ).toBeVisible();
  await page
    .getByLabel('Câu hỏi phân tích', { exact: true })
    .fill('Giá vàng hôm nay?');
  await page.getByRole('button', { name: 'Phân tích', exact: true }).dblclick();
  await expect(
    page
      .locator('[role="alert"]')
      .filter({ hasText: 'Không kiểm tra được phiên' }),
  ).toBeVisible();
  expect(posts).toBe(1);
  expect(oauth).toBe(0);
});

test('expired server session shows an explicit login action instead of redirecting in a loop', async ({
  page,
}) => {
  await login(page);
  await page.route('**/api/analysis/prepare', async (route) =>
    route.fulfill({
      json: {
        access: {
          ...adminAccess,
          authenticated: false,
          canAnalyze: false,
          code: 'AUTH_REQUIRED',
          message: 'Đăng nhập lại.',
        },
        authenticated: false,
        ready: false,
        needs: [],
      },
    }),
  );
  await page.goto('/phan-tich');
  await expect(
    page.getByRole('button', { name: 'Mở menu tài khoản' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Phân tích', exact: true }).click();
  await expect(
    page
      .locator('[role="alert"]')
      .filter({ hasText: 'Máy chủ không nhận được phiên' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Mở menu tài khoản/ }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Đăng nhập lại', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/phan-tich$/);
});

test('missing information and closed AI access stay on the page without consuming a request', async ({
  page,
}) => {
  await login(page);
  let analysis = 0;
  page.on('request', (req) => {
    if (new URL(req.url()).pathname === '/api/analysis') analysis++;
  });
  await page.goto('/phan-tich');
  await expect(
    page.getByRole('button', { name: 'Mở menu tài khoản' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: /Tôi định mua/ }).click();
  await page.getByRole('button', { name: 'Phân tích', exact: true }).click();
  await expect(page.getByText('Hãy bổ sung:', { exact: true })).toBeVisible();
  expect(analysis).toBe(0);
  await page.route('**/api/analysis/prepare', async (route) =>
    route.fulfill({
      json: {
        access: {
          ...adminAccess,
          isAdmin: false,
          canAnalyze: false,
          code: 'AI_ACCESS_DISABLED',
          message: 'Tài khoản này chưa được cấp quyền AI.',
        },
        authenticated: true,
        ready: false,
        needs: [],
      },
    }),
  );
  await page.getByRole('button', { name: 'Phân tích', exact: true }).click();
  await expect(
    page.locator('[role="alert"]').filter({ hasText: 'chưa được cấp quyền' }),
  ).toBeVisible();
  expect(analysis).toBe(0);
  await expect(page).toHaveURL(/\/phan-tich$/);
});

test('mobile question workspace has one column and no context form', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/phan-tich');
  await expect(page.getByRole('button', { name: 'Mở menu tài khoản' })).toBeVisible();
  await expect(page.getByText('Thông tin lượt này', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Số lượng (lượng)', { exact: true })).toHaveCount(0);
  await expect(page.locator('.ai-content-grid')).toHaveCSS('max-width', '1040px');
});
