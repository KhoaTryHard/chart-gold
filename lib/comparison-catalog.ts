import {
  getMarketCompany,
  getMarketProduct,
  isMarketProductSelectable,
  isMarketCompanyId,
  presentMarketCatalogText,
  presentMarketCompany,
  presentMarketProduct,
  type MarketCompanyId,
  type MarketProduct,
} from '@/lib/market-sources';
import type { Locale } from '@/lib/i18n';

/**
 * The comparison catalog describes what can be compared. It deliberately
 * contains product identity and presentation metadata only; quotes always
 * come from getMarketData at request time.
 */
export type ComparisonProductCategory =
  | 'bar'
  | 'ring'
  | 'gift'
  | 'jewelry'
  | 'coin'
  | 'raw-material'
  | 'other';

export type ComparisonUnit = 'luong' | 'chi' | 'phan' | 'gram';

export type ComparisonEligibility = 'eligible' | 'unavailable';

export type ComparisonSetMode = 'same-group' | 'cross-group';

export type ComparisonCatalogProduct = {
  /** Stable catalog identity; safe to use in shareable URLs. */
  id: string;
  companyId: MarketCompanyId;
  productId: MarketProduct['id'];
  brandId: string;
  brandName: string;
  label: string;
  shortLabel: string;
  productGroup: string;
  category: ComparisonProductCategory;
  /** Purity in parts per thousand, when the source label publishes it. */
  purity: number | null;
  /** Karat value, when the source label publishes it. */
  karat: number | null;
  unit: ComparisonUnit;
  unitLabel: string;
  weightInLuong: number | null;
  region: string | null;
  /** Canonical source/company identity used for duplicate detection. */
  sourceIdentity: string;
  sourceIdentityLabel: string;
  sourceUrl: string | null;
  sourceKind: 'official' | 'aggregated' | 'unavailable';
  /** Products in the same group may be ranked against one another. */
  comparableGroup: string;
  eligibility: ComparisonEligibility;
  eligibilityReason: string | null;
  /** Same source identity and semantic group must not count twice. */
  dedupeKey: string;
};

export type ComparisonSetId =
  | 'sjc-bar'
  | 'ring-9999'
  | 'ring-9999-vs-sjc';

export type ComparisonSet = {
  id: ComparisonSetId;
  label: string;
  description: string;
  mode: ComparisonSetMode;
  rankingEnabled: boolean;
  /** The group used for same-group ranking. Null for cross-group sets. */
  comparableGroup: string | null;
  products: readonly ComparisonCatalogProduct[];
  maxProducts: 3;
};

type CatalogDefinition = {
  companyId: MarketCompanyId;
  productId: string;
  category: ComparisonProductCategory;
  comparableGroup: string;
  purity?: number | null;
  karat?: number | null;
  region?: string | null;
  sourceIdentity?: string;
};

const SOURCE_IDENTITY_ALIASES: Partial<Record<MarketCompanyId, string>> = {
  // Vang.Today's "Bảo Tín" alias identifies BTMC. Keep it separate from BTMH.
  baotin: 'btmc',
};

const COMPARABLE_GROUPS = {
  sjcBar: 'gold-bar-sjc',
  ring9999: 'plain-ring-9999',
} as const;

function unitFromLabel(unitLabel: string): ComparisonUnit {
  const normalized = unitLabel.toLocaleLowerCase('vi-VN');
  if (normalized.includes('lượng')) return 'luong';
  if (normalized.includes('chỉ')) return 'chi';
  if (normalized.includes('phân')) return 'phan';
  return 'gram';
}

function sourceKind(companyId: MarketCompanyId) {
  const adapter = getMarketCompany(companyId).adapter;
  if (adapter === 'unavailable') return 'unavailable' as const;
  if (adapter.endsWith('official')) return 'official' as const;
  return 'aggregated' as const;
}

function sourceIdentity(companyId: MarketCompanyId, explicit?: string) {
  return explicit ?? SOURCE_IDENTITY_ALIASES[companyId] ?? companyId;
}

function sourceIdentityLabel(identity: string) {
  if (identity === 'btmc') return 'Bảo Tín / BTMC';
  return getMarketCompany(identity).shortName;
}

function toCatalogProduct(definition: CatalogDefinition): ComparisonCatalogProduct {
  const product = getMarketProduct(definition.companyId, definition.productId);
  const company = getMarketCompany(definition.companyId);
  const identity = sourceIdentity(definition.companyId, definition.sourceIdentity);
  const eligible = isMarketProductSelectable(product);
  const eligibilityReason =
    !eligible && 'unavailableReason' in product
      ? (product.unavailableReason ?? 'Sản phẩm chưa có dữ liệu hai chiều.')
      : null;

  return {
    id: `${definition.companyId}:${product.id}`,
    companyId: definition.companyId,
    productId: product.id,
    brandId: identity,
    brandName: company.name,
    label: product.label,
    shortLabel: product.shortLabel,
    productGroup: product.group,
    category: definition.category,
    purity: definition.purity ?? null,
    karat: definition.karat ?? null,
    unit: unitFromLabel(product.unitLabel),
    unitLabel: product.unitLabel,
    weightInLuong: product.weightInLuong,
    region: definition.region ?? null,
    sourceIdentity: identity,
    sourceIdentityLabel: sourceIdentityLabel(identity),
    sourceUrl: company.sourceUrl,
    sourceKind: sourceKind(definition.companyId),
    comparableGroup: definition.comparableGroup,
    eligibility: eligible ? 'eligible' : 'unavailable',
    eligibilityReason,
    dedupeKey: `${identity}:${definition.comparableGroup}`,
  };
}

