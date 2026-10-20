import { createEmptyUserData, type DayPopUserData } from '../../src/domain/types';
import { parseDayPopUserData } from '../../src/domain/validation';
import { visibleOccurrences } from '../../src/domain/calendars';

export const measurementInstant = '2026-10-20T04:00:00.000Z';
const id = (n: number) => `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Fixed synthetic data only. No account adapter or external data is loaded. */
export function monthScrollData(seriesCount: number): DayPopUserData {
  const data = createEmptyUserData({ now: measurementInstant, idFactory: () => id(1) });
  data.preferences = { ...data.preferences, petEnabled: false, calendarGridMode: 'fixed-six' };
  data.events = Array.from({ length: seriesCount }, (_, index) => ({
    id: id(index + 100),
    calendarId: id(1),
    title: `量測行程 ${index + 1}`,
    location: null,
    notes: null,
    allDay: false as const,
    startsAt: new Date(Date.parse('2025-01-01T01:00:00Z') + index * 30 * 60_000).toISOString(),
    endsAt: new Date(Date.parse('2025-01-01T01:30:00Z') + index * 30 * 60_000).toISOString(),
    timezone: 'Asia/Taipei',
    reminderMinutes: [],
    recurrence: { rule: 'FREQ=DAILY' },
    sharingScope: 'inherit' as const,
    createdAt: measurementInstant,
    updatedAt: measurementInstant,
  }));
  return parseDayPopUserData(data);
}

export function measureExpansion(data: DayPopUserData, startDate: string, endDate: string) {
  return visibleOccurrences(data, { startDate, endDate }, data.preferences.timezone).length;
}
