import { createHmac, randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { Pool } from 'pg';

const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;
const baseURL = 'http://127.0.0.1:3000';
const authSecret = process.env.E2E_AUTH_SECRET ?? 'e2e-auth-secret';
const webhookSecret =
  process.env.E2E_SEPAY_WEBHOOK_SECRET ?? 'e2e-webhook-secret';
const accountNumber = process.env.E2E_SEPAY_ACCOUNT_NUMBER ?? '123456789';
const bankCode = process.env.E2E_SEPAY_BANK_CODE ?? 'MBBank';
const accountHolder = process.env.E2E_SEPAY_ACCOUNT_HOLDER ?? 'E2E TEST';

type DonationOrder = {
  id: string;
  accessToken: string | null;
  amountVnd: number;
  orderCode: string;
  status: string;
  qrUrl: string | null;
  expiresAt: string;
};

let nextSepayId = Date.now() * 1_000;

function uniqueSepayId() {
  nextSepayId += 1;
  return nextSepayId;
}

function signedHeaders(rawBody: string, timestamp = Math.floor(Date.now() / 1_000)) {
  const signature = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return {
    'content-type': 'application/json',
    'x-sepay-timestamp': String(timestamp),
    'x-sepay-signature': `sha256=${signature}`,
  };
}

async function createOrder(
  request: APIRequestContext,
  amountVnd = 20_000,
  displayName?: string,
) {
  const response = await request.post('/api/donations/orders', {
    data: JSON.stringify({
      amountVnd,
      isAnonymous: !displayName,
      displayName: displayName ?? null,
    }),
    headers: {
      origin: baseURL,
      'content-type': 'application/json',
    },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { order: DonationOrder };
  expect(body.order.status).toBe('pending');
  return body.order;
}

function webhookPayload(order: DonationOrder, overrides: Record<string, unknown> = {}) {
  return {
    id: uniqueSepayId(),
    gateway: bankCode,
    transactionDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
    accountNumber,
    code: order.orderCode,
    transferType: 'in',
    transferAmount: order.amountVnd,
    referenceCode: `E2E-DONATE-${order.id}`,
    ...overrides,
  };
}

async function sendWebhook(
  request: APIRequestContext,
  payload: Record<string, unknown>,
  options: { timestamp?: number; tamperSignature?: boolean } = {},
) {
  const rawBody = JSON.stringify(payload);
  const headers = signedHeaders(rawBody, options.timestamp);
  if (options.tamperSignature) headers['x-sepay-signature'] = `sha256=${'0'.repeat(64)}`;
  return request.post('/api/webhooks/sepay', { data: rawBody, headers });
}

test.describe('DONATE production contract against isolated PostgreSQL', () => {
  test.skip(
    !e2eDatabaseUrl,
    'Set E2E_DATABASE_URL to run donate E2E against an isolated PostgreSQL database.',
  );
  test.describe.configure({ mode: 'serial' });

  test('creates a QR, protects the order with its token, and restores it after reload', async ({
    page,
    request,
  }) => {
    const orderIds: string[] = [];
    const pool = new Pool({ connectionString: e2eDatabaseUrl });
    try {
      const order = await createOrder(request, 1_000);
      orderIds.push(order.id);
      expect(order.orderCode).toMatch(/^DN[A-Z0-9]{10}$/);
      expect(order.accessToken).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
      expect(order.qrUrl).toBeTruthy();
      const qr = new URL(order.qrUrl!);
      expect(qr.searchParams.get('amount')).toBe('1000');
      expect(qr.searchParams.get('des')).toBe(order.orderCode);
      expect(qr.searchParams.get('bank')).toBe(bankCode);
      expect(qr.searchParams.get('acc')).toBe(accountNumber);
      expect(qr.searchParams.get('holder')).toBe(accountHolder);

      const withoutToken = await request.get(`/api/donations/orders/${order.id}`);
      expect(withoutToken.status()).toBe(404);
      const withToken = await request.get(`/api/donations/orders/${order.id}`, {
        headers: { 'x-donation-token': order.accessToken! },
      });
      expect(withToken.status()).toBe(200);
      expect((await withToken.json()).order.id).toBe(order.id);
      expect(withToken.url()).not.toContain(order.accessToken!);

      await page.goto('/donate');
      await page.getByRole('button', { name: 'Ủng hộ 20.000đ' }).click();
      await page.getByPlaceholder('Ví dụ: 20000').fill('1000');
      const uiOrderResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/donations/orders') &&
          response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Tạo mã QR ủng hộ' }).click();
      const uiOrderBody = (await (await uiOrderResponse).json()) as {
        order: DonationOrder;
      };
      orderIds.push(uiOrderBody.order.id);
      await expect(page.getByAltText('QR ủng hộ Kim Tuyến')).toBeVisible();
      const displayedCode = page.locator('p.font-semibold').filter({ hasText: /^DN/ }).first();
      await expect(displayedCode).toBeVisible();
      await page.reload();
      await expect(page.getByAltText('QR ủng hộ Kim Tuyến')).toBeVisible();
      await expect(page.locator('p.font-semibold').filter({ hasText: /^DN/ }).first()).toBeVisible();

      const rows = await pool.query('select status from donation_orders where id = $1', [order.id]);
      expect(rows.rows).toEqual([{ status: 'pending' }]);
    } finally {
      for (const orderId of orderIds)
        await pool.query('delete from donation_orders where id = $1', [orderId]);
      await pool.end();
    }
  });

  test('accepts a valid webhook once, including code recovery, and never creates a subscription', async ({
    request,
  }) => {
    const pool = new Pool({ connectionString: e2eDatabaseUrl });
    let orderId = '';
    let sepayId = 0;
    try {
      const order = await createOrder(request, 5_000, 'E2E Donate Recovery');
      orderId = order.id;
      const payload = webhookPayload(order, {
        id: uniqueSepayId(),
        code: null,
        content: `bank memo ${order.orderCode}`,
      });
      sepayId = Number(payload.id);
      const beforePeriods = await pool.query('select count(*)::int as count from subscription_periods');
      const response = await sendWebhook(request, payload);
      expect(response.status()).toBe(200);
      expect((await response.json()).success).toBe(true);
      const duplicate = await sendWebhook(request, payload);
      expect(duplicate.status()).toBe(200);

      const stored = await pool.query(
        `select d.status, d.paid_at is not null as paid, d.sepay_transaction_id,
                s.status as transaction_status, s.donation_order_id
           from donation_orders d
           join sepay_transactions s on s.sepay_id = $2
          where d.id = $1`,
        [orderId, sepayId],
      );
      expect(stored.rows).toEqual([
        {
          status: 'paid',
          paid: true,
          sepay_transaction_id: sepayId,
          transaction_status: 'accepted',
          donation_order_id: orderId,
        },
      ]);
      const afterPeriods = await pool.query('select count(*)::int as count from subscription_periods');
      expect(afterPeriods.rows[0].count).toBe(beforePeriods.rows[0].count);
      const duplicates = await pool.query(
        'select count(*)::int as count from sepay_transactions where sepay_id = $1',
        [sepayId],
      );
      expect(duplicates.rows[0].count).toBe(1);
    } finally {
      if (sepayId) await pool.query('delete from sepay_transactions where sepay_id = $1', [sepayId]);
      if (orderId) await pool.query('delete from donation_orders where id = $1', [orderId]);
      await pool.end();
    }
  });

  test('expires pending orders on read and distinguishes late transfers before and after expiry', async ({
    request,
  }) => {
    const pool = new Pool({ connectionString: e2eDatabaseUrl });
    const orderIds: string[] = [];
    const sepayIds: number[] = [];
    try {
      const expired = await createOrder(request, 9_000);
      orderIds.push(expired.id);
      await pool.query(
        `update donation_orders set expires_at = now() - interval '1 second' where id = $1`,
        [expired.id],
      );
      const expiredResponse = await request.get(`/api/donations/orders/${expired.id}`, {
        headers: { 'x-donation-token': expired.accessToken! },
      });
      expect(expiredResponse.status()).toBe(200);
      expect((await expiredResponse.json()).order).toMatchObject({
        id: expired.id,
        status: 'expired',
        qrUrl: null,
      });
      const replacement = await createOrder(request, 9_000);
      orderIds.push(replacement.id);
      expect(replacement.id).not.toBe(expired.id);

      const beforeExpiry = await createOrder(request, 11_000);
      orderIds.push(beforeExpiry.id);
      const beforePayload = webhookPayload(beforeExpiry, {
        id: uniqueSepayId(),
        transactionDate: new Date(Date.now() - 60_000)
          .toISOString()
          .slice(0, 19)
          .replace('T', ' '),
      });
      sepayIds.push(Number(beforePayload.id));
      const beforeResponse = await sendWebhook(request, beforePayload);
      expect(beforeResponse.status()).toBe(200);
      const beforeStored = await pool.query(
        'select status from donation_orders where id = $1',
        [beforeExpiry.id],
      );
      expect(beforeStored.rows[0].status).toBe('paid');

      const afterExpiry = await createOrder(request, 12_000);
      orderIds.push(afterExpiry.id);
      await pool.query(
        `update donation_orders set expires_at = now() - interval '1 minute' where id = $1`,
        [afterExpiry.id],
      );
      const afterPayload = webhookPayload(afterExpiry, {
        id: uniqueSepayId(),
      });
      sepayIds.push(Number(afterPayload.id));
      const afterResponse = await sendWebhook(request, afterPayload);
      expect(afterResponse.status()).toBe(200);
      const afterStored = await pool.query(
        `select d.status, s.status as transaction_status
           from donation_orders d
           join sepay_transactions s on s.sepay_id = $2
          where d.id = $1`,
        [afterExpiry.id, afterPayload.id],
      );
      expect(afterStored.rows[0]).toEqual({
        status: 'expired',
        transaction_status: 'needs_review',
      });
    } finally {
      for (const id of sepayIds)
        await pool.query('delete from sepay_transactions where sepay_id = $1', [id]);
      for (const id of orderIds)
        await pool.query('delete from donation_orders where id = $1', [id]);
      await pool.end();
    }
  });

  test('handles invalid signatures, invalid deliveries, and concurrent duplicates safely', async ({
    request,
  }) => {
    const pool = new Pool({ connectionString: e2eDatabaseUrl });
    const orderIds: string[] = [];
    const sepayIds: number[] = [];
    try {
      const invalidOrder = await createOrder(request, 20_000);
      orderIds.push(invalidOrder.id);
      const invalidSignature = await sendWebhook(
        request,
        webhookPayload(invalidOrder),
        { tamperSignature: true },
      );
      expect(invalidSignature.status()).toBe(401);
      const unchanged = await pool.query('select status from donation_orders where id = $1', [invalidOrder.id]);
      expect(unchanged.rows[0].status).toBe('pending');

      const oldTimestamp = Math.floor(Date.now() / 1_000) - 301;
      const stale = await sendWebhook(request, webhookPayload(invalidOrder), { timestamp: oldTimestamp });
      expect(stale.status()).toBe(401);
      const malformedBody = '{"id":"bad"}';
      const malformed = await request.post('/api/webhooks/sepay', {
        data: malformedBody,
        headers: signedHeaders(malformedBody),
      });
      expect(malformed.status()).toBe(400);

      const testDelivery = await sendWebhook(request, { ...webhookPayload(invalidOrder), id: 0 });
      expect(testDelivery.status()).toBe(200);
      const synthetic = await pool.query('select count(*)::int as count from sepay_transactions where sepay_id = 0');
      expect(synthetic.rows[0].count).toBe(0);

      const mismatchCases = [
        { accountNumber: '999999', label: 'wrong-account' },
        { transferType: 'out', label: 'wrong-direction' },
        { transferAmount: 19_999, label: 'wrong-amount' },
        { code: null, label: 'missing-code' },
      ];
      for (const mismatch of mismatchCases) {
        const order = await createOrder(request, 20_000);
        orderIds.push(order.id);
        const payload = webhookPayload(order, { ...mismatch, id: uniqueSepayId() });
        sepayIds.push(Number(payload.id));
        const response = await sendWebhook(request, payload);
        expect(response.status()).toBe(200);
        const rows = await pool.query(
          'select d.status, s.status as transaction_status from donation_orders d join sepay_transactions s on s.sepay_id = $2 where d.id = $1',
          [order.id, payload.id],
        );
        expect(rows.rows[0]).toEqual({ status: 'pending', transaction_status: 'needs_review' });
      }

      const concurrentOrder = await createOrder(request, 30_000);
      orderIds.push(concurrentOrder.id);
      const concurrentPayload = webhookPayload(concurrentOrder);
      const concurrentId = Number(concurrentPayload.id);
      sepayIds.push(concurrentId);
      const responses = await Promise.all([
        sendWebhook(request, concurrentPayload),
        sendWebhook(request, concurrentPayload),
        sendWebhook(request, concurrentPayload),
      ]);
      expect(responses.every((response) => response.status() === 200)).toBe(true);
      const concurrentRows = await pool.query(
        `select d.status, count(s.sepay_id)::int as transactions
           from donation_orders d
           left join sepay_transactions s on s.donation_order_id = d.id
          where d.id = $1 group by d.status`,
        [concurrentOrder.id],
      );
      expect(concurrentRows.rows).toEqual([{ status: 'paid', transactions: 1 }]);
      expect(concurrentId).toBeGreaterThan(0);
    } finally {
      for (const id of sepayIds) await pool.query('delete from sepay_transactions where sepay_id = $1', [id]);
      for (const id of orderIds) await pool.query('delete from donation_orders where id = $1', [id]);
      await pool.end();
    }
  });

  test('keeps anonymous donations private and rejects non-admin review confirmation', async ({
    browser,
    request,
  }) => {
    const pool = new Pool({ connectionString: e2eDatabaseUrl });
    const userId = randomUUID();
    let orderId = '';
    let sepayId = 0;
    try {
      const anonymous = await createOrder(request, 7_000);
      orderId = anonymous.id;
      const payload = webhookPayload(anonymous);
      sepayId = Number(payload.id);
      await sendWebhook(request, payload);
      const leaderboard = await request.get('/api/donations/leaderboard?period=month');
      expect((await leaderboard.json()).rows).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ displayName: 'Nhà hảo tâm' })]),
      );

      await pool.query(
        `insert into users (id, google_subject, email, name) values ($1, $2, $3, $4)`,
        [userId, `e2e-${userId}`, `nonadmin-${userId}@example.test`, 'E2E User'],
      );
      const token = await encode({
        secret: authSecret,
        salt: 'authjs.session-token',
        token: { sub: userId, email: `nonadmin-${userId}@example.test`, name: 'E2E User' },
      });
      const context = await browser.newContext({ baseURL });
      await context.addCookies([
        {
          name: 'authjs.session-token',
          value: token,
          url: baseURL,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      const response = await context.request.post('/api/admin/billing', {
        data: JSON.stringify({ action: 'confirmDonation', donationId: orderId, sepayId }),
        headers: { origin: baseURL, 'content-type': 'application/json' },
      });
      expect(response.status()).toBe(403);
      await context.close();
    } finally {
      if (sepayId) await pool.query('delete from sepay_transactions where sepay_id = $1', [sepayId]);
      if (orderId) await pool.query('delete from donation_orders where id = $1', [orderId]);
      await pool.query('delete from users where id = $1', [userId]);
      await pool.end();
    }
  });
});
