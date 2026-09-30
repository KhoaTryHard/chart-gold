import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  calculateLedgerSummary,
  appendLedgerTransaction,
  mergeLedger,
  inspectLedgerIntegrity,
  previewLedgerRestore,
  removeLedgerTransaction,
  updateLedgerTransaction,
  LedgerMutationError,
  exportPortfolioLedger,
  importPortfolioLedger,
  portfolioLedgerSchema,
  type LedgerQuote,
  type LedgerTransaction,
} from '@/lib/portfolio-ledger';
import {
  buildMarketContext,
  selectQuoteGroups,
} from '@/lib/analysis/market-context';
import { resolveIntent } from '@/lib/analysis/intent';
import { getMarketCompany } from '@/lib/market-sources';
import type { MarketData } from '@/lib/server/sjc';

const buy = (
  id: string,
  date: string,
  quantityLuong: number,
  unitPriceVnd: number,
  feesVnd = 0,
): LedgerTransaction => ({
  id,
  date,
  side: 'buy',
  companyId: 'sjc',
  productId: 'bar-1l',
  quantityLuong,
  unitPriceVnd,
  feesVnd,
  note: '',
});
const sell = (
  id: string,
  date: string,
  quantityLuong: number,
  unitPriceVnd: number,
  feesVnd = 0,
): LedgerTransaction => ({
  id,
  date,
  side: 'sell',
  companyId: 'sjc',
  productId: 'bar-1l',
  quantityLuong,
  unitPriceVnd,
  feesVnd,
  note: '',
});
const quote: LedgerQuote = {
  companyId: 'sjc',
  productId: 'bar-1l',
  buy: 150_000_000,
  sell: 153_000_000,
};

