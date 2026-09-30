import { z } from 'zod';

import {
  MARKET_COMPANIES,
  getMarketProducts,
} from '@/lib/market-sources';
import { defaultLocale, type Locale } from '@/lib/i18n';

export const PORTFOLIO_LEDGER_VERSION = 1 as const;
export const PORTFOLIO_LEDGER_MAX_TRANSACTIONS = 2_000;
export const PORTFOLIO_LEDGER_MAX_BYTES = 450 * 1_024;

export type LedgerSide = 'buy' | 'sell';

export function ledgerSideLabel(side: LedgerSide, locale: Locale = defaultLocale) {
  if (locale === 'en') return side === 'buy' ? 'BUY' : 'SELL';
  return side === 'buy' ? 'MUA' : 'BÁN';
}

const ledgerTransactionSchema = z
  .object({
    id: z.string().min(1).max(100),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    side: z.enum(['buy', 'sell']),
    companyId: z.string().max(50),
    productId: z.string().max(100),
    quantityLuong: z.number().positive().max(1e6),
    unitPriceVnd: z.number().positive().max(1e15),
    feesVnd: z.number().nonnegative().max(1e15).default(0),
    purchaseVenue: z.string().max(160).optional(),
    saleVenue: z.string().max(160).optional(),
    invoiceStatus: z.string().max(40).optional(),
    packagingStatus: z.string().max(40).optional(),
    serial: z.string().max(120).optional(),
    note: z.string().max(500).default(''),
  })
  .superRefine((transaction, context) => {
    const company = MARKET_COMPANIES.find(
      (candidate) => candidate.id === transaction.companyId,
    );
    if (!company) {
      context.addIssue({
        code: 'custom',
        path: ['companyId'],
        message: 'Thương hiệu không hợp lệ.',
      });
      return;
    }
    if (
      !getMarketProducts(company.id).some(
        (product) => product.id === transaction.productId,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['productId'],
        message: 'Sản phẩm không thuộc thương hiệu.',
      });
    }
  });

export const portfolioLedgerSchema = z.object({
  version: z
    .literal(PORTFOLIO_LEDGER_VERSION)
    .default(PORTFOLIO_LEDGER_VERSION),
  transactions: z
    .array(ledgerTransactionSchema)
    .max(PORTFOLIO_LEDGER_MAX_TRANSACTIONS),
});

export type LedgerTransaction = z.infer<typeof ledgerTransactionSchema>;
export type PortfolioLedger = z.infer<typeof portfolioLedgerSchema>;

export type LedgerQuote = {
  companyId: string;
  productId: string;
  buy: number;
  sell: number;
  observedAt?: string;
};

export type LedgerPosition = {
  companyId: string;
  productId: string;
  label: string;
  quantityLuong: number;
  averageCostPerLuongVnd: number;
  currentBuyVndPerLuong: number | null;
  currentValueVnd: number | null;
  costBasisVnd: number;
  unrealizedPnlVnd: number | null;
  breakEvenBuyVndPerLuong: number;
  status: 'profit' | 'loss' | 'flat' | 'no-quote';
};

export type LedgerSummary = {
  transactionCount: number;
  buyTransactionCount: number;
  sellTransactionCount: number;
  totalBoughtLuong: number;
  totalSoldLuong: number;
  openQuantityLuong: number;
  totalBuyCostVnd: number;
  totalSellProceedsVnd: number;
  realizedPnlVnd: number;
  openCostBasisVnd: number;
  currentValueVnd: number | null;
  unrealizedPnlVnd: number | null;
  totalPnlVnd: number | null;
  canLockProfitToday: boolean | null;
  positions: LedgerPosition[];
  errors: string[];
};

export type LedgerIntegrityCode =
  | 'duplicate-id'
  | 'invalid-date'
  | 'invalid-quantity'
  | 'invalid-price'
  | 'invalid-fee'
  | 'oversold';

export type LedgerIntegrityIssue = {
  code: LedgerIntegrityCode;
  transactionId: string;
  date: string;
  companyId: string;
  productId: string;
  missingQuantityLuong?: number;
};

