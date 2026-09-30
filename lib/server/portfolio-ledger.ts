import { asc, eq } from 'drizzle-orm';

import type { AppDatabase } from '@/db';
import { portfolioLedgerTransactions, portfolioLedgers } from '@/db/schema';
import { portfolioLedgerSchema } from '@/lib/portfolio-ledger';
import type { Session } from 'next-auth';

export async function readPortfolioLedgerForUser(
  userId: string,
  db?: AppDatabase,
) {
  const database = db ?? (await import('@/db')).getDatabase();
  let [ledger] = await database
    .select()
    .from(portfolioLedgers)
    .where(eq(portfolioLedgers.userId, userId))
    .limit(1);
  if (!ledger) {
    [ledger] = await database
      .insert(portfolioLedgers)
      .values({ userId })
      .onConflictDoNothing({ target: portfolioLedgers.userId })
      .returning();
    if (!ledger)
      [ledger] = await database
        .select()
        .from(portfolioLedgers)
        .where(eq(portfolioLedgers.userId, userId))
        .limit(1);
  }
  if (!ledger) throw new Error('PORTFOLIO_LEDGER_UNAVAILABLE');
  const rows = await database
    .select()
    .from(portfolioLedgerTransactions)
    .where(eq(portfolioLedgerTransactions.ledgerId, ledger.id))
    .orderBy(asc(portfolioLedgerTransactions.sortOrder));
  return {
    version: ledger.version,
    updatedAt: ledger.updatedAt.toISOString(),
    ledger: portfolioLedgerSchema.parse({
      version: 1,
      transactions: rows.map((row) => ({
        id: row.id,
        date: row.date,
        side: row.side,
        companyId: row.companyId,
        productId: row.productId,
        quantityLuong: row.quantityLuong,
        unitPriceVnd: row.unitPriceVnd,
        feesVnd: row.feesVnd,
        ...(row.purchaseVenue ? { purchaseVenue: row.purchaseVenue } : {}),
        ...(row.saleVenue ? { saleVenue: row.saleVenue } : {}),
        ...(row.invoiceStatus ? { invoiceStatus: row.invoiceStatus } : {}),
        ...(row.packagingStatus ? { packagingStatus: row.packagingStatus } : {}),
        ...(row.serial ? { serial: row.serial } : {}),
        note: row.note,
      })),
    }),
  };
}

export async function readPortfolioLedgerForSession(
  session: Session,
  db?: AppDatabase,
) {
  const { ensureSessionUser } = await import('@/lib/billing/server');
  const user = await ensureSessionUser(session, db);
  return { user, ...(await readPortfolioLedgerForUser(user.id, db)) };
}
