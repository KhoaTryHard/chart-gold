import { afterEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error server-only is a Next.js virtual module, not a test dependency.
vi.mock('server-only', () => ({}), { virtual: true });

import {
  AGGREGATED_PRODUCTS,
  getMarketCompany,
  getMarketProduct,
  getMarketProducts,
  isMarketProductSelectable,
  MARKET_COMPANIES,
  presentMarketCatalogText,
  presentMarketCompany,
  presentMarketProduct,
} from '@/lib/market-sources';
import { getMarketData } from '@/lib/server/sjc';

describe('market source registry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers Vang.Today products with their documented upstream codes', () => {
    expect(MARKET_COMPANIES.map((company) => company.id)).toEqual([
      'sjc',
      'pnj',
      'doji',
      'baotin',
      'vngold',
      'viettin',
      'vgj',
      'btmc',
      'btmh',
      'phuquy',
      'mihong',
    ]);
    expect(AGGREGATED_PRODUCTS.map((product) => product.upstreamCode)).toEqual([
      'DOHNL',
      'DOHCML',
      'DOJINHTV',
      'BTSJC',
      'BT9999NTT',
      'VNGSJC',
      'VIETTINMSJC',
    ]);
  });

  it('resolves a product only inside the selected company', () => {
    expect(getMarketProduct('pnj', 'pnj-ring-9999').officialMatch).toBe(
      'Nhẫn Trơn PNJ 999.9',
    );
    expect(getMarketProduct('doji', 'pnj-24k').companyId).toBe('doji');
    expect(
      getMarketProducts('sjc').every((product) => 'officialMatch' in product),
    ).toBe(true);
    expect(getMarketCompany('unknown').id).toBe('sjc');
    expect(getMarketProducts('btmh')).toHaveLength(11);
    expect(getMarketProducts('btmh').map((product) => product.id)).toEqual([
      'btmh-kgb',
      'btmh-bt-tkc',
      'btmh-kgbg',
      'btmh-khs',
      'btmh-sjc9999',
      'btmh-9999',
      'btmh-999',
      'btmh-bt24k',
      'btmh-vrtl',
      'btmh-nl9999',
      'btmh-nl999',
    ]);
    expect(getMarketCompany('btmh')).toMatchObject({
      name: 'Bảo Tín Mạnh Hải',
      adapter: 'btmh-official',
      supportsOfficialQuote: true,
    });
    expect(
      getMarketProducts('btmh')
        .filter((product) => !isMarketProductSelectable(product))
        .map((product) => product.id),
    ).toEqual([
      'btmh-bt24k',
      'btmh-vrtl',
      'btmh-nl9999',
      'btmh-nl999',
    ]);
  });

  it('localizes visible catalog labels without changing source identities', () => {
    const company = getMarketCompany('pnj');
    const product = getMarketProduct('phuquy', 'phuquy-ring-9999-05c');
    const englishCompany = presentMarketCompany(company, 'en');
    const englishProduct = presentMarketProduct(product, 'en');

    expect(englishCompany.name).toBe('PNJ');
    expect(englishProduct).toMatchObject({
      label: 'Gold ring Phú Quý 999.9 · 0.5 chỉ',
      shortLabel: 'Gold ring Phú Quý 0.5 chỉ',
      group: 'Gold ring Phú Quý 999.9',
    });
    expect(product).toMatchObject({
      id: 'phuquy-ring-9999-05c',
      label: 'Nhẫn tròn Phú Quý 999.9 · 0,5 chỉ',
      group: 'Nhẫn tròn Phú Quý 999.9',
    });
    expect(
      presentMarketCatalogText('Vàng miếng và nhẫn trơn', 'en'),
    ).toBe('Gold bar and Plain ring');
    expect(
      presentMarketCatalogText('Vàng.Today · Bản dự phòng cục bộ', 'en'),
    ).toBe('Vang.Today · Local fallback data');
  });

  it('returns the selected company and source labels for live aggregator data', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes('days=')) {
        return Response.json({
          success: true,
          history: [
            {
              date: '2026-09-03',
              prices: {
                DOHNL: { buy: 145_000_000, sell: 148_000_000 },
              },
            },
          ],
        });
      }
      return Response.json({
        success: true,
        timestamp: 1_788_453_005,
        buy: 145_400_000,
        sell: 148_400_000,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const market = await getMarketData('doji', 'doji-hanoi');
    expect(market.company.id).toBe('doji');
    expect(market.product.id).toBe('doji-hanoi');
    expect(market.mode).toBe('live');
    expect(market.availability).toBe('available');
    expect(market.source.provider).toBe('Vang.Today aggregator');
    expect(market.source.official).toBe(false);
    expect(market.records.at(-1)).toMatchObject({ buy: 145.4, sell: 148.4 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetches BTMH prices from its own first-party GraphQL adapter', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        data: {
          goldRates: {
            items: [
              {
                code: 'KHS',
                name: 'Đồng vàng Kim Gia Bảo hoa sen',
                vendor_name: 'Công ty cổ phần Bảo Tín Mạnh Hải',
                buy_price: 14_020_000,
                sell_price: 14_420_000,
                unit: 'VND/1 chỉ',
                weight: '1 chỉ',
                last_updated: '2026-09-30 15:20:59.0',
              },
            ],
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetcher);

    const market = await getMarketData('btmh', 'btmh-khs', { view: 'quote' });
    expect(market).toMatchObject({
      mode: 'live',
      availability: 'available',
      company: { id: 'btmh', name: 'Bảo Tín Mạnh Hải' },
      product: { id: 'btmh-khs', officialKey: 'KHS' },
      latest: { buy: 140.2, sell: 144.2 },
      source: { provider: 'Bảo Tín Mạnh Hải official', official: true },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe('POST');
    expect(new Headers(request.headers).get('Store')).toBe('/bang-gia-vang');
    expect(request.body).toEqual(expect.stringContaining('GetBtmhGoldRates'));
  });

  it('keeps Tiểu Kim Cát at one verified current quote without importing mixed-size history', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
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
      }),
    );
    vi.stubGlobal('fetch', fetcher);

    const market = await getMarketData('btmh', 'btmh-bt-tkc');
    expect(market).toMatchObject({
      mode: 'live',
      product: { id: 'btmh-bt-tkc' },
      latest: { buy: 139.9, sell: 144.2 },
      historySource: {
        provider: 'Lịch sử Tiểu Kim Cát tích lũy từ ngày tích hợp',
        url: null,
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not fetch or invent a BTMH quote for buy-only catalog lines', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('buy-only row must not trigger an upstream request');
    });
    vi.stubGlobal('fetch', fetcher);

    const market = await getMarketData('btmh', 'btmh-nl9999');
    expect(market).toMatchObject({
      mode: 'unavailable',
      availability: 'unavailable',
      product: { id: 'btmh-nl9999' },
      unavailableReason:
        'Bảng giá BTMH hiện chỉ công bố giá mua cho dòng này.',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not substitute SJC prices when an external source is unavailable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('upstream unavailable');
    });
    vi.stubGlobal('fetch', fetchMock);

    const market = await getMarketData('doji', 'doji-hanoi');
    expect(market.company.id).toBe('doji');
    expect(market.product.id).toBe('doji-hanoi');
    expect(market.mode).toBe('unavailable');
    expect(market.availability).toBe('unavailable');
    expect(market.records).toEqual([]);
    expect(market.unavailableReason).toContain('Không có snapshot thay thế');
  });

  it('normalizes the official Phú Quý table from VND/chỉ to VND/lượng', async () => {
    const officialHtml = `
      <table><tbody>
        <tr><td>V&#224;ng miếng SJC</td><td>14,560,000</td><td>14,860,000</td></tr>
        <tr><td>Nhẫn tr&#242;n Ph&#250; Qu&#253; 999.9</td><td>14,500,000</td><td>14,890,000</td></tr>
      </tbody></table>`;
    const historyHtml = `
      <table><tbody>
        <tr><td>Nhẫn tr&#242;n Ph&#250; Qu&#253; 999.9</td><td>14,400,000</td><td>14,800,000</td></tr>
      </tbody></table>`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      return new Response(
        url.includes('/XemLai?') ? historyHtml : officialHtml,
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const market = await getMarketData('phuquy', 'phuquy-ring-9999');
    expect(market.mode).toBe('live');
    expect(market.source).toMatchObject({
      provider: 'Phú Quý official',
      official: true,
      url: 'https://gold.phuquy.com.vn/giavang',
    });
    expect(market.latest).toMatchObject({ buy: 145, sell: 148.9, spread: 3.9 });
    expect(market.records.length).toBeGreaterThan(1);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('uses only documented Vang.Today codes as a fast BTMC fallback', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes('btmc.vn')) throw new Error('BTMC official unavailable');
      if (url.includes('days=')) {
        return Response.json({
          success: true,
          history: [
            {
              date: '2026-09-03',
              prices: {
                BT9999NTT: { buy: 145_000_000, sell: 149_000_000 },
              },
            },
          ],
        });
      }
      return Response.json({
        success: true,
        timestamp: 1_788_453_005,
        buy: 145_600_000,
        sell: 149_600_000,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const market = await getMarketData('btmc', 'btmc-ring');
    expect(market.availability).toBe('available');
    expect(market.mode).toBe('live');
    expect(market.product.id).toBe('btmc-ring');
    expect(market.source).toMatchObject({
      provider: 'Vang.Today aggregator (BTMC fallback)',
      official: false,
      url: 'https://www.vang.today/vi/api',
    });
    expect(market.latest).toMatchObject({ buy: 145.6, sell: 149.6 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        return url.includes('type=BT9999NTT');
      }),
    ).toBe(true);
  });

  it('normalizes BTMC official JSON and omits rows without a sell quote', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes('btmc.vn')) {
        if (url.includes('/Home/BGiaVang')) {
          return new Response(`
            <table><tbody>
              <tr><td>NHẪN TRÒN TRƠN BẢO TÍN<br/> MINH CHÂU</td><td>999.9</td><td><b>14500</b></td><td><b>14900</b></td></tr>
              <tr><td>VÀNG MIẾNG SJC</td><td>999.9</td><td><b>14560</b></td><td><b>14960</b></td></tr>
              <tr><td>QUÀ MỪNG <br/> BẢN VỊ VÀNG<br/> BẢO TÍN <br/>MINH CHÂU</td><td>999.9</td><td><b>14500</b></td><td><b>14900</b></td></tr>
            </tbody></table>`);
        }
        return Response.json({
          Data: {
            btmcvangnhanmua: '<b>14500</b>',
            btmcvangnhanban: '<b>14900</b>',
            btmcvangquamungmua: '<b>14500</b>',
            btmcvangquamungban: '<b>14900</b>',
            sjcmua: '<b>14560</b>',
            sjcban: '<b>14960</b>',
          },
        });
      }
      throw new Error('unexpected upstream');
    });
    vi.stubGlobal('fetch', fetchMock);

    const market = await getMarketData('btmc', 'btmc-gift');
    expect(market.mode).toBe('live');
    expect(market.source).toMatchObject({
      provider: 'Bảo Tín Minh Châu official',
      official: true,
    });
    expect(market.latest).toMatchObject({ buy: 145, sell: 149, spread: 4 });
    expect(market.records.length).toBeGreaterThan(1);

    const callsAfterFirstProduct = fetchMock.mock.calls.length;
    const secondProduct = await getMarketData('btmc', 'btmc-sjc');
    expect(secondProduct.mode).toBe('live');
    expect(secondProduct.latest).toMatchObject({ buy: 145.6, sell: 149.6 });
    // The current page is fetched once per product; date-by-date history is
    // shared through the company/date cache.
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstProduct + 1);

    const rawMaterial = getMarketProducts('btmc').find(
      (product) => product.id === 'btmc-raw-9999',
    );
    expect(rawMaterial).toBeDefined();
    expect(rawMaterial && isMarketProductSelectable(rawMaterial)).toBe(false);
  });

  it('keeps Mi Hồng explicit unavailable while its official domain is inactive', async () => {
    const market = await getMarketData('mihong', 'mihong-9999');
    expect(market.availability).toBe('unavailable');
    expect(market.mode).toBe('unavailable');
    expect(market.records).toEqual([]);
    expect(market.unavailableReason).toContain('endpoint Mi Hồng');
  });
});