export type LedgerIntegrity = {
  valid: boolean;
  issues: LedgerIntegrityIssue[];
};

export class LedgerMutationError extends Error {
  readonly issues: LedgerIntegrityIssue[];

  constructor(message: string, issues: LedgerIntegrityIssue[] = []) {
    super(message);
    this.name = 'LedgerMutationError';
    this.issues = issues;
  }
}

type Lot = {
  date: string;
  quantityLuong: number;
  unitCostVnd: number;
};

function formatDateParts(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  )
    return null;
  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function isCalendarDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return Boolean(
    match &&
      formatDateParts(Number(match[1]), Number(match[2]), Number(match[3])),
  );
}

function issueKey(issue: LedgerIntegrityIssue) {
  return `${issue.code}:${issue.transactionId}:${issue.productId}`;
}

function transactionsEqual(
  left: LedgerTransaction,
  right: LedgerTransaction,
) {
  const { id: _leftId, ...leftContent } = left;
  const { id: _rightId, ...rightContent } = right;
  return ledgerFingerprint(leftContent) === ledgerFingerprint(rightContent);
}

/**
 * Inspect a v1 ledger without mutating or normalizing it. Existing invalid
 * ledgers stay readable so users can repair them incrementally.
 */
export function inspectLedgerIntegrity(
  transactions: readonly LedgerTransaction[],
): LedgerIntegrity {
  const issues: LedgerIntegrityIssue[] = [];
  const ids = new Set<string>();
  const structuralIssue = (
    transaction: LedgerTransaction,
    code: Exclude<LedgerIntegrityCode, 'oversold' | 'duplicate-id'>,
  ) =>
    issues.push({
      code,
      transactionId: transaction.id,
      date: transaction.date,
      companyId: transaction.companyId,
      productId: transaction.productId,
    });

  for (const transaction of transactions) {
    if (ids.has(transaction.id))
      issues.push({
        code: 'duplicate-id',
        transactionId: transaction.id,
        date: transaction.date,
        companyId: transaction.companyId,
        productId: transaction.productId,
      });
    ids.add(transaction.id);
    if (!isCalendarDate(transaction.date))
      structuralIssue(transaction, 'invalid-date');
    if (!Number.isFinite(transaction.quantityLuong) || transaction.quantityLuong <= 0)
      structuralIssue(transaction, 'invalid-quantity');
    if (!Number.isFinite(transaction.unitPriceVnd) || transaction.unitPriceVnd <= 0)
      structuralIssue(transaction, 'invalid-price');
    if (!Number.isFinite(transaction.feesVnd) || transaction.feesVnd < 0)
      structuralIssue(transaction, 'invalid-fee');
  }

  const sorted = transactions
    .map((transaction, index) => ({ transaction, index }))
    .sort(
      (left, right) =>
        left.transaction.date.localeCompare(right.transaction.date) ||
        left.index - right.index,
    );
  const inventory = new Map<string, number>();
  for (const { transaction } of sorted) {
    const key = `${transaction.companyId}:${transaction.productId}`;
    const available = inventory.get(key) ?? 0;
    if (transaction.side === 'buy') {
      inventory.set(key, available + transaction.quantityLuong);
      continue;
    }
    const remaining = transaction.quantityLuong - available;
    if (remaining > 1e-9)
      issues.push({
        code: 'oversold',
        transactionId: transaction.id,
        date: transaction.date,
        companyId: transaction.companyId,
        productId: transaction.productId,
        missingQuantityLuong: remaining,
      });
    inventory.set(key, Math.max(0, available - transaction.quantityLuong));
  }

  return { valid: issues.length === 0, issues };
}

