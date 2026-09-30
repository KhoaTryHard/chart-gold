export type QuoteResolutionStatus =
  | 'live'
  | 'delayed'
  | 'fallback'
  | 'unavailable';

export type QuoteResponseShape = {
  company?: { id?: string };
  product?: { id?: string };
  latest?: { buy?: number | null } | null;
  mode?: QuoteResolutionStatus;
  availability?: 'available' | 'unavailable';
  unavailableReason?: string | null;
  observedAt?: string;
  timestampKind?: 'source' | 'retrieval-or-date';
  source?: { provider?: string; url?: string | null };
};

export type ResolvedMarketQuote = {
  priceVndPerLuong: number | null;
  status: QuoteResolutionStatus;
  canAutofill: boolean;
  reason: string | null;
  provider: string;
  observedAt: string | null;
  timestampKind: QuoteResponseShape['timestampKind'];
  url: string | null;
};

/**
 * Validate a market response before it can populate a calculator field.
 * Product identity is checked separately from venue identity: a valid quote
 * for another product is never a valid fallback for the selected product.
 */
export function resolveMarketQuote(
  response: QuoteResponseShape,
  expectedCompanyId: string,
  expectedProductId: string,
): ResolvedMarketQuote {
  const status = response.mode ?? 'unavailable';
  const identityMatches =
    response.company?.id === expectedCompanyId &&
    response.product?.id === expectedProductId;
  const rawBuy = response.latest?.buy;
  const priceVndPerLuong =
    typeof rawBuy === 'number' && Number.isFinite(rawBuy) && rawBuy > 0
      ? rawBuy * 1_000_000
      : null;
  const available = response.availability === 'available' && priceVndPerLuong !== null;
  const canAutofill = identityMatches && available && status === 'live';
  const reason = !identityMatches
    ? 'Nguồn trả về sản phẩm hoặc thương hiệu không khớp lựa chọn.'
    : !available
      ? response.unavailableReason ?? 'Chưa có giá thu mua phù hợp.'
      : null;

  return {
    priceVndPerLuong: identityMatches && available ? priceVndPerLuong : null,
    status,
    canAutofill,
    reason,
    provider: response.source?.provider ?? '',
    observedAt: response.observedAt ?? null,
    timestampKind: response.timestampKind,
    url: response.source?.url ?? null,
  };
}


