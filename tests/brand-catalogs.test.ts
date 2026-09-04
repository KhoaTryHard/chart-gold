import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error server-only is a Next.js virtual module, not a test dependency.
vi.mock('server-only', () => ({}), { virtual: true });

import {
  getMarketProduct,
  getMarketProducts,
  isMarketProductSelectable,
} from '@/lib/market-sources';
import {
  parsePnjCurrentQuote,
  parsePnjHistoryPoint,
  type PnjProduct,
} from '@/lib/server/pnj';
import { parseVgjQuoteFromHtml, type VgjProduct } from '@/lib/server/vgj';

describe('brand-specific product catalogs', () => {
  it('keeps PNJ product categories tied to its official product labels', () => {
    const products = getMarketProducts('pnj');
    expect(products.some((product) => product.id === 'pnj-ring-9999')).toBe(true);
    expect(products.some((product) => product.id === 'pnj-gold-750')).toBe(true);
    expect(products.some((product) => product.id === 'pnj-sjc-hanoi')).toBe(true);
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
                  { gia_mua: '144.000', gia_ban: '147.300', updated_at: '03/09/2026 08:41:36' },
                  { gia_mua: '145.000', gia_ban: '148.300', updated_at: '03/09/2026 15:28:35' },
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

  it('keeps VGJ product-size groupings and only accepts two-sided official quotes', () => {
    const product = getMarketProduct('vgj', 'vgj-ring-9999-1-2-5c') as VgjProduct;
    const quote = parseVgjQuoteFromHtml(
      product,
      '<script>"purchase":144900000,"sell":147900000,"title":"Vàng nhẫn VGJ 99.99 dạng 1 chỉ, 2 chỉ, 5 chỉ"</script>',
    );
    expect(quote).toMatchObject({ buy: 144.9, sell: 147.9 });

    const unavailable = getMarketProduct('phuquy', 'phuquy-non-sjc-9999');
    expect(isMarketProductSelectable(unavailable)).toBe(false);
  });
});
