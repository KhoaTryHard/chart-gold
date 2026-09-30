import 'server-only';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { attachDatabasePool } from '@vercel/functions';

import * as schema from './schema';

type Database = ReturnType<typeof drizzle<typeof schema>>;
const globalForDatabase = globalThis as typeof globalThis & {
  __kimTuyenPool?: Pool;
  __kimTuyenDb?: Database;
};

export function getDatabase() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString)
    throw new Error('DATABASE_URL is required for B2C subscriptions.');
  if (!globalForDatabase.__kimTuyenPool) {
    globalForDatabase.__kimTuyenPool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    attachDatabasePool(globalForDatabase.__kimTuyenPool);
  }
  if (!globalForDatabase.__kimTuyenDb)
    globalForDatabase.__kimTuyenDb = drizzle(globalForDatabase.__kimTuyenPool, {
      schema,
    });
  return globalForDatabase.__kimTuyenDb;
}

export async function withDatabaseAdvisoryLock<T>(
  key: string,
  work: () => Promise<T>,
) {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString)
    throw new Error('DATABASE_URL is required for market history.');
  if (!globalForDatabase.__kimTuyenPool) getDatabase();
  const client = await globalForDatabase.__kimTuyenPool!.connect();
  const owner = randomUUID();
  const leaseMs = 30_000;
  try {
    const result = await client.query<{ owner: string }>(
      `insert into market_history_leases
         (key, owner, expires_at, heartbeat_at, updated_at)
       values ($1, $2, now() + ($3 * interval '1 millisecond'), now(), now())
       on conflict (key) do update set
         owner = excluded.owner,
         expires_at = excluded.expires_at,
         heartbeat_at = now(),
         updated_at = now()
       where market_history_leases.expires_at <= now()
       returning owner`,
      [key, owner, leaseMs],
    );
    if (result.rows[0]?.owner !== owner) return null;
    const heartbeat = setInterval(() => {
      void client
        .query(
          `update market_history_leases
           set expires_at = now() + ($3 * interval '1 millisecond'),
               heartbeat_at = now(), updated_at = now()
           where key = $1 and owner = $2`,
          [key, owner, leaseMs],
        )
        .catch(() => undefined);
    }, Math.floor(leaseMs / 3));
    try {
      return await work();
    } finally {
      clearInterval(heartbeat);
      await client.query(
        'delete from market_history_leases where key = $1 and owner = $2',
        [key, owner],
      );
    }
  } finally {
    client.release();
  }
}

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
) {
  if (!Number.isFinite(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1)
    throw new Error('Invalid rate limit configuration.');
  if (!globalForDatabase.__kimTuyenPool) getDatabase();
  const client = await globalForDatabase.__kimTuyenPool!.connect();
  try {
    await client.query('begin');
    const result = await client.query<{ count: number; retry_ms: number }>(
      `insert into request_rate_limit_buckets
        (key, window_start, count, expires_at, updated_at)
       values ($1, now(), 1, now() + ($2 * interval '1 millisecond'), now())
       on conflict (key) do update set
         window_start = case
           when request_rate_limit_buckets.expires_at <= now() then now()
           else request_rate_limit_buckets.window_start
         end,
         count = case
           when request_rate_limit_buckets.expires_at <= now() then 1
           else request_rate_limit_buckets.count + 1
         end,
         expires_at = case
           when request_rate_limit_buckets.expires_at <= now()
             then now() + ($2 * interval '1 millisecond')
           else request_rate_limit_buckets.expires_at
         end,
         updated_at = now()
       returning count, greatest(0, extract(epoch from (expires_at - now())) * 1000)::int as retry_ms`,
      [key, Math.ceil(windowMs)],
    );
    await client.query('commit');
    const row = result.rows[0];
    return {
      allowed: Boolean(row && row.count <= limit),
      retryAfterMs: Math.max(1_000, row?.retry_ms ?? windowMs),
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export type AppDatabase = ReturnType<typeof getDatabase>;
