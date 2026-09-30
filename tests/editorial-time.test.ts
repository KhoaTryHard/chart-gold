import { describe, expect, it } from 'vitest';

import {
  editorialScheduleForDate,
  scheduledAtForEditorialSlot,
} from '@/lib/editorial/time';

describe('editorial publication schedule', () => {
  it('maps the three Vietnam publication slots to their expected UTC instants', () => {
    expect(
      scheduledAtForEditorialSlot('2026-09-10', 'morning').toISOString(),
    ).toBe('2026-09-10T01:30:00.000Z');
    expect(
      scheduledAtForEditorialSlot('2026-09-10', 'noon').toISOString(),
    ).toBe('2026-09-10T05:00:00.000Z');
    expect(
      scheduledAtForEditorialSlot('2026-09-10', 'evening').toISOString(),
    ).toBe('2026-09-10T10:00:00.000Z');
  });

  it('always creates exactly one morning, noon, and evening slot', () => {
    expect(
      editorialScheduleForDate('2026-09-10').map((item) => item.slot),
    ).toEqual(['morning', 'noon', 'evening']);
  });
});
