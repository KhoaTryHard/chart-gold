import { SJC_PRODUCTS, type SjcProduct } from '@/lib/sjc-products';
import type { MarketHistoryCapability } from '@/lib/market-history';
import type { Locale } from '@/lib/i18n';

const englishCatalogPhrases: readonly [RegExp, string][] = [
  [/Vàng\.Today/gi, 'Vang.Today'],
  [
    /Không thể tải dữ liệu cho lựa chọn này\. Không có snapshot thay thế để tránh hiển thị giá không xác thực\./gi,
    'Unable to load data for this selection. No backup snapshot is available, to avoid showing an unverified price.',
  ],
  [
    /Phú Quý công bố định lượng nhưng chưa có dòng giá hai chiều tương ứng\./gi,
    'Phú Quý lists the product size but does not yet publish matching buy and sell quotes.',
  ],
  [
    /Trang giá VGJ hiện công bố dòng này nhưng chưa có giá mua và bán\./gi,
    'VGJ lists this product, but buy and sell quotes are not yet available.',
  ],
  [
    /Trang giá Phú Quý hiện chỉ công bố giá mua cho dòng này\./gi,
    'Phú Quý currently publishes only a dealer buy quote for this product.',
  ],
  [
    /Bảng giá BTMC hiện chỉ công bố giá mua cho dòng này\./gi,
    'BTMC currently publishes only a dealer buy quote for this product.',
  ],
  [
    /Bảng giá BTMH hiện chỉ công bố giá mua cho dòng này\./gi,
    'BTMH currently publishes only a dealer buy quote for this product.',
  ],
  [
    /Chưa có lịch sử Tiểu Kim Cát đã xác minh; giá hiện tại chưa tải được\./gi,
    'No verified Tieu Kim Cat history is available and its current price could not be loaded.',
  ],
  [
    /chưa chuẩn hóa giá theo ([\d.,]+) chỉ/gi,
    'the price has not been normalized to $1 chỉ',
  ],
  [/chưa có giá mua và bán/gi, 'buy and sell quotes are not yet available'],
  [/chưa có dữ liệu hai chiều/gi, 'two-sided price data is not yet available'],
  [/chưa xác minh nguồn trực tiếp/gi, 'direct source is unverified'],
  [/chưa có chuỗi lịch sử/gi, 'no historical series'],
  [/chưa có mã lịch sử/gi, 'no history code'],
  [/chưa có dòng giá/gi, 'no quoted size'],
  [/chưa có giá bán/gi, 'no sell quote'],
  [/chưa có giá/gi, 'no price'],
  [/chưa khả dụng/gi, 'unavailable'],
  [/theo tuổi vàng/gi, 'by purity'],
  [/theo khu vực/gi, 'by region'],
  [/vàng tích lũy/gi, 'investment gold'],
  [/vàng nguyên liệu/gi, 'raw gold'],
  [/Đồng vàng/gi, 'Gold coin'],
  [/Tiểu Kim Cát/gi, 'Tieu Kim Cat'],
  [/Nhẫn trơn và vàng tài lộc/gi, 'Plain rings and auspicious gold'],
  [/Quà mừng Bản vị vàng BTMC/gi, 'BTMC Gold Standard Celebration Gift'],
  [/Trang sức Vàng Rồng Thăng Long/gi, 'VRTL jewelry'],
  [/Trang sức VRTL/gi, 'VRTL jewelry'],
  [/TP\.HCM|TPHCM/gi, 'Ho Chi Minh City'],
  [/Đông Nam Bộ/gi, 'Southeast region'],
  [/Miền Tây/gi, 'Mekong Delta'],
  [/Tây Nguyên/gi, 'Central Highlands'],
  [/Hà Nội/gi, 'Hanoi'],
  [/Đà Nẵng/gi, 'Da Nang'],
  [
    /SJC (Ho Chi Minh City|Hanoi|Da Nang|Mekong Delta|Central Highlands|Southeast region) (?:tại|at) PNJ/gi,
    'SJC gold bar at PNJ · $1',
  ],
  [/Nhẫn tròn trơn/gi, 'Plain ring'],
  [/Vàng nhẫn trơn/gi, 'Plain gold ring'],
  [/Vàng miếng/gi, 'Gold bar'],
  [/Vàng nữ trang/gi, 'Gold jewelry'],
  [/Vàng trang sức/gi, 'Gold jewelry'],
  [/Trang sức/gi, 'Jewelry'],
  [/Nữ trang/gi, 'Jewelry'],
  [/Nhẫn tròn/gi, 'Gold ring'],
  [/Nhẫn trơn/gi, 'Plain ring'],
  [/Vàng nguyên liệu/gi, 'Raw gold'],
  [/Vàng hệ thống/gi, 'System gold'],
  [/Vàng phi SJC/gi, 'Non-SJC gold'],
  [/Vàng nhẫn/gi, 'Gold ring'],
  [/Thần tài/gi, 'God of Wealth'],
  [/Quà mừng/gi, 'Celebration gift'],
  [/Bản vị vàng/gi, 'gold standard'],
  [/Đồng xu/gi, 'Coin'],
  [/thương hiệu khác/gi, 'other brands'],
  [/Miếng/gi, 'Bar'],
  [/Nhẫn/gi, 'Ring'],
  [/Vàng/gi, 'Gold'],
  [/tại/gi, 'at'],
  [/(?<![\p{L}\p{N}])và(?![\p{L}\p{N}])/giu, 'and'],
  [/Bản dự phòng cục bộ/gi, 'Local fallback data'],
  [/Bản lịch sử dự phòng/gi, 'Historical fallback data'],
  [/Chưa có dữ liệu lịch sử khả dụng/gi, 'No history data is available'],
  [
    /Nguồn chưa trả dữ liệu hai chiều\./gi,
    'The source has not returned both buy and sell prices.',
  ],
];

