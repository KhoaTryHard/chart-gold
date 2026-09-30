import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  load: vi.fn(),
  analyze: vi.fn(),
  classify: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitKey: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/auth', () => ({
  auth: mocks.auth,
  isAdminEmail: (email: string) => email === 'admin@example.com',
}));
vi.mock('@/lib/analysis/market-context', () => ({
  loadMarketContext: mocks.load,
}));
vi.mock('@/lib/analysis/provider', () => ({
  classifyIntent: mocks.classify,
  createAnalysisProvider: () => ({ name: 'test', analyze: mocks.analyze }),
}));
vi.mock('@/lib/server/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitKey: mocks.rateLimitKey,
  tooManyRequests: vi.fn(),
}));
import { POST } from '@/app/api/analysis/route';
import { resolveIntent } from '@/lib/analysis/intent';
const body = {
  question: 'Giá vàng hôm nay?',
  companyId: 'sjc',
  productId: 'bar-1l',
  range: '7N',
  messages: [],
};
function req(
  payload: unknown = body,
  origin = 'http://localhost:3000',
  signal?: AbortSignal,
) {
  return new Request('http://localhost:3000/api/analysis', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}
function configure() {
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 1_000 });
  mocks.rateLimitKey.mockReturnValue('test-key');
  mocks.auth.mockResolvedValue({
    user: { email: 'admin@example.com', isAdmin: true },
  });
  mocks.classify.mockResolvedValue(resolveIntent(body.question));
  mocks.load.mockResolvedValue({
    context: {
      today: '2026-09-05',
      eligible: 0,
      requested: 0,
      rows: [],
      missing: [],
    },
    markets: [],
  });
  mocks.analyze.mockImplementation(async function* () {
    yield { type: 'delta', delta: 'Trả lời' };
    yield { type: 'done', model: 'test', usage: null };
  });
}
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
describe('analysis SSE route', () => {
  it('checks origin, authentication and the exact company/product pair', async () => {
    configure();
    expect((await POST(req(body, 'https://foreign.example'))).status).toBe(403);
    mocks.auth.mockResolvedValueOnce(null);
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req({ ...body, companyId: 'pnj' }))).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('rejects an invalid portfolio ledger before using a provider or quota', async () => {
    configure();
    const response = await POST(req({
      ...body,
      question: 'Hôm nay danh mục của tôi có chốt lời được chưa?',
      responseVersion: 2,
      locale: 'vi',
      goal: 'buy',
      usePortfolioLedger: true,
      portfolioLedger: {
        version: 1,
        transactions: [{
          id: 'oversold',
          date: '2026-09-05',
          side: 'sell',
          companyId: 'sjc',
          productId: 'bar-1l',
          quantityLuong: 1,
          unitPriceVnd: 150_000_000,
          feesVnd: 0,
          note: '',
        }],
      },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_LEDGER' });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it('streams progress before data resolves and includes metadata and completion', async () => {
    configure();
    let resolve!: (value: unknown) => void;
    mocks.load.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const response = await POST(req());
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      'Đang lấy giá',
    );
    resolve({
      context: { today: '2026-09-05', rows: [], missing: [] },
      markets: [],
    });
    let text = '';
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      text += new TextDecoder().decode(next.value);
    }
    expect(text).toContain('event: metadata');
    expect(text).toContain('event: done');
  });
  it('applies a 75s deadline to data loading and releases the busy state', async () => {
    configure();
    vi.useFakeTimers();
    mocks.load.mockImplementation(
      (_i, _c, _p, _r, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          }),
        ),
    );
    const response = await POST(req());
    const text = response.text();
    expect((await POST(req())).status).toBe(409);
    await vi.advanceTimersByTimeAsync(75_001);
    expect(await text).toContain('hết thời gian');
    configure();
    const next = await POST(req());
    expect(next.status).toBe(200);
    await next.text();
  });
  it('client cancellation releases the slot for another request', async () => {
    configure();
    const signal = new AbortController();
    mocks.load.mockImplementationOnce(
      (_i, _c, _p, _r, s: AbortSignal) =>
        new Promise((_resolve, reject) =>
          s.addEventListener('abort', () => reject(s.reason), { once: true }),
        ),
    );
    const response = await POST(req(body, undefined, signal.signal));
    await response.body!.cancel();
    configure();
    const second = await POST(req());
    expect(second.status).toBe(200);
    await second.text();
  });
});