export function ledgerIntegrityIssueMessage(
  issue: LedgerIntegrityIssue,
  locale: Locale = defaultLocale,
) {
  const product = `${issue.companyId}:${issue.productId}`;
  if (locale === 'en') {
    if (issue.code === 'duplicate-id') return `${issue.date}: duplicate transaction ID ${issue.transactionId}.`;
    if (issue.code === 'invalid-date') return `${issue.transactionId}: invalid calendar date.`;
    if (issue.code === 'invalid-quantity') return `${issue.transactionId}: quantity must be greater than zero.`;
    if (issue.code === 'invalid-price') return `${issue.transactionId}: unit price must be greater than zero.`;
    if (issue.code === 'invalid-fee') return `${issue.transactionId}: fees cannot be negative.`;
    return `${issue.date}: sale ${issue.transactionId} exceeds ${product} inventory by ${(issue.missingQuantityLuong ?? 0).toFixed(4)} lượng.`;
  }
  if (issue.code === 'duplicate-id') return `${issue.date}: mã giao dịch ${issue.transactionId} bị trùng.`;
  if (issue.code === 'invalid-date') return `${issue.transactionId}: ngày lịch không hợp lệ.`;
  if (issue.code === 'invalid-quantity') return `${issue.transactionId}: số lượng phải lớn hơn 0.`;
  if (issue.code === 'invalid-price') return `${issue.transactionId}: đơn giá phải lớn hơn 0.`;
  if (issue.code === 'invalid-fee') return `${issue.transactionId}: phí không được âm.`;
  return `${issue.date}: giao dịch bán ${issue.transactionId} vượt tồn ${product} ${(issue.missingQuantityLuong ?? 0).toFixed(4)} lượng.`;
}

function mutationErrorMessage(issues: readonly LedgerIntegrityIssue[]) {
  return issues.length
    ? ledgerIntegrityIssueMessage(issues[0], 'vi')
    : 'Sổ vàng không hợp lệ.';
}

/**
 * Validate a next ledger against its current state. A previously invalid v1
 * ledger can be repaired one step at a time, but a mutation cannot introduce a
 * new issue, worsen an existing shortage, or leave all current issues intact.
 */
export function validateLedgerMutation(
  current: PortfolioLedger,
  next: PortfolioLedger,
) {
  const parsed = portfolioLedgerSchema.parse(next);
  const before = inspectLedgerIntegrity(current.transactions);
  const after = inspectLedgerIntegrity(parsed.transactions);
  if (!before.issues.length && !after.issues.length) return parsed;
  if (!before.issues.length && after.issues.length)
    throw new LedgerMutationError(mutationErrorMessage(after.issues), after.issues);

  const beforeByKey = new Map(before.issues.map((issue) => [issueKey(issue), issue]));
  let resolved = false;
  for (const issue of before.issues) {
    const currentIssue = after.issues.find((candidate) => issueKey(candidate) === issueKey(issue));
    if (!currentIssue) {
      resolved = true;
      continue;
    }
    if (
      issue.code === 'oversold' &&
      (currentIssue.missingQuantityLuong ?? 0) < (issue.missingQuantityLuong ?? 0) - 1e-9
    )
      resolved = true;
  }
  const introduced = after.issues.find((issue) => {
    const previous = beforeByKey.get(issueKey(issue));
    return !previous ||
      (issue.code === 'oversold' &&
        (issue.missingQuantityLuong ?? 0) > (previous.missingQuantityLuong ?? 0) + 1e-9);
  });
  if (introduced || !resolved)
    throw new LedgerMutationError(
      mutationErrorMessage(introduced ? [introduced] : after.issues),
      introduced ? [introduced] : after.issues,
    );
  return parsed;
}

export function appendLedgerTransaction(
  current: PortfolioLedger,
  transaction: LedgerTransaction,
) {
  if (current.transactions.some((item) => item.id === transaction.id))
    throw new LedgerMutationError(`Mã giao dịch ${transaction.id} đã tồn tại.`);
  return validateLedgerMutation(current, {
    version: PORTFOLIO_LEDGER_VERSION,
    transactions: [...current.transactions, transaction],
  });
}

export function updateLedgerTransaction(
  current: PortfolioLedger,
  transaction: LedgerTransaction,
) {
  const index = current.transactions.findIndex((item) => item.id === transaction.id);
  if (index < 0)
    throw new LedgerMutationError(`Không tìm thấy giao dịch ${transaction.id}.`);
  const original = current.transactions[index];
  const nextTransactions = [...current.transactions];
  nextTransactions[index] = { ...original, ...transaction, id: original.id };
  return validateLedgerMutation(current, {
    version: PORTFOLIO_LEDGER_VERSION,
    transactions: nextTransactions,
  });
}

