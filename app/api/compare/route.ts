import {
  dedupeComparisonCatalogProducts,
  getComparisonCatalogProduct,
  getComparisonSet,
  presentComparisonCatalogProduct,
  presentComparisonSet,
  resolveComparisonSetId,
  selectComparisonProducts,
  type ComparisonCatalogProduct,
} from '@/lib/comparison-catalog';
import { localeFromValue } from '@/lib/i18n';
import { presentMarketCatalogText } from '@/lib/market-sources';
import { withMarketFetch } from '@/lib/server/market-fetch';
import { getMarketData } from '@/lib/server/sjc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type CompareDirection = 'buy' | 'sell';

type CompareRow = {
  id: string;
  companyId: ComparisonCatalogProduct['companyId'];
  productId: string;
  brandId: string;
  company: string;
  product: string;
  productGroup: string;
  category: ComparisonCatalogProduct['category'];
  purity: number | null;
  karat: number | null;
  unit: ComparisonCatalogProduct['unit'];
  unitLabel: string;
  weightInLuong: number | null;
  region: string | null;
  sourceIdentity: string;
  sourceIdentityLabel: string;
  comparableGroup: string;
  eligibility: ComparisonCatalogProduct['eligibility'];
  eligibilityReason: string | null;
  eligibleForRanking: boolean;
  rank: number | null;
  latest: {
    date: string;
    buy: number;
    sell: number;
    spread: number;
  } | null;
  timestampKind?: 'source' | 'retrieval-or-date';
  mode: 'live' | 'delayed' | 'fallback' | 'unavailable';
  availability: 'available' | 'unavailable';
  unavailableReason: string | null;
  observedAt: string;
  source: { provider: string; url: string | null; official: boolean };
};

function isCompareDirection(value: string | null): value is CompareDirection {
  return value === 'buy' || value === 'sell';
}

function rowPriority(row: CompareRow) {
  return [
    Number(Boolean(row.latest)),
    Number(row.availability === 'available'),
    Number(row.source.official),
    Number(row.mode === 'live'),
    Number(row.mode === 'delayed'),
  ];
}

function compareRows(left: CompareRow, right: CompareRow) {
  const leftPriority = rowPriority(left);
  const rightPriority = rowPriority(right);
  for (let index = 0; index < leftPriority.length; index++) {
    if (leftPriority[index] !== rightPriority[index])
      return rightPriority[index] - leftPriority[index];
  }
  return left.id.localeCompare(right.id);
}

