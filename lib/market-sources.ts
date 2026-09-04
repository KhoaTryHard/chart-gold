import { SJC_PRODUCTS, type SjcProduct } from '@/lib/sjc-products';

/**
 * The adapter used by a company. Keep this explicit so a product can never
 * accidentally fall back to another company's quote when an upstream is
 * unavailable.
 */
export type MarketSourceAdapter =
  | 'sjc-official'
  | 'vang-today'
  | 'btmc-official'
  | 'phuquy-official'
  | 'unavailable';

/** Companies currently exposed by the market dashboard. */
export const MARKET_COMPANIES = [
  {
    id: 'sjc',
    name: 'SJC',
    shortName: 'SJC',
    websiteUrl: 'https://sjc.com.vn',
    sourceUrl: 'https://www.vang.today/vi/api',
    officialSourceUrl: 'https://sjc.com.vn/xml/tygiavang.xml',
    provider: 'SJC official + Vang.Today history',
    supportsOfficialQuote: true,
    maxHistoryDays: 365,
    adapter: 'sjc-official',
  },
  {
    id: 'pnj',
    name: 'PNJ',
    shortName: 'PNJ',
    websiteUrl: 'https://www.pnj.com.vn',
    sourceUrl: 'https://www.vang.today/vi/api',
    officialSourceUrl: null,
    provider: 'Vang.Today aggregator',
    supportsOfficialQuote: false,
    maxHistoryDays: 30,
    adapter: 'vang-today',
  },
  {
    id: 'doji',
    name: 'DOJI',
    shortName: 'DOJI',
    websiteUrl: 'https://doji.vn',
    sourceUrl: 'https://www.vang.today/vi/api',
    officialSourceUrl: null,
    provider: 'Vang.Today aggregator',
    supportsOfficialQuote: false,
    maxHistoryDays: 30,
    adapter: 'vang-today',
  },
  {
    id: 'baotin',
    name: 'Bảo Tín',
    shortName: 'Bảo Tín',
    websiteUrl: 'https://btmc.vn',
    sourceUrl: 'https://www.vang.today/vi/api',
    officialSourceUrl: null,
    provider: 'Vang.Today aggregator',
    supportsOfficialQuote: false,
    maxHistoryDays: 30,
    adapter: 'vang-today',
  },
  {
    id: 'vngold',
    name: 'VN Gold',
    shortName: 'VN Gold',
    websiteUrl: null,
    sourceUrl: 'https://www.vang.today/vi/api',
    officialSourceUrl: null,
    provider: 'Vang.Today aggregator',
    supportsOfficialQuote: false,
    maxHistoryDays: 30,
    adapter: 'vang-today',
  },
  {
    id: 'viettin',
    name: 'VietinBank',
    shortName: 'VietinBank',
    websiteUrl: 'https://www.vietinbank.vn',
    sourceUrl: 'https://www.vang.today/vi/api',
    officialSourceUrl: null,
    provider: 'Vang.Today aggregator',
    supportsOfficialQuote: false,
    maxHistoryDays: 30,
    adapter: 'vang-today',
  },
  {
    id: 'btmc',
    name: 'Bảo Tín Minh Châu',
    shortName: 'BTMC',
    websiteUrl: 'https://btmc.vn',
    sourceUrl: 'https://btmc.vn/Home/BGiaVang',
    officialSourceUrl: 'https://btmc.vn/Home/BGiaVang',
    provider: 'Bảo Tín Minh Châu official',
    supportsOfficialQuote: true,
    maxHistoryDays: 7,
    adapter: 'btmc-official',
  },
  {
    id: 'phuquy',
    name: 'Phú Quý',
    shortName: 'Phú Quý',
    websiteUrl: 'https://phuquygroup.vn',
    sourceUrl: 'https://gold.phuquy.com.vn/giavang',
    officialSourceUrl: 'https://gold.phuquy.com.vn/giavang',
    provider: 'Phú Quý official',
    supportsOfficialQuote: true,
    maxHistoryDays: 7,
    adapter: 'phuquy-official',
  },
  {
    id: 'mihong',
    name: 'Mi Hồng',
    shortName: 'Mi Hồng',
    websiteUrl: 'https://mihong.vn',
    sourceUrl: 'https://mihong.vn',
    officialSourceUrl: null,
    provider: 'Mi Hồng — chưa xác minh nguồn trực tiếp',
    supportsOfficialQuote: false,
    maxHistoryDays: 0,
    adapter: 'unavailable',
  },
] as const;

