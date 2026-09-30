export type PricePoint = {
  date: string;
  buy: number;
  sell: number;
  spread: number;
  eventId: null;
};

export type PriceRangeStats = {
  first: PricePoint | null;
  latest: PricePoint | null;
  change: number;
  percent: number;
  highestSell: number | null;
  lowestSell: number | null;
};

export type PriceChartRange = '7N' | '1T' | '1N';

export const PRICE_CHART_RANGES: ReadonlyArray<{
  value: PriceChartRange;
  label: string;
  days: number;
}> = [
  { value: '7N', label: '7 ngày', days: 7 },
  { value: '1T', label: '1 tháng', days: 30 },
  { value: '1N', label: '1 năm', days: 365 },
];

export type PriceLabelSeries = 'sell' | 'buy';
export type PriceLabelPlacement = 'top' | 'bottom';

export type PriceLabelLayout = {
  sell: Set<number>;
  buy: Set<number>;
  sellPlacement: Map<number, PriceLabelPlacement>;
  buyPlacement: Map<number, PriceLabelPlacement>;
};

type PriceLabelCandidate = {
  index: number;
  series: PriceLabelSeries;
  value: number;
  priority: number;
};

type LabelRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type LabelPlacementResult = {
  rect: LabelRect;
  placement: PriceLabelPlacement;
};

type PlotArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function finiteIndexes(
  records: PricePoint[],
  startIndex: number,
  endIndex: number,
) {
  const start = Math.max(0, Math.min(startIndex, records.length - 1));
  const end = Math.max(start, Math.min(endIndex, records.length - 1));
  return { start, end };
}

/** Selects useful labels while keeping labels from the same line apart. */
export function chooseLabelIndexes(
  records: PricePoint[],
  startIndex: number,
  endIndex: number,
  estimatedWidth = 480,
  minimumGap = 56,
  valueKey: 'sell' | 'buy' = 'sell',
) {
  if (!records.length) return [];

  const { start, end } = finiteIndexes(records, startIndex, endIndex);
  const pointWidth = estimatedWidth / Math.max(1, end - start);
  const minimumPointGap = Math.max(1, Math.ceil(minimumGap / pointWidth));
  const extrema = [
    start,
    end,
    records
      .slice(start, end + 1)
      .reduce(
        (best, point, offset, visible) =>
          point[valueKey] > visible[best - start][valueKey]
            ? start + offset
            : best,
        start,
      ),
    records
      .slice(start, end + 1)
      .reduce(
        (best, point, offset, visible) =>
          point[valueKey] < visible[best - start][valueKey]
            ? start + offset
            : best,
        start,
      ),
  ];
  const selected: number[] = [];

  const addIfSpaced = (index: number) => {
    if (
      index >= start &&
      index <= end &&
      selected.every(
        (existing) => Math.abs(existing - index) >= minimumPointGap,
      )
    ) {
      selected.push(index);
    }
  };

  extrema.forEach(addIfSpaced);
  for (let index = start; index <= end; index += minimumPointGap) {
    addIfSpaced(index);
  }

  return selected.sort((left, right) => left - right);
}

function nearestExtremumIndex(
  records: PricePoint[],
  start: number,
  end: number,
  valueKey: PriceLabelSeries,
  direction: 'highest' | 'lowest',
  latestIndex: number,
) {
  const visible = records.slice(start, end + 1);
  const target = visible.reduce(
    (best, point) =>
      direction === 'highest'
        ? Math.max(best, point[valueKey])
        : Math.min(best, point[valueKey]),
    visible[0]?.[valueKey] ?? 0,
  );
  let bestIndex = latestIndex;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = start; index <= end; index += 1) {
    if (records[index][valueKey] !== target) continue;
    const distance = Math.abs(latestIndex - index);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }

  return bestIndex;
}

function getLabelCandidates(
  records: PricePoint[],
  start: number,
  end: number,
  narrow: boolean,
) {
  const candidates: PriceLabelCandidate[] = [];
  const rangeSize = Math.max(1, end - start);

  for (const series of ['sell', 'buy'] as const) {
    const latestIndex = end;
    const highestIndex = nearestExtremumIndex(
      records,
      start,
      end,
      series,
      'highest',
      latestIndex,
    );
    const lowestIndex = nearestExtremumIndex(
      records,
      start,
      end,
      series,
      'lowest',
      latestIndex,
    );

    const add = (index: number, roleWeight: number) => {
      const existing = candidates.find(
        (candidate) => candidate.series === series && candidate.index === index,
      );
      const values = records.slice(start, end + 1).map((point) => point[series]);
      const valueSpan = Math.max(0.0001, Math.max(...values) - Math.min(...values));
      const valueDistance =
        Math.abs(records[index][series] - records[latestIndex][series]) /
        valueSpan;
      const timeDistance = Math.abs(latestIndex - index) / rangeSize;
      const priority =
        roleWeight +
        (narrow && roleWeight < 100
          ? valueDistance * 20 + timeDistance * 0.01
          : 0);

      if (existing) {
        existing.priority = Math.max(existing.priority, priority);
        return;
      }

      candidates.push({
        index,
        series,
        value: records[index][series],
        priority,
      });
    };

    add(latestIndex, 100);
    add(highestIndex, 72);
    add(lowestIndex, 72);
  }

  return candidates;
}

