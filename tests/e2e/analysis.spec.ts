import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import { encode } from 'next-auth/jwt';
import { expect, test, type Page } from '@playwright/test';

const authSecret = process.env.E2E_AUTH_SECRET ?? 'e2e-auth-secret';
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.test';
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;
const fakeAiPort = 4317;

function writeSse(response: ServerResponse<IncomingMessage>, value: unknown) {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function startFakeHermes() {
  return new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
    const server = createServer((request, response) => {
      if (
        request.method !== 'POST' ||
        !request.url?.endsWith('/chat/completions')
      ) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const chunks = [
        { choices: [{ delta: { content: 'Tóm tắt giá vàng: ' } }] },
        {
          choices: [
            { delta: { content: 'giá bán ra và mua vào đang được theo dõi.' } },
          ],
        },
        {
          choices: [
            { delta: { content: ' Dữ liệu kiểm thử được ghi rõ theo ngày.' } },
          ],
        },
        {
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 },
        },
      ];
      let index = 0;
      const sendNext = () => {
        if (response.writableEnded) return;
        if (index < chunks.length) {
          writeSse(response, { id: 'e2e-analysis', ...chunks[index++] });
          setTimeout(sendNext, 180);
          return;
        }
        response.write('data: [DONE]\n\n');
        response.end();
      };
      sendNext();
    });
    server.once('error', reject);
    server.listen(fakeAiPort, '127.0.0.1', () => resolve(server));
  });
}

