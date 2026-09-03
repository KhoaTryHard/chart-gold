import {
  index,
  integer,
  real,
  sqliteTable,
  text,
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
