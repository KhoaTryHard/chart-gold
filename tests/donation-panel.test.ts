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
let visibility: DocumentVisibilityState;
let online: boolean;
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

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
  visibility = 'visible'; online = true;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/public?')) return Response.json({ enabled: true, summary: {
      month: '2026-09', amountVnd: paid ? 160_000 : 140_000,
      donationCount: paid ? 5 : 4, operatingCostVnd: null, updatedAt: now.toISOString(),
    }, rows: paid
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
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('donation payment updates', () => {
  it('refreshes summary and leaderboard on an open visitor page without an order', async () => {
    await mount();
    expect(host.textContent).toContain('140.000');
    paid = true;
    await act(async () => vi.advanceTimersByTimeAsync(25_000));
    expect(host.querySelector('li')?.textContent).toContain('Phạm Anh');
    expect(host.textContent).toContain('160.000');
  });

  it('uses at most 25 public requests in ten visible idle minutes', async () => {
    await mount();
    await act(async () => vi.advanceTimersByTimeAsync(599_999));
    expect(fetchMock).toHaveBeenCalledTimes(25);
    expect(fetchMock.mock.calls.every(([url]) => url === '/api/donations/public?period=month')).toBe(true);
  });

  it('pauses public and payment polling while hidden or offline, then resumes immediately', async () => {
    await mount(true);
    fetchMock.mockClear();
    visibility = 'hidden';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).not.toHaveBeenCalled();
    visibility = 'visible'; online = false;
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(fetchMock).not.toHaveBeenCalled();
    paid = true; status = 'paid'; online = true;
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(host.textContent).toContain('Đã xác nhận lúc');
    expect(host.textContent).toContain('160.000');
  });

  it('restores a saved order when a page opened offline reconnects', async () => {
    online = false;
    await mount(true);
    expect(fetchMock).not.toHaveBeenCalled();
    online = true;
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(host.querySelector('img')?.getAttribute('src')).toBe(fixture.qrUrl);
    expect(localStorage.getItem('kim-tuyen-donation-access-token')).toBe(token);
  });

  it('confirms an active payment within three seconds and immediately refreshes public totals', async () => {
    await mount(true);
    fetchMock.mockClear();
    paid = true; status = 'paid';
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(host.textContent).toContain('Đã xác nhận lúc');
    expect(host.textContent).toContain('160.000');
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/public?'))).toHaveLength(1);
    fetchMock.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(9_000));
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/orders/'))).toHaveLength(0);
  });

  it('keeps confirmed public totals and donor rows when the next refresh fails', async () => {
    paid = true;
    await mount();
    fetchMock.mockResolvedValue(Response.json({ summary: null, rows: [] }, { status: 503 }));
    await act(async () => vi.advanceTimersByTimeAsync(25_000));
    expect(host.textContent).toContain('160.000');
    expect(host.querySelector('li')?.textContent).toContain('Phạm Anh');
  });

  it('does not overlap requests when several resume events arrive during an in-flight refresh', async () => {
    await mount();
    let resolve!: (response: Response) => void;
    fetchMock.mockClear();
    fetchMock.mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => resolve(Response.json({ summary: null, rows: [] })));
  });

  it('ignores an older public response after the leaderboard period changes', async () => {
    await mount();
    let resolveOld!: (response: Response) => void;
    let oldSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('period=month')) {
        oldSignal = init?.signal ?? undefined;
        return new Promise<Response>((done) => { resolveOld = done; });
      }
      return Promise.resolve(Response.json({ summary: null, rows: [
        { rank: 1, displayName: 'All-time donor', amountVnd: 70_000 },
      ] }));
    });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    const all = [...host.querySelectorAll('button')].find(b => b.textContent === 'Toàn thời gian')!;
    await act(async () => all.click());
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => resolveOld(Response.json({ summary: null, rows: [
      { rank: 1, displayName: 'Stale monthly donor', amountVnd: 20_000 },
    ] })));
    expect(host.textContent).toContain('All-time donor');
    expect(host.textContent).not.toContain('Stale monthly donor');
  });

  it('recovers a payment delivered after the QR expired without reloading the page', async () => {
    status = 'expired';
    await mount(true);
    expect(host.textContent).toContain('Mã QR đã hết hạn');
    fetchMock.mockClear();
    paid = true; status = 'paid';
    await act(async () => vi.advanceTimersByTimeAsync(29_000));
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/orders/'))).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(host.textContent).toContain('Đã xác nhận lúc');
    expect(host.textContent).not.toContain('Mã QR đã hết hạn');
    expect(host.querySelector('li')?.textContent).toContain('Phạm Anh');
    expect(host.textContent).toContain('160.000');
  });

  it.each(['paid', 'cancelled'])('does not keep polling a restored %s order', async (terminalStatus) => {
    status = terminalStatus; paid = status === 'paid';
    await mount(true);
    fetchMock.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/orders/'))).toHaveLength(0);
  });

  it('keeps checking a needs-review order every three seconds', async () => {
    status = 'needs_review';
    await mount(true);
    fetchMock.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(9_000));
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/orders/'))).toHaveLength(3);
  });

  it('checks an expired previous code every thirty seconds while its replacement remains pending', async () => {
    status = 'expired';
    await mount(true);
    const existingImplementation = fetchMock.getMockImplementation()!;
    const replacement = {
      ...fixture, id: '22222222-2222-4222-8222-222222222222',
      accessToken: 'replacement-donation-token', orderCode: 'DNNEW1234567',
    };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/donations/orders' || url.endsWith(replacement.id))
        return Promise.resolve(Response.json({ order: replacement }));
      return existingImplementation(url, init);
    });
    const create = [...host.querySelectorAll('button')].find(b => b.textContent === 'Tạo mã mới')!;
    await act(async () => create.click());
    fetchMock.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(9_000));
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith(fixture.id))).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith(replacement.id))).toHaveLength(3);
    await act(async () => vi.advanceTimersByTimeAsync(21_000));
    const previousPolls = fetchMock.mock.calls.filter(([url]) => url.endsWith(fixture.id));
    expect(previousPolls).toHaveLength(1);
    expect(new Headers(previousPolls[0][1]?.headers).get('x-donation-token')).toBe(token);
    paid = true; status = 'paid';
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(host.textContent).toContain('Khoản ủng hộ theo mã cũ đã được xác nhận');
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
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('/api/donations/public?');
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
