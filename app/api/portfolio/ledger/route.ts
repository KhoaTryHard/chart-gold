import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';

import { auth } from '@/auth';
import { getDatabase } from '@/db';
import {
  portfolioLedgerMutations,
  portfolioLedgerTransactions,
  portfolioLedgers,
} from '@/db/schema';
import {
  inspectLedgerIntegrity,
  portfolioLedgerSchema,
} from '@/lib/portfolio-ledger';
import { ensureSessionUser, BillingError } from '@/lib/billing/server';
import { readPortfolioLedgerForUser } from '@/lib/server/portfolio-ledger';
import { readJsonBody, RequestBodyTooLargeError } from '@/lib/server/body';
import { isTrustedOrigin } from '@/lib/server/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};

const replaceSchema = z.object({
  operationId: z.string().trim().min(1).max(100),
  baseVersion: z.number().int().positive(),
  ledger: portfolioLedgerSchema,
});

function respond(body: unknown, status = 200) {
  return Response.json(body, { status, headers });
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email)
      return respond({ code: 'AUTH_REQUIRED', error: 'Đăng nhập Google để sử dụng Sổ vàng.' }, 401);
    const user = await ensureSessionUser(session);
    return respond(await readPortfolioLedgerForUser(user.id, getDatabase()));
  } catch (error) {
    if (error instanceof BillingError)
      return respond({ code: error.code, error: error.message }, error.status);
    return respond({ code: 'LEDGER_UNAVAILABLE', error: 'Không thể tải Sổ vàng lúc này.' }, 503);
  }
}

export async function PUT(request: Request) {
  try {
    if (!isTrustedOrigin(request))
      return respond({ code: 'INVALID_ORIGIN', error: 'Yêu cầu không hợp lệ.' }, 403);
    const session = await auth();
    if (!session?.user?.email)
      return respond({ code: 'AUTH_REQUIRED', error: 'Đăng nhập Google để lưu Sổ vàng.' }, 401);
    const parsed = replaceSchema.safeParse(await readJsonBody(request, 600 * 1024));
    if (!parsed.success)
      return respond({ code: 'INVALID_LEDGER', error: 'Dữ liệu Sổ vàng không hợp lệ.' }, 400);
    const integrity = inspectLedgerIntegrity(parsed.data.ledger.transactions);
    if (!integrity.valid)
      return respond({ code: 'INVALID_LEDGER', error: 'Hãy sửa lỗi giao dịch trước khi lưu.', issues: integrity.issues }, 400);

    const user = await ensureSessionUser(session);
    const db = getDatabase();
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`);
      const [existingMutation] = await tx
        .select()
        .from(portfolioLedgerMutations)
        .where(eq(portfolioLedgerMutations.operationId, parsed.data.operationId))
        .limit(1);
      if (existingMutation) return { idempotent: true, ledgerId: existingMutation.ledgerId };

      let [ledger] = await tx
        .select()
        .from(portfolioLedgers)
        .where(eq(portfolioLedgers.userId, user.id))
        .limit(1);
      if (!ledger) {
        [ledger] = await tx.insert(portfolioLedgers).values({ userId: user.id }).returning();
      }
      if (!ledger) throw new BillingError('LEDGER_UNAVAILABLE', 'Không thể mở sổ vàng.', 503);
      if (parsed.data.baseVersion !== ledger.version)
        return { conflict: true, ledgerId: ledger.id };
      const nextVersion = ledger.version + 1;
      await tx
        .delete(portfolioLedgerTransactions)
        .where(eq(portfolioLedgerTransactions.ledgerId, ledger.id));
      if (parsed.data.ledger.transactions.length)
        await tx.insert(portfolioLedgerTransactions).values(
          parsed.data.ledger.transactions.map((transaction, sortOrder) => ({
            id: transaction.id,
            ledgerId: ledger.id,
            sortOrder,
            date: transaction.date,
            side: transaction.side,
            companyId: transaction.companyId,
            productId: transaction.productId,
            quantityLuong: transaction.quantityLuong,
            unitPriceVnd: transaction.unitPriceVnd,
            feesVnd: transaction.feesVnd,
            purchaseVenue: transaction.purchaseVenue ?? null,
            saleVenue: transaction.saleVenue ?? null,
            invoiceStatus: transaction.invoiceStatus ?? null,
            packagingStatus: transaction.packagingStatus ?? null,
            serial: transaction.serial ?? null,
            note: transaction.note,
            updatedAt: new Date(),
          })),
        );
      await tx
        .update(portfolioLedgers)
        .set({ version: nextVersion, updatedAt: new Date() })
        .where(eq(portfolioLedgers.id, ledger.id));
      await tx.insert(portfolioLedgerMutations).values({
        operationId: parsed.data.operationId,
        ledgerId: ledger.id,
        version: nextVersion,
      });
      return { ledgerId: ledger.id, version: nextVersion };
    });

    const current = await readPortfolioLedgerForUser(user.id, db);
    if ('conflict' in result && result.conflict)
      return respond({ code: 'LEDGER_VERSION_CONFLICT', error: 'Sổ đã thay đổi trên thiết bị khác.', ...current }, 409);
    return respond({ ...current, saved: true, idempotent: 'idempotent' in result && result.idempotent === true });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return respond({ code: 'INVALID_LEDGER', error: 'Sổ vàng vượt giới hạn dữ liệu.' }, 413);
    if (error instanceof BillingError)
      return respond({ code: error.code, error: error.message }, error.status);
    return respond({ code: 'LEDGER_UNAVAILABLE', error: 'Không thể lưu Sổ vàng lúc này.' }, 503);
  }
}
