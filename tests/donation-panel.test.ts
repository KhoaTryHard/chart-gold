// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DonationPanel } from '@/components/billing/donation-panel';

vi.mock('@/components/locale-provider', () => ({ useLocale: () => ({ locale: 'vi' }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const now = new Date('2026-09-15T10:00:00Z');
const token = 'fixture-donation-token-only';
const fixture = {
  id: '11111111-1111-4111-8111-111111111111', accessToken: null,
  amountVnd: 20_000, orderCode: 'DNABC1234567', displayName: 'Phạm Anh',
  isAnonymous: false, status: 'pending', paidAt: null,
  createdAt: now.toISOString(), serverTime: now.toISOString(),
  expiresAt: new Date(now.getTime() + 300_000).toISOString(),
  qrUrl: 'https://example.test/qr.png', bankCode: 'TEST',
  accountNumber: '123456789', accountHolder: 'E2E TEST',
};
let root: Root;
let host: HTMLDivElement;
let status: string;
let paid: boolean;
let pollingOffline: boolean;
let fetchMock: ReturnType<typeof vi.fn>;

async function mount(savedOrder = false) {
  if (savedOrder) {
    localStorage.setItem('kim-tuyen-donation-order', fixture.id);
    localStorage.setItem('kim-tuyen-donation-access-token', token);
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(DonationPanel)));
  await act(async () => vi.advanceTimersByTimeAsync(1));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  status = 'pending'; paid = false; pollingOffline = false;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/summary')) return Response.json({ summary: {
      month: '2026-09', amountVnd: paid ? 160_000 : 140_000,
      donationCount: paid ? 5 : 4, operatingCostVnd: null, updatedAt: now.toISOString(),
    } });
    if (url.includes('/leaderboard')) return Response.json({ rows: paid
      ? [{ rank: 1, displayName: 'Phạm Anh', amountVnd: 20_000 }] : [] });
    if (url.includes('/orders/')) {
      if (pollingOffline) throw new TypeError('offline');
      if (init?.method === 'PATCH') {
        return Response.json({ order: { ...fixture, ...JSON.parse(init.body as string), status } });
      }
      return Response.json({ order: { ...fixture, status, paidAt: paid ? now.toISOString() : null,
        qrUrl: status === 'pending' ? fixture.qrUrl : null } });
    }
    throw new Error(`Unexpected fixture request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('donation payment updates', () => {
  it('refreshes summary and leaderboard on an open visitor page without an order', async () => {
    await mount();
    expect(host.textContent).toContain('140.000');
    paid = true;
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(host.querySelector('li')?.textContent).toContain('Phạm Anh');
    expect(host.textContent).toContain('160.000');
  });

  it('recovers a payment delivered after the QR expired without reloading the page', async () => {
    status = 'expired';
    await mount(true);
    expect(host.textContent).toContain('Mã QR đã hết hạn');
    paid = true; status = 'paid';
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(host.textContent).toContain('Đã xác nhận lúc');
    expect(host.textContent).not.toContain('Mã QR đã hết hạn');
    expect(host.querySelector('li')?.textContent).toContain('Phạm Anh');
    expect(host.textContent).toContain('160.000');
  });

  it('keeps the access token after restoring and polling, so display details remain editable', async () => {
    await mount(true);
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    const edit = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Sửa thông tin'))!;
    await act(async () => edit.click());
    const save = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Lưu thông tin'))!;
    await act(async () => save.click());
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(new Headers(patch?.[1]?.headers).get('x-donation-token')).toBe(token);
    expect(patch?.[0]).not.toContain(token);
  });

  it('offers a manual status retry after an offline request and preserves the current order', async () => {
    await mount(true);
    pollingOffline = true;
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(host.textContent).toContain('Chưa kiểm tra được trạng thái');
    pollingOffline = false; paid = true; status = 'paid';
    const retry = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Kiểm tra thanh toán'))!;
    expect(retry).toBeDefined();
    await act(async () => retry.click());
    expect(host.textContent).toContain('Đã xác nhận lúc');
  });
});