async function signInAsE2eAdmin(page: Page) {
  const token = await encode({
    secret: authSecret,
    salt: 'authjs.session-token',
    token: {
      sub: 'e2e-admin-user',
      email: adminEmail,
      name: 'E2E AI Admin',
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

test.describe('Phân tích AI — guest and lazy-load UI', () => {
  test('opens the goal-first AI workspace', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/phan-tich');
    await expect(
      page.getByRole('heading', { name: 'Phân tích AI', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('tab', { name: /Tôi đang giữ vàng/ }),
    ).toBeVisible();
    await expect(
      page.locator('textarea#analysis-question').first(),
    ).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewport);
  });

  test('replaces legacy ?ai=open with the full AI route on mobile', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?ai=open');
    await expect(page).toHaveURL(
      /\/phan-tich\?company=sjc&product=bar-1l&range=1T/,
    );
    const workspaceHeading = page.getByRole('heading', {
      name: 'Phân tích AI',
      exact: true,
    });
    await expect(workspaceHeading).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewport);
  });

  test('carries the selected product and chart range into the full AI route', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/?ai=open&company=pnj&product=pnj-ring-9999&range=7N');
    await expect(page).toHaveURL(
      /\/phan-tich\?company=pnj&product=pnj-ring-9999&range=7N/,
    );
    await expect(
      page.locator('.ai-content-grid aside select').nth(0),
    ).toHaveValue('pnj');
    await expect(
      page.locator('.ai-content-grid aside select').nth(1),
    ).toHaveValue('pnj-ring-9999');
    await expect(
      page.locator('.ai-content-grid aside select').nth(2),
    ).toHaveValue('7N');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('navigates to the AI workspace when the action is used', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('link', { name: 'Hỏi AI về giá vàng' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Phân tích AI', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('link', { name: 'Hỏi AI về giá vàng' }).click();
    await expect(page).toHaveURL(
      /\/phan-tich\?company=sjc&product=bar-1l&range=1T/,
    );
    await expect(
      page.getByRole('heading', { name: 'Phân tích AI', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Phân tích AI — UI SSE resilience with mocked responses', () => {
  test('keeps UTF-8 deltas and ignores malformed SSE blocks', async ({
    page,
  }) => {
    await signInAsE2eAdmin(page);
    await page.route('**/api/analysis/prepare', (route) =>
      route.fulfill({
        json: {
          ready: true,
          authenticated: true,
          access: {
            authenticated: true,
            canAnalyze: true,
            isAdmin: true,
            capabilities: ['standard'],
            remaining: null,
            unlimited: true,
            message: 'Có quyền sử dụng AI.',
            code: null,
          },
        },
      }),
    );
    await page.route('**/api/analysis', async (route) => {
      const request = route.request().postDataJSON() as {
        companyId?: string;
        productId?: string;
        range?: string;
      };
      expect(request).toMatchObject({
        companyId: 'sjc',
        productId: 'bar-1l',
        range: '1T',
      });
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: [
          'data: {"type":"status","message":"Đang lấy giá"}\n\n',
          'data: {"type":"delta","delta":"Phân tích tiếng Việt: "}\n\n',
          'data: {"type":broken}\n\n',
          'data: {"type":"delta","delta":"đã nhận đúng."}\n\n',
          'data: {"type":"done","model":"mock-model","completion":"complete"}\n\n',
        ].join(''),
      });
    });
    await page.goto('/phan-tich?company=sjc&product=bar-1l&range=1T');
    const input = page.locator('textarea#analysis-question');
    await expect(input).toBeVisible();
    await input.fill('Kiểm tra stream tiếng Việt.');
    await page.getByRole('button', { name: 'Phân tích', exact: true }).click();
    await expect(
      page.getByText('Phân tích tiếng Việt: đã nhận đúng.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('mock-model')).toHaveCount(0);
  });

  test('shows provider failure and can retry without duplicating the prompt', async ({
    page,
  }) => {
    await signInAsE2eAdmin(page);
    await page.route('**/api/analysis/prepare', (route) =>
      route.fulfill({
        json: {
          ready: true,
          authenticated: true,
          access: {
            authenticated: true,
            canAnalyze: true,
            isAdmin: true,
            capabilities: ['standard'],
            remaining: null,
            unlimited: true,
            message: 'Có quyền sử dụng AI.',
            code: null,
          },
        },
      }),
    );
    let calls = 0;
    await page.route('**/api/analysis', async (route) => {
      calls += 1;
      if (calls === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'AI mock unavailable' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: [
          'data: {"type":"delta","delta":"Retry thành công."}\n\n',
          'data: {"type":"done","model":"mock-model","completion":"complete"}\n\n',
        ].join(''),
      });
    });
    await page.goto('/phan-tich?company=sjc&product=bar-1l&range=1T');
    const input = page.locator('textarea#analysis-question');
    await input.fill('Kiểm tra retry.');
    await page.getByRole('button', { name: 'Phân tích', exact: true }).click();
    await expect(page.getByText('AI mock unavailable')).toBeVisible();
    await page.getByRole('button', { name: 'Phân tích', exact: true }).click();
    await expect(
      page.getByText('Retry thành công.', { exact: true }),
    ).toBeVisible();
    expect(calls).toBe(2);
  });
});

test.describe('Phân tích AI — local authenticated integration', () => {
  test.skip(
    !e2eDatabaseUrl,
    'BLOCKED: set E2E_DATABASE_URL to an isolated PostgreSQL database; production DATABASE_URL is never used.',
  );
  test.describe.configure({ mode: 'serial' });

  let fakeHermes: Awaited<ReturnType<typeof startFakeHermes>>;

  test.beforeAll(async () => {
    fakeHermes = await startFakeHermes();
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      fakeHermes.close((error) => (error ? reject(error) : resolve())),
    );
  });

  test('streams a response, keeps UTF-8 text, and releases busy state', async ({
    page,
  }) => {
    await signInAsE2eAdmin(page);
    await page.goto('/phan-tich?company=sjc&product=bar-1l&range=1T');
    await expect(
      page.getByRole('heading', { name: 'Phân tích AI' }),
    ).toBeVisible();
    const input = page.locator('textarea#analysis-question');
    await expect(input).toBeVisible();
    await input.fill(
      'Tóm tắt giá mua vào, bán ra và xu hướng SJC 1 lượng trong 1 tháng đang chọn; ghi ngày dữ liệu.',
    );
    await page.getByRole('button', { name: 'Phân tích', exact: true }).click();
    await expect(page.getByText(/Tóm tắt giá vàng:/).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(/Dữ liệu kiểm thử được ghi rõ theo ngày/),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Phân tích', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Tóm tắt giá vàng:')).toHaveCount(2);
  });

  test('cancels a streaming request and can submit the next question', async ({
    page,
  }) => {
    await signInAsE2eAdmin(page);
    await page.goto('/phan-tich?company=sjc&product=bar-1l&range=1T');
    const input = page.locator('textarea#analysis-question');
    await input.fill('Kiểm tra khả năng dừng phân tích.');
    await page.getByRole('button', { name: 'Phân tích', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Dừng phân tích' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Dừng phân tích' }).click();
    await expect(
      page.getByRole('button', { name: 'Phân tích', exact: true }),
    ).toBeVisible();
    await input.fill('Gửi lại sau khi dừng.');
    await page.getByRole('button', { name: 'Phân tích', exact: true }).click();
    await expect(page.getByText(/Tóm tắt giá vàng:/).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
