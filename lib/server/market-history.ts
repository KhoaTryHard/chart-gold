import { and, desc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { vietnamDate } from '@/lib/analysis/dates';

import { getDatabase, withDatabaseAdvisoryLock } from '@/db';
import {
  marketHistoryFetchAttempts,
  marketHistoryPoints,
  marketHistorySyncRuns,
} from '@/db/schema';
import {
  buildHistoryCoverage,
  enumerateCalendarDates,
  getCalendarWindow,
  type MarketHistoryPoint,
  type MarketHistoryResponse,
} from '@/lib/market-history';
import {
  getMarketCompany,
  getMarketHistoryCapability,
  getMarketProduct,
  getMarketProducts,
  isMarketProductSelectable,
} from '@/lib/market-sources';
import {
  fetchPnjHistoryPayload,
  parsePnjHistoryEntry,
  PnjHistoryFetchError,
  type PnjProduct,
} from '@/lib/server/pnj';
import { fetchSjcHistoricalCsv } from '@/lib/server/sjc';
import type { PricePoint } from '@/lib/server/sjc';
import {
  fetchBtmhHistory,
  fetchBtmhRates,
  parseBtmhQuote,
  toPoint as btmhToPoint,
  type BtmhProduct,
} from '@/lib/server/btmh';

const PNJ_PROVIDER = 'PNJ official history';
const PNJ_HISTORY_URL =
  'https://edge-cf-api.pnj.io/ecom-frontend/v1/get-gold-price-history';
const SJC_PROVIDER = 'SJC-price dataset';
const SJC_HISTORY_URL =
  'https://github.com/vkhuy/SJC-price/blob/main/docs/data/sjc_final.csv';
const BTMH_PROVIDER = 'Bảo Tín Mạnh Hải official history';
const BTMH_HISTORY_URL = 'https://baotinmanhhai.vn/api/graphql';
const BTMH_LIVE_PROVIDER = 'Bảo Tín Mạnh Hải official';

type PointStatus = 'ok' | 'missing' | 'error';
type RunStatus = 'running' | 'completed' | 'partial' | 'failed';
export type SyncOutcome = Omit<SyncSummary, 'status'> & {
  status: RunStatus | 'skipped_locked';
};

export type SyncSummary = {
  provider: string;
  companyId: string;
  productId: string;
  requestedStart: string;
  requestedEnd: string;
  expectedDays: number;
  okDays: number;
  missingDays: number;
  errorDays: number;
  status: RunStatus;
};

type StoredPoint = {
  provider: string;
  companyId: string;
  productId: string;
  region?: string | null;
  date: string;
  buyVndPerLuong?: number | null;
  sellVndPerLuong?: number | null;
  publishedAt?: Date | null;
  sourceUrl: string;
  status: PointStatus;
  errorMessage?: string | null;
  rawPayload?: Record<string, unknown> | null;
};

function toVnd(value: number) {
  return Math.round(value * 1_000_000);
}

function asVndPoint(point: { date: string; buy: number; sell: number }) {
  return {
    date: point.date,
    buyVndPerLuong: toVnd(point.buy),
    sellVndPerLuong: toVnd(point.sell),
  };
}

async function upsertPoint(point: StoredPoint) {
  const db = getDatabase();
  const retrievedAt = new Date();
  await db.insert(marketHistoryFetchAttempts).values({
    provider: point.provider,
    companyId: point.companyId,
    productId: point.productId,
    region: point.region ?? '',
    date: point.date,
    status: point.status,
    sourceUrl: point.sourceUrl,
    errorMessage: point.errorMessage ?? null,
    rawPayload: point.rawPayload ?? null,
    retrievedAt,
  });
  if (point.status !== 'ok') {
    const [existing] = await db
      .select({ status: marketHistoryPoints.status })
      .from(marketHistoryPoints)
      .where(
        and(
          eq(marketHistoryPoints.provider, point.provider),
          eq(marketHistoryPoints.companyId, point.companyId),
          eq(marketHistoryPoints.productId, point.productId),
          eq(marketHistoryPoints.region, point.region ?? ''),
          eq(marketHistoryPoints.date, point.date),
        ),
      )
      .limit(1);
    if (existing?.status === 'ok') return;
  }
  await db
    .insert(marketHistoryPoints)
    .values({
      ...point,
      region: point.region ?? '',
      retrievedAt,
    })
    .onConflictDoUpdate({
      target: [
        marketHistoryPoints.provider,
        marketHistoryPoints.companyId,
        marketHistoryPoints.productId,
        marketHistoryPoints.region,
        marketHistoryPoints.date,
      ],
      set: {
        buyVndPerLuong: point.buyVndPerLuong ?? null,
        sellVndPerLuong: point.sellVndPerLuong ?? null,
        publishedAt: point.publishedAt ?? null,
        retrievedAt,
        sourceUrl: point.sourceUrl,
        status: point.status,
        errorMessage: point.errorMessage ?? null,
        rawPayload: point.rawPayload ?? null,
      },
    });
}

async function completedPnjDates(
  products: readonly PnjProduct[],
  requestedStart: string,
  requestedEnd: string,
) {
  const db = getDatabase();
  const rows = await db
    .select({
      date: marketHistoryPoints.date,
      productId: marketHistoryPoints.productId,
      status: marketHistoryPoints.status,
    })
    .from(marketHistoryPoints)
    .where(
      and(
        eq(marketHistoryPoints.provider, PNJ_PROVIDER),
        eq(marketHistoryPoints.companyId, 'pnj'),
        gte(marketHistoryPoints.date, requestedStart),
        lte(marketHistoryPoints.date, requestedEnd),
      ),
    );
  const statuses = new Map<string, Map<string, PointStatus>>();
  for (const row of rows) {
    const date = String(row.date);
    const byProduct = statuses.get(date) ?? new Map<string, PointStatus>();
    byProduct.set(row.productId, row.status);
    statuses.set(date, byProduct);
  }
  return new Set(
    [...statuses.entries()]
      .filter(([, byProduct]) =>
        products.every((product) => {
          const status = byProduct.get(product.id);
          return status === 'ok' || status === 'missing';
        }),
      )
      .map(([date]) => date),
  );
}

async function createSyncRun(
  syncKey: string,
  provider: string,
  companyId: string,
  productId: string,
  requestedStart: string,
  requestedEnd: string,
  expectedDays = enumerateCalendarDates(requestedStart, requestedEnd).length,
) {
  const db = getDatabase();
  await db
    .update(marketHistorySyncRuns)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      message: 'Tiến trình đồng bộ trước đó đã bị gián đoạn.',
    })
    .where(
      and(
        eq(marketHistorySyncRuns.syncKey, syncKey),
        eq(marketHistorySyncRuns.status, 'running'),
      ),
    );
  const [run] = await db
    .insert(marketHistorySyncRuns)
    .values({
      syncKey,
      provider,
      companyId,
      productId,
      requestedStart,
      requestedEnd,
      status: 'running',
      expectedDays,
    })
    .returning({ id: marketHistorySyncRuns.id });
  return run!.id;
}

