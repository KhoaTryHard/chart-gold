import { expect, test, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

async function signInAsE2eAdmin(page: Page) {
  const token = await encode({
    secret: process.env.E2E_AUTH_SECRET ?? 'e2e-auth-secret',
    salt: 'authjs.session-token',
    token: {
      sub: 'e2e-layout-admin',
      email: process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.test',
      name: 'Layout Admin',
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

const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
  { width: 1440, height: 960 },
] as const;

for (const viewport of viewports) {
  test(`fits at ${viewport.width}px without duplicate login copy`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/phan-tich');
    await expect(
      page.getByRole('heading', { name: 'Phân tích AI', exact: true }),
    ).toBeVisible();
    if (viewport.width >= 1024) {
      await expect(
        page.getByRole('link', { name: 'Hỏi AI về giá vàng', exact: true }),
      ).toHaveAttribute('aria-current', 'page');
    }
    await expect(
      page.getByText('Đăng nhập khi gửi', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Bạn chưa đăng nhập trên trang này.', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        'Đăng nhập Google để gửi câu hỏi. Bản nháp sẽ được giữ lại.',
        { exact: true },
      ),
    ).toHaveCount(0);
    const metrics = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      heading:
        document.querySelector('.ai-page-heading')?.getBoundingClientRect()
          .height ?? 0,
      account:
        document.querySelector('.ai-account')?.getBoundingClientRect().width ??
        0,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.heading).toBeGreaterThan(45);
    expect(metrics.account).toBeGreaterThanOrEqual(40);
  });
}

test('supports the compact dark appearance and keyboard account menu', async ({
  page,
}) => {
  await signInAsE2eAdmin(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/phan-tich');
  const themeToggle = page.getByRole('button', {
    name: 'Chuyển sang giao diện tối',
    exact: true,
  });
  await themeToggle.focus();
  await themeToggle.press('Enter');
  await expect(page.locator('html.dark')).toHaveCount(1);
  await expect(
    page.getByRole('button', {
      name: 'Chuyển sang giao diện sáng',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  const account = page.getByRole('button', { name: /Mở menu tài khoản/ });
  await account.focus();
  await account.press('Enter');
  await expect(
    page.getByRole('menuitem', { name: 'Làm mới trạng thái', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('menuitem', { name: 'Làm mới trạng thái', exact: true }),
  ).toHaveCount(0);
});

test('puts the question box before optional details on a first phone visit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/phan-tich');
  const question = page.locator('.ai-question-panel');
  await expect(question.locator('#analysis-question')).toBeVisible();
  await expect(page.locator('.ai-content-grid > aside')).toHaveCount(0);
  await expect(page.getByText('Thông tin lượt này', { exact: true })).toHaveCount(0);
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewport + 1);
});

test('clears the previous page indicator before highlighting Phân tích AI', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/cong-cu-vang');
  const nav = page.locator('.glass-nav--desktop');
  const indicator = nav.locator('.glass-nav__indicator');
  await expect(indicator).toHaveCSS('opacity', '1');

  await nav.getByRole('link', { name: 'Hỏi AI về giá vàng' }).click();
  await expect(page).toHaveURL(/\/phan-tich/);
  await expect(
    nav.getByRole('link', { name: 'Hỏi AI về giá vàng' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    nav.getByRole('link', { name: 'Công cụ', exact: true }),
  ).not.toHaveAttribute('aria-current', 'page');
  await expect(indicator).toHaveCSS('opacity', '0');
});

test('shares the account menu on the prices and news routes', async ({ page }) => {
  await signInAsE2eAdmin(page);
  for (const path of ['/', '/nhip-vang']) {
    await page.goto(path);
    const account = page.getByRole('button', { name: /Mở menu tài khoản/ });
    await expect(account).toBeVisible();
    await account.click();
    await expect(page.getByRole('menuitem', { name: 'Sổ vàng', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Hỏi AI', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
});
