import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { getDatabase } from '@/db';
import { marketQuoteSnapshots } from '@/db/schema';
import type { MarketData } from '@/lib/server/sjc';

const SNAPSHOT_TTL_MS = 4 * 60 * 1_000;

function regionFor(market: MarketData) {
  return 'officialLocation' in market.product
    ? (market.product.officialLocation ?? '')
    : '';
}

function isMarketData(value: unknown): value is MarketData {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Array.isArray((value as { records?: unknown }).records) &&
      typeof (value as { company?: { id?: unknown } }).company?.id === 'string' &&
      typeof (value as { product?: { id?: unknown } }).product?.id === 'string',
  );
}

export async function saveMarketQuoteSnapshot(market: MarketData) {
  if (market.mode !== 'live' || !market.latest) return;
  const fetchedAt = new Date(market.generatedAt);
  if (!Number.isFinite(fetchedAt.getTime())) return;
  const db = getDatabase();
  const source = market.source.provider;
  const region = regionFor(market);
  await db
    .insert(marketQuoteSnapshots)
    .values({
      purpose: 'live',
      source,
      companyId: market.company.id,
      productId: market.product.id,
      region,
      payload: market as unknown as Record<string, unknown>,
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + SNAPSHOT_TTL_MS),
      lastSuccessAt: fetchedAt,
    })
    .onConflictDoUpdate({
      target: [
        marketQuoteSnapshots.purpose,
        marketQuoteSnapshots.source,
        marketQuoteSnapshots.companyId,
        marketQuoteSnapshots.productId,
        marketQuoteSnapshots.region,
      ],
      set: {
        payload: market as unknown as Record<string, unknown>,
        fetchedAt,
        expiresAt: new Date(fetchedAt.getTime() + SNAPSHOT_TTL_MS),
        lastSuccessAt: fetchedAt,
      },
    });
}

export async function getLatestMarketQuoteSnapshot(
  companyId: string,
  productId: string,
) {
  const [snapshot] = await getDatabase()
    .select()
    .from(marketQuoteSnapshots)
    .where(
      and(
        eq(marketQuoteSnapshots.purpose, 'live'),
        eq(marketQuoteSnapshots.companyId, companyId),
        eq(marketQuoteSnapshots.productId, productId),
      ),
    )
    .orderBy(desc(marketQuoteSnapshots.fetchedAt))
    .limit(1);
  if (!snapshot || !isMarketData(snapshot.payload)) return null;
  return {
    market: snapshot.payload,
    fetchedAt: snapshot.fetchedAt,
    expiresAt: snapshot.expiresAt,
  };
}