export type MarketCompany = (typeof MARKET_COMPANIES)[number];
export type MarketCompanyId = MarketCompany['id'];

export type AggregatedMarketProduct = {
  id: string;
  companyId: Exclude<MarketCompanyId, 'sjc'>;
  group: string;
  label: string;
  shortLabel: string;
  unitLabel: string;
  /** Vang.Today code. Official adapters intentionally use null here. */
  upstreamCode: string | null;
  seriesId: string;
  weightInLuong: number | null;
  officialMatch: string | null;
  /** Key used by the BTMC historical JSON endpoint, when applicable. */
  officialKey?: string;
};

/**
 * Product metadata only. Prices are always fetched from the configured
 * adapter; this registry intentionally contains no invented quote/history.
 */
export const AGGREGATED_PRODUCTS: readonly AggregatedMarketProduct[] = [
  {
    id: 'pnj-hanoi',
    companyId: 'pnj',
    group: 'PNJ Hà Nội',
    label: 'PNJ Hà Nội',
    shortLabel: 'PNJ Hà Nội',
    unitLabel: '1 lượng',
    upstreamCode: 'PQHNVM',
    seriesId: 'aggregated',
    weightInLuong: 1,
    officialMatch: null,
  },
  {
    id: 'pnj-24k',
    companyId: 'pnj',
    group: 'PNJ 24K',
    label: 'PNJ 24K',
    shortLabel: 'PNJ 24K',
    unitLabel: '1 lượng',
    upstreamCode: 'PQHN24NTT',
    seriesId: 'aggregated',
    weightInLuong: 1,
    officialMatch: null,
  },
  {
    id: 'doji-hanoi',
    companyId: 'doji',
    group: 'DOJI Hà Nội',
    label: 'DOJI Hà Nội',
    shortLabel: 'DOJI Hà Nội',
    unitLabel: '1 lượng',
    upstreamCode: 'DOHNL',
    seriesId: 'aggregated',
    weightInLuong: 1,
    officialMatch: null,
  },
  {
    id: 'doji-hcm',
    companyId: 'doji',
    group: 'DOJI TP.HCM',
    label: 'DOJI TP.HCM',
    shortLabel: 'DOJI TP.HCM',
    unitLabel: '1 lượng',
    upstreamCode: 'DOHCML',
    seriesId: 'aggregated',
    weightInLuong: 1,
    officialMatch: null,
  },
  {
    id: 'doji-jewelry',
    companyId: 'doji',
    group: 'DOJI Nữ trang',
    label: 'DOJI Nữ trang',
    shortLabel: 'DOJI Nữ trang',
    unitLabel: '1 lượng',
    upstreamCode: 'DOJINHTV',
    seriesId: 'aggregated',
    weightInLuong: 1,
    officialMatch: null,
  },
  {
    id: 'baotin-sjc',
    companyId: 'baotin',
    group: 'Bảo Tín SJC',
    label: 'Bảo Tín SJC',
    shortLabel: 'Bảo Tín SJC',
    unitLabel: '1 lượng',
    upstreamCode: 'BTSJC',
    seriesId: 'aggregated',
    weightInLuong: 1,
    officialMatch: null,
  },
  {
    id: 'baotin-9999',
    companyId: 'baotin',
    group: 'Bảo Tín 9999',
    label: 'Bảo Tín 9999',
    shortLabel: 'Bảo Tín 9999',
    unitLabel: '1 lượng',
    upstreamCode: 'BT9999NTT',
    seriesId: 'aggregated',
    weightInLuong: 1,
    officialMatch: null,
  },
  {
    id: 'vngold-sjc',
    companyId: 'vngold',
    group: 'VN Gold SJC',
    label: 'VN Gold SJC',
    shortLabel: 'VN Gold SJC',
    unitLabel: '1 lượng',
    upstreamCode: 'VNGSJC',
    seriesId: 'aggregated',
    weightInLuong: 1,
    officialMatch: null,
  },
  {
    id: 'viettin-sjc',
    companyId: 'viettin',
    group: 'VietinBank SJC',
    label: 'VietinBank SJC',
    shortLabel: 'VietinBank SJC',
    unitLabel: '1 lượng',
    upstreamCode: 'VIETTINMSJC',
    seriesId: 'aggregated',
    weightInLuong: 1,
    officialMatch: null,
  },
];

