import 'server-only';
import { marketFetch as fetch } from '@/lib/server/market-fetch';

import {
  getMarketCompany,
  getMarketProduct,
  getMarketProducts,
  type AggregatedMarketProduct,
  type MarketProduct,
} from '@/lib/market-sources';
import type { MarketData, MarketDataOptions, PricePoint } from '@/lib/server/sjc';

/**
 * VietinBank Gold & Jewellery publishes its current gold table in the
 * server-rendered `prices.gia_vang` payload on the official home page. There
 * is currently no public history endpoint, so this adapter intentionally
 * returns one current observation and never synthesizes older points.
 */
export const VGJ_PRICE_PAGE = 'https://vietinbankgold.vn/';

export type VgjProduct = AggregatedMarketProduct & { companyId: 'vgj' };

export type VgjPriceRow = {
  purchase: number | null;
  sell: number | null;
  title: string;
};

export type VgjQuote = {
  buy: number;
  sell: number;
  observedAt: string;
  provider: string;
  providerUrl: string;
};

function decodeEscapedHtml(value: string) {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\u([\da-f]{4})/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function normalizeTitle(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNullableNumber(value: string) {
  if (value === 'null') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse only the first-party price objects, not product/catalog metadata. */
export function parseVgjPriceRows(html: string): VgjPriceRow[] {
  const decoded = decodeEscapedHtml(html);
  const rows: VgjPriceRow[] = [];
  const rowPattern =
    /"purchase"\s*:\s*(null|-?\d+(?:\.\d+)?)\s*,\s*"sell"\s*:\s*(null|-?\d+(?:\.\d+)?)\s*,\s*"title"\s*:\s*"([^"]+)"/g;

  for (const match of decoded.matchAll(rowPattern)) {
    const title = match[3]?.trim();
    if (!title) continue;
    rows.push({
      purchase: parseNullableNumber(match[1]),
      sell: parseNullableNumber(match[2]),
      title,
    });
  }
  return rows;
}

function isValidPrice(buy: number, sell: number) {
  return (
    Number.isFinite(buy) &&
    Number.isFinite(sell) &&
    buy > 10 &&
    sell < 500 &&
    buy <= sell
  );
}

function toPoint(date: string, buy: number, sell: number): PricePoint {
  return {
    date,
    buy: Number(buy.toFixed(2)),
    sell: Number(sell.toFixed(2)),
    spread: Number((sell - buy).toFixed(2)),
    eventId: null,
  };
}

function vietnamDate(instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

export function parseVgjQuoteFromHtml(
  product: VgjProduct,
  html: string,
  observedAt = new Date().toISOString(),
): VgjQuote {
  if (!product.officialMatch) {
    throw new Error('VGJ product has no official match');
  }

  const expected = normalizeTitle(product.officialMatch);
  const row = parseVgjPriceRows(html).find((candidate) => {
    const actual = normalizeTitle(candidate.title);
    return actual === expected || actual.includes(expected);
  });
  if (!row || row.purchase === null || row.sell === null) {
    throw new Error('VGJ quote is incomplete');
  }

  // The official page states VND/Lượng. The dashboard's display unit is
  // million VND/lượng, so no denomination scaling is applied here.
  const buy = row.purchase / 1_000_000;
  const sell = row.sell / 1_000_000;
  if (!isValidPrice(buy, sell)) throw new Error('VGJ quote is invalid');

  return {
    buy,
    sell,
    observedAt,
    provider: 'VietinBank Gold & Jewellery official',
    providerUrl: VGJ_PRICE_PAGE,
  };
}

export async function fetchVgjQuote(product: VgjProduct): Promise<VgjQuote> {
  const response = await fetch(VGJ_PRICE_PAGE, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'KimTuyen-MarketView/1.0',
    },
    signal: AbortSignal.timeout(7_000),
  });
  if (!response.ok) throw new Error(`VGJ upstream ${response.status}`);
  return parseVgjQuoteFromHtml(product, await response.text());
}

function unavailableMarketData(
  company: ReturnType<typeof getMarketCompany>,
  product: MarketProduct,
  reason: string,
): MarketData {
  return {
    mode: 'unavailable',
    availability: 'unavailable',
    unavailableReason: reason,
    company,
    product,
    products: getMarketProducts(company.id),
    records: [],
    latest: null,
    observedAt: new Date().toISOString(),
    source: {
      provider: company.provider,
      url: company.sourceUrl,
      official: false,
    },
    historySource: {
      provider: 'Chưa có dữ liệu lịch sử khả dụng',
      url: null,
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Standalone adapter for callers that do not share the SJC first-party cache. */
export async function getVgjMarketData(
  productId: string | null | undefined,
  options: MarketDataOptions = {},
): Promise<MarketData> {
  const company = getMarketCompany('vgj');
  const product = getMarketProduct(company.id, productId);
  if (product.companyId !== 'vgj') {
    return unavailableMarketData(
      company,
      product,
      'Sản phẩm không thuộc danh mục VietinBank Gold & Jewellery.',
    );
  }

  if (options.view === 'history') {
    return unavailableMarketData(
      company,
      product,
      'VGJ hiện chỉ hỗ trợ snapshot giá hiện tại, chưa có lịch sử giao dịch.',
    );
  }

  let quote: VgjQuote;
  try {
    quote = await fetchVgjQuote(product as VgjProduct);
  } catch {
    return unavailableMarketData(
      company,
      product,
      'Trang giá VGJ hiện không trả được quote hai chiều cho sản phẩm này.',
    );
  }

  const latest = toPoint(
    vietnamDate(new Date(quote.observedAt)),
    quote.buy,
    quote.sell,
  );
  return {
    mode: 'live',
    availability: 'available',
    unavailableReason: null,
    company,
    product,
    products: getMarketProducts(company.id),
    records: [latest],
    latest,
    observedAt: quote.observedAt,
    source: {
      provider: quote.provider,
      url: quote.providerUrl,
      official: true,
    },
    historySource: {
      provider: 'VGJ official (chỉ có snapshot hiện tại)',
      url: VGJ_PRICE_PAGE,
    },
    generatedAt: new Date().toISOString(),
  };
}
