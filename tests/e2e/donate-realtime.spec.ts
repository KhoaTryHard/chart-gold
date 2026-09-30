import { createHash, createHmac, randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { Pool } from 'pg';

const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;
const baseURL = 'http://127.0.0.1:3000';
const authSecret = process.env.E2E_AUTH_SECRET ?? 'e2e-auth-secret';
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.test';
const webhookSecret =
  process.env.E2E_SEPAY_WEBHOOK_SECRET ?? 'e2e-webhook-secret';
const accountNumber = process.env.E2E_SEPAY_ACCOUNT_NUMBER ?? '123456789';

test.describe('DONATE realtime leaderboard', () => {
  test.skip(
    !e2eDatabaseUrl,
    'Set E2E_DATABASE_URL to run against the isolated PostgreSQL test database.',
  );
  test.describe.configure({ mode: 'serial' });

  test('updates two open pages after a real SePay webhook within five seconds', async ({
    page,
    browser,
    request,
  }) => {
    const pool = new Pool({ connectionString: e2eDatabaseUrl });
    const userId = randomUUID();
    const adminId = randomUUID();
    let orderId = '';
    let orderCode = '';
    let reviewOrderId = '';
    let reviewSepayId = 0;
    const displayName = 'E2E Nhà hảo tâm';
    const sepayId = Date.now();
    try {
      await pool.query(
        `insert into users (id, google_subject, email, name)
         values ($1, $2, $3, $4)`,
        [userId, `e2e-${userId}`, `${userId}@example.test`, displayName],
      );
      const sessionToken = await encode({
        secret: authSecret,
        salt: 'authjs.session-token',
        token: {
          sub: userId,
          email: `${userId}@example.test`,
          name: displayName,
        },
      });
      await page.context().addCookies([
        {
          name: 'authjs.session-token',
          value: sessionToken,
          url: 'http://127.0.0.1:3000',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      const secondPage = await browser.newPage({ baseURL });
      await Promise.all([page.goto('/donate'), secondPage.goto('/donate')]);
      await expect(
        page.getByRole('heading', { name: 'Top nhà hảo tâm' }),
      ).toBeVisible();
      await expect(
        secondPage.getByRole('heading', { name: 'Top nhà hảo tâm' }),
      ).toBeVisible();

      const session = await page.evaluate(async () => {
        const response = await fetch('/api/auth/session', {
          cache: 'no-store',
        });
        return response.json();
      });
      expect(session.user.email).toBe(`${userId}@example.test`);
      await page.getByRole('button', { name: 'Ủng hộ 100.000đ' }).click();
      await expect(page.getByAltText('QR ủng hộ Kim Tuyến')).not.toBeVisible();
      await page
        .getByPlaceholder('Tên hiển thị trên bảng tri ân')
        .fill(displayName);
      await page.getByPlaceholder('Ví dụ: 20000').fill('100000');
      const createResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/donations/orders') &&
          response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Tạo mã QR ủng hộ' }).click();
      const created = (await (await createResponse).json()) as {
        order?: { id: string; orderCode: string; status: string };
      };
      expect(created.order?.status).toBe('pending');
      orderId = created.order?.id ?? '';
      orderCode = created.order?.orderCode ?? '';
      expect(orderId).toBeTruthy();
      expect(orderCode).toMatch(/^DN/);

      const transactionDate = new Date(Date.now() + 7 * 60 * 60 * 1_000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');
      const payload = {
        id: sepayId,
        gateway: 'MBBank',
        transactionDate,
        accountNumber,
        code: orderCode,
        transferType: 'in',
        transferAmount: 100_000,
        referenceCode: `E2E-${sepayId}`,
      };
      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1_000);
      const signature = createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');
      const startedAt = Date.now();
      const response = await request.post('/api/webhooks/sepay', {
        data: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-sepay-timestamp': String(timestamp),
          'x-sepay-signature': `sha256=${signature}`,
        },
      });
      expect(response.ok()).toBe(true);

      for (const openPage of [page, secondPage]) {
        const row = openPage
          .locator('li')
          .filter({ hasText: displayName })
          .first();
        await expect(row).toBeVisible({ timeout: 5_000 });
        await expect(row).toContainText('100.000');
        await expect(row.locator('span').first()).toHaveText('1');
      }
      expect(Date.now() - startedAt).toBeLessThanOrEqual(5_000);
      const duplicateResponses = await Promise.all([
        request.post('/api/webhooks/sepay', {
          data: rawBody,
          headers: {
            'content-type': 'application/json',
            'x-sepay-timestamp': String(timestamp),
            'x-sepay-signature': `sha256=${signature}`,
          },
        }),
        request.post('/api/webhooks/sepay', {
          data: rawBody,
          headers: {
            'content-type': 'application/json',
            'x-sepay-timestamp': String(timestamp),
            'x-sepay-signature': `sha256=${signature}`,
          },
        }),
      ]);
      expect(duplicateResponses.every((duplicate) => duplicate.ok())).toBe(
        true,
      );
      const stored = await pool.query(
        'select status, sepay_transaction_id from donation_orders where id = $1',
        [orderId],
      );
      expect(stored.rows).toEqual([
        { status: 'paid', sepay_transaction_id: sepayId },
      ]);

      reviewOrderId = randomUUID();
      reviewSepayId = sepayId + 1;
      const reviewOrderCode = `DNREV${Date.now().toString(36).toUpperCase()}`;
      await pool.query(
        `insert into donation_orders
          (id, user_id, amount_vnd, order_code, display_name, is_anonymous,
           leaderboard_opt_in, status, expires_at)
         values ($1, $2, $3, $4, $5, false, true, 'needs_review', now() + interval '5 minutes')`,
        [reviewOrderId, userId, 50_000, reviewOrderCode, displayName],
      );
      await pool.query(
        `insert into sepay_transactions
          (sepay_id, gateway, account_number, transfer_type, amount_vnd,
           order_code, reference_code, transaction_date, raw_body_hash, status)
         values ($1, 'MBBank', '*****6789', 'in', $2, $3, $4, now(), $5, 'needs_review')`,
        [
          reviewSepayId,
          50_000,
          reviewOrderCode,
          `E2E-REVIEW-${reviewSepayId}`,
          createHash('sha256').update(String(reviewSepayId)).digest('hex'),
        ],
      );
      const adminToken = await encode({
        secret: authSecret,
        salt: 'authjs.session-token',
        token: { sub: adminId, email: adminEmail, name: 'E2E Admin' },
      });
      const adminContext = await browser.newContext({ baseURL });
      await adminContext.addCookies([
        {
          name: 'authjs.session-token',
          value: adminToken,
          url: 'http://127.0.0.1:3000',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      const adminResponse = await adminContext.request.post(
        '/api/admin/billing',
        {
          data: JSON.stringify({
            action: 'confirmDonation',
            donationId: reviewOrderId,
            sepayId: reviewSepayId,
          }),
          headers: {
            origin: 'http://127.0.0.1:3000',
            'content-type': 'application/json',
          },
        },
      );
      expect(adminResponse.ok()).toBe(true);
      await expect(
        page.locator('li').filter({ hasText: displayName }).first(),
      ).toContainText('150.000', { timeout: 5_000 });
      await adminContext.close();
      await secondPage.close();
    } finally {
      if (orderId) {
        await pool.query(
          'delete from sepay_transactions where donation_order_id = $1',
          [orderId],
        );
        await pool.query('delete from donation_orders where id = $1', [
          orderId,
        ]);
      }
      if (reviewOrderId) {
        await pool.query('delete from sepay_transactions where sepay_id = $1', [
          reviewSepayId,
        ]);
        await pool.query('delete from donation_orders where id = $1', [
          reviewOrderId,
        ]);
      }
      await pool.query('delete from users where id = $1', [userId]);
      await pool.query('delete from users where id = $1', [adminId]);
      await pool.end();
    }
  });
});