/**
 * Products listed by first-party pages. Their prices are parsed only from the
 * matching official row/key; they do not contain guessed upstream codes.
 */
export const OFFICIAL_MARKET_PRODUCTS: readonly AggregatedMarketProduct[] = [
  {
    id: 'btmc-bar',
    companyId: 'btmc',
    group: 'Bảo Tín Minh Châu',
    label: 'Vàng miếng VRTL Bảo Tín Minh Châu',
    shortLabel: 'Vàng miếng VRTL',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'btmc',
    weightInLuong: 1,
    officialMatch: 'VÀNG MIẾNG VRTL BẢO TÍN MINH CHÂU',
    officialKey: 'btmcvangmiengmua',
  },
  {
    id: 'btmc-ring',
    companyId: 'btmc',
    group: 'Bảo Tín Minh Châu',
    label: 'Nhẫn tròn trơn Bảo Tín Minh Châu 999.9',
    shortLabel: 'Nhẫn tròn trơn BTMC',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'btmc',
    weightInLuong: 1,
    officialMatch: 'NHẪN TRÒN TRƠN BẢO TÍN MINH CHÂU',
    officialKey: 'btmcvangnhanmua',
  },
  {
    id: 'btmc-gift',
    companyId: 'btmc',
    group: 'Bảo Tín Minh Châu',
    label: 'Quà mừng Bản vị vàng BTMC 999.9',
    shortLabel: 'Quà mừng BTMC',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'btmc',
    weightInLuong: 1,
    officialMatch: 'QUÀ MỪNG BẢN VỊ VÀNG BẢO TÍN MINH CHÂU',
    officialKey: 'btmcvangquamungmua',
  },
  {
    id: 'btmc-sjc',
    companyId: 'btmc',
    group: 'Bảo Tín Minh Châu',
    label: 'Vàng miếng SJC tại BTMC',
    shortLabel: 'SJC tại BTMC',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'btmc',
    weightInLuong: 1,
    officialMatch: 'VÀNG MIẾNG SJC',
    officialKey: 'sjcmua',
  },
  {
    id: 'btmc-jewelry-9999',
    companyId: 'btmc',
    group: 'Trang sức Vàng Rồng Thăng Long',
    label: 'Trang sức Vàng Rồng Thăng Long 999.9',
    shortLabel: 'Trang sức VRTL 999.9',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'btmc',
    weightInLuong: 1,
    officialMatch: 'TRANG SỨC VÀNG RỒNG THĂNG LONG 999.9',
    officialKey: 'trangsucmua',
  },
  {
    id: 'btmc-jewelry-999',
    companyId: 'btmc',
    group: 'Trang sức Vàng Rồng Thăng Long',
    label: 'Trang sức Vàng Rồng Thăng Long 99.9',
    shortLabel: 'Trang sức VRTL 99.9',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'btmc',
    weightInLuong: 1,
    officialMatch: 'TRANG SỨC VÀNG RỒNG THĂNG LONG 99.9',
    officialKey: 'trangsucmua1',
  },
  {
    id: 'phuquy-bar',
    companyId: 'phuquy',
    group: 'Phú Quý',
    label: 'Vàng miếng SJC tại Phú Quý',
    shortLabel: 'Miếng SJC Phú Quý',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'phuquy',
    weightInLuong: 1,
    officialMatch: 'VÀNG MIẾNG SJC',
  },
  {
    id: 'phuquy-ring-9999',
    companyId: 'phuquy',
    group: 'Phú Quý',
    label: 'Nhẫn tròn Phú Quý 999.9',
    shortLabel: 'Nhẫn tròn Phú Quý',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'phuquy',
    weightInLuong: 1,
    officialMatch: 'NHẪN TRÒN PHÚ QUÝ 999.9',
  },
  {
    id: 'phuquy-bar-9999',
    companyId: 'phuquy',
    group: 'Phú Quý',
    label: 'Phú Quý 1 lượng 999.9',
    shortLabel: 'Phú Quý 999.9',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'phuquy',
    weightInLuong: 1,
    officialMatch: 'PHÚ QUÝ 1 LƯỢNG 999.9',
  },
  {
    id: 'phuquy-999',
    companyId: 'phuquy',
    group: 'Phú Quý',
    label: 'Phú Quý 1 lượng 99.9',
    shortLabel: 'Phú Quý 99.9',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'phuquy',
    weightInLuong: 1,
    officialMatch: 'PHÚ QUÝ 1 LƯỢNG 99.9',
  },
  {
    id: 'phuquy-jewelry-9999',
    companyId: 'phuquy',
    group: 'Trang sức Phú Quý',
    label: 'Vàng trang sức Phú Quý 999.9',
    shortLabel: 'Trang sức Phú Quý 999.9',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'phuquy',
    weightInLuong: 1,
    officialMatch: 'VÀNG TRANG SỨC 999.9',
  },
  {
    id: 'mihong-sjc',
    companyId: 'mihong',
    group: 'Mi Hồng (chưa khả dụng)',
    label: 'Vàng miếng SJC Mi Hồng',
    shortLabel: 'SJC Mi Hồng',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'unavailable',
    weightInLuong: 1,
    officialMatch: null,
  },
  {
    id: 'mihong-9999',
    companyId: 'mihong',
    group: 'Mi Hồng (chưa khả dụng)',
    label: 'Vàng 9999 Mi Hồng',
    shortLabel: '9999 Mi Hồng',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'unavailable',
    weightInLuong: 1,
    officialMatch: null,
  },
];

