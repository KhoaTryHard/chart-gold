import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMarketFetchDiagnostics, marketFetch, recordMarketAdapterFailure, withMarketFetch } from '@/lib/server/market-fetch';
afterEach(() => vi.unstubAllGlobals());
describe('public market request scheduling', () => {
  it('counts origin network work, shared promises and cache hits separately', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"price":1}')));
    const first = createMarketFetchDiagnostics();
    await withMarketFetch(new AbortController().signal, 1, () => Promise.all([
      marketFetch('https://diagnostics.example/shared?token=private'),
      marketFetch('https://diagnostics.example/shared?token=private'),
    ]), first);
    expect(first).toMatchObject({ networkRequests: 1, deduplicatedRequests: 1, cacheHits: 0 });
    const second = createMarketFetchDiagnostics();
    await withMarketFetch(new AbortController().signal, 1, () => marketFetch('https://diagnostics.example/shared?token=private'), second);
    expect(second).toMatchObject({ networkRequests: 0, deduplicatedRequests: 0, cacheHits: 1 });
    expect(JSON.stringify([first, second])).not.toMatch(/token|private|diagnostics.example/);
  });

  it('categorizes upstream HTTP, timeout, cancellation and parser failures without raw messages', async () => {
    const diagnostics = createMarketFetchDiagnostics();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('private body', { status: 503 }))
      .mockRejectedValueOnce(new DOMException('private timeout', 'TimeoutError'))
      .mockRejectedValueOnce(new DOMException('private cancellation', 'AbortError')));
    await withMarketFetch(new AbortController().signal, 1, async () => {
      expect((await marketFetch('https://diagnostics-failure.example/http')).status).toBe(503);
      for (const path of ['timeout', 'cancel']) {
        try { await marketFetch(`https://diagnostics-failure.example/${path}`); }
        catch (error) { recordMarketAdapterFailure(error); }
      }
      const parseError = new SyntaxError('private payload');
      recordMarketAdapterFailure(parseError);
      recordMarketAdapterFailure(parseError);
      recordMarketAdapterFailure(new Error('private adapter failure'));
    }, diagnostics);
    expect(diagnostics).toMatchObject({
      networkRequests: 3,
      upstreamHttpErrors: { 503: 1 },
      failures: { timeout: 1, cancelled: 1, invalid_payload: 1, adapter_error: 1 },
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/private|https:/);
  });

  it('isolates diagnostics between simultaneous requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
    const first = createMarketFetchDiagnostics();
    const second = createMarketFetchDiagnostics();
    await Promise.all([
      withMarketFetch(new AbortController().signal, 1, () => marketFetch('https://diagnostics-isolation.example/a'), first),
      withMarketFetch(new AbortController().signal, 1, async () => {
        await marketFetch('https://diagnostics-isolation.example/b');
        await marketFetch('https://diagnostics-isolation.example/c');
      }, second),
    ]);
    expect(first.networkRequests).toBe(1);
    expect(second.networkRequests).toBe(2);
  });

  it('deduplicates a shared URL and caches public responses across requests', async () => {
    const fetcher = vi.fn(async () => new Response('{"price":1}'));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    const responses = await withMarketFetch(signal, 1, () =>
      Promise.all(
        Array.from({ length: 8 }, () =>
          marketFetch('https://cache.example/day'),
        ),
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await responses[0].text()).toContain('price');
    expect(await responses[1].text()).toContain('price');
    await withMarketFetch(signal, 1, () =>
      marketFetch('https://cache.example/day'),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('caches opt-in read-only POSTs by query body and Store header', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      Response.json({ body: init?.body }),
    );
    vi.stubGlobal('fetch', fetcher);
    const run = (body: string, store = '/bang-gia-vang') =>
      withMarketFetch(new AbortController().signal, 1, () =>
        marketFetch(
          'https://btmh-cache.example/api/graphql',
          {
            method: 'POST',
            headers: { Accept: 'application/json', Store: store },
            body,
          },
          { cacheReadOnly: true },
        ),
      );
    const body = JSON.stringify({ query: 'goldRates', variables: { limit: 50 } });
    await run(body);
    await run(body);
    await run(JSON.stringify({ query: 'goldChartData', variables: { code: 'KGB' } }));
    await run(body, '/en/gold-prices');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('does not cache arbitrary POSTs', async () => {
    const fetcher = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetcher);
    const run = () =>
      withMarketFetch(new AbortController().signal, 1, () =>
        marketFetch('https://uncached-post.example/', {
          method: 'POST',
          body: 'mutation',
        }),
      );
    await run();
    await run();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('limits each host to four simultaneous upstream requests', async () => {
    let active = 0,
      max = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        active++;
        max = Math.max(max, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return new Response('ok');
      }),
    );
    await withMarketFetch(new AbortController().signal, 1, () =>
      Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          marketFetch(`https://pool.example/${i}`),
        ),
      ),
    );
    expect(max).toBe(4);
    expect(active).toBe(0);
  });
  it('aborts active and queued requests without leaking semaphore slots', async () => {
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init.signal!.addEventListener(
            'abort',
            () => reject(init.signal!.reason),
            { once: true },
          ),
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const pending = withMarketFetch(controller.signal, 1, () =>
      Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          marketFetch(`https://cancel.example/${i}`),
        ),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    const results = await pending;
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('recovered')),
    );
    expect(
      await (
        await withMarketFetch(new AbortController().signal, 1, () =>
          marketFetch('https://cancel.example/new'),
        )
      ).text(),
    ).toBe('recovered');
  });
});