async function finishSyncRun(
  id: string,
  summary: Omit<SyncSummary, 'provider' | 'companyId' | 'productId'>,
  message: string | null = null,
) {
  const db = getDatabase();
  await db
    .update(marketHistorySyncRuns)
    .set({
      status: summary.status,
      expectedDays: summary.expectedDays,
      okDays: summary.okDays,
      missingDays: summary.missingDays,
      errorDays: summary.errorDays,
      message,
      finishedAt: new Date(),
    })
    .where(eq(marketHistorySyncRuns.id, id));
}

function emptySummary(
  provider: string,
  companyId: string,
  productId: string,
  requestedStart: string,
  requestedEnd: string,
): SyncSummary {
  return {
    provider,
    companyId,
    productId,
    requestedStart,
    requestedEnd,
    expectedDays: enumerateCalendarDates(requestedStart, requestedEnd).length,
    okDays: 0,
    missingDays: 0,
    errorDays: 0,
    status: 'completed',
  };
}

async function retry<T>(work: () => Promise<T>, attempts = 3) {
  let error: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await work();
    } catch (nextError) {
      error = nextError;
      if (nextError instanceof PnjHistoryFetchError && nextError.status === 429) {
        if (index < attempts - 1) {
          await wait(Math.min(nextError.retryAfterMs ?? 1_000, 30_000));
          continue;
        }
        throw nextError;
      }
      if (index < attempts - 1)
        await new Promise((resolve) => setTimeout(resolve, 250 * (index + 1)));
    }
  }
  throw error;
}