/** Localizes catalog copy for display without changing the source registry. */
export function presentMarketCatalogText(
  value: string,
  locale: Locale,
): string {
  if (locale === 'vi') return value;
  return englishCatalogPhrases.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value.replace(/(?<=\d),(?=\d)/g, '.'),
  );
}

export function presentMarketCompany(
  company: MarketCompany,
  locale: Locale,
): { name: string; shortName: string; provider: string } {
  return {
    name: presentMarketCatalogText(company.name, locale),
    shortName: presentMarketCatalogText(company.shortName, locale),
    provider: presentMarketCatalogText(company.provider, locale),
  };
}

export function presentMarketProduct(
  product: MarketProduct,
  locale: Locale,
): {
  label: string;
  shortLabel: string;
  group: string;
  unitLabel: string;
  unavailableReason?: string;
} {
  return {
    label: presentMarketCatalogText(product.label, locale),
    shortLabel: presentMarketCatalogText(product.shortLabel, locale),
    group: presentMarketCatalogText(product.group, locale),
    unitLabel: presentMarketCatalogText(product.unitLabel, locale),
    ...('unavailableReason' in product && product.unavailableReason
      ? {
          unavailableReason: presentMarketCatalogText(
            product.unavailableReason,
            locale,
          ),
        }
      : {}),
  };
}

/**
 * The adapter used by a company. Keep this explicit so a product can never
 * accidentally fall back to another company's quote when an upstream is
 * unavailable.
 */
export type MarketSourceAdapter =
  | 'sjc-official'
  | 'pnj-official'
  | 'vang-today'
  | 'btmc-official'
  | 'btmh-official'
  | 'phuquy-official'
  | 'vgj-official'
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
    sourceUrl: 'https://edge-cf-api.pnj.io/ecom-frontend/v3/get-gold-price',
    officialSourceUrl:
      'https://edge-cf-api.pnj.io/ecom-frontend/v3/get-gold-price',
    provider: 'PNJ official',
    supportsOfficialQuote: true,
    maxHistoryDays: 30,
    adapter: 'pnj-official',
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
    id: 'vgj',
    name: 'VietinBank Gold & Jewellery (VGJ)',
    shortName: 'VGJ',
    websiteUrl: 'https://vietinbankgold.vn',
    sourceUrl: 'https://vietinbankgold.vn/',
    officialSourceUrl: 'https://vietinbankgold.vn/',
    provider: 'VietinBank Gold & Jewellery official',
    supportsOfficialQuote: true,
    // The first-party page exposes the current table, but no public history
    // endpoint. Keep one current observation instead of manufacturing history.
    maxHistoryDays: 1,
    adapter: 'vgj-official',
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
    id: 'btmh',
    name: 'Bảo Tín Mạnh Hải',
    shortName: 'BTMH',
    websiteUrl: 'https://baotinmanhhai.vn',
    sourceUrl: 'https://baotinmanhhai.vn/bang-gia-vang',
    officialSourceUrl: 'https://baotinmanhhai.vn/api/graphql',
    provider: 'Bảo Tín Mạnh Hải official',
    supportsOfficialQuote: true,
    maxHistoryDays: 365,
    adapter: 'btmh-official',
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

export type MarketProductCategory =
  | 'bar'
  | 'ring'
  | 'investment-gold'
  | 'gift'
  | 'jewelry'
  | 'coin'
  | 'raw-material'
  | 'other';

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
  /** Shared product category used by the market, ledger, and analysis flows. */
  category?: MarketProductCategory;
  /** Short first-party names and quote codes users commonly type. */
  searchAliases?: readonly string[];
  weightInLuong: number | null;
  officialMatch: string | null;
  /** Exact location/group label used by a first-party product API. */
  officialLocation?: string;
  /** Key used by the BTMC historical JSON endpoint, when applicable. */
  officialKey?: string;
  /** Exact Vang.Today code allowed as a transparent BTMC fallback. */
  fallbackUpstreamCode?: string;
  /** Catalog rows without a verified two-sided quote are visible but disabled. */
  catalogStatus?: 'priced' | 'unavailable';
  unavailableReason?: string;
};