export function removeLedgerTransaction(
  current: PortfolioLedger,
  transactionId: string,
) {
  if (!current.transactions.some((item) => item.id === transactionId))
    throw new LedgerMutationError(`Không tìm thấy giao dịch ${transactionId}.`);
  return validateLedgerMutation(current, {
    version: PORTFOLIO_LEDGER_VERSION,
    transactions: current.transactions.filter((item) => item.id !== transactionId),
  });
}

export function ledgerFingerprint(transaction: Omit<LedgerTransaction, 'id'>) {
  return [
    transaction.date,
    transaction.side,
    transaction.companyId,
    transaction.productId,
    transaction.quantityLuong,
    transaction.unitPriceVnd,
    transaction.feesVnd,
    transaction.purchaseVenue ?? '',
    transaction.saleVenue ?? '',
    transaction.invoiceStatus ?? '',
    transaction.packagingStatus ?? '',
    transaction.serial ?? '',
    transaction.note,
  ].join('|');
}

export function mergeLedger(
  current: PortfolioLedger,
  incoming: readonly LedgerTransaction[],
): PortfolioLedger {
  const preview = previewLedgerRestore(current, {
    version: PORTFOLIO_LEDGER_VERSION,
    transactions: [...incoming],
  });
  if (preview.conflicts.length)
    throw new LedgerMutationError('Bản sao lưu có mã giao dịch xung đột.', []);
  if (preview.error) throw preview.error;
  return preview.candidate!;
}

export type LedgerRestoreConflict = {
  id: string;
  current: LedgerTransaction;
  incoming: LedgerTransaction;
};

export type LedgerRestorePreview = {
  currentCount: number;
  incomingCount: number;
  additions: LedgerTransaction[];
  duplicates: LedgerTransaction[];
  conflicts: LedgerRestoreConflict[];
  candidate: PortfolioLedger | null;
  integrity: LedgerIntegrity;
  error: LedgerMutationError | null;
};

/** Compare a JSON v1 backup with the current device ledger by stable ID. */
export function previewLedgerRestore(
  current: PortfolioLedger,
  incoming: PortfolioLedger,
): LedgerRestorePreview {
  const currentById = new Map(current.transactions.map((transaction) => [transaction.id, transaction]));
  const seenIncoming = new Map<string, LedgerTransaction>();
  const additions: LedgerTransaction[] = [];
  const duplicates: LedgerTransaction[] = [];
  const conflicts: LedgerRestoreConflict[] = [];
  for (const transaction of incoming.transactions) {
    const previousIncoming = seenIncoming.get(transaction.id);
    if (previousIncoming) {
      if (transactionsEqual(previousIncoming, transaction)) duplicates.push(transaction);
      else conflicts.push({ id: transaction.id, current: previousIncoming, incoming: transaction });
      continue;
    }
    seenIncoming.set(transaction.id, transaction);
    const existing = currentById.get(transaction.id);
    if (!existing) additions.push(transaction);
    else if (transactionsEqual(existing, transaction)) duplicates.push(transaction);
    else conflicts.push({ id: transaction.id, current: existing, incoming: transaction });
  }
  const candidate = conflicts.length
    ? null
    : portfolioLedgerSchema.safeParse({
        version: PORTFOLIO_LEDGER_VERSION,
        transactions: [...current.transactions, ...additions],
      }).success
      ? portfolioLedgerSchema.parse({
          version: PORTFOLIO_LEDGER_VERSION,
          transactions: [...current.transactions, ...additions],
        })
      : null;
  if (!candidate) {
    const issue: LedgerIntegrityIssue = {
      code: 'invalid-price',
      transactionId: 'restore',
      date: '',
      companyId: '',
      productId: '',
    };
    return {
      currentCount: current.transactions.length,
      incomingCount: incoming.transactions.length,
      additions,
      duplicates,
      conflicts,
      candidate: null,
      integrity: { valid: false, issues: [issue] },
      error: new LedgerMutationError('Bản sao lưu không đúng định dạng sổ vàng.', [issue]),
    };
  }
  const integrity = inspectLedgerIntegrity(candidate.transactions);
  let error: LedgerMutationError | null = null;
  if (conflicts.length)
    error = new LedgerMutationError('Bản sao lưu có mã giao dịch xung đột.', []);
  else {
    try {
      validateLedgerMutation(current, candidate);
    } catch (cause) {
      error = cause instanceof LedgerMutationError
        ? cause
        : new LedgerMutationError('Không thể khôi phục sổ vàng.', integrity.issues);
    }
  }
  return {
    currentCount: current.transactions.length,
    incomingCount: incoming.transactions.length,
    additions,
    duplicates,
    conflicts,
    candidate: error ? null : candidate,
    integrity,
    error,
  };
}