async function retryUntil<T>(
  work: () => Promise<T>,
  deadlineAt: number,
  attempts = 3,
) {
  let error: unknown;
  for (let index = 0; index < attempts; index += 1) {
    if (Date.now() >= deadlineAt)
      throw new Error('Đồng bộ lịch sử vượt thời gian cho phép.');
    try {
      return await work();
    } catch (nextError) {
      error = nextError;
      if (index >= attempts - 1) throw nextError;
      const requestedWait =
        nextError instanceof PnjHistoryFetchError
          ? (nextError.retryAfterMs ?? 1_000)
          : 250 * (index + 1);
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) throw nextError;
      await wait(Math.min(requestedWait, remaining));
    }
  }
  throw error;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  limit: number,
  work: (value: T) => Promise<void>,
) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (cursor < values.length) {
        const current = values[cursor++];
        await work(current);
      }
    }),
  );
}

export async function syncSjcBarHistory(
  requestedStart: string,
  requestedEnd: string,
) {
  const syncKey = 'market-history:sjc:bar-1l';
  const summary = await withDatabaseAdvisoryLock(syncKey, async () => {
    const summary = emptySummary(
      SJC_PROVIDER,
      'sjc',
      'bar-1l',
      requestedStart,
      requestedEnd,
    );
    const runId = await createSyncRun(
      syncKey,
      SJC_PROVIDER,
      'sjc',
      'bar-1l',
      requestedStart,
      requestedEnd,
    );
    try {
      const csv = await retry(() => fetchSjcHistoricalCsv());
      const byDate = new Map(csv.map((point) => [point.date, point]));
      await mapWithConcurrency(
        enumerateCalendarDates(requestedStart, requestedEnd),
        2,
        async (date) => {
          const point = byDate.get(date);
          if (!point) {
            summary.missingDays += 1;
            await upsertPoint({
              provider: SJC_PROVIDER,
              companyId: 'sjc',
              productId: 'bar-1l',
              date,
              sourceUrl: SJC_HISTORY_URL,
              status: 'missing',
              rawPayload: { reason: 'No daily observation in source dataset' },
            });
            return;
          }
          summary.okDays += 1;
          await upsertPoint({
            provider: SJC_PROVIDER,
            companyId: 'sjc',
            productId: 'bar-1l',
            ...asVndPoint(point),
            sourceUrl: SJC_HISTORY_URL,
            status: 'ok',
            rawPayload: { source: 'sjc_final.csv' },
          });
        },
      );
    } catch (error) {
      summary.status = 'failed';
      summary.errorDays = summary.expectedDays;
      await finishSyncRun(
        runId,
        summary,
        error instanceof Error ? error.message : 'Không thể nhập lịch sử SJC.',
      );
      throw error;
    }
    await finishSyncRun(runId, summary);
    return summary;
  });
  return summary ?? ({
    ...emptySummary(SJC_PROVIDER, 'sjc', 'bar-1l', requestedStart, requestedEnd),
    status: 'skipped_locked' as const,
  } satisfies SyncOutcome);
}