/**
 * Products published by PNJ's first-party gold-price API. The API quotes
 * every row in VND per lượng and does not publish per-size prices, so the
 * registry intentionally keeps one product per published row. Do not infer
 * 1/2/5 chỉ variants from these values.
 */
export const PNJ_PRODUCTS: readonly AggregatedMarketProduct[] = [
  ...(
    [
      ['pnj-hcm', 'PNJ TP.HCM', 'TPHCM'],
      ['pnj-hanoi', 'PNJ Hà Nội', 'Hà Nội'],
      ['pnj-danang', 'PNJ Đà Nẵng', 'Đà Nẵng'],
      ['pnj-mientay', 'PNJ Miền Tây', 'Miền Tây'],
      ['pnj-taynguyen', 'PNJ Tây Nguyên', 'Tây Nguyên'],
      ['pnj-dongnambo', 'PNJ Đông Nam Bộ', 'Đông Nam Bộ'],
    ] as const
  ).map(([id, label, officialLocation]) => ({
    id,
    companyId: 'pnj' as const,
    group: 'PNJ theo khu vực',
    label,
    shortLabel: label,
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'pnj',
    weightInLuong: 1,
    officialMatch: 'PNJ',
    officialLocation,
  })),
  ...(
    [
      ['pnj-sjc-hcm', 'SJC TP.HCM tại PNJ', 'TPHCM'],
      ['pnj-sjc-hanoi', 'SJC Hà Nội tại PNJ', 'Hà Nội'],
      ['pnj-sjc-danang', 'SJC Đà Nẵng tại PNJ', 'Đà Nẵng'],
      ['pnj-sjc-mientay', 'SJC Miền Tây tại PNJ', 'Miền Tây'],
      ['pnj-sjc-taynguyen', 'SJC Tây Nguyên tại PNJ', 'Tây Nguyên'],
      ['pnj-sjc-dongnambo', 'SJC Đông Nam Bộ tại PNJ', 'Đông Nam Bộ'],
    ] as const
  ).map(([id, label, officialLocation]) => ({
    id,
    companyId: 'pnj' as const,
    group: 'SJC theo khu vực tại PNJ',
    label,
    shortLabel: label,
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'pnj',
    weightInLuong: 1,
    officialMatch: 'SJC',
    officialLocation,
  })),
  ...(
    [
      ['pnj-ring-9999', 'Nhẫn Trơn PNJ 999.9'],
      ['pnj-kim-bao-9999', 'Vàng Kim Bảo 999.9'],
      ['pnj-phuc-loc-tai-9999', 'Vàng Phúc Lộc Tài 999.9'],
    ] as const
  ).map(([id, label]) => ({
    id,
    companyId: 'pnj' as const,
    group: 'Nhẫn trơn và vàng tài lộc',
    label,
    shortLabel: label,
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'pnj',
    weightInLuong: 1,
    officialMatch: label,
    officialLocation: 'Giá vàng nữ trang',
  })),
  ...(
    [
      ['pnj-jewelry-9999', 'Vàng nữ trang 999.9'],
      ['pnj-jewelry-999', 'Vàng nữ trang 999'],
      ['pnj-jewelry-9920', 'Vàng nữ trang 9920'],
      ['pnj-jewelry-99', 'Vàng nữ trang 99'],
      ['pnj-gold-916', 'Vàng 916 (22K)'],
      ['pnj-gold-750', 'Vàng 750 (18K)'],
      ['pnj-gold-680', 'Vàng 680 (16.3K)'],
      ['pnj-gold-650', 'Vàng 650 (15.6K)'],
      ['pnj-gold-610', 'Vàng 610 (14.6K)'],
      ['pnj-gold-585', 'Vàng 585 (14K)'],
      ['pnj-gold-416', 'Vàng 416 (10K)'],
      ['pnj-gold-375', 'Vàng 375 (9K)'],
      ['pnj-gold-333', 'Vàng 333 (8K)'],
    ] as const
  ).map(([id, label]) => ({
    id,
    companyId: 'pnj' as const,
    group: 'Vàng nữ trang theo tuổi vàng',
    label,
    shortLabel: label,
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'pnj',
    weightInLuong: 1,
    officialMatch: label,
    officialLocation: 'Giá vàng nữ trang',
  })),
];

/**
 * Product metadata only. Prices are always fetched from the configured
 * adapter; this registry intentionally contains no invented quote/history.
 */