const SJC_BAR_DEFINITIONS: readonly CatalogDefinition[] = [
  {
    companyId: 'sjc',
    productId: 'bar-1l',
    category: 'bar',
    comparableGroup: COMPARABLE_GROUPS.sjcBar,
  },
  {
    companyId: 'pnj',
    productId: 'pnj-sjc-hcm',
    category: 'bar',
    comparableGroup: COMPARABLE_GROUPS.sjcBar,
    region: 'TPHCM',
  },
  {
    companyId: 'btmc',
    productId: 'btmc-sjc',
    category: 'bar',
    comparableGroup: COMPARABLE_GROUPS.sjcBar,
  },
  {
    companyId: 'btmh',
    productId: 'btmh-sjc9999',
    category: 'bar',
    comparableGroup: COMPARABLE_GROUPS.sjcBar,
  },
  {
    companyId: 'phuquy',
    productId: 'phuquy-bar',
    category: 'bar',
    comparableGroup: COMPARABLE_GROUPS.sjcBar,
  },
  {
    companyId: 'baotin',
    productId: 'baotin-sjc',
    category: 'bar',
    comparableGroup: COMPARABLE_GROUPS.sjcBar,
  },
  {
    companyId: 'vngold',
    productId: 'vngold-sjc',
    category: 'bar',
    comparableGroup: COMPARABLE_GROUPS.sjcBar,
  },
  {
    companyId: 'viettin',
    productId: 'viettin-sjc',
    category: 'bar',
    comparableGroup: COMPARABLE_GROUPS.sjcBar,
  },
];

const RING_9999_DEFINITIONS: readonly CatalogDefinition[] = [
  {
    companyId: 'sjc',
    productId: 'ring-1c',
    category: 'ring',
    comparableGroup: COMPARABLE_GROUPS.ring9999,
    purity: 999.9,
  },
  {
    companyId: 'pnj',
    productId: 'pnj-ring-9999',
    category: 'ring',
    comparableGroup: COMPARABLE_GROUPS.ring9999,
    purity: 999.9,
  },
  {
    companyId: 'btmc',
    productId: 'btmc-ring',
    category: 'ring',
    comparableGroup: COMPARABLE_GROUPS.ring9999,
    purity: 999.9,
  },
  {
    companyId: 'phuquy',
    productId: 'phuquy-ring-9999',
    category: 'ring',
    comparableGroup: COMPARABLE_GROUPS.ring9999,
    purity: 999.9,
    region: null,
  },
  {
    companyId: 'baotin',
    productId: 'baotin-9999',
    category: 'ring',
    comparableGroup: COMPARABLE_GROUPS.ring9999,
    purity: 999.9,
  },
];

function buildProducts(definitions: readonly CatalogDefinition[]) {
  return definitions.map(toCatalogProduct);
}

const SJC_BAR_PRODUCTS = buildProducts(SJC_BAR_DEFINITIONS);
const RING_9999_PRODUCTS = buildProducts(RING_9999_DEFINITIONS);

export const COMPARISON_SETS: Readonly<Record<ComparisonSetId, ComparisonSet>> = {
  'sjc-bar': {
    id: 'sjc-bar',
    label: 'Vàng miếng SJC',
    description:
      'So sánh giá vàng miếng SJC tương đương giữa các nguồn đang có báo giá.',
    mode: 'same-group',
    rankingEnabled: true,
    comparableGroup: COMPARABLE_GROUPS.sjcBar,
    products: SJC_BAR_PRODUCTS,
    maxProducts: 3,
  },
  'ring-9999': {
    id: 'ring-9999',
    label: 'Vàng nhẫn 9999',
    description:
      'So sánh giá nhẫn trơn 9999 giữa các nguồn đang có báo giá.',
    mode: 'same-group',
    rankingEnabled: true,
    comparableGroup: COMPARABLE_GROUPS.ring9999,
    products: RING_9999_PRODUCTS,
    maxProducts: 3,
  },
  'ring-9999-vs-sjc': {
    id: 'ring-9999-vs-sjc',
    label: 'Nhẫn 9999 và vàng miếng SJC',
    description:
      'Đối chiếu nhẫn trơn 9999 với vàng miếng SJC; các nhóm được trình bày cạnh nhau và không xếp hạng như một sản phẩm đồng nhất.',
    mode: 'cross-group',
    rankingEnabled: false,
    comparableGroup: null,
    products: [...RING_9999_PRODUCTS, ...SJC_BAR_PRODUCTS],
    maxProducts: 3,
  },
};

