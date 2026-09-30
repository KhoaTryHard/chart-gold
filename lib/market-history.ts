import { shiftDate, vietnamDate } from '@/lib/analysis/dates';

export type MarketHistoryStatus = 'ready' | 'partial' | 'unavailable';
export type MarketHistoryCapability =
  | 'annual'
  | 'rolling-30'
  | 'rolling-7'
  | 'snapshot';

export type MarketHistoryPoint = {
  date: string;
  buy: number;
  sell: number;
  spread: number;
  eventId: null;
};

export type MarketHistoryResponse = {
  companyId: string;
  productId: string;
  range: '1N';
  requestedStart: string;
  requestedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  expectedDays: number;
  availableDays: number;
  missingDates: string[];
  status: MarketHistoryStatus;
  records: MarketHistoryPoint[];
  source: {
    provider: string;
    url: string | null;
    official: boolean;
    description: string;
  } | null;
  latestSync: {
    status: 'running' | 'completed' | 'partial' | 'failed' | 'skipped_locked';
    startedAt: string;
    finishedAt: string | null;
    message: string | null;
  } | null;
};

export type HistoryDayStatus = 'ok' | 'missing' | 'error';

export function getCalendarWindow(
  days: number,
  endDate = vietnamDate(),
) {
  return {
    start: shiftDate(endDate, 1 - Math.max(1, days)),
    end: endDate,
  };
}

export function enumerateCalendarDates(start: string, end: string) {
  if (start > end) return [];
  const dates: string[] = [];
  for (let date = start; date <= end; date = shiftDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

export function filterRecordsByCalendarWindow<
  T extends { date: string },
>(records: readonly T[], days: number, endDate?: string) {
  const end = endDate ?? records.at(-1)?.date;
  if (!end) return [];
  const { start } = getCalendarWindow(days, end);
  return records.filter((point) => point.date >= start && point.date <= end);
}

export function mergeRecordsByDate<T extends { date: string }>(
  primary: readonly T[],
  current: readonly T[],
) {
  const merged = new Map<string, T>();
  for (const point of primary) merged.set(point.date, point);
  for (const point of current) merged.set(point.date, point);
  return [...merged.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

export function buildHistoryCoverage(
  expectedDates: readonly string[],
  statuses: ReadonlyMap<string, HistoryDayStatus>,
) {
  const missingDates = expectedDates.filter(
    (date) => statuses.get(date) !== 'ok',
  );
  const allChecked = expectedDates.every((date) => statuses.has(date));
  const hasErrors = expectedDates.some((date) => statuses.get(date) === 'error');
  return {
    missingDates,
    status: !statuses.size
      ? ('unavailable' as const)
      : allChecked && !hasErrors
        ? ('ready' as const)
        : ('partial' as const),
  };
}