export const AGGREGATED_PRODUCTS: readonly AggregatedMarketProduct[] = [
  {
    id: 'doji-hanoi',
    companyId: 'doji',
    group: 'DOJI Hà Nội · vàng miếng và nhẫn',
    label: 'DOJI Hà Nội · vàng miếng / nhẫn 9999',
    shortLabel: 'DOJI Hà Nội · miếng/nhẫn',
    unitLabel: '1 lượng',
    upstreamCode: 'DOHNL',
    seriesId: 'aggregated',
    weightInLuong: 1,
    officialMatch: null,
  },
  {
    id: 'doji-hcm',
    companyId: 'doji',
    group: 'DOJI TP.HCM · vàng miếng và nhẫn',
    label: 'DOJI TP.HCM · vàng miếng / nhẫn 9999',
    shortLabel: 'DOJI TP.HCM · miếng/nhẫn',
    unitLabel: '1 lượng',
    upstreamCode: 'DOHCML',
    seriesId: 'aggregated',
    weightInLuong: 1,
    officialMatch: null,
  },
  {
    id: 'doji-jewelry',
    companyId: 'doji',
    group: 'DOJI nữ trang',
    label: 'DOJI nữ trang 9999',
    shortLabel: 'DOJI nữ trang 9999',
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
    fallbackUpstreamCode: 'BT9999NTT',
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
    id: 'btmc-coin-01c',
    companyId: 'btmc',
    group: 'Đồng xu VRTL (chưa có mã lịch sử)',
    label: 'Đồng xu VRTL 0,1 chỉ · chưa có chuỗi lịch sử',
    shortLabel: 'Đồng xu VRTL 0,1 chỉ',
    unitLabel: '0,1 chỉ',
    upstreamCode: null,
    seriesId: 'unavailable',
    weightInLuong: 0.01,
    officialMatch: 'ĐỒNG XU VRTL 0.1',
    catalogStatus: 'unavailable',
    unavailableReason:
      'BTMC có niêm yết dòng này trên bảng giá, nhưng endpoint JSON không công bố mã hai chiều tương ứng; chưa chuẩn hóa giá theo 0,1 chỉ.',
  },
  {
    id: 'btmc-system-9999',
    companyId: 'btmc',
    group: 'Vàng hệ thống (chưa có giá bán)',
    label: 'Vàng hệ thống BTMC 999.9 · chưa có giá bán',
    shortLabel: 'Vàng hệ thống BTMC 999.9',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'unavailable',
    weightInLuong: 1,
    officialMatch: 'VÀNG HỆ THỐNG',
    catalogStatus: 'unavailable',
    unavailableReason: 'Bảng giá BTMC hiện chỉ công bố giá mua cho dòng này.',
  },
  {
    id: 'btmc-raw-9999',
    companyId: 'btmc',
    group: 'Vàng nguyên liệu (chưa có giá bán)',
    label: 'Vàng nguyên liệu BTMC 999.9 · chưa có giá bán',
    shortLabel: 'Vàng nguyên liệu BTMC 999.9',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'unavailable',
    weightInLuong: 1,
    officialMatch: 'VÀNG NGUYÊN LIỆU',
    catalogStatus: 'unavailable',
    unavailableReason: 'Bảng giá BTMC hiện chỉ công bố giá mua cho dòng này.',
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
    fallbackUpstreamCode: 'BTSJC',
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
    id: 'btmh-kgb',
    companyId: 'btmh',
    group: 'Kim Gia Bảo · vàng tích lũy',
    label: 'Kim Gia Bảo 24K',
    shortLabel: 'Kim Gia Bảo 24K',
    unitLabel: '1 chỉ',
    upstreamCode: null,
    seriesId: 'btmh',
    category: 'investment-gold',
    searchAliases: ['KGB', 'Kim Gia Bảo'],
    weightInLuong: 0.1,
    officialMatch: 'Kim Gia Bảo 24K',
    officialKey: 'KGB',
  },
  {
    id: 'btmh-bt-tkc',
    companyId: 'btmh',
    group: 'Tiểu Kim Cát · vàng tích lũy',
    label: 'Tiểu Kim Cát 24K · 0,1 chỉ',
    shortLabel: 'Tiểu Kim Cát 0,1 chỉ',
    unitLabel: '0,1 chỉ',
    upstreamCode: null,
    seriesId: 'btmh',
    category: 'investment-gold',
    searchAliases: ['BT-TKC', 'Tiểu Kim Cát'],
    weightInLuong: 0.01,
    officialMatch: 'Tiểu Kim Cát 24K',
    officialKey: 'BT-TKC',
  },
  {
    id: 'btmh-kgbg',
    companyId: 'btmh',
    group: 'Quà tặng vàng',
    label: 'Kim Gia Bảo Gift 24K',
    shortLabel: 'Kim Gia Bảo Gift',
    unitLabel: '1 chỉ',
    upstreamCode: null,
    seriesId: 'btmh',
    category: 'gift',
    searchAliases: ['KGBG', 'Kim Gia Bảo Gift'],
    weightInLuong: 0.1,
    officialMatch: 'Kim Gia Bảo Gift 24K',
    officialKey: 'KGBG',
  },
  {
    id: 'btmh-khs',
    companyId: 'btmh',
    group: 'Đồng vàng Kim Gia Bảo',
    label: 'Đồng vàng Kim Gia Bảo hoa sen',
    shortLabel: 'Đồng vàng Kim Gia Bảo',
    unitLabel: '1 chỉ',
    upstreamCode: null,
    seriesId: 'btmh',
    category: 'coin',
    searchAliases: ['KHS', 'Kim Gia Bảo hoa sen'],
    weightInLuong: 0.1,
    officialMatch: 'Đồng vàng Kim Gia Bảo hoa sen',
    officialKey: 'KHS',
  },
  {
    id: 'btmh-sjc9999',
    companyId: 'btmh',
    group: 'Bảo Tín Mạnh Hải · vàng miếng SJC',
    label: 'Vàng miếng SJC tại Bảo Tín Mạnh Hải',
    shortLabel: 'SJC tại BTMH',
    unitLabel: '1 chỉ',
    upstreamCode: null,
    seriesId: 'btmh',
    category: 'bar',
    searchAliases: ['SJC9999'],
    weightInLuong: 0.1,
    officialMatch: 'Vàng miếng SJC (Cty CP BTMH)',
    officialKey: 'SJC9999',
  },
  {
    id: 'btmh-9999',
    companyId: 'btmh',
    group: 'Trang sức vàng 24K',
    label: 'Vàng trang sức 24K (999.9) BTMH',
    shortLabel: 'Trang sức BTMH 999.9',
    unitLabel: '1 chỉ',
    upstreamCode: null,
    seriesId: 'btmh',
    category: 'jewelry',
    searchAliases: ['9999'],
    weightInLuong: 0.1,
    officialMatch: 'Vàng trang sức 24K (999.9)',
    officialKey: '9999',
  },
  {
    id: 'btmh-999',
    companyId: 'btmh',
    group: 'Trang sức vàng 24K',
    label: 'Vàng trang sức 24K 999 BTMH',
    shortLabel: 'Trang sức BTMH 999',
    unitLabel: '1 chỉ',
    upstreamCode: null,
    seriesId: 'btmh',
    category: 'jewelry',
    searchAliases: ['999'],
    weightInLuong: 0.1,
    officialMatch: 'Vàng trang sức 24K 999',
    officialKey: '999',
  },
  {
    id: 'btmh-bt24k',
    companyId: 'btmh',
    group: 'Trang sức BTMH (chưa có giá bán)',
    label: 'Trang sức · Nhẫn tròn BTMH 999.9',
    shortLabel: 'Nhẫn tròn BTMH',
    unitLabel: 'Chưa xác minh quy cách',
    upstreamCode: null,
    seriesId: 'unavailable',
    category: 'jewelry',
    searchAliases: ['BT24K'],
    weightInLuong: null,
    officialMatch: 'Trang sức - Nhẫn tròn BTMH',
    officialKey: 'BT24K',
    catalogStatus: 'unavailable',
    unavailableReason: 'Bảng giá BTMH hiện chỉ công bố giá mua cho dòng này.',
  },
  {
    id: 'btmh-vrtl',
    companyId: 'btmh',
    group: 'Nhẫn vàng BTMH (chưa có giá bán)',
    label: 'Nhẫn ép vỉ Vàng Rồng Thăng Long · BTMH',
    shortLabel: 'Nhẫn ép vỉ VRTL BTMH',
    unitLabel: 'Chưa xác minh quy cách',
    upstreamCode: null,
    seriesId: 'unavailable',
    category: 'ring',
    searchAliases: ['VRTL'],
    weightInLuong: null,
    officialMatch: 'Nhẫn ép vỉ Vàng Rồng Thăng Long',
    officialKey: 'VRTL',
    catalogStatus: 'unavailable',
    unavailableReason: 'Bảng giá BTMH hiện chỉ công bố giá mua cho dòng này.',
  },
  {
    id: 'btmh-nl9999',
    companyId: 'btmh',
    group: 'Vàng nguyên liệu BTMH (chưa có giá bán)',
    label: 'Vàng nguyên liệu BTMH 999.9',
    shortLabel: 'Nguyên liệu BTMH 999.9',
    unitLabel: 'Chưa xác minh quy cách',
    upstreamCode: null,
    seriesId: 'unavailable',
    category: 'raw-material',
    searchAliases: ['NL9999'],
    weightInLuong: null,
    officialMatch: 'Vàng nguyên liệu (999.9)',
    officialKey: 'NL9999',
    catalogStatus: 'unavailable',
    unavailableReason: 'Bảng giá BTMH hiện chỉ công bố giá mua cho dòng này.',
  },
  {
    id: 'btmh-nl999',
    companyId: 'btmh',
    group: 'Vàng nguyên liệu BTMH (chưa có giá bán)',
    label: 'Vàng nguyên liệu BTMH 999',
    shortLabel: 'Nguyên liệu BTMH 999',
    unitLabel: 'Chưa xác minh quy cách',
    upstreamCode: null,
    seriesId: 'unavailable',
    category: 'raw-material',
    searchAliases: ['NL999'],
    weightInLuong: null,
    officialMatch: 'Vàng nguyên liệu (999)',
    officialKey: 'NL999',
    catalogStatus: 'unavailable',
    unavailableReason: 'Bảng giá BTMH hiện chỉ công bố giá mua cho dòng này.',
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
    group: 'Nhẫn tròn Phú Quý 999.9',
    label: 'Nhẫn tròn Phú Quý 999.9 · 1 chỉ',
    shortLabel: 'Nhẫn tròn Phú Quý 1 chỉ',
    unitLabel: '1 chỉ',
    upstreamCode: null,
    seriesId: 'phuquy',
    weightInLuong: 0.1,
    officialMatch: 'NHẪN TRÒN PHÚ QUÝ 999.9',
  },
  {
    id: 'phuquy-ring-9999-05c',
    companyId: 'phuquy',
    group: 'Nhẫn tròn Phú Quý 999.9',
    label: 'Nhẫn tròn Phú Quý 999.9 · 0,5 chỉ',
    shortLabel: 'Nhẫn tròn Phú Quý 0,5 chỉ',
    unitLabel: '0,5 chỉ',
    upstreamCode: null,
    seriesId: 'phuquy',
    weightInLuong: 0.05,
    officialMatch: 'NHẪN TRÒN PHÚ QUÝ 999.9',
  },
  {
    id: 'phuquy-ring-9999-2c',
    companyId: 'phuquy',
    group: 'Nhẫn tròn Phú Quý 999.9',
    label: 'Nhẫn tròn Phú Quý 999.9 · 2 chỉ',
    shortLabel: 'Nhẫn tròn Phú Quý 2 chỉ',
    unitLabel: '2 chỉ',
    upstreamCode: null,
    seriesId: 'phuquy',
    weightInLuong: 0.2,
    officialMatch: 'NHẪN TRÒN PHÚ QUÝ 999.9',
  },
  {
    id: 'phuquy-ring-9999-3c',
    companyId: 'phuquy',
    group: 'Nhẫn tròn Phú Quý 999.9',
    label: 'Nhẫn tròn Phú Quý 999.9 · 3 chỉ',
    shortLabel: 'Nhẫn tròn Phú Quý 3 chỉ',
    unitLabel: '3 chỉ',
    upstreamCode: null,
    seriesId: 'phuquy',
    weightInLuong: 0.3,
    officialMatch: 'NHẪN TRÒN PHÚ QUÝ 999.9',
  },
  {
    id: 'phuquy-ring-9999-5c',
    companyId: 'phuquy',
    group: 'Nhẫn tròn Phú Quý 999.9',
    label: 'Nhẫn tròn Phú Quý 999.9 · 5 chỉ',
    shortLabel: 'Nhẫn tròn Phú Quý 5 chỉ',
    unitLabel: '5 chỉ',
    upstreamCode: null,
    seriesId: 'phuquy',
    weightInLuong: 0.5,
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
    id: 'phuquy-jewelry-999',
    companyId: 'phuquy',
    group: 'Trang sức Phú Quý',
    label: 'Vàng trang sức Phú Quý 999',
    shortLabel: 'Trang sức Phú Quý 999',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'phuquy',
    weightInLuong: 1,
    officialMatch: 'VÀNG TRANG SỨC 999',
  },
  {
    id: 'phuquy-jewelry-99',
    companyId: 'phuquy',
    group: 'Trang sức Phú Quý',
    label: 'Vàng trang sức Phú Quý 99',
    shortLabel: 'Trang sức Phú Quý 99',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'phuquy',
    weightInLuong: 1,
    officialMatch: 'VÀNG TRANG SỨC 99',
  },
  {
    id: 'phuquy-jewelry-98',
    companyId: 'phuquy',
    group: 'Trang sức Phú Quý',
    label: 'Vàng trang sức Phú Quý 98',
    shortLabel: 'Trang sức Phú Quý 98',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'phuquy',
    weightInLuong: 1,
    officialMatch: 'VÀNG TRANG SỨC 98',
  },
  {
    id: 'phuquy-non-sjc-9999',
    companyId: 'phuquy',
    group: 'Vàng phi SJC (chưa có giá bán)',
    label: 'Vàng 999.9 phi SJC · chưa có giá bán',
    shortLabel: 'Vàng 999.9 phi SJC',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'unavailable',
    weightInLuong: 1,
    officialMatch: 'VÀNG 999.9 PHI SJC',
    catalogStatus: 'unavailable',
    unavailableReason:
      'Trang giá Phú Quý hiện chỉ công bố giá mua cho dòng này.',
  },
  {
    id: 'phuquy-non-sjc-999',
    companyId: 'phuquy',
    group: 'Vàng phi SJC (chưa có giá bán)',
    label: 'Vàng 999.0 phi SJC · chưa có giá bán',
    shortLabel: 'Vàng 999.0 phi SJC',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'unavailable',
    weightInLuong: 1,
    officialMatch: 'VÀNG 999.0 PHI SJC',
    catalogStatus: 'unavailable',
    unavailableReason:
      'Trang giá Phú Quý hiện chỉ công bố giá mua cho dòng này.',
  },
  {
    id: 'phuquy-gift-9999-05c',
    companyId: 'phuquy',
    group: 'Thần tài Phú Quý 999.9 (chưa có dòng giá)',
    label: 'Thần tài Phú Quý 999.9 · 0,5 chỉ · chưa có giá',
    shortLabel: 'Thần tài Phú Quý 0,5 chỉ',
    unitLabel: '0,5 chỉ',
    upstreamCode: null,
    seriesId: 'unavailable',
    weightInLuong: 0.05,
    officialMatch: null,
    catalogStatus: 'unavailable',
    unavailableReason:
      'Phú Quý công bố định lượng nhưng chưa có dòng giá hai chiều tương ứng.',
  },
  {
    id: 'phuquy-gift-9999-1c',
    companyId: 'phuquy',
    group: 'Thần tài Phú Quý 999.9 (chưa có dòng giá)',
    label: 'Thần tài Phú Quý 999.9 · 1 chỉ · chưa có giá',
    shortLabel: 'Thần tài Phú Quý 1 chỉ',
    unitLabel: '1 chỉ',
    upstreamCode: null,
    seriesId: 'unavailable',
    weightInLuong: 0.1,
    officialMatch: null,
    catalogStatus: 'unavailable',
    unavailableReason:
      'Phú Quý công bố định lượng nhưng chưa có dòng giá hai chiều tương ứng.',
  },
  {
    id: 'phuquy-gift-9999-1l',
    companyId: 'phuquy',
    group: 'Thần tài Phú Quý 999.9 (chưa có dòng giá)',
    label: 'Thần tài Phú Quý 999.9 · 1 lượng · chưa có giá',
    shortLabel: 'Thần tài Phú Quý 1 lượng',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'unavailable',
    weightInLuong: 1,
    officialMatch: null,
    catalogStatus: 'unavailable',
    unavailableReason:
      'Phú Quý công bố định lượng nhưng chưa có dòng giá hai chiều tương ứng.',
  },
  {
    id: 'vgj-bar-sjc-1l',
    companyId: 'vgj',
    group: 'Vàng miếng SJC tại VietinBank / VGJ',
    label: 'Vàng miếng SJC VGJ · 1 lượng',
    shortLabel: 'Miếng SJC VGJ 1 lượng',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'vgj',
    weightInLuong: 1,
    officialMatch: 'Vàng miếng SJC dạng 1 lượng',
  },
  {
    id: 'vgj-ring-9999-1-2-5c',
    companyId: 'vgj',
    group: 'Vàng nhẫn VGJ 99.99%',
    label: 'Vàng nhẫn VGJ 99.99 · 1 chỉ, 2 chỉ, 5 chỉ',
    shortLabel: 'Nhẫn VGJ 99.99 · 1/2/5 chỉ',
    unitLabel: '1, 2, 5 chỉ',
    upstreamCode: null,
    seriesId: 'vgj',
    weightInLuong: null,
    officialMatch: 'Vàng nhẫn VGJ 99.99 dạng 1 chỉ, 2 chỉ, 5 chỉ',
  },
  {
    id: 'vgj-ring-9999-05c',
    companyId: 'vgj',
    group: 'Vàng nhẫn VGJ 99.99%',
    label: 'Vàng nhẫn VGJ 99.99 · 0,5 chỉ',
    shortLabel: 'Nhẫn VGJ 99.99 · 0,5 chỉ',
    unitLabel: '0,5 chỉ',
    upstreamCode: null,
    seriesId: 'vgj',
    weightInLuong: 0.05,
    officialMatch: 'Vàng nhẫn VGJ 99.99 dạng 0.5 chỉ',
  },
  {
    id: 'vgj-ring-sjc-1-2-5c',
    companyId: 'vgj',
    group: 'Vàng nhẫn SJC tại VietinBank / VGJ',
    label: 'Vàng nhẫn SJC 99.99 · 1 chỉ, 2 chỉ, 5 chỉ',
    shortLabel: 'Nhẫn SJC VGJ · 1/2/5 chỉ',
    unitLabel: '1, 2, 5 chỉ',
    upstreamCode: null,
    seriesId: 'vgj',
    weightInLuong: null,
    officialMatch: 'Vàng nhẫn SJC 99.99 loại 1 chỉ, 2 chỉ, 5 chỉ',
  },
  {
    id: 'vgj-ring-sjc-05-03c',
    companyId: 'vgj',
    group: 'Vàng nhẫn SJC tại VietinBank / VGJ',
    label: 'Vàng nhẫn SJC 99.99 · 0,5 chỉ, 0,3 chỉ',
    shortLabel: 'Nhẫn SJC VGJ · 0,5/0,3 chỉ',
    unitLabel: '0,5; 0,3 chỉ',
    upstreamCode: null,
    seriesId: 'vgj',
    weightInLuong: null,
    officialMatch: 'Vàng nhẫn SJC 99.99 loại 0.5 chỉ, 0.3 chỉ',
  },
  {
    id: 'vgj-jewelry-9999',
    companyId: 'vgj',
    group: 'Nữ trang VGJ / SJC 99.99%',
    label: 'Nữ trang VGJ 99.99%',
    shortLabel: 'Nữ trang VGJ 99.99%',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'vgj',
    weightInLuong: 1,
    officialMatch: 'Nữ trang VGJ 99.99%',
  },
  {
    id: 'vgj-jewelry-sjc-9999',
    companyId: 'vgj',
    group: 'Nữ trang VGJ / SJC 99.99%',
    label: 'Nữ trang SJC 99.99% tại VGJ',
    shortLabel: 'Nữ trang SJC VGJ 99.99%',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'vgj',
    weightInLuong: 1,
    officialMatch: 'Nữ trang SJC 99.99%',
  },
  {
    id: 'vgj-jewelry-other-9999',
    companyId: 'vgj',
    group: 'Nữ trang thương hiệu khác (chưa có giá)',
    label: 'Nữ trang thương hiệu khác 99.99% · chưa có giá',
    shortLabel: 'Nữ trang khác VGJ 99.99%',
    unitLabel: '1 lượng',
    upstreamCode: null,
    seriesId: 'unavailable',
    weightInLuong: 1,
    officialMatch: 'Nữ trang thương hiệu khác, hàm lượng 99.99%',
    catalogStatus: 'unavailable',
    unavailableReason:
      'Trang giá VGJ hiện công bố dòng này nhưng chưa có giá mua và bán.',
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
  pnj: PNJ_PRODUCTS,
  doji: AGGREGATED_PRODUCTS.filter((product) => product.companyId === 'doji'),
  baotin: AGGREGATED_PRODUCTS.filter(
    (product) => product.companyId === 'baotin',
  ),
  btmc: OFFICIAL_MARKET_PRODUCTS.filter(
    (product) => product.companyId === 'btmc',
  ).sort((left, right) => {
    if (left.id === 'btmc-ring') return -1;
    if (right.id === 'btmc-ring') return 1;
    return 0;
  }),
  btmh: OFFICIAL_MARKET_PRODUCTS.filter(
    (product) => product.companyId === 'btmh',
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
  vgj: OFFICIAL_MARKET_PRODUCTS.filter(
    (product) => product.companyId === 'vgj',
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

export function isMarketCompanyId(
  value: string | null | undefined,
): value is MarketCompanyId {
  return MARKET_COMPANIES.some((company) => company.id === value);
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

/** Return every catalog row for the brand that has a verified quote contract. */
export function getSelectableMarketProducts(
  companyId: string | null | undefined,
) {
  return getMarketProducts(companyId).filter(isMarketProductSelectable);
}

/** Keep manual-entry-only brands usable while preferring a verified row. */
export function getDefaultMarketProduct(companyId: string | null | undefined) {
  const products = getMarketProducts(companyId);
  return products.find(isMarketProductSelectable) ?? products[0];
}

export function isMarketProductId(
  companyId: string | null | undefined,
  productId: string | null | undefined,
): productId is string {
  return getMarketProducts(companyId).some(
    (product) => product.id === productId,
  );
}

export function isSelectableMarketProductId(
  companyId: string | null | undefined,
  productId: string | null | undefined,
) {
  return (
    isMarketProductId(companyId, productId) &&
    getSelectableMarketProducts(companyId).some(
      (product) => product.id === productId,
    )
  );
}

export function getMarketProductCompany(productId: string | null | undefined) {
  return MARKET_COMPANIES.find((company) =>
    PRODUCTS_BY_COMPANY[company.id].some((product) => product.id === productId),
  );
}

export function isMarketProductSelectable(product: MarketProduct) {
  return !(
    'catalogStatus' in product && product.catalogStatus === 'unavailable'
  );
}

/** One shared product category for selectors, comparison, and AI filtering. */
export function getMarketProductCategory(
  product: MarketProduct,
): MarketProductCategory {
  if ('category' in product && product.category) return product.category;
  if ('seriesId' in product && product.seriesId === 'bar') return 'bar';
  if ('seriesId' in product && product.seriesId === 'ring') return 'ring';
  const label = `${product.group} ${product.label} ${product.id}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (
    /sjc theo khu vuc|sjc (?:ho chi minh|hanoi|da nang|mien tay|tay nguyen|dong nam bo)/.test(
      label,
    )
  )
    return 'bar';
  if (/mieng.*nhan|nhan.*mieng/.test(label)) return 'other';
  if (/nguyen lieu|raw material/.test(label)) return 'raw-material';
  if (/dong vang|coin/.test(label)) return 'coin';
  if (/gift|qua tang|qua mung/.test(label)) return 'gift';
  if (/tich luy|accumulation|kim gia bao|tieu kim cat/.test(label))
    return 'investment-gold';
  if (/nhan|ring/.test(label)) return 'ring';
  if (/mieng|bar/.test(label)) return 'bar';
  if (/nu trang|trang suc|jewell?ry/.test(label)) return 'jewelry';
  return 'other';
}

export function getMarketHistoryCapability(
  companyId: string | null | undefined,
  productId: string | null | undefined,
): MarketHistoryCapability {
  const company = getMarketCompany(companyId);
  const product = getMarketProduct(company.id, productId);
  if (company.id === 'pnj') return 'annual';
  if (company.id === 'sjc' && product.id === 'bar-1l') return 'annual';
  if (company.id === 'btmh') return 'annual';
  if (company.maxHistoryDays >= 30) return 'rolling-30';
  if (company.maxHistoryDays >= 7) return 'rolling-7';
  return 'snapshot';
}