export type MarketProduct = SjcProduct | AggregatedMarketProduct;
export type MarketProductId = MarketProduct['id'];

const PRODUCTS_BY_COMPANY: Record<MarketCompanyId, readonly MarketProduct[]> = {
  sjc: SJC_PRODUCTS,
  pnj: AGGREGATED_PRODUCTS.filter((product) => product.companyId === 'pnj'),
  doji: AGGREGATED_PRODUCTS.filter((product) => product.companyId === 'doji'),
  baotin: AGGREGATED_PRODUCTS.filter(
    (product) => product.companyId === 'baotin',
  ),
  btmc: OFFICIAL_MARKET_PRODUCTS.filter(
    (product) => product.companyId === 'btmc',
  ),
  phuquy: OFFICIAL_MARKET_PRODUCTS.filter(
    (product) => product.companyId === 'phuquy',
  ),
  mihong: OFFICIAL_MARKET_PRODUCTS.filter(
    (product) => product.companyId === 'mihong',
  ),
  vngold: AGGREGATED_PRODUCTS.filter(
    (product) => product.companyId === 'vngold',
  ),
  viettin: AGGREGATED_PRODUCTS.filter(
    (product) => product.companyId === 'viettin',
  ),
};

export const MARKET_PRODUCTS = Object.values(PRODUCTS_BY_COMPANY).flat();

export function getMarketCompany(
  value: string | null | undefined,
): MarketCompany {
  return (
    MARKET_COMPANIES.find((company) => company.id === value) ??
    MARKET_COMPANIES[0]
  );
}

export function getMarketProducts(
  companyId: string | null | undefined,
): readonly MarketProduct[] {
  return PRODUCTS_BY_COMPANY[getMarketCompany(companyId).id];
}

export function getMarketProduct(
  companyId: string | null | undefined,
  productId: string | null | undefined,
): MarketProduct {
  const products = getMarketProducts(companyId);
  return products.find((product) => product.id === productId) ?? products[0];
}

export function getMarketProductCompany(productId: string | null | undefined) {
  return MARKET_COMPANIES.find((company) =>
    PRODUCTS_BY_COMPANY[company.id].some((product) => product.id === productId),
  );
}
