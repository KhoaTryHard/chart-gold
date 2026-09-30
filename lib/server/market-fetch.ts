import { AsyncLocalStorage } from 'node:async_hooks';

type Context = {
  signal: AbortSignal;
  historyDays: number;
  responses: Map<string, Promise<Response>>;
};
const context = new AsyncLocalStorage<Context>();
const cache = new Map<
  string,
  { until: number; body: string; status: number; headers: Headers }
>();
const pools = new Map<string, { active: number; queue: Array<() => void> }>();

export function marketHistoryDays(defaultDays: number) {
  return Math.min(defaultDays, context.getStore()?.historyDays ?? defaultDays);
}
export function isAnalysisFetch() {
  return Boolean(context.getStore());
}
export function withMarketFetch<T>(
  signal: AbortSignal,
  historyDays: number,
  work: () => Promise<T>,
) {
  return context.run({ signal, historyDays, responses: new Map() }, work);
}

export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

async function acquire(host: string, signal: AbortSignal) {
  const pool = pools.get(host) ?? { active: 0, queue: [] };
  pools.set(host, pool);
  if (pool.active < 4) {
    pool.active++;
    return () => release();
  }
  let wake: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    wake = resolve;
    pool.queue.push(wake);
  });
  try {
    await abortable(waiting, signal);
  } catch (error) {
    const index = pool.queue.indexOf(wake);
    if (index >= 0) pool.queue.splice(index, 1);
    else release();
    throw error;
  }
  return () => release();
  function release() {
    const next = pool.queue.shift();
    if (next) next();
    else pool.active--;
  }
}

/** Cache public GETs and explicitly opted-in read-only POSTs. */
export async function marketFetch(
  url: string,
  init: RequestInit = {},
  options: { cacheReadOnly?: boolean } = {},
): Promise<Response> {
  const active = context.getStore();
  // Existing dashboard callers keep their adapter-level caches.
  if (!active) return fetch(url, init);
  active.signal.throwIfAborted();
  const method = (init.method ?? 'GET').toUpperCase();
  const cacheable = method === 'GET' || options.cacheReadOnly === true;
  if (!cacheable) return fetchWithLimit(url, init, active.signal);
  const headers = new Headers(init.headers);
  const key = JSON.stringify([
    url,
    method,
    headers.get('Accept') ?? '',
    headers.get('Content-Type') ?? '',
    headers.get('Store') ?? '',
    typeof init.body === 'string' ? init.body : '',
  ]);
  const saved = cache.get(key);
  if (saved && saved.until > Date.now())
    return new Response(saved.body, {
      status: saved.status,
      headers: saved.headers,
    });
  const existing = active.responses.get(key);
  if (existing) return (await abortable(existing, active.signal)).clone();
  const pending = fetchWithLimit(url, init, active.signal, async (response) => {
    const body = await response.text();
    if (body.length > 8_000_000) throw new Error('Market response too large');
    if (response.ok) {
      for (const [savedKey, saved] of cache)
        if (saved.until <= Date.now()) cache.delete(savedKey);
      let cachedBytes = [...cache.values()].reduce(
        (total, entry) => total + entry.body.length * 2,
        0,
      );
      while (
        cache.size &&
        (cache.size >= 200 || cachedBytes + body.length * 2 > 32_000_000)
      ) {
        const oldest = cache.keys().next().value!;
        cachedBytes -= cache.get(oldest)!.body.length * 2;
        cache.delete(oldest);
      }
      cache.set(key, {
        body,
        status: response.status,
        headers: response.headers,
        until: Date.now() + 240_000,
      });
    }
    return new Response(body, { status: response.status, headers: response.headers });
  });
  active.responses.set(key, pending);
  return (await pending).clone();
}

async function fetchWithLimit(
  url: string,
  init: RequestInit,
  parentSignal: AbortSignal,
  consume?: (response: Response) => Promise<Response>,
) {
  const release = await acquire(new URL(url).host, parentSignal);
  try {
    parentSignal.throwIfAborted();
    // Timeout starts after acquiring the slot, not while waiting in the queue.
    const signal = AbortSignal.any([
      parentSignal,
      AbortSignal.timeout(7_000),
    ]);
    const response = await fetch(url, { ...init, signal });
    return consume ? consume(response) : response;
  } finally {
    release();
  }
}