export async function syncPnjHistory(
  requestedStart: string,
  requestedEnd: string,
) {
  const syncKey = 'market-history:pnj:all';
  const summary = await withDatabaseAdvisoryLock(syncKey, async () => {
    const deadlineAt = Date.now() + 240_000;
    const products = getMarketProducts('pnj').filter(
      (product): product is PnjProduct =>
        product.companyId === 'pnj' && isMarketProductSelectable(product),
    );
    const summary = emptySummary(
      PNJ_PROVIDER,
      'pnj',
      '*',
      requestedStart,
      requestedEnd,
    );
    const runId = await createSyncRun(
      syncKey,
      PNJ_PROVIDER,
      'pnj',
      '*',
      requestedStart,
      requestedEnd,
      summary.expectedDays * products.length,
    );
    summary.expectedDays *= products.length;
    try {
      const completedDates = await completedPnjDates(
        products,
        requestedStart,
        requestedEnd,
      );
      const dates = enumerateCalendarDates(requestedStart, requestedEnd);
      const forceRefresh = dates.length <= 7;
      for (const date of dates) {
        if (Date.now() >= deadlineAt) {
          summary.status = 'partial';
          await finishSyncRun(runId, summary, 'Đồng bộ được tiếp tục ở lần chạy sau.');
          return summary;
        }
        if (!forceRefresh && completedDates.has(date)) {
          const prior = await getDatabase()
            .select({ status: marketHistoryPoints.status })
            .from(marketHistoryPoints)
            .where(
              and(
                eq(marketHistoryPoints.provider, PNJ_PROVIDER),
                eq(marketHistoryPoints.companyId, 'pnj'),
                eq(marketHistoryPoints.date, date),
              ),
            );
          summary.okDays += prior.filter((point) => point.status === 'ok').length;
          summary.missingDays += prior.filter(
            (point) => point.status === 'missing',
          ).length;
          continue;
        }
        let payload;
        try {
          payload = await retryUntil(
            () => fetchPnjHistoryPayload(date),
            deadlineAt,
          );
        } catch (error) {
          await Promise.all(
            products.map(async (product) => {
              summary.errorDays += 1;
              await upsertPoint({
                provider: PNJ_PROVIDER,
                companyId: 'pnj',
                productId: product.id,
                region: product.officialLocation,
                date,
                sourceUrl: PNJ_HISTORY_URL,
                status: 'error',
                errorMessage:
                  error instanceof Error
                    ? error.message
                    : 'Không tải được lịch sử PNJ.',
              });
            }),
          );
          if (error instanceof PnjHistoryFetchError && error.status === 429) {
            summary.status = 'failed';
            await finishSyncRun(
              runId,
              summary,
              `PNJ giới hạn tốc độ; thử lại sau ${Math.ceil((error.retryAfterMs ?? 60_000) / 1_000)} giây.`,
            );
            return summary;
          }
          continue;
        }
        await Promise.all(
          products.map(async (product) => {
            const entry = parsePnjHistoryEntry(payload, product, date);
            if (!entry) {
              summary.missingDays += 1;
              await upsertPoint({
                provider: PNJ_PROVIDER,
                companyId: 'pnj',
                productId: product.id,
                region: product.officialLocation,
                date,
                sourceUrl: PNJ_HISTORY_URL,
                status: 'missing',
                rawPayload: { reason: 'No valid matching quote for day' },
              });
              return;
            }
            summary.okDays += 1;
            await upsertPoint({
              provider: PNJ_PROVIDER,
              companyId: 'pnj',
              productId: product.id,
              region: product.officialLocation,
              ...asVndPoint(entry.point),
              publishedAt: new Date(entry.observedAt),
              sourceUrl: PNJ_HISTORY_URL,
              status: 'ok',
              rawPayload: entry.raw as Record<string, unknown>,
            });
          }),
        );
        // Keep the date requests below the upstream rate limit while one
        // response continues to serve every PNJ product and region.
        await wait(Math.min(3_000, Math.max(0, deadlineAt - Date.now())));
      }
    } catch (error) {
      summary.status = 'failed';
      await finishSyncRun(
        runId,
        summary,
        error instanceof Error ? error.message : 'Không thể nhập lịch sử PNJ.',
      );
      throw error;
    }
    summary.status = summary.errorDays ? 'partial' : 'completed';
    await finishSyncRun(
      runId,
      summary,
      summary.errorDays ? 'Một số ngày PNJ chưa tải được.' : null,
    );
    return summary;
  });
  return summary ?? ({
    ...emptySummary(PNJ_PROVIDER, 'pnj', '*', requestedStart, requestedEnd),
    expectedDays:
      enumerateCalendarDates(requestedStart, requestedEnd).length *
      getMarketProducts('pnj').filter(
        (product): product is PnjProduct =>
          product.companyId === 'pnj' && isMarketProductSelectable(product),
      ).length,
    status: 'skipped_locked' as const,
  } satisfies SyncOutcome);
}

