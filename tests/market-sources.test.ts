import { afterEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error server-only is a Next.js virtual module, not a test dependency.
vi.mock('server-only', () => ({}), { virtual: true });

import {
  AGGREGATED_PRODUCTS,
  getMarketCompany,
  getMarketProduct,
  getMarketProducts,
  MARKET_COMPANIES,
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
      'btmc',
      'phuquy',
      'mihong',
    ]);
    expect(AGGREGATED_PRODUCTS.map((product) => product.upstreamCode)).toEqual([
      'PQHNVM',
      'PQHN24NTT',
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
    expect(getMarketProduct('pnj', 'pnj-24k').upstreamCode).toBe('PQHN24NTT');
    expect(getMarketProduct('doji', 'pnj-24k').companyId).toBe('doji');
    expect(
      getMarketProducts('sjc').every((product) => 'officialMatch' in product),
    ).toBe(true);
    expect(getMarketCompany('unknown').id).toBe('sjc');
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
                PQHN24NTT: { buy: 145_000_000, sell: 148_000_000 },
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

    const market = await getMarketData('pnj', 'pnj-24k');
    expect(market.company.id).toBe('pnj');
    expect(market.product.id).toBe('pnj-24k');
    expect(market.mode).toBe('live');
    expect(market.availability).toBe('available');
    expect(market.source.provider).toBe('Vang.Today aggregator');
    expect(market.source.official).toBe(false);
    expect(market.records.at(-1)).toMatchObject({ buy: 145.4, sell: 148.4 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
            </tbody></table>`);
        }
        return Response.json({
          Data: {
            btmcvangnhanmua: '<b>14500</b>',
            btmcvangnhanban: '<b>14900</b>',
            sjcmua: '<b>14560</b>',
            sjcban: '<b>14960</b>',
          },
        });
      }
      throw new Error('unexpected upstream');
    });
    vi.stubGlobal('fetch', fetchMock);

    const market = await getMarketData('btmc', 'btmc-ring');
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

    expect(
      getMarketProducts('btmc').some(
        (product) => product.id === 'btmc-raw-9999',
      ),
    ).toBe(false);
  });

  it('keeps Mi Hồng explicit unavailable while its official domain is inactive', async () => {
    const market = await getMarketData('mihong', 'mihong-9999');
    expect(market.availability).toBe('unavailable');
    expect(market.mode).toBe('unavailable');
    expect(market.records).toEqual([]);
    expect(market.unavailableReason).toContain('endpoint Mi Hồng');
  });
});
