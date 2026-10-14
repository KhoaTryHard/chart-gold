import { describe, expect, it } from 'vitest';
import {
  aggregateCandle,
  candleCoverage,
  parsePnjCandle,
  parseVangTodayCandles,
} from '@/lib/market-candles';

const date = '2026-10-13';
const entries = [
  {
    unix: Date.parse(`${date}T15:30:00+07:00`) / 1000,
    buy: 141300000,
    sell: 144300000,
  },
  {
    unix: Date.parse(`${date}T08:30:00+07:00`) / 1000,
    buy: 140500000,
    sell: 143500000,
  },
  {
    unix: Date.parse(`${date}T00:00:00+07:00`) / 1000,
    buy: 141300000,
    sell: 144300000,
  },
];
const row = {
  date,
  buy: 141300000,
  sell: 144300000,
  open_buy: 141300000,
  open_sell: 144300000,
  high_buy: 141300000,
  low_buy: 140500000,
  high_sell: 144300000,
  low_sell: 143500000,
  entries,
  entry_count: 3,
};
const html = (value: unknown) =>
  `<script>const chartData = ${JSON.stringify(value)};</script>`;

describe('source-backed daily candles', () => {
  it('reorders timestamps, preserves intraday lows, and uses Vietnam calendar dates', () => {
    const [candle] = parseVangTodayCandles(html([row]));
    expect(candle.sell).toEqual({
      open: 144.3,
      high: 144.3,
      low: 143.5,
      close: 144.3,
    });
    expect(candle.buy.low).toBe(140.5);
    expect(candle.updatedAt).toBe('2026-10-13T08:30:00.000Z');
  });
  it('rejects supplied OHLC that disagrees with observations, incomplete entries and invalid prices', () => {
    expect(
      parseVangTodayCandles(html([{ ...row, low_sell: 100000000 }])),
    ).toEqual([]);
    expect(parseVangTodayCandles(html([{ ...row, entry_count: 4 }]))).toEqual(
      [],
    );
    expect(
      parseVangTodayCandles(
        html([
          {
            ...row,
            entries: [{ ...entries[0], buy: null }, ...entries.slice(1)],
          },
        ]),
      ),
    ).toEqual([]);
    expect(
      aggregateCandle(date, [
        { timestamp: entries[0].unix * 1000, buy: 145, sell: 140 },
      ]),
    ).toBeNull();
    expect(
      aggregateCandle(date, [
        {
          timestamp: Date.parse('2026-10-14T00:00:00+07:00'),
          buy: 140,
          sell: 143,
        },
      ]),
    ).toBeNull();
  });
  it('never executes source scripts or manufactures OHLC from daily-only history', () => {
    expect(() =>
      parseVangTodayCandles(
        '<script>const chartData = [globalThis.bad()];</script>',
      ),
    ).toThrow();
    expect(
      parseVangTodayCandles(html([{ date, buy: 140, sell: 143 }])),
    ).toEqual([]);
    expect(() =>
      parseVangTodayCandles('<html>Source changed</html>'),
    ).toThrow();
  });
  it('accepts an observed unchanged day, rejects conflicting duplicate timestamps and keeps gaps', () => {
    const observation = {
      timestamp: entries[0].unix * 1000,
      buy: 141.3,
      sell: 144.3,
    };
    const candle = aggregateCandle(date, [observation])!;
    expect(candle.sell).toEqual({
      open: 144.3,
      high: 144.3,
      low: 144.3,
      close: 144.3,
    });
    expect(
      aggregateCandle(date, [observation, { ...observation, sell: 144 }]),
    ).toBeNull();
    expect(candleCoverage([candle], '2026-10-12', '2026-10-14')).toEqual([
      '2026-10-12',
      '2026-10-14',
    ]);
  });
  it('matches PNJ region and product exactly and aggregates all timestamped rows', () => {
    const data = [
      {
        updated_at: '13/10/2026 13:30:00',
        gia_mua: '140.500',
        gia_ban: '143.500',
      },
      {
        updated_at: '13/10/2026 08:00:00',
        gia_mua: '140.000',
        gia_ban: '143.000',
      },
    ];
    const payload = {
      locations: [{ name: 'TPHCM', gold_type: [{ name: 'SJC', data }] }],
    };
    expect(parsePnjCandle(payload, 'TPHCM', 'SJC', date)?.sell).toEqual({
      open: 143,
      high: 143.5,
      low: 143,
      close: 143.5,
    });
    expect(parsePnjCandle(payload, 'Hà Nội', 'SJC', date)).toBeNull();
    expect(parsePnjCandle(payload, 'TPHCM', 'PNJ', date)).toBeNull();
    data[0].updated_at = '';
    expect(parsePnjCandle(payload, 'TPHCM', 'SJC', date)).toBeNull();
  });
});