/**
 * Import the published BTMH series and record today's verified prices. The
 * chart endpoint has no weight metadata, so Tiểu Kim Cát is deliberately
 * excluded from backfill and is stored only from its currently verified size.
 */
export async function syncBtmhHistory(
  requestedStart: string,
  requestedEnd: string,
) {
  const syncKey = 'market-history:btmh:all';
  const outcome = await withDatabaseAdvisoryLock(syncKey, async () => {
    const products = getMarketProducts('btmh').filter(
      (product): product is BtmhProduct =>
        product.companyId === 'btmh' &&
        isMarketProductSelectable(product) &&
        Boolean(product.officialKey) &&
        product.weightInLuong !== null,
    );
    const chartProducts = products.filter(
      (product) => product.id !== 'btmh-bt-tkc',
    );
    const dates = enumerateCalendarDates(requestedStart, requestedEnd);
    const summary = emptySummary(
      BTMH_PROVIDER,
      'btmh',
      '*',
      requestedStart,
      requestedEnd,
    );
    summary.expectedDays = dates.length * chartProducts.length;
    const runId = await createSyncRun(
      syncKey,
      BTMH_PROVIDER,
      'btmh',
      '*',
      requestedStart,
      requestedEnd,
      summary.expectedDays,
    );
    const deadlineAt = Date.now() + 220_000;
    try {
      // This current quote collection is also the daily verified history seed
      // for Tiểu Kim Cát; it never consumes the ambiguous historical series.
      try {
        const current = await retry(() => fetchBtmhRates());
        await Promise.all(
          products.map(async (product) => {
            try {
              const quote = parseBtmhQuote(current, product);
              const date = vietnamDate(new Date(quote.observedAt));
              if (date < requestedStart || date > requestedEnd) return;
              const point = btmhToPoint(
                date,
                quote.buy * 1_000_000,
                quote.sell * 1_000_000,
              );
              await upsertPoint({
                provider: BTMH_LIVE_PROVIDER,
                companyId: 'btmh',
                productId: product.id,
                ...asVndPoint(point),
                publishedAt: new Date(quote.observedAt),
                sourceUrl: BTMH_HISTORY_URL,
                status: 'ok',
                rawPayload: { code: product.officialKey, source: 'goldRates' },
              });
            } catch {
              // Other published products can still seed history independently.
            }
          }),
        );
      } catch {
        // The official chart API remains an independent best-effort source.
      }

      const existingRows = await getDatabase()
        .select({
          productId: marketHistoryPoints.productId,
          date: marketHistoryPoints.date,
          status: marketHistoryPoints.status,
        })
        .from(marketHistoryPoints)
        .where(
          and(
            eq(marketHistoryPoints.provider, BTMH_PROVIDER),
            eq(marketHistoryPoints.companyId, 'btmh'),
            inArray(
              marketHistoryPoints.productId,
              products.map((product) => product.id),
            ),
            gte(marketHistoryPoints.date, requestedStart),
            lte(marketHistoryPoints.date, requestedEnd),
          ),
        );
      const existing = new Map(
        existingRows.map((row) => [
          `${row.productId}:${row.date}`,
          row.status,
        ]),
      );
      const forceRefresh = dates.length <= 7;

      await mapWithConcurrency(chartProducts, 2, async (product) => {
        const todo = dates.filter((date) => {
          const status = existing.get(`${product.id}:${date}`);
          return (
            forceRefresh ||
            (status !== 'ok' && status !== 'missing')
          );
        });
        if (!todo.length) {
          for (const date of dates) {
            const status = existing.get(`${product.id}:${date}`);
            if (status === 'ok') summary.okDays += 1;
            else if (status === 'missing') summary.missingDays += 1;
          }
          return;
        }

        let history: PricePoint[] = [];
        let fetchError: unknown;
        if (Date.now() >= deadlineAt) {
          fetchError = new Error('BTMH history sync deadline reached');
        } else {
          const start = todo[0]!;
          const end = todo.at(-1)!;
          try {
            history = await retryUntil(
              () => fetchBtmhHistory(product, start, end),
              deadlineAt,
            );
          } catch (error) {
            fetchError = error;
          }
        }
        const byDate = new Map(history.map((point) => [point.date, point]));

        await mapWithConcurrency(todo, 2, async (date) => {
          if (fetchError) {
            summary.errorDays += 1;
            await upsertPoint({
              provider: BTMH_PROVIDER,
              companyId: 'btmh',
              productId: product.id,
              date,
              sourceUrl: BTMH_HISTORY_URL,
              status: 'error',
              errorMessage:
                fetchError instanceof Error
                  ? fetchError.message
                  : 'Không tải được lịch sử BTMH.',
            });
            return;
          }
          const point = byDate.get(date);
          if (!point) {
            summary.missingDays += 1;
            await upsertPoint({
              provider: BTMH_PROVIDER,
              companyId: 'btmh',
              productId: product.id,
              date,
              sourceUrl: BTMH_HISTORY_URL,
              status: 'missing',
              rawPayload: { reason: 'No official BTMH quote for this day' },
            });
            return;
          }
          summary.okDays += 1;
          await upsertPoint({
            provider: BTMH_PROVIDER,
            companyId: 'btmh',
            productId: product.id,
            ...asVndPoint(point),
            sourceUrl: BTMH_HISTORY_URL,
            status: 'ok',
            rawPayload: { code: product.officialKey, source: 'goldChartData' },
          });
        });
      });
    } catch (error) {
      summary.status = 'failed';
      summary.errorDays = Math.max(
        summary.errorDays,
        summary.expectedDays - summary.okDays - summary.missingDays,
      );
      await finishSyncRun(
        runId,
        summary,
        error instanceof Error ? error.message : 'Không thể nhập lịch sử BTMH.',
      );
      throw error;
    }

    summary.status = summary.errorDays ? 'partial' : 'completed';
    await finishSyncRun(
      runId,
      summary,
      summary.errorDays ? 'Một số ngày BTMH chưa tải được.' : null,
    );
    return summary;
  });

  return outcome ?? ({
    ...emptySummary(BTMH_PROVIDER, 'btmh', '*', requestedStart, requestedEnd),
    expectedDays:
      enumerateCalendarDates(requestedStart, requestedEnd).length *
      getMarketProducts('btmh').filter(
        (product) =>
          product.companyId === 'btmh' &&
          isMarketProductSelectable(product) &&
          product.id !== 'btmh-bt-tkc',
      ).length,
    status: 'skipped_locked' as const,
  } satisfies SyncOutcome);
}

