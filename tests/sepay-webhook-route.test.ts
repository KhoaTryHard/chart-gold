import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  process: vi.fn(),
}));

vi.mock('@/lib/billing/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/config')>()),
  subscriptionsEnabled: mocks.enabled,
  donationsEnabled: () => false,
}));
vi.mock('@/lib/billing/server', () => ({
  processSepayTransaction: mocks.process,
}));

import { POST } from '@/app/api/webhooks/sepay/route';

const secret = 'webhook-test-secret';
const payload = {
  id: 92704,
  gateway: 'TestBank',
  transactionDate: '2026-09-05 11:08:33',
  accountNumber: '123456789',
  subAccount: '',
  code: 'KTABC123456',
  transferType: 'in',
  transferAmount: 49_000,
  referenceCode: 'REF-1',
};

function signedRequest(
  body: string,
  timestamp = Math.floor(Date.now() / 1_000),
) {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return new Request('http://localhost:3000/api/webhooks/sepay', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-SePay-Timestamp': String(timestamp),
      'X-SePay-Signature': `sha256=${signature}`,
    },
    body,
  });
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SEPAY_WEBHOOK_SECRET;
});

describe('SePay webhook route', () => {
  it('accepts a signed fixture and forwards the exact raw body', async () => {
    mocks.enabled.mockReturnValue(true);
    process.env.SEPAY_WEBHOOK_SECRET = secret;
    mocks.process.mockResolvedValue({
      status: 'accepted',
      periodStatus: 'active',
    });
    const rawBody = JSON.stringify(payload);
    const response = await POST(signedRequest(rawBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
    });
    expect(mocks.process).toHaveBeenCalledWith({ payload, rawBody });
  });

  it('rejects invalid HMAC and does not touch billing data', async () => {
    mocks.enabled.mockReturnValue(true);
    process.env.SEPAY_WEBHOOK_SECRET = secret;
    const request = signedRequest(JSON.stringify(payload));
    request.headers.set('X-SePay-Signature', 'sha256=' + '0'.repeat(64));
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it('acknowledges SePay dashboard test deliveries without processing them', async () => {
    mocks.enabled.mockReturnValue(true);
    process.env.SEPAY_WEBHOOK_SECRET = secret;
    const rawBody = JSON.stringify({ ...payload, id: 0 });
    const response = await POST(signedRequest(rawBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it('acknowledges deliveries while the rollout flag is disabled', async () => {
    mocks.enabled.mockReturnValue(false);
    const response = await POST(signedRequest(JSON.stringify(payload)));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      status: 'disabled',
    });
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
