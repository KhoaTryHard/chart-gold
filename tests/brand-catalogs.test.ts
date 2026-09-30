import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error server-only is a Next.js virtual module, not a test dependency.
vi.mock('server-only', () => ({}), { virtual: true });

import {
  getDefaultMarketProduct,
  getMarketProductCategory,
  getMarketProduct,
  getMarketProducts,
  getSelectableMarketProducts,
  isMarketProductSelectable,
} from '@/lib/market-sources';
import {
  parsePnjCurrentQuote,
  parsePnjHistoryPoint,
  type PnjProduct,
} from '@/lib/server/pnj';
import { parseVgjQuoteFromHtml, type VgjProduct } from '@/lib/server/vgj';
import {
  parseBtmhHistoryPoints,
  parseBtmhQuote,
  parseBtmhTimestamp,
  parseBtmhUnitWeight,
  splitBtmhHistoryWindows,
  type BtmhProduct,
} from '@/lib/server/btmh';

describe('brand-specific product catalogs', () => {
  it('keeps PNJ product categories tied to its official product labels', () => {
    const products = getMarketProducts('pnj');
    expect(products.some((product) => product.id === 'pnj-ring-9999')).toBe(
      true,
    );
    expect(products.some((product) => product.id === 'pnj-gold-750')).toBe(
      true,
    );
    expect(products.some((product) => product.id === 'pnj-sjc-hanoi')).toBe(
      true,
    );
  });

  it('parses official PNJ current and historical rows by location and label', () => {
    const product = getMarketProduct('pnj', 'pnj-ring-9999') as PnjProduct;
    const current = parsePnjCurrentQuote(
      {
        locations: [
          {
            name: 'Giá vàng nữ trang',
            gold_type: [
              {
                name: 'Nhẫn Trơn PNJ 999.9',
                gia_mua: '145.100',
                gia_ban: '148.500',
                updated_at: '04/09/2026 13:09:06',
              },
            ],
          },
        ],
      },
      product,
    );
    expect(current).toMatchObject({ buy: 145.1, sell: 148.5 });

    const point = parsePnjHistoryPoint(
      {
        locations: [
          {
            name: 'Giá vàng nữ trang',
            gold_type: [
              {
                name: 'Nhẫn Trơn PNJ 999.9',
                data: [
                  {
                    gia_mua: '144.000',
                    gia_ban: '147.300',
                    updated_at: '03/09/2026 08:41:36',
                  },
                  {
                    gia_mua: '145.000',
                    gia_ban: '148.300',
                    updated_at: '03/09/2026 15:28:35',
                  },
                ],
              },
            ],
          },
        ],
      },
      product,
      '2026-09-03',
    );
    expect(point).toMatchObject({ date: '2026-09-03', buy: 145, sell: 148.3 });
  });

  it('does not relabel a historical PNJ quote from another calendar day', () => {
    const product = getMarketProduct('pnj', 'pnj-ring-9999') as PnjProduct;
    expect(
      parsePnjHistoryPoint(
        {
          locations: [
            {
              name: 'Giá vàng nữ trang',
              gold_type: [
                {
                  name: 'Nhẫn Trơn PNJ 999.9',
                  data: [
                    {
                      gia_mua: '145.000',
                      gia_ban: '148.300',
                      updated_at: '02/09/2026 15:28:35',
                    },
                  ],
                },
              ],
            },
          ],
        },
        product,
        '2026-09-03',
      ),
    ).toBeNull();
  });

  it('keeps VGJ product-size groupings and only accepts two-sided official quotes', () => {
    const product = getMarketProduct(
      'vgj',
      'vgj-ring-9999-1-2-5c',
    ) as VgjProduct;
    const quote = parseVgjQuoteFromHtml(
      product,
      '<script>"purchase":144900000,"sell":147900000,"title":"Vàng nhẫn VGJ 99.99 dạng 1 chỉ, 2 chỉ, 5 chỉ"</script>',
    );
    expect(quote).toMatchObject({ buy: 144.9, sell: 147.9 });

    const unavailable = getMarketProduct('phuquy', 'phuquy-non-sjc-9999');
    expect(isMarketProductSelectable(unavailable)).toBe(false);
  });

  it('shares BTMH product categories and only enables the seven two-sided rows', () => {
    const all = getMarketProducts('btmh');
    expect(all).toHaveLength(11);
    expect(
      getSelectableMarketProducts('btmh').map((product) => product.id),
    ).toEqual([
      'btmh-kgb',
      'btmh-bt-tkc',
      'btmh-kgbg',
      'btmh-khs',
      'btmh-sjc9999',
      'btmh-9999',
      'btmh-999',
    ]);
    expect(getDefaultMarketProduct('btmh')?.id).toBe('btmh-kgb');
    expect(all.map((product) => getMarketProductCategory(product))).toEqual([
      'investment-gold',
      'investment-gold',
      'gift',
      'coin',
      'bar',
      'jewelry',
      'jewelry',
      'jewelry',
      'ring',
      'raw-material',
      'raw-material',
    ]);
  });

  it('normalizes BTMH prices by the official unit and rejects incomplete rows', () => {
    const kimGiaBao = getMarketProduct('btmh', 'btmh-kgb') as BtmhProduct;
    const quote = parseBtmhQuote(
      {
        data: {
          goldRates: {
            items: [
              {
                code: 'KGB',
                name: 'Kim Gia Bảo 24K',
                vendor_name: 'Công ty cổ phần Bảo Tín Mạnh Hải',
                buy_price: 13_990_000,
                sell_price: 14_390_000,
                unit: 'VND/1 chỉ',
                weight: '1 chỉ',
                last_updated: '2026-09-30 15:20:53.0',
              },
            ],
          },
        },
      },
      kimGiaBao,
    );
    expect(quote).toMatchObject({ buy: 139.9, sell: 143.9 });
    expect(quote.observedAt).toBe('2026-09-30T08:20:53.000Z');

    const tieuKimCat = getMarketProduct('btmh', 'btmh-bt-tkc') as BtmhProduct;
    const smallQuote = parseBtmhQuote(
      {
        data: {
          goldRates: {
            items: [
              {
                code: 'BT-TKC',
                name: 'Tiểu Kim Cát 24K',
                vendor_name: 'Công ty cổ phần Bảo Tín Mạnh Hải',
                buy_price: 1_399_000,
                sell_price: 1_442_000,
                unit: 'VND/0,1 chỉ',
                weight: '0,1 chỉ',
                last_updated: '2026-09-30 15:20:59.0',
              },
            ],
          },
        },
      },
      tieuKimCat,
    );
    expect(smallQuote).toMatchObject({ buy: 139.9, sell: 144.2 });
    expect(parseBtmhUnitWeight('VND/1 chỉ')).toBe(0.1);
    expect(parseBtmhUnitWeight('VND/0,1 chỉ')).toBe(0.01);
    expect(parseBtmhUnitWeight('VND/1 lượng')).toBe(1);
    expect(parseBtmhTimestamp('not a timestamp')).toBeNull();

    const invalid = {
      data: {
        goldRates: {
          items: [
            {
              code: 'KGB',
              name: 'Kim Gia Bảo 24K',
              vendor_name: 'Công ty cổ phần Bảo Tín Mạnh Hải',
              buy_price: 13_990_000,
              sell_price: 1,
              unit: 'VND/1 chỉ',
              last_updated: '2026-09-30 15:20:53.0',
            },
          ],
        },
      },
    };
    expect(() => parseBtmhQuote(invalid, kimGiaBao)).toThrow();
    expect(() =>
      parseBtmhQuote({ ...invalid, errors: [{ message: 'no' }] }, kimGiaBao),
    ).toThrow();
    expect(() =>
      parseBtmhQuote(
        {
          data: {
            goldRates: {
              items: [
                {
                  ...invalid.data.goldRates.items[0],
                  unit: 'VND/0,1 chỉ',
                  sell_price: 14_390_000,
                },
              ],
            },
          },
        },
        kimGiaBao,
      ),
    ).toThrow(/size/);
  });

  it('splits BTMH history at New Year and never relabels another product or year', () => {
    const product = getMarketProduct('btmh', 'btmh-kgb') as BtmhProduct;
    expect(splitBtmhHistoryWindows('2025-12-30', '2026-01-02')).toEqual([
      { start: '2025-12-30', end: '2025-12-31' },
      { start: '2026-01-01', end: '2026-01-02' },
    ]);

    const points = parseBtmhHistoryPoints(
      {
        data: {
          goldChartData: {
            default_product: 'KGB',
            data_points: [
              { date: '31/12', buy: 13_000_000, sell: 13_400_000 },
              { date: '01/01', buy: 13_100_000, sell: 13_500_000 },
              { date: '01/01/2027', buy: 14_000_000, sell: 14_400_000 },
            ],
          },
        },
      },
      product,
      { start: '2025-12-30', end: '2025-12-31' },
    );
    expect(points).toMatchObject([{ date: '2025-12-31', buy: 130, sell: 134 }]);
    expect(() =>
      parseBtmhHistoryPoints(
        {
          data: {
            goldChartData: {
              default_product: 'KGBG',
              data_points: [
                { date: '31/12', buy: 13_000_000, sell: 13_400_000 },
              ],
            },
          },
        },
        product,
        { start: '2025-12-30', end: '2025-12-31' },
      ),
    ).toThrow(/different product/);
  });
});