export const HISTORY_SYNC_COMPANIES = ['sjc', 'pnj', 'btmh'] as const;
export type HistorySyncCompany = (typeof HISTORY_SYNC_COMPANIES)[number];

export function isHistorySyncCompany(
  value: string | null | undefined,
): value is HistorySyncCompany {
  return HISTORY_SYNC_COMPANIES.some((companyId) => companyId === value);
}

export async function syncAnnualMarketHistory(
  requestedStart: string,
  requestedEnd: string,
  company?: HistorySyncCompany,
) {
  const syncs: Array<Promise<SyncOutcome>> = [];
  if (!company || company === 'sjc')
    syncs.push(syncSjcBarHistory(requestedStart, requestedEnd));
  if (!company || company === 'pnj')
    syncs.push(syncPnjHistory(requestedStart, requestedEnd));
  if (!company || company === 'btmh')
    syncs.push(syncBtmhHistory(requestedStart, requestedEnd));
  const results = await Promise.all(syncs);
  return Object.fromEntries(
    results.map((result) => [result.companyId, result]),
  ) as Partial<Record<HistorySyncCompany, SyncOutcome>>;
}

export async function getAnnualMarketHistory(
  companyId: string,
  productId: string,
): Promise<MarketHistoryResponse> {
  const company = getMarketCompany(companyId);
  const product = getMarketProduct(company.id, productId);
  const { start: requestedStart, end: requestedEnd } = getCalendarWindow(365);
  const capability = getMarketHistoryCapability(company.id, product.id);
  if (capability !== 'annual') {
    return {
      companyId: company.id,
      productId: product.id,
      range: '1N',
      requestedStart,
      requestedEnd,
      actualStart: null,
      actualEnd: null,
      expectedDays: 365,
      availableDays: 0,
      missingDates: enumerateCalendarDates(requestedStart, requestedEnd),
      status: 'unavailable',
      records: [],
      source: null,
      latestSync: null,
    };
  }

  const db = getDatabase();
  const rows = await db
    .select()
    .from(marketHistoryPoints)
    .where(
      and(
        eq(marketHistoryPoints.companyId, company.id),
        eq(marketHistoryPoints.productId, product.id),
        gte(marketHistoryPoints.date, requestedStart),
        lte(marketHistoryPoints.date, requestedEnd),
      ),
    )
    .orderBy(desc(marketHistoryPoints.retrievedAt));
  const preferred = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!preferred.has(row.date)) preferred.set(row.date, row);
  }
  const expected = enumerateCalendarDates(requestedStart, requestedEnd);
  const values = expected.map((date) => preferred.get(date));
  const records = values.flatMap((row) =>
    row?.status === 'ok' &&
    row.buyVndPerLuong !== null &&
    row.sellVndPerLuong !== null
      ? [
          {
            date: row.date,
            buy: row.buyVndPerLuong / 1_000_000,
            sell: row.sellVndPerLuong / 1_000_000,
            spread:
              (row.sellVndPerLuong - row.buyVndPerLuong) / 1_000_000,
            eventId: null,
          } satisfies MarketHistoryPoint,
        ]
      : [],
  );
  const coverage = buildHistoryCoverage(
    expected,
    new Map(
      [...preferred.entries()].map(([date, row]) => [date, row.status]),
    ),
  );
  const [latestRun] = await db
    .select()
    .from(marketHistorySyncRuns)
    .where(
      and(
        eq(marketHistorySyncRuns.companyId, company.id),
        or(
          eq(marketHistorySyncRuns.productId, product.id),
          eq(marketHistorySyncRuns.productId, '*'),
        ),
      ),
    )
    .orderBy(desc(marketHistorySyncRuns.startedAt))
    .limit(1);
  const sourceRow = records.length
    ? rows.find((row) => row.status === 'ok')
    : rows[0];
  const source = sourceRow
    ? {
        provider: sourceRow.provider,
        url: sourceRow.sourceUrl,
        official: [PNJ_PROVIDER, BTMH_PROVIDER, BTMH_LIVE_PROVIDER].includes(
          sourceRow.provider,
        ),
        description:
          sourceRow.provider === SJC_PROVIDER
            ? 'Lịch sử tổng hợp/đối chiếu cho vàng miếng SJC 1 lượng.'
            : [BTMH_PROVIDER, BTMH_LIVE_PROVIDER].includes(sourceRow.provider)
              ? sourceRow.provider === BTMH_LIVE_PROVIDER
                ? 'Snapshot giá công bố trên website chính thức Bảo Tín Mạnh Hải; lịch sử Tiểu Kim Cát được tích lũy từ ngày tích hợp.'
                : 'Lịch sử giá vàng công bố trên website chính thức Bảo Tín Mạnh Hải.'
              : 'Lịch sử giá cuối ngày từ nguồn công bố PNJ.',
      }
    : null;
  return {
    companyId: company.id,
    productId: product.id,
    range: '1N',
    requestedStart,
    requestedEnd,
    actualStart: records[0]?.date ?? null,
    actualEnd: records.at(-1)?.date ?? null,
    expectedDays: expected.length,
    availableDays: records.length,
    missingDates: coverage.missingDates,
    status: coverage.status,
    records,
    source,
    latestSync: latestRun
      ? {
          status: latestRun.status,
          startedAt: latestRun.startedAt.toISOString(),
          finishedAt: latestRun.finishedAt?.toISOString() ?? null,
          message: latestRun.message,
        }
      : null,
  };
}

export function recentHistoryWindow() {
  return getCalendarWindow(7);
}