export function ledgerStorageKey(account: string) {
  return `kim-tuyen:portfolio-ledger:v${PORTFOLIO_LEDGER_VERSION}:${encodeURIComponent(account.trim().toLowerCase())}`;
}

export function readPortfolioLedger(
  account: string,
): PortfolioLedger | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(ledgerStorageKey(account));
    if (
      !raw ||
      new TextEncoder().encode(raw).byteLength > PORTFOLIO_LEDGER_MAX_BYTES
    )
      return undefined;
    const parsed: unknown = JSON.parse(raw);
    const result = portfolioLedgerSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function savePortfolioLedger(account: string, ledger: PortfolioLedger) {
  if (typeof window === 'undefined') return;
  const normalized = portfolioLedgerSchema.parse(ledger);
  const serialized = JSON.stringify(normalized);
  if (new TextEncoder().encode(serialized).byteLength > PORTFOLIO_LEDGER_MAX_BYTES)
    throw new Error(
      `Sổ vàng vượt giới hạn ${Math.round(PORTFOLIO_LEDGER_MAX_BYTES / 1_024)} KB; dữ liệu cũ được giữ nguyên.`,
    );
  window.localStorage.setItem(ledgerStorageKey(account), serialized);
}

export function exportPortfolioLedger(ledger: PortfolioLedger) {
  return JSON.stringify(portfolioLedgerSchema.parse(ledger), null, 2);
}

export function importPortfolioLedger(raw: string) {
  if (new TextEncoder().encode(raw).byteLength > PORTFOLIO_LEDGER_MAX_BYTES)
    throw new Error('File sổ vàng vượt giới hạn lưu trữ trên thiết bị.');
  const parsed: unknown = JSON.parse(raw);
  return portfolioLedgerSchema.parse(parsed);
}

export function clearPortfolioLedger(account: string) {
  if (typeof window !== 'undefined')
    window.localStorage.removeItem(ledgerStorageKey(account));
}

export function ledgerProductKeys(ledger: PortfolioLedger) {
  return [
    ...new Set(
      ledger.transactions.map(
        (transaction) => `${transaction.companyId}:${transaction.productId}`,
      ),
    ),
  ];
}

