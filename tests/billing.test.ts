import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  formatVnd,
  getPlan,
  planHasCapability,
  requiredCapability,
  requiredPlanForCapability,
  subscriptionPlacement,
  BETA_PAID_PLANS,
} from '@/lib/billing/plans';
import {
  buildSepayQrUrl,
  extractSepayPaymentCode,
  sepayWebhookPayloadSchema,
  validateSepayPayment,
  verifySepaySignature,
} from '@/lib/billing/sepay';
import { DONATION_ORDER_TTL_MS } from '@/lib/billing/config';

describe('B2C plan catalog', () => {
  it('uses a five-minute lifetime for new donation QR orders', () => {
    expect(DONATION_ORDER_TTL_MS).toBe(5 * 60 * 1_000);
  });
  it('keeps the trial and paid quota ladder explicit', () => {
    expect(getPlan('trial')).toMatchObject({ priceVnd: 0, quota: 3 });
    expect(getPlan('basic')).toMatchObject({ priceVnd: 49_000, quota: 30 });
    expect(getPlan('plus')).toMatchObject({ priceVnd: 99_000, quota: 20 });
    expect(getPlan('pro')).toMatchObject({ priceVnd: 199_000, quota: 300 });
    expect(planHasCapability('basic', 'standard')).toBe(true);
    expect(planHasCapability('basic', 'research')).toBe(false);
    expect(planHasCapability('trial', 'portfolio')).toBe(true);
    expect(planHasCapability('plus', 'portfolio')).toBe(true);
    expect(planHasCapability('pro', 'deep')).toBe(true);
    expect(requiredPlanForCapability('research')).toBe('plus');
    expect(requiredPlanForCapability('deep')).toBe('pro');
    expect(BETA_PAID_PLANS).toEqual(['plus']);
  });

  it('routes question capability without relying on a client-provided plan', () => {
    expect(
      requiredCapability({
        question: 'Giá vàng hôm nay?',
        needsResearch: false,
        depth: 'short',
      }),
    ).toBe('standard');
    expect(
      requiredCapability({
        question: 'Tin mới về Fed?',
        needsResearch: true,
        depth: 'standard',
      }),
    ).toBe('research');
    expect(
      requiredCapability({
        question: 'Phân tích sâu danh mục',
        needsResearch: false,
        depth: 'deep',
      }),
    ).toBe('deep');
    expect(
      requiredCapability({
        question: 'Hôm nay danh mục của tôi có chốt lời được chưa?',
        needsResearch: false,
        depth: 'standard',
      }),
    ).toBe('portfolio');
    expect(formatVnd(49_000)).toContain('49.000');
  });

  it('places renewals after the current period and upgrades immediately', () => {
    const now = new Date('2026-09-05T00:00:00Z');
    const activeEnds = new Date('2026-09-20T00:00:00Z');
    const renewal = subscriptionPlacement({
      plan: 'basic',
      now,
      active: { plan: 'basic', endsAt: activeEnds },
    });
    expect(renewal.status).toBe('scheduled');
    expect(renewal.startsAt).toEqual(activeEnds);
    expect(renewal.endsAt).toEqual(new Date('2026-10-20T00:00:00Z'));
    const upgrade = subscriptionPlacement({
      plan: 'pro',
      now,
      active: { plan: 'basic', endsAt: activeEnds },
    });
    expect(upgrade.status).toBe('active');
    expect(upgrade.startsAt).toEqual(now);
    expect(upgrade.revokeExisting).toBe(true);
  });

  it('queues a downgrade behind an already scheduled period', () => {
    const placement = subscriptionPlacement({
      plan: 'basic',
      now: new Date('2026-09-05T00:00:00Z'),
      active: { plan: 'pro', endsAt: new Date('2026-09-20T00:00:00Z') },
      scheduled: {
        plan: 'plus',
        startsAt: new Date('2026-09-20T00:00:00Z'),
        endsAt: new Date('2026-10-20T00:00:00Z'),
      },
    });
    expect(placement.status).toBe('scheduled');
    expect(placement.startsAt).toEqual(new Date('2026-10-20T00:00:00Z'));
  });
});

