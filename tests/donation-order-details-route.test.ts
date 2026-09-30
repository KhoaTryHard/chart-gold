import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateDonationOrderDetails: vi.fn(),
  getDonationOrder: vi.fn(),
  auth: vi.fn(),
  BillingError: class BillingError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: number,
    ) {
      super(message);
    }
  },
}));

vi.mock('@/lib/billing/server', () => ({
  BillingError: mocks.BillingError,
  ensureSessionUser: vi.fn(),
  getDonationOrder: mocks.getDonationOrder,
  updateDonationOrderDetails: mocks.updateDonationOrderDetails,
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));

import { GET, PATCH } from '@/app/api/donations/orders/[id]/route';

const orderId = '11111111-1111-4111-8111-111111111111';

function request(body: unknown) {
  return new Request(
    'http://localhost:3000/api/donations/orders/11111111-1111-4111-8111-111111111111',
    {
      method: 'PATCH',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
}

function headerTokenRequest(body: unknown) {
  return new Request(
    'http://localhost:3000/api/donations/orders/11111111-1111-4111-8111-111111111111',
    {
      method: 'PATCH',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-donation-token': 'abcdefghijklmnop',
      },
      body: JSON.stringify(body),
    },
  );
}

function getRequest(token?: string) {
  return new Request(`http://localhost:3000/api/donations/orders/${orderId}`, {
    headers: token ? { 'x-donation-token': token } : undefined,
  });
}

afterEach(() => vi.clearAllMocks());

describe('donation order details route', () => {
  it('reads an order with the header access token without using a URL token', async () => {
    mocks.getDonationOrder.mockResolvedValue({
      id: orderId,
      orderCode: 'DNREAD123456',
      status: 'pending',
    });

    const response = await GET(getRequest('abcdefghijklmnop'), {
      params: Promise.resolve({ id: orderId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      order: { id: orderId, status: 'pending' },
    });
    expect(mocks.getDonationOrder).toHaveBeenCalledWith(
      orderId,
      null,
      'abcdefghijklmnop',
    );
  });

  it('rejects malformed order ids before reading billing data', async () => {
    const response = await GET(
      new Request('http://localhost:3000/api/donations/orders/not-a-uuid'),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.getDonationOrder).not.toHaveBeenCalled();
  });

  it('updates display details without replacing the order', async () => {
    mocks.updateDonationOrderDetails.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      orderCode: 'DNKEEP123456',
      displayName: 'Nguyen Van A',
      isAnonymous: false,
      status: 'pending',
    });
    const response = await PATCH(
      request({
        token: 'abcdefghijklmnop',
        isAnonymous: false,
        displayName: 'Nguyen Van A',
      }),
      {
        params: Promise.resolve({
          id: '11111111-1111-4111-8111-111111111111',
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      order: { orderCode: 'DNKEEP123456', displayName: 'Nguyen Van A' },
    });
    expect(mocks.updateDonationOrderDetails).toHaveBeenCalledWith({
      orderId: '11111111-1111-4111-8111-111111111111',
      accessToken: 'abcdefghijklmnop',
      user: null,
      isAnonymous: false,
      displayName: 'Nguyen Van A',
    });
  });

  it('rejects an empty public name before touching the order', async () => {
    const response = await PATCH(
      request({
        token: 'abcdefghijklmnop',
        isAnonymous: false,
        displayName: ' ',
      }),
      {
        params: Promise.resolve({
          id: '11111111-1111-4111-8111-111111111111',
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(mocks.updateDonationOrderDetails).not.toHaveBeenCalled();
  });

  it('accepts the donation access token in a header', async () => {
    mocks.updateDonationOrderDetails.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      orderCode: 'DNHEADER1234',
      isAnonymous: true,
      status: 'pending',
    });
    const response = await PATCH(
      headerTokenRequest({ isAnonymous: true }),
      {
        params: Promise.resolve({
          id: '11111111-1111-4111-8111-111111111111',
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(mocks.updateDonationOrderDetails).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'abcdefghijklmnop' }),
    );
  });

  it.each(['paid', 'expired'])(
    'surfaces a %s order as no longer editable',
    async () => {
      mocks.updateDonationOrderDetails.mockRejectedValue(
        new mocks.BillingError(
          'DONATION_NOT_EDITABLE',
          'Chỉ có thể sửa thông tin khi đơn đang chờ thanh toán.',
          409,
        ),
      );

      const response = await PATCH(
        headerTokenRequest({ isAnonymous: true }),
        { params: Promise.resolve({ id: orderId }) },
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: 'Chỉ có thể sửa thông tin khi đơn đang chờ thanh toán.',
        code: 'DONATION_NOT_EDITABLE',
      });
    },
  );
});
