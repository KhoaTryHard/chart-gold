import { AsyncLocalStorage } from 'node:async_hooks';
import { marketFailureKind } from '@/lib/server/market-telemetry';

export type MarketFetchDiagnostics = {
  networkRequests: number;
  cacheHits: number;
  deduplicatedRequests: number;
  upstreamHttpErrors: Record<string, number>;
  failures: Record<string, number>;
};

export function createMarketFetchDiagnostics(): MarketFetchDiagnostics {
  return {
    networkRequests: 0,
    cacheHits: 0,
    deduplicatedRequests: 0,
    upstreamHttpErrors: {},
    failures: {},
  };
}

type Context = {
  signal: AbortSignal;
  historyDays: number;
  responses: Map<string, Promise<Response>>;
  diagnostics?: MarketFetchDiagnostics;
  reportedErrors: WeakSet<object>;
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
  diagnostics?: MarketFetchDiagnostics,
) {
  return context.run({ signal, historyDays, responses: new Map(), diagnostics, reportedErrors: new WeakSet() }, work);
}

/** Record caught adapter errors without serializing upstream messages or payloads. */
export function recordMarketAdapterFailure(error: unknown) {
  recordFailure(error, 'adapter_error');
}

function recordFailure(error: unknown, fallback: 'adapter_error' | 'network_error') {
  const active = context.getStore();
  if (!active?.diagnostics) return;
  if (error && typeof error === 'object') {
    if (active.reportedErrors.has(error)) return;
    active.reportedErrors.add(error);
  }
  const kind = marketFailureKind(error);
  const category = kind === 'operation_failed' ? fallback : kind;
  active.diagnostics.failures[category] = (active.diagnostics.failures[category] ?? 0) + 1;
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
  if (saved && saved.until > Date.now()) {
    if (active.diagnostics) active.diagnostics.cacheHits++;
    return new Response(saved.body, {
      status: saved.status,
      headers: saved.headers,
    });
  }
  const existing = active.responses.get(key);
  if (existing) {
    if (active.diagnostics) active.diagnostics.deduplicatedRequests++;
    return (await abortable(existing, active.signal)).clone();
  }
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
  let release: (() => void) | undefined;
  try {
    release = await acquire(new URL(url).host, parentSignal);
    parentSignal.throwIfAborted();
    // Timeout starts after acquiring the slot, not while waiting in the queue.
    const signal = AbortSignal.any([
      parentSignal,
      AbortSignal.timeout(7_000),
    ]);
    const diagnostics = context.getStore()?.diagnostics;
    if (diagnostics) diagnostics.networkRequests++;
    const response = await fetch(url, { ...init, signal });
    if (!response.ok && diagnostics) {
      const status = String(response.status);
      diagnostics.upstreamHttpErrors[status] = (diagnostics.upstreamHttpErrors[status] ?? 0) + 1;
    }
    return consume ? await consume(response) : response;
  } catch (error) {
    recordFailure(error, 'network_error');
    throw error;
  } finally {
    release?.();
  }
}