describe('portfolio ledger accounting and backup', () => {
  it('accounts FIFO sales, sells part of a lot and values remaining lots today', () => {
    const transactions = [
      buy('b1', '2026-01-01', 1, 140_000_000, 100_000),
      buy('b2', '2026-02-01', 1, 146_000_000),
      sell('s1', '2026-03-01', 0.5, 150_000_000, 50_000),
    ];
    const summary = calculateLedgerSummary(
      transactions,
      new Map([['sjc:bar-1l', quote]]),
    );
    expect(summary.openQuantityLuong).toBe(1.5);
    expect(summary.totalBoughtLuong).toBe(2);
    expect(summary.totalSoldLuong).toBe(0.5);
    expect(summary.realizedPnlVnd).toBe(4_900_000);
    expect(summary.currentValueVnd).toBe(225_000_000);
    expect(summary.unrealizedPnlVnd).toBe(8_950_000);
    expect(summary.totalPnlVnd).toBe(13_850_000);
    expect(summary.canLockProfitToday).toBe(true);
    expect(summary.positions[0]).toMatchObject({
      status: 'profit',
      currentBuyVndPerLuong: 150_000_000,
    });
  });

  it('reports missing quotes and sells beyond inventory explicitly', () => {
    const oversold = calculateLedgerSummary(
      [sell('s1', '2026-01-01', 1, 150_000_000)],
      new Map(),
    );
    expect(oversold.errors[0]).toContain('vượt tồn');
    expect(oversold.openQuantityLuong).toBe(0);
    expect(oversold.canLockProfitToday).toBeNull();
    const noQuote = calculateLedgerSummary(
      [buy('b1', '2026-01-01', 1, 140_000_000)],
      new Map(),
    );
    expect(noQuote.canLockProfitToday).toBeNull();
    expect(noQuote.unrealizedPnlVnd).toBeNull();
    expect(noQuote.positions[0].status).toBe('no-quote');
  });

  it('keeps stable IDs and enforces the serializable ledger schema', () => {
    const current = portfolioLedgerSchema.parse({
      version: 1,
      transactions: [buy('b1', '2026-01-01', 1, 140_000_000)],
    });
    const merged = mergeLedger(current, [
      buy('new-id', '2026-01-01', 1, 140_000_000),
      buy('b2', '2026-01-02', 1, 141_000_000),
    ]);
    expect(merged.transactions).toHaveLength(3);
    expect(merged.transactions[1].id).toBe('new-id');
    expect(
      portfolioLedgerSchema.safeParse({
        version: 1,
        transactions: [
          { ...buy('bad', '2026-01-01', 1, 140_000_000), companyId: 'bad' },
        ],
      }).success,
    ).toBe(false);
  });

  it('keeps identical manual purchases and preserves metadata when editing', () => {
    const current = portfolioLedgerSchema.parse({
      version: 1,
      transactions: [{
        ...buy('legacy', '2026-01-01', 1, 140_000_000),
        invoiceStatus: 'available',
        packagingStatus: 'intact',
        serial: 'SERIAL-1',
      }],
    });
    const samePurchase = buy('manual-2', '2026-01-01', 1, 140_000_000);
    const withSamePurchase = appendLedgerTransaction(current, samePurchase);
    expect(withSamePurchase.transactions).toHaveLength(2);
    const edited = updateLedgerTransaction(withSamePurchase, {
      ...withSamePurchase.transactions[0],
      note: 'updated',
    });
    expect(edited.transactions[0]).toMatchObject({ id: 'legacy', note: 'updated' });
    expect(edited.transactions[0]).toMatchObject({
      invoiceStatus: 'available',
      packagingStatus: 'intact',
      serial: 'SERIAL-1',
    });
  });

  it('blocks new oversells and allows repairing an existing oversold ledger', () => {
    const valid = portfolioLedgerSchema.parse({
      version: 1,
      transactions: [buy('b1', '2026-01-01', 1, 140_000_000)],
    });
    expect(() => appendLedgerTransaction(valid, sell('s1', '2026-01-02', 2, 150_000_000))).toThrow(LedgerMutationError);
    const legacyInvalid = portfolioLedgerSchema.parse({
      version: 1,
      transactions: [sell('s1', '2026-01-02', 2, 150_000_000)],
    });
    expect(inspectLedgerIntegrity(legacyInvalid.transactions).issues[0].code).toBe('oversold');
    const repaired = appendLedgerTransaction(legacyInvalid, buy('b1', '2026-01-01', 1, 140_000_000));
    expect(inspectLedgerIntegrity(repaired.transactions).issues[0].missingQuantityLuong).toBe(1);
    expect(() => removeLedgerTransaction(repaired, 'b1')).toThrow(LedgerMutationError);
  });

  it('previews JSON restore by ID and reports conflicts without overwriting', () => {
    const current = portfolioLedgerSchema.parse({
      version: 1,
      transactions: [buy('same', '2026-01-01', 1, 140_000_000)],
    });
    const duplicate = previewLedgerRestore(current, portfolioLedgerSchema.parse({
      version: 1,
      transactions: [buy('same', '2026-01-01', 1, 140_000_000)],
    }));
    expect(duplicate.duplicates).toHaveLength(1);
    expect(duplicate.additions).toHaveLength(0);
    const sameContentDifferentId = previewLedgerRestore(current, portfolioLedgerSchema.parse({
      version: 1,
      transactions: [buy('different', '2026-01-01', 1, 140_000_000)],
    }));
    expect(sameContentDifferentId.additions).toHaveLength(1);
    const conflict = previewLedgerRestore(current, portfolioLedgerSchema.parse({
      version: 1,
      transactions: [buy('same', '2026-01-01', 1, 141_000_000)],
    }));
    expect(conflict.conflicts).toHaveLength(1);
    expect(conflict.candidate).toBeNull();
  });

  it('rejects an oversized merge and supports a JSON backup round trip', () => {
    const current = portfolioLedgerSchema.parse({
      version: 1,
      transactions: Array.from({ length: 2_000 }, (_, index) =>
        buy(`b-${index}`, `2026-01-${String((index % 9) + 1).padStart(2, '0')}`, 0.01, 140_000_000 + index),
      ),
    });
    expect(() => mergeLedger(current, [buy('overflow', '2026-02-01', 0.01, 150_000_000)])).toThrow();
    const backupSource = portfolioLedgerSchema.parse({
      version: 1,
      transactions: [buy('backup', '2026-02-02', 1, 150_000_000)],
    });
    const backup = exportPortfolioLedger(backupSource);
    expect(importPortfolioLedger(backup).transactions).toHaveLength(1);
  });

  it('makes the ledger summary available to the chatbot market context', () => {
    const intent = resolveIntent(
      'Hôm nay danh mục của tôi có chốt lời được chưa?',
    );
    const groups = selectQuoteGroups(intent, 'sjc', 'bar-1l');
    const market: MarketData = {
      company: getMarketCompany('sjc'),
      product: groups[0].product,
      products: [],
      mode: 'live',
      availability: 'available',
      unavailableReason: null,
      records: [
        { date: '2026-09-05', buy: 150, sell: 153, spread: 3, eventId: null },
      ],
      latest: {
        date: '2026-09-05',
        buy: 150,
        sell: 153,
        spread: 3,
        eventId: null,
      },
      observedAt: '2026-09-05T01:00:00Z',
      generatedAt: '2026-09-05T01:00:00Z',
      source: {
        provider: 'fixture',
        url: 'https://example.com',
        official: false,
      },
      historySource: { provider: 'fixture', url: 'https://example.com' },
    };
    const ledger = portfolioLedgerSchema.parse({
      version: 1,
      transactions: [buy('b1', '2026-09-01', 1, 140_000_000)],
    });
    const context = buildMarketContext(
      groups,
      [market],
      intent,
      '7N',
      new Date('2026-09-05T01:00:00Z'),
      undefined,
      'Hôm nay danh mục của tôi có chốt lời được chưa?',
      ledger,
    );
    expect(context.portfolioSummary).toMatchObject({
      openQuantityLuong: 1,
      currentValueVnd: 150_000_000,
      unrealizedPnlVnd: 10_000_000,
      canLockProfitToday: true,
    });
  });
});