function dedupeRows(rows: readonly CompareRow[]): CompareRow[] {
  const groups = new Map<string, CompareRow[]>();
  for (const row of rows) {
    const key = `${row.sourceIdentity}:${row.comparableGroup}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => [...group].sort(compareRows)[0]);
}

function applyRanking(
  rows: readonly CompareRow[],
  set: ReturnType<typeof getComparisonSet>,
  direction: CompareDirection,
) {
  const metric = direction === 'buy' ? 'sell' : 'buy';
  const eligible = rows
    .filter(
      (row) =>
        set.rankingEnabled &&
        row.eligibility === 'eligible' &&
        row.availability === 'available' &&
        row.latest !== null &&
        row.mode !== 'fallback' &&
        row.comparableGroup === set.comparableGroup,
    )
    .sort((left, right) => {
      const leftValue = left.latest?.[metric] ?? Number.POSITIVE_INFINITY;
      const rightValue = right.latest?.[metric] ?? Number.POSITIVE_INFINITY;
      return direction === 'buy'
        ? leftValue - rightValue
        : rightValue - leftValue;
    });
  const ranks = new Map(eligible.map((row, index) => [row.id, index + 1]));

  const ranked = rows.map((row) => ({
    ...row,
    eligibleForRanking: ranks.has(row.id),
    rank: ranks.get(row.id) ?? null,
  }));
  if (!set.rankingEnabled) return ranked;
  return [...ranked].sort((left, right) => {
    if (left.rank !== null && right.rank !== null)
      return left.rank - right.rank;
    if (left.rank !== null) return -1;
    if (right.rank !== null) return 1;
    return 0;
  });
}

function catalogRow(
  product: ComparisonCatalogProduct,
  observedAt = new Date().toISOString(),
): CompareRow {
  const source = {
    provider: product.sourceIdentityLabel,
    url: product.sourceUrl,
    official: product.sourceKind === 'official',
  };
  return {
    id: product.id,
    companyId: product.companyId,
    productId: product.productId,
    brandId: product.brandId,
    company: product.brandName,
    product: product.label,
    productGroup: product.productGroup,
    category: product.category,
    purity: product.purity,
    karat: product.karat,
    unit: product.unit,
    unitLabel: product.unitLabel,
    weightInLuong: product.weightInLuong,
    region: product.region,
    sourceIdentity: product.sourceIdentity,
    sourceIdentityLabel: product.sourceIdentityLabel,
    comparableGroup: product.comparableGroup,
    eligibility: product.eligibility,
    eligibilityReason: product.eligibilityReason,
    eligibleForRanking: false,
    rank: null,
    latest: null,
    mode: 'unavailable',
    availability: 'unavailable',
    unavailableReason:
      product.eligibilityReason ?? 'Nguồn chưa trả dữ liệu hai chiều.',
    observedAt,
    source,
  };
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const locale = localeFromValue(searchParams.get('locale'));
  const set = getComparisonSet(searchParams.get('set'));
  const requestedDirection = searchParams.get('direction');
  const direction = isCompareDirection(requestedDirection)
    ? requestedDirection
    : 'buy';
  const requestedProducts = searchParams.get('products');
  const requestedTokens = requestedProducts
    ? requestedProducts
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const requestedCatalogProducts = requestedTokens
    .map((item) => getComparisonCatalogProduct(set, item))
    .filter((product): product is ComparisonCatalogProduct => Boolean(product));

  if (
    requestedProducts &&
    (new Set(requestedCatalogProducts.map((product) => product.id)).size !==
      new Set(requestedTokens).size ||
      new Set(requestedCatalogProducts.map((product) => product.id)).size >
        set.maxProducts)
  ) {
    return Response.json(
      {
        error:
          locale === 'en'
            ? `Select up to ${set.maxProducts} valid products in this comparison.`
            : `Chỉ được chọn tối đa ${set.maxProducts} sản phẩm hợp lệ trong bộ so sánh.`,
      },
      { status: 400, headers: { 'X-Content-Type-Options': 'nosniff' } },
    );
  }

  const selected = requestedProducts
    ? selectComparisonProducts(set, requestedProducts)
    : set.products;

  if (requestedProducts && selected.length === 0) {
    return Response.json(
      {
        error:
          locale === 'en'
            ? 'No valid products are available in this comparison.'
            : 'Không có sản phẩm hợp lệ trong bộ so sánh.',
      },
      { status: 400, headers: { 'X-Content-Type-Options': 'nosniff' } },
    );
  }

  const products = dedupeComparisonCatalogProducts(selected);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  const results = await withMarketFetch(signal, 7, () =>
    Promise.all(
      products.map(async (product) => {
        const row = catalogRow(product);
        if (product.eligibility !== 'eligible') return row;
        try {
          const market = await getMarketData(product.companyId, product.productId, { view: 'quote' });
          return {
            ...row,
            latest: market.latest,
            mode: market.mode,
            availability: market.availability,
            unavailableReason: market.unavailableReason,
            observedAt: market.observedAt,
            timestampKind: market.timestampKind,
            source: market.source,
          } satisfies CompareRow;
        } catch (error) {
          return {
            ...row,
            unavailableReason:
              error instanceof Error ? error.message : 'Nguồn không phản hồi.',
          } satisfies CompareRow;
        }
      }),
    ),
  );
  const rows = applyRanking(dedupeRows(results), set, direction);
  const metric = direction === 'buy' ? 'sell' : 'buy';
  const displayedSet = presentComparisonSet(set, locale);
  const displayedProducts = products.map((product) =>
    presentComparisonCatalogProduct(product, locale),
  );
  const displayedProductById = new Map(
    displayedProducts.map((product) => [product.id, product]),
  );
  const displayedRows = rows.map((row) => {
    const product = displayedProductById.get(row.id);
    if (!product) return row;
    return {
      ...row,
      company: product.brandName,
      product: product.label,
      productGroup: product.productGroup,
      unitLabel: product.unitLabel,
      regionId: row.region,
      region: product.region,
      sourceIdentityLabel: product.sourceIdentityLabel,
      eligibilityReason: product.eligibilityReason,
      unavailableReason: row.unavailableReason
        ? presentMarketCatalogText(row.unavailableReason, locale)
        : null,
    };
  });

  return Response.json(
    {
      set: resolveComparisonSetId(searchParams.get('set')),
      label: displayedSet.label,
      description: displayedSet.description,
      mode: set.mode,
      comparisonMode: set.mode,
      ranking: {
        enabled: set.rankingEnabled,
        direction,
        metric,
        label:
          locale === 'en'
            ? set.mode === 'same-group'
              ? direction === 'buy'
                ? 'Rank by lowest dealer sell price'
                : 'Rank by highest dealer buy price'
              : 'Side-by-side comparison; groups are not ranked together'
            : set.mode === 'same-group'
              ? direction === 'buy'
                ? 'Xếp giá bán ra thấp nhất'
                : 'Xếp giá mua vào cao nhất'
              : 'Đối chiếu giữa các nhóm, không xếp hạng chung',
        eligibleCount: displayedRows.filter((row) => row.eligibleForRanking).length,
      },
      maxProducts: set.maxProducts,
      products: displayedProducts,
      unit: locale === 'en' ? 'VND million / lượng' : 'triệu đồng / lượng',
      rows: displayedRows,
      generatedAt: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control':
          'public, max-age=60, s-maxage=240, stale-while-revalidate=60',
        'Vercel-CDN-Cache-Control': 's-maxage=240, stale-while-revalidate=60',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
