import type { LedgerSide } from '@/lib/portfolio-ledger';

export type PortfolioMarketQuoteStatus =
  | 'current'
  | 'historical'
  | 'unavailable';

export type PortfolioMarketQuote = {
  companyId: string;
  productId: string;
  requestedDate: string;
  quoteDate: string | null;
  buyVndPerLuong: number | null;
  sellVndPerLuong: number | null;
  status: PortfolioMarketQuoteStatus;
  source: { provider: string; url: string | null; official: boolean } | null;
  observedAt: string | null;
  expiresAt: string | null;
  reason: string | null;
};

export function isPortfolioMarketQuote(
  value: unknown,
  expectedCompanyId: string,
  expectedProductId: string,
  requestedDate: string,
): value is PortfolioMarketQuote {
  if (!value || typeof value !== 'object') return false;
  const quote = value as Partial<PortfolioMarketQuote>;
  if (
    quote.companyId !== expectedCompanyId ||
    quote.productId !== expectedProductId ||
    quote.requestedDate !== requestedDate ||
    !['current', 'historical', 'unavailable'].includes(quote.status ?? '')
  )
    return false;
  if (quote.status === 'unavailable') return true;
  const freshnessValid =
    quote.status !== 'current' ||
    (typeof quote.expiresAt === 'string' &&
      Number.isFinite(new Date(quote.expiresAt).getTime()) &&
      new Date(quote.expiresAt).getTime() > Date.now());
  return (
    quote.quoteDate === requestedDate &&
    freshnessValid &&
    isValidTwoSidedQuote(quote.buyVndPerLuong, quote.sellVndPerLuong)
  );
}

export type PortfolioQuoteCandidate = {
  companyId?: string;
  productId?: string;
  availability?: string;
  mode?: string;
  latest?: { date?: string; buy?: number | null; sell?: number | null } | null;
  observedAt?: string;
  timestampKind?: string;
  sourcePublishedAt?: string;
  generatedAt?: string;
  source?: { provider?: string; url?: string | null; official?: boolean };
};

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(instant.getTime()) &&
    instant.toISOString().slice(0, 10) === value
  );
}

export function isValidTwoSidedQuote(buy: unknown, sell: unknown) {
  return (
    typeof buy === 'number' &&
    Number.isSafeInteger(buy) &&
    buy > 0 &&
    typeof sell === 'number' &&
    Number.isSafeInteger(sell) &&
    sell > 0 &&
    buy <= sell
  );
}

/** A quote is usable for autofill only when every identity and date matches. */
export function resolveCurrentPortfolioQuote(
  candidate: PortfolioQuoteCandidate,
  expectedCompanyId: string,
  expectedProductId: string,
  requestedDate: string,
  today: string,
  now = Date.now(),
): PortfolioMarketQuote | null {
  const buy =
    typeof candidate.latest?.buy === 'number'
      ? Math.round(candidate.latest.buy * 1_000_000)
      : null;
  const sell =
    typeof candidate.latest?.sell === 'number'
      ? Math.round(candidate.latest.sell * 1_000_000)
      : null;
  const generatedAt = candidate.generatedAt
    ? new Date(candidate.generatedAt).getTime()
    : Number.NaN;
  const sourceTimestamp = candidate.sourcePublishedAt ?? candidate.observedAt;
  const sourceDate = sourceTimestamp
    ? vietnamCalendarDate(sourceTimestamp)
    : null;
  const expiresAt = Number.isFinite(generatedAt)
    ? new Date(generatedAt + 240_000).toISOString()
    : null;
  const valid =
    candidate.companyId === expectedCompanyId &&
    candidate.productId === expectedProductId &&
    candidate.availability === 'available' &&
    candidate.mode === 'live' &&
    candidate.latest?.date === requestedDate &&
    requestedDate === today &&
    isValidTwoSidedQuote(buy, sell) &&
    Number.isFinite(generatedAt) &&
    Math.abs(generatedAt) <= 8.64e15 - 240_000 &&
    generatedAt <= now &&
    generatedAt + 240_000 > now &&
    (candidate.timestampKind !== 'source' || sourceDate === requestedDate);

  if (!valid) return null;
  return {
    companyId: expectedCompanyId,
    productId: expectedProductId,
    requestedDate,
    quoteDate: requestedDate,
    buyVndPerLuong: buy,
    sellVndPerLuong: sell,
    status: 'current',
    source: {
      provider: candidate.source?.provider ?? 'Nguồn giá thị trường',
      url: candidate.source?.url ?? null,
      official: candidate.source?.official === true,
    },
    observedAt: candidate.sourcePublishedAt ?? candidate.observedAt ?? null,
    expiresAt,
    reason: null,
  };
}

export function resolveHistoricalPortfolioQuote(input: {
  companyId: string;
  productId: string;
  requestedDate: string;
  record: { date: string; buy: number | null; sell: number | null } | null;
  source: { provider: string; url: string | null; official: boolean } | null;
  observedAt?: string | null;
  reason?: string | null;
}): PortfolioMarketQuote {
  const buy = input.record?.buy ?? null;
  const sell = input.record?.sell ?? null;
  if (
    !input.record ||
    input.record.date !== input.requestedDate ||
    !isValidTwoSidedQuote(buy, sell)
  ) {
    return unavailablePortfolioQuote(
      input.companyId,
      input.productId,
      input.requestedDate,
      input.reason ?? 'Không có báo giá đã xác minh đúng ngày này.',
    );
  }
  return {
    companyId: input.companyId,
    productId: input.productId,
    requestedDate: input.requestedDate,
    quoteDate: input.record.date,
    buyVndPerLuong: buy,
    sellVndPerLuong: sell,
    status: 'historical',
    source: input.source,
    observedAt: input.observedAt ?? null,
    expiresAt: null,
    reason: null,
  };
}

export function unavailablePortfolioQuote(
  companyId: string,
  productId: string,
  requestedDate: string,
  reason: string,
): PortfolioMarketQuote {
  return {
    companyId,
    productId,
    requestedDate,
    quoteDate: null,
    buyVndPerLuong: null,
    sellVndPerLuong: null,
    status: 'unavailable',
    source: null,
    observedAt: null,
    expiresAt: null,
    reason,
  };
}

export function portfolioQuotePriceForSide(
  quote: Pick<PortfolioMarketQuote, 'buyVndPerLuong' | 'sellVndPerLuong'>,
  side: LedgerSide,
) {
  // Buying from a dealer uses its sell quote; selling uses its buy quote.
  return side === 'buy' ? quote.sellVndPerLuong : quote.buyVndPerLuong;
}

export function portfolioUnitFactor(unit: 'chi' | 'luong') {
  return unit === 'chi' ? 0.1 : 1;
}

export function portfolioUnitPriceFromLuong(
  priceVndPerLuong: number,
  unit: 'chi' | 'luong',
) {
  return Math.round(priceVndPerLuong * portfolioUnitFactor(unit));
}

export function portfolioPriceVndPerLuongForSave(
  displayPrice: number,
  unit: 'chi' | 'luong',
  canonicalPriceVndPerLuong: number | null,
) {
  if (
    canonicalPriceVndPerLuong !== null &&
    Number.isSafeInteger(canonicalPriceVndPerLuong) &&
    canonicalPriceVndPerLuong > 0
  )
    return canonicalPriceVndPerLuong;
  return Math.round(displayPrice / portfolioUnitFactor(unit));
}

export function vietnamCalendarDate(value: string) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const fields = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${fields.year}-${fields.month}-${fields.day}`;
}