describe('SePay webhook contract', () => {
  it('extracts an alphanumeric donation code from a bank memo', () => {
    const payload = sepayWebhookPayloadSchema.parse({
      id: 1,
      gateway: 'MBBank',
      transactionDate: '2026-09-07 17:10:00',
      accountNumber: '0337990731',
      code: null,
      content: '145715879634-DNCDB1ECAA1F-CHUYEN TIEN-OQCH000JTJQC-MOMO',
      transferType: 'in',
      transferAmount: 5_000,
    });
    expect(extractSepayPaymentCode(payload, ['DN', 'KT'])).toBe('DNCDB1ECAA1F');
  });

  it.each(['content', 'description', 'referenceCode'] as const)(
    'recovers a donation code from %s when SePay code is empty',
    (field) => {
      const payload = sepayWebhookPayloadSchema.parse({
        id: 2,
        gateway: 'MBBank',
        transactionDate: '2026-09-07 17:10:00',
        accountNumber: '0337990731',
        code: null,
        [field]: 'E2E transfer DNABC1234567',
        transferType: 'in',
        transferAmount: 5_000,
      });

      expect(extractSepayPaymentCode(payload, ['DN', 'KT'])).toBe(
        'DNABC1234567',
      );
    },
  );

  const rawBody = JSON.stringify({ id: 123, transferAmount: 49_000 });
  const secret = 'test-webhook-secret';
  const timestamp = 1_780_000_000;

  function signedHeaders(body = rawBody, at = timestamp) {
    return new Headers({
      'X-SePay-Timestamp': String(at),
      'X-SePay-Signature': `sha256=${requireHmac(body, at, secret)}`,
    });
  }

  it('accepts the raw-body HMAC and rejects altered, replayed, or malformed signatures', () => {
    expect(
      verifySepaySignature(rawBody, signedHeaders(), secret, timestamp),
    ).toBe(true);
    expect(
      verifySepaySignature(`${rawBody} `, signedHeaders(), secret, timestamp),
    ).toBe(false);
    expect(
      verifySepaySignature(
        rawBody,
        signedHeaders(rawBody, timestamp - 301),
        secret,
        timestamp,
      ),
    ).toBe(false);
    expect(
      verifySepaySignature(
        rawBody,
        new Headers({
          'X-SePay-Timestamp': String(timestamp),
          'X-SePay-Signature': 'bad',
        }),
        secret,
        timestamp,
      ),
    ).toBe(false);
  });

  it('validates the payment payload and builds a QR with amount and unique code', () => {
    const payload = sepayWebhookPayloadSchema.parse({
      id: 123,
      gateway: 'TestBank',
      transactionDate: '2026-09-05 10:00:00',
      accountNumber: '123456789',
      code: 'KTABC123456',
      transferType: 'in',
      transferAmount: 49_000,
      referenceCode: 'REF-1',
    });
    expect(payload.transferAmount).toBe(49_000);
    const old = {
      bank: process.env.SEPAY_BANK_CODE,
      account: process.env.SEPAY_ACCOUNT_NUMBER,
      holder: process.env.SEPAY_ACCOUNT_HOLDER,
    };
    process.env.SEPAY_BANK_CODE = 'VCB';
    process.env.SEPAY_ACCOUNT_NUMBER = '123456789';
    process.env.SEPAY_ACCOUNT_HOLDER = 'KIM TUYEN';
    const url = new URL(
      buildSepayQrUrl({ amountVnd: 49_000, orderCode: 'KTABC123456' }),
    );
    expect(url.hostname).toBe('vietqr.app');
    expect(url.searchParams.get('amount')).toBe('49000');
    expect(url.searchParams.get('des')).toBe('KTABC123456');
    if (old.bank === undefined) delete process.env.SEPAY_BANK_CODE;
    else process.env.SEPAY_BANK_CODE = old.bank;
    if (old.account === undefined) delete process.env.SEPAY_ACCOUNT_NUMBER;
    else process.env.SEPAY_ACCOUNT_NUMBER = old.account;
    if (old.holder === undefined) delete process.env.SEPAY_ACCOUNT_HOLDER;
    else process.env.SEPAY_ACCOUNT_HOLDER = old.holder;
  });

  it('rejects wrong account, amount, code, direction, status, and expiry', () => {
    const payload = sepayWebhookPayloadSchema.parse({
      id: 123,
      gateway: 'TestBank',
      transactionDate: '2026-09-05 10:00:00',
      accountNumber: '999',
      code: null,
      transferType: 'out',
      transferAmount: 1,
    });
    const result = validateSepayPayment({
      payload,
      expectedAccount: '123',
      order: {
        amountVnd: 49_000,
        status: 'paid',
        expiresAt: new Date('2026-09-04T00:00:00Z'),
      },
      now: new Date('2026-09-05T00:00:00Z'),
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('tài khoản nhận không khớp');
    expect(result.reason).toContain('số tiền không khớp');
    expect(result.reason).toContain('thiếu mã đơn hàng');
    expect(result.reason).toContain('không phải giao dịch tiền vào');
    expect(result.reason).toContain('đơn hàng không ở trạng thái chờ');
    expect(result.reason).toContain('đơn hàng đã hết hạn');
  });

  it('accepts a webhook delivered late when the transfer happened before expiry', () => {
    const payload = sepayWebhookPayloadSchema.parse({
      id: 124,
      gateway: 'MBBank',
      transactionDate: '2026-09-05 10:00:00',
      accountNumber: '123',
      code: 'DNABC123456',
      transferType: 'in',
      transferAmount: 49_000,
      referenceCode: 'REF-LATE',
    });
    const result = validateSepayPayment({
      payload,
      expectedAccount: '123',
      order: {
        amountVnd: 49_000,
        status: 'expired',
        expiresAt: new Date('2026-09-05T11:00:00+07:00'),
      },
      transactionDate: new Date('2026-09-05T10:00:00+07:00'),
      now: new Date('2026-09-06T00:00:00+07:00'),
    });
    expect(result).toEqual({ valid: true, reason: '' });
  });
});

function requireHmac(body: string, timestamp: number, secret: string) {
  // Keep test signing identical to SePay's documented `${timestamp}.${rawBody}` contract.
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}