function makeLabelRect(
  candidate: PriceLabelCandidate,
  x: number,
  y: number,
  plotArea: PlotArea,
  labelGap: number,
): LabelPlacementResult {
  const text = candidate.value.toFixed(1);
  const width = Math.max(28, text.length * 7.1);
  const height = 16;
  const left = x - width / 2;
  const topAbove = y - labelGap - height;
  const topBelow = y + labelGap;
  const canPlaceAbove = topAbove >= plotArea.y;
  const canPlaceBelow = topBelow + height <= plotArea.y + plotArea.height;
  const placement: PriceLabelPlacement =
    candidate.series === 'sell'
      ? canPlaceAbove || !canPlaceBelow
        ? 'top'
        : 'bottom'
      : canPlaceBelow || !canPlaceAbove
        ? 'bottom'
        : 'top';
  const top = placement === 'top' ? topAbove : topBelow;

  return {
    rect: {
      left,
      top,
      right: left + width,
      bottom: top + height,
    },
    placement,
  };
}

function rectanglesOverlap(left: LabelRect, right: LabelRect, gap: number) {
  return (
    left.left < right.right + gap &&
    left.right + gap > right.left &&
    left.top < right.bottom + gap &&
    left.bottom + gap > right.top
  );
}

/**
 * Selects and lays out labels for both price lines using the measured plot area.
 * The result is deterministic and can be tested without rendering Recharts.
 */
export function chooseResponsiveLabelLayout(
  records: PricePoint[],
  startIndex: number,
  endIndex: number,
  plotArea: PlotArea,
  getX: (index: number) => number | undefined,
  getY: (series: PriceLabelSeries, index: number) => number | undefined,
) {
  const layout: PriceLabelLayout = {
    sell: new Set(),
    buy: new Set(),
    sellPlacement: new Map(),
    buyPlacement: new Map(),
  };
  if (!records.length || plotArea.width <= 0 || plotArea.height <= 0) {
    return layout;
  }

  const { start, end } = finiteIndexes(records, startIndex, endIndex);
  const narrow = plotArea.width < 280;
  const maximumLabels = narrow ? 4 : 6;
  const labels: Array<{ candidate: PriceLabelCandidate; rect: LabelRect }> = [];
  const candidates = getLabelCandidates(records, start, end, narrow).sort(
    (left, right) =>
      right.priority - left.priority ||
      right.index - left.index ||
      left.series.localeCompare(right.series),
  );

  for (const candidate of candidates) {
    const x = getX(candidate.index);
    const y = getY(candidate.series, candidate.index);
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    const { rect, placement } = makeLabelRect(candidate, x, y, plotArea, 8);
    if (labels.every((label) => !rectanglesOverlap(label.rect, rect, 8))) {
      labels.push({ candidate, rect });
      layout[candidate.series].add(candidate.index);
      layout[`${candidate.series}Placement`].set(candidate.index, placement);
      if (labels.length >= maximumLabels) break;
    }
  }

  return layout;
}

export function getPriceRangeStats(
  records: PricePoint[],
  startIndex: number,
  endIndex: number,
): PriceRangeStats {
  if (!records.length) {
    return {
      first: null,
      latest: null,
      change: 0,
      percent: 0,
      highestSell: null,
      lowestSell: null,
    };
  }

  const { start, end } = finiteIndexes(records, startIndex, endIndex);
  const visible = records.slice(start, end + 1);
  const first = visible[0] ?? null;
  const latest = visible.at(-1) ?? null;
  const change = first && latest ? latest.sell - first.sell : 0;

  return {
    first,
    latest,
    change,
    percent: first?.sell ? (change / first.sell) * 100 : 0,
    highestSell: Math.max(...visible.map((point) => point.sell)),
    lowestSell: Math.min(...visible.map((point) => point.sell)),
  };
}
