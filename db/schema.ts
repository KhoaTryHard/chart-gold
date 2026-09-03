import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const goldSnapshots = sqliteTable(
  'gold_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    observedAt: text('observed_at').notNull().unique(),
    observedDate: text('observed_date').notNull(),
    buy: real('buy').notNull(),
    sell: real('sell').notNull(),
    provider: text('provider').notNull(),
    sourceUrl: text('source_url').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_gold_snapshots_date').on(table.observedDate)],
);

export const goldProductSnapshots = sqliteTable(
  'gold_product_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seriesId: text('series_id').notNull(),
    observedAt: text('observed_at').notNull(),
    observedDate: text('observed_date').notNull(),
    buy: real('buy').notNull(),
    sell: real('sell').notNull(),
    provider: text('provider').notNull(),
    sourceUrl: text('source_url').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_gold_product_snapshots_series_observed').on(
      table.seriesId,
      table.observedAt,
    ),
    index('idx_gold_product_snapshots_series_date').on(
      table.seriesId,
      table.observedDate,
    ),
  ],
);