export function calculateLedgerSummary(
  transactions: readonly LedgerTransaction[],
  quotes: ReadonlyMap<string, LedgerQuote>,
): LedgerSummary {
  const sorted = transactions
    .map((transaction, index) => ({ transaction, index }))
    .sort(
      (left, right) =>
        left.transaction.date.localeCompare(right.transaction.date) ||
        left.index - right.index,
    );
  const lots = new Map<string, Lot[]>();
  const errors = inspectLedgerIntegrity(transactions).issues.map((issue) =>
    ledgerIntegrityIssueMessage(issue, 'vi'),
  );
  let totalBoughtLuong = 0;
  let totalSoldLuong = 0;
  let totalBuyCostVnd = 0;
  let totalSellProceedsVnd = 0;
  let realizedPnlVnd = 0;
  for (const { transaction } of sorted) {
    const key = `${transaction.companyId}:${transaction.productId}`;
    const queue = lots.get(key) ?? [];
    if (transaction.side === 'buy') {
      const totalCost =
        transaction.quantityLuong * transaction.unitPriceVnd +
        transaction.feesVnd;
      queue.push({
        date: transaction.date,
        quantityLuong: transaction.quantityLuong,
        unitCostVnd: totalCost / transaction.quantityLuong,
      });
      lots.set(key, queue);
      totalBoughtLuong += transaction.quantityLuong;
      totalBuyCostVnd += totalCost;
      continue;
    }
    totalSoldLuong += transaction.quantityLuong;
    totalSellProceedsVnd +=
      transaction.quantityLuong * transaction.unitPriceVnd -
      transaction.feesVnd;
    let remaining = transaction.quantityLuong;
    let realized = -transaction.feesVnd;
    while (remaining > 1e-9 && queue.length) {
      const lot = queue[0];
      const matched = Math.min(remaining, lot.quantityLuong);
      realized += matched * (transaction.unitPriceVnd - lot.unitCostVnd);
      lot.quantityLuong -= matched;
      remaining -= matched;
      if (lot.quantityLuong <= 1e-9) queue.shift();
    }
    realizedPnlVnd += realized;
    lots.set(key, queue);
  }
  const positions: LedgerPosition[] = [];
  let openCostBasisVnd = 0;
  let currentValueVnd = 0;
  let hasMissingQuote = false;
  for (const [key, queue] of lots) {
    const quantityLuong = queue.reduce(
      (sum, lot) => sum + lot.quantityLuong,
      0,
    );
    if (quantityLuong <= 1e-9) continue;
    const [companyId, productId] = key.split(':');
    const product = getMarketProducts(companyId).find(
      (candidate) => candidate.id === productId,
    );
    const costBasisVnd = queue.reduce(
      (sum, lot) => sum + lot.quantityLuong * lot.unitCostVnd,
      0,
    );
    const averageCostPerLuongVnd = costBasisVnd / quantityLuong;
    const quote = quotes.get(key);
    const currentBuyVndPerLuong = quote?.buy ?? null;
    const value = quote ? quantityLuong * quote.buy : null;
    const pnl = value === null ? null : value - costBasisVnd;
    openCostBasisVnd += costBasisVnd;
    if (value === null) hasMissingQuote = true;
    else currentValueVnd += value;
    positions.push({
      companyId,
      productId,
      label: product?.label ?? productId,
      quantityLuong,
      averageCostPerLuongVnd,
      currentBuyVndPerLuong,
      currentValueVnd: value,
      costBasisVnd,
      unrealizedPnlVnd: pnl,
      breakEvenBuyVndPerLuong: averageCostPerLuongVnd,
      status:
        pnl === null
          ? 'no-quote'
          : pnl > 0
            ? 'profit'
            : pnl < 0
              ? 'loss'
              : 'flat',
    });
  }
  const unrealizedPnlVnd = hasMissingQuote
    ? null
    : currentValueVnd - openCostBasisVnd;
  return {
    transactionCount: transactions.length,
    buyTransactionCount: transactions.filter(
      (transaction) => transaction.side === 'buy',
    ).length,
    sellTransactionCount: transactions.filter(
      (transaction) => transaction.side === 'sell',
    ).length,
    totalBoughtLuong,
    totalSoldLuong,
    openQuantityLuong: positions.reduce(
      (sum, position) => sum + position.quantityLuong,
      0,
    ),
    totalBuyCostVnd: Math.round(totalBuyCostVnd),
    totalSellProceedsVnd: Math.round(totalSellProceedsVnd),
    realizedPnlVnd: Math.round(realizedPnlVnd),
    openCostBasisVnd: Math.round(openCostBasisVnd),
    currentValueVnd: hasMissingQuote ? null : Math.round(currentValueVnd),
    unrealizedPnlVnd:
      unrealizedPnlVnd === null ? null : Math.round(unrealizedPnlVnd),
    totalPnlVnd:
      unrealizedPnlVnd === null
        ? null
        : Math.round(realizedPnlVnd + unrealizedPnlVnd),
    canLockProfitToday:
      positions.length === 0
        ? null
        : hasMissingQuote
          ? null
          : errors.length > 0
            ? null
            : unrealizedPnlVnd! > 0,
    positions,
    errors,
  };
}