/** Backward-compatible aliases accepted in query strings and old links. */
export function resolveComparisonSetId(value: string | null | undefined): ComparisonSetId {
  if (value === 'ring-9999-vs-sjc' || value === 'ring-9999-vs-sjc-bar')
    return 'ring-9999-vs-sjc';
  if (value === 'ring-9999') return 'ring-9999';
  return 'sjc-bar';
}

export function getComparisonSet(
  value: string | null | undefined,
): ComparisonSet {
  return COMPARISON_SETS[resolveComparisonSetId(value)];
}

export function getComparisonCatalogProduct(
  set: ComparisonSet,
  value: string,
): ComparisonCatalogProduct | undefined {
  return set.products.find(
    (product) =>
      product.id === value ||
      product.productId === value ||
      `${product.companyId}:${product.productId}` === value,
  );
}

/**
 * Resolve an optional product selection while keeping it inside the set. A
 * share link may use either `company:product` or the stable catalog `id`.
 */
export function selectComparisonProducts(
  set: ComparisonSet,
  value: string | null | undefined,
): readonly ComparisonCatalogProduct[] {
  if (!value) return set.products;
  const selected = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => getComparisonCatalogProduct(set, item))
    .filter((product): product is ComparisonCatalogProduct => Boolean(product));
  const unique = new Map(selected.map((product) => [product.id, product]));
  return [...unique.values()].slice(0, set.maxProducts);
}

/**
 * Pick one row when an aggregator and an official row represent the same
 * source identity. The official, available row wins; otherwise preserve the
 * available fallback row. This function works on catalog metadata only and
 * is intentionally exported for the API and unit tests.
 */
export function dedupeComparisonCatalogProducts(
  products: readonly ComparisonCatalogProduct[],
): readonly ComparisonCatalogProduct[] {
  const groups = new Map<string, ComparisonCatalogProduct[]>();
  for (const product of products) {
    const group = groups.get(product.dedupeKey) ?? [];
    group.push(product);
    groups.set(product.dedupeKey, group);
  }
  return [...groups.values()].map((group) =>
    [...group].sort((left, right) => {
      const availability =
        Number(right.eligibility === 'eligible') -
        Number(left.eligibility === 'eligible');
      if (availability) return availability;
      const source =
        Number(right.sourceKind === 'official') -
        Number(left.sourceKind === 'official');
      return source || left.id.localeCompare(right.id);
    })[0],
  );
}

export function getComparisonCatalogProducts(value: string | null | undefined) {
  return getComparisonSet(value).products;
}

/** Returns presentation-only English labels while retaining catalog IDs. */
export function presentComparisonCatalogProduct(
  product: ComparisonCatalogProduct,
  locale: Locale,
): ComparisonCatalogProduct {
  if (locale === 'vi') return product;
  const marketCompany = getMarketCompany(product.companyId);
  const marketProduct = getMarketProduct(product.companyId, product.productId);
  const companyPresentation = presentMarketCompany(marketCompany, locale);
  const productPresentation = presentMarketProduct(marketProduct, locale);
  const identityCompany = isMarketCompanyId(product.sourceIdentity)
    ? presentMarketCompany(getMarketCompany(product.sourceIdentity), locale)
    : null;

  return {
    ...product,
    brandName: companyPresentation.name,
    label: productPresentation.label,
    shortLabel: productPresentation.shortLabel,
    productGroup: productPresentation.group,
    unitLabel: productPresentation.unitLabel,
    region: product.region
      ? presentMarketCatalogText(product.region, locale)
      : null,
    sourceIdentityLabel:
      product.sourceIdentity === 'btmc'
        ? 'Bảo Tín / BTMC'
        : identityCompany?.shortName ?? product.sourceIdentityLabel,
    eligibilityReason: product.eligibilityReason
      ? presentMarketCatalogText(product.eligibilityReason, locale)
      : null,
  };
}

/** Returns localized set and product labels without modifying COMPARISON_SETS. */
export function presentComparisonSet(
  set: ComparisonSet,
  locale: Locale,
): ComparisonSet {
  if (locale === 'vi') return set;
  const englishCopy: Record<ComparisonSetId, { label: string; description: string }> = {
    'sjc-bar': {
      label: 'SJC gold bars',
      description:
        'Compare like-for-like SJC gold bar prices across sources with available quotes.',
    },
    'ring-9999': {
      label: '9999 plain gold rings',
      description:
        'Compare 9999 plain gold ring prices across sources with available quotes.',
    },
    'ring-9999-vs-sjc': {
      label: '9999 rings and SJC gold bars',
      description:
        'Compare 9999 plain gold rings with SJC gold bars side by side. These different product groups are not ranked as if they were interchangeable.',
    },
  };
  return {
    ...set,
    ...englishCopy[set.id],
    products: set.products.map((product) =>
      presentComparisonCatalogProduct(product, locale),
    ),
  };
}
