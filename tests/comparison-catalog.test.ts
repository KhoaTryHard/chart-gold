import { describe, expect, it } from 'vitest';

import {
  COMPARISON_SETS,
  dedupeComparisonCatalogProducts,
  getComparisonCatalogProduct,
  getComparisonSet,
  presentComparisonCatalogProduct,
  presentComparisonSet,
  resolveComparisonSetId,
  selectComparisonProducts,
} from '@/lib/comparison-catalog';

describe('comparison catalog', () => {
  it('keeps the two legacy sets and exposes the cross-group set', () => {
    expect(Object.keys(COMPARISON_SETS)).toEqual([
      'sjc-bar',
      'ring-9999',
      'ring-9999-vs-sjc',
    ]);
    expect(getComparisonSet('ring-9999-vs-sjc').mode).toBe('cross-group');
    expect(getComparisonSet('ring-9999').rankingEnabled).toBe(true);
    expect(
      getComparisonSet('sjc-bar').products.some(
        (product) =>
          product.companyId === 'btmh' &&
          product.productId === 'btmh-sjc9999' &&
          product.sourceKind === 'official',
      ),
    ).toBe(true);
    expect(resolveComparisonSetId('ring-9999-vs-sjc-bar')).toBe(
      'ring-9999-vs-sjc',
    );
    expect(resolveComparisonSetId('old-or-unknown-set')).toBe('sjc-bar');
  });

  it('keeps product identity metadata without embedding a quote', () => {
    const product = getComparisonCatalogProduct(
      getComparisonSet('ring-9999'),
      'pnj:pnj-ring-9999',
    );
    expect(product).toMatchObject({
      id: 'pnj:pnj-ring-9999',
      companyId: 'pnj',
      productId: 'pnj-ring-9999',
      category: 'ring',
      comparableGroup: 'plain-ring-9999',
      purity: 999.9,
      unit: 'luong',
      eligibility: 'eligible',
      sourceIdentity: 'pnj',
    });
    expect(product).not.toHaveProperty('latest');
  });

  it('presents comparison catalog labels in English while keeping stable IDs', () => {
    const set = getComparisonSet('sjc-bar');
    const product = set.products.find((item) => item.productId === 'bar-1l');
    expect(product).toBeDefined();
    const displayedProduct = presentComparisonCatalogProduct(product!, 'en');
    const displayedSet = presentComparisonSet(set, 'en');

    expect(displayedSet.label).toBe('SJC gold bars');
    expect(displayedProduct).toMatchObject({
      id: 'sjc:bar-1l',
      companyId: 'sjc',
      productId: 'bar-1l',
      label: 'Gold bar SJC 1 lượng',
      productGroup: 'Gold bar SJC',
    });
    expect(set.label).toBe('Vàng miếng SJC');
    expect(product?.label).toBe('Vàng miếng SJC 1 lượng');
  });

  it('deduplicates Bảo Tín and BTMC by canonical source identity', () => {
    const products = getComparisonSet('sjc-bar').products;
    const deduped = dedupeComparisonCatalogProducts(products);
    expect(products.some((product) => product.companyId === 'baotin')).toBe(
      true,
    );
    expect(
      deduped.filter((product) => product.sourceIdentity === 'btmc'),
    ).toHaveLength(1);
    expect(deduped.find((product) => product.sourceIdentity === 'btmc')?.companyId).toBe(
      'btmc',
    );
  });

  it('resolves share-link product selections and caps them at three', () => {
    const set = getComparisonSet('ring-9999');
    const selected = selectComparisonProducts(
      set,
      'sjc:ring-1c,pnj:pnj-ring-9999,btmc:btmc-ring,baotin:baotin-9999',
    );
    expect(selected).toHaveLength(3);
    expect(selected.map((product) => product.id)).toEqual([
      'sjc:ring-1c',
      'pnj:pnj-ring-9999',
      'btmc:btmc-ring',
    ]);
  });
});
