// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { PriceChart } from '@/components/market/price-chart';

const chartMocks = vi.hoisted(() => {
  const series = { setData: vi.fn(), applyOptions: vi.fn() };
  const api = {
    addSeries: vi.fn(() => series),
    applyOptions: vi.fn(),
    subscribeCrosshairMove: vi.fn(),
    subscribeClick: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    unsubscribeClick: vi.fn(),
    remove: vi.fn(),
    timeScale: () => ({ fitContent: vi.fn() }),
  };
  return { createChart: vi.fn(() => api), api };
});
vi.mock('lightweight-charts', () => ({
  createChart: chartMocks.createChart,
  CandlestickSeries: {},
  LineSeries: {},
  ColorType: { Solid: 'solid' },
}));
vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('switches VI/EN and lượng/chỉ without recreating the chart or losing the chosen range', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const candle = {
    date: '2026-10-13',
    buy: { open: 140, high: 142, low: 139, close: 141 },
    sell: { open: 143, high: 145, low: 142, close: 144 },
    updatedAt: '2026-10-13T08:00:00Z',
    observations: 3,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        companyId: 'sjc',
        productId: 'bar-1l',
        range: '7N',
        status: 'partial',
        records: [candle],
        requestedStart: '2026-10-07',
        requestedEnd: '2026-10-13',
        source: null,
      }),
    })),
  );
  const element = document.createElement('div');
  document.body.appendChild(element);
  const root = createRoot(element);
  const props = {
    data: [],
    companyId: 'sjc',
    productId: 'bar-1l',
    productLabel: 'Miếng 1 lượng',
    rangeLabel: '7 ngày',
    range: '7N' as const,
    locale: 'vi' as const,
    onRangeChange: vi.fn(),
  };
  try {
    await act(async () => root.render(createElement(PriceChart, props)));
    expect(element.textContent).toContain('Thị trường trong nước');
    expect(
      element.querySelector('[data-testid="chart-readout"]')?.textContent,
    ).toContain('144,00');
    await act(async () =>
      root.render(
        createElement(PriceChart, {
          ...props,
          locale: 'en',
          displayUnit: 'chi',
          rangeLabel: '7 days',
        }),
      ),
    );
    expect(element.textContent).toContain('Domestic market');
    expect(element.textContent).toContain('million VND / chỉ');
    expect(
      element.querySelector('[data-testid="chart-readout"]')?.textContent,
    ).toContain('Close 14.40');
    expect(
      [...element.querySelectorAll('button')]
        .find((button) => button.textContent === '7 days')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(chartMocks.createChart).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
  expect(chartMocks.api.remove).toHaveBeenCalledTimes(1);
});
