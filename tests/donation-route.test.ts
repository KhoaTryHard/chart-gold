import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDonationOrder: vi.fn(),
  auth: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitKey: vi.fn(),
  tooManyRequests: vi.fn(),
}));

vi.mock('@/lib/billing/server', () => ({
  BillingError: class BillingError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: number,
    ) {
      super(message);
    }
  },
  createDonationOrder: mocks.createDonationOrder,
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/server/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitKey: mocks.rateLimitKey,
  requestAddress: vi.fn(() => '127.0.0.1'),
  tooManyRequests: mocks.tooManyRequests,
}));

import { POST } from '@/app/api/donations/orders/route';

function request(body: unknown, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/donations/orders', {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.clearAllMocks());

describe('donation order route', () => {
  beforeEach(() => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 1_000 });
    mocks.rateLimitKey.mockReturnValue('test-key');
    mocks.tooManyRequests.mockReturnValue(
      Response.json({ error: 'Quá nhiều yêu cầu.' }, { status: 429 }),
    );
  });
  it('validates the amount before creating an order', async () => {
    const response = await POST(request({ amountVnd: 99 }));
    expect(response.status).toBe(400);
    expect(mocks.createDonationOrder).not.toHaveBeenCalled();
  });

  it.each([1_000, 10_000_000])(
    'accepts the amount boundary %s VND',
    async (amountVnd) => {
      mocks.createDonationOrder.mockResolvedValue({
        id: `order-${amountVnd}`,
        amountVnd,
        orderCode: 'DNBOUNDARY1234',
        status: 'pending',
      });

      const response = await POST(request({ amountVnd }));

      expect(response.status).toBe(200);
      expect(mocks.createDonationOrder).toHaveBeenCalledWith({
        amountVnd,
        isAnonymous: true,
      });
    },
  );

  it.each([
    { amountVnd: 999 },
    { amountVnd: 10_000_001 },
    { amountVnd: 1_000.5 },
    { amountVnd: 'not-a-number' },
  ])('rejects malformed amount $amountVnd', async (body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(mocks.createDonationOrder).not.toHaveBeenCalled();
  });

  it('requires same-origin browser requests', async () => {
    const response = await POST(
      request({ amountVnd: 20_000 }, 'https://evil.example'),
    );
    expect(response.status).toBe(403);
    expect(mocks.createDonationOrder).not.toHaveBeenCalled();
  });

  it('returns rate-limit responses before creating an order', async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({
      allowed: false,
      retryAfterMs: 60_000,
    });

    const response = await POST(request({ amountVnd: 20_000 }));

    expect(response.status).toBe(429);
    expect(mocks.tooManyRequests).toHaveBeenCalledWith({
      allowed: false,
      retryAfterMs: 60_000,
    });
    expect(mocks.createDonationOrder).not.toHaveBeenCalled();
  });

  it('creates an anonymous donation order without authentication', async () => {
    mocks.createDonationOrder.mockResolvedValue({
      id: 'order-1',
      amountVnd: 20_000,
      orderCode: 'DNABC123456',
      status: 'pending',
    });
    const response = await POST(request({ amountVnd: 20_000 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      order: { orderCode: 'DNABC123456' },
    });
    expect(mocks.createDonationOrder).toHaveBeenCalledWith({
      amountVnd: 20_000,
      isAnonymous: true,
    });
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it('can create a named QR without authentication, but leaves identity resolution to the server', async () => {
    mocks.createDonationOrder.mockResolvedValue({
      id: 'order-2',
      amountVnd: 50_000,
      orderCode: 'DNNAMED12345',
      displayName: 'Nhà hảo tâm thử nghiệm',
      isAnonymous: false,
      status: 'pending',
    });
    const response = await POST(
      request({
        amountVnd: 50_000,
        isAnonymous: false,
        displayName: 'Nhà hảo tâm thử nghiệm',
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      order: {
        orderCode: 'DNNAMED12345',
        displayName: 'Nhà hảo tâm thử nghiệm',
      },
    });
    expect(mocks.createDonationOrder).toHaveBeenCalledWith({
      amountVnd: 50_000,
      isAnonymous: false,
      displayName: 'Nhà hảo tâm thử nghiệm',
    });
    expect(mocks.auth).toHaveBeenCalled();
  });

  it('requires a display name when anonymous mode is off', async () => {
    const response = await POST(
      request({ amountVnd: 50_000, isAnonymous: false, displayName: '   ' }),
    );
    expect(response.status).toBe(400);
    expect(mocks.createDonationOrder).not.toHaveBeenCalled();
  });
});
