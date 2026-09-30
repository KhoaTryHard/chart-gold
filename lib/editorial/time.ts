import {
  editorialPublicationSlots,
  type EditorialPublicationSlot,
} from './types';

export const EDITORIAL_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1_000;

export const editorialPublicationTimes: Record<
  EditorialPublicationSlot,
  { hour: number; minute: number; label: string }
> = {
  morning: { hour: 8, minute: 30, label: '08:30' },
  noon: { hour: 12, minute: 0, label: '12:00' },
  evening: { hour: 17, minute: 0, label: '17:00' },
};

type VietnamDateParts = {
  year: number;
  month: number;
  day: number;
};

function parseVietnamDate(localDate: string): VietnamDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) {
    throw new RangeError('Ngày lịch biên tập phải có dạng YYYY-MM-DD.');
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new RangeError('Ngày lịch biên tập không hợp lệ.');
  }

  return { year, month, day };
}

export function vietnamLocalDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EDITORIAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) {
    throw new Error('Không thể xác định ngày Việt Nam.');
  }
  return `${year}-${month}-${day}`;
}

export function scheduledAtForEditorialSlot(
  localDate: string,
  slot: EditorialPublicationSlot,
): Date {
  const { year, month, day } = parseVietnamDate(localDate);
  const time = editorialPublicationTimes[slot];
  return new Date(
    Date.UTC(year, month - 1, day, time.hour, time.minute) -
      VIETNAM_UTC_OFFSET_MS,
  );
}

export function editorialScheduleForDate(localDate: string) {
  parseVietnamDate(localDate);
  return editorialPublicationSlots.map((slot) => ({
    localDate,
    slot,
    scheduledAt: scheduledAtForEditorialSlot(localDate, slot),
  }));
}
