const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1_000;

function vietnamYearMonth(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month))
    throw new Error('Không xác định được tháng Việt Nam.');
  return { year, month };
}

export function vietnamMonthKey(value: Date) {
  const { year, month } = vietnamYearMonth(value);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Calendar-month boundaries represented as UTC instants at Vietnam midnight. */
export function vietnamMonthBounds(value: Date) {
  const { year, month } = vietnamYearMonth(value);
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - VIETNAM_OFFSET_MS),
    end: new Date(Date.UTC(year, month, 1) - VIETNAM_OFFSET_MS),
  };
}

export function vietnamDayBounds(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return {
    start: new Date(Date.UTC(year, month - 1, day) - VIETNAM_OFFSET_MS),
    end: new Date(Date.UTC(year, month - 1, day + 1) - VIETNAM_OFFSET_MS),
  };
}

/** First instant of the following Vietnam calendar day, represented in UTC. */
export function vietnamNextDayStart(value: Date) {
  return vietnamDayBounds(value).end;
}
