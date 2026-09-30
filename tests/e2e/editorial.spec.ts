import { expect, test } from '@playwright/test';
import { encode } from 'next-auth/jwt';

async function signInAs(page: import('@playwright/test').Page, email: string) {
  const token = await encode({
    secret: process.env.E2E_AUTH_SECRET ?? 'e2e-auth-secret',
    salt: 'authjs.session-token',
    token: { sub: email, email, name: 'Editorial Test' },
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

test('renders the indexable Nhịp vàng hub and keeps the price route available', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/nhip-vang');
  await expect(
    page.getByRole('heading', { name: 'Nhịp vàng', exact: true }),
  ).toBeVisible();
  const moreMenu = page
    .locator('.glass-bottom-nav')
    .getByRole('button', { name: 'Mở thêm lựa chọn' });
  await expect(moreMenu).toHaveAttribute('aria-current', 'page');
  await moreMenu.click();
  await expect(
    page.getByRole('menuitem', { name: 'Tin vàng · Nhịp vàng', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('body')).toContainText(
    'Đọc chuyển động, hiểu giá trị',
  );
  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width);

  const home = await request.get('/');
  expect(home.status()).toBe(200);
});

test('scrolls from the Bảng giá route to the Nhịp vàng section', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const target = page.locator('#nhip-vang');
  await expect(target).toBeVisible();
  await page
    .locator('.glass-nav--desktop')
    .getByRole('link', { name: 'Tin vàng', exact: true })
    .click();
  await expect.poll(() => new URL(page.url()).hash).toBe('#nhip-vang');
  await expect
    .poll(async () => page.evaluate(() => Math.round(window.scrollY)))
    .toBeGreaterThan(0);
  await expect(target).toBeInViewport();
  const targetTop = await target.evaluate((node) =>
    Math.round(node.getBoundingClientRect().top),
  );
  expect(targetTop).toBeGreaterThanOrEqual(0);
  expect(targetTop).toBeLessThan(900);
});

test('returns to Bảng giá before scrolling when Nhịp vàng is clicked from another route', async ({
  page,
}) => {
  await page.goto('/cong-cu-vang');
  await page
    .locator('.glass-nav--desktop')
    .getByRole('link', { name: 'Tin vàng', exact: true })
    .click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  await expect.poll(() => new URL(page.url()).hash).toBe('#nhip-vang');
});

test('does not expose unpublished articles or editorial APIs to guests', async ({
  request,
}) => {
  const unpublished = await request.get('/nhip-vang/ban-nhap-khong-ton-tai');
  expect(unpublished.status()).toBe(200);
  const unpublishedHtml = await unpublished.text();
  expect(unpublishedHtml).toContain('Không tìm thấy bài viết');
  expect(unpublishedHtml).not.toContain('Bản nháp chờ biên tập viên');
  expect((await request.get('/api/admin/articles')).status()).toBe(401);
  expect((await request.get('/api/cron/editorial')).status()).toBe(401);
});

test('shows a denied-account message and keeps article APIs closed to non-admins', async ({
  page,
}) => {
  await signInAs(page, 'member@example.test');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/bai-viet');

  await expect(
    page.getByText('member@example.test', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Tài khoản này chưa có quyền quản trị bài viết.'),
  ).toBeVisible();
  const switchAccount = page.getByRole('button', {
    name: 'Đổi tài khoản Google',
  });
  await expect(switchAccount).toBeVisible();
  await expect(switchAccount).toHaveClass(/w-full/);
  await page.locator('[data-theme-toggle="lightbulb"]').click();
  await expect(switchAccount).toBeVisible();

  const layout = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);

  const apiStatus = await page.evaluate(
    async () => (await fetch('/api/admin/articles')).status,
  );
  expect(apiStatus).toBe(403);

  let oauthRequest: {
    prompt: string | null;
    callbackUrl: string | null;
  } | null = null;
  await page.route('**/api/auth/providers', (route) =>
    route.fulfill({ json: { google: { type: 'oauth' } } }),
  );
  await page.route('**/api/auth/csrf', (route) =>
    route.fulfill({ json: { csrfToken: 'editorial-test-token' } }),
  );
  await page.route(
    (url) =>
      url.pathname === '/api/auth/signin/google' &&
      url.searchParams.has('prompt'),
    async (route) => {
      const form = new URLSearchParams(route.request().postData() ?? '');
      oauthRequest = {
        prompt: new URL(route.request().url()).searchParams.get('prompt'),
        callbackUrl: form.get('callbackUrl'),
      };
      await route.fulfill({
        json: {
          url: 'https://accounts.google.com/o/oauth2/v2/auth?flow=e2e',
        },
      });
    },
  );
  await page.route('https://accounts.google.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: 'Google OAuth test page' }),
  );
  await switchAccount.focus();
  await page.keyboard.press('Enter');

  await expect
    .poll(() => oauthRequest)
    .toEqual({
      prompt: 'select_account',
      callbackUrl: '/admin/bai-viet',
    });
  await expect(page).toHaveURL(
    'https://accounts.google.com/o/oauth2/v2/auth?flow=e2e',
  );
});

test('keeps the Google login invitation out of the authorized admin panel', async ({
  page,
}) => {
  await signInAs(page, process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.test');
  await page.goto('/admin/bai-viet');

  await expect(
    page.getByRole('heading', { name: 'Quản trị Nhịp vàng' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /Đăng nhập bằng Google|Đổi tài khoản Google/,
    }),
  ).toHaveCount(0);

  const apiStatus = await page.evaluate(
    async () => (await fetch('/api/admin/articles')).status,
  );
  expect([200, 503]).toContain(apiStatus);
});

test('serves versioned brand covers and protects cover mutations', async ({
  request,
}) => {
  for (const cover of ['news', 'explain', 'practice']) {
    const response = await request.get(`/brand/covers/${cover}.webp`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/webp');
  }
  const response = await request.post(
    '/api/admin/articles/00000000-0000-0000-0000-000000000000/cover',
    {
      multipart: {
        revisionId: '00000000-0000-0000-0000-000000000000',
        source: 'brand-library',
      },
    },
  );
  expect([401, 403]).toContain(response.status());
});
