import type { DayPopUserData } from '../../src/domain/types';

// Synthetic schema-v4 data. Keep the expected rows independent of the backup
// serializer/importer so a shared omission cannot make the round-trip pass.
const id = (n: number) => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const timestamps = {
  createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T01:00:00.000Z',
};
const event = {
  calendarId: id(1),
  location: '會議室 A',
  notes: '第一行\n第二行，保留中文與換行',
  reminderMinutes: [15],
  recurrence: null,
  sharingScope: 'private' as const,
  ...timestamps,
};
const todo = {
  calendarId: id(2),
  dueDate: '2026-09-30',
  priority: 'high' as const,
  sharingScope: 'private' as const,
  ...timestamps,
};

export const backupData: DayPopUserData = {
  calendars: [
    { id: id(1), name: '備份工作', color: '#F06C5C', isVisible: true, isDefault: true, sortOrder: 0, ...timestamps },
    { id: id(2), name: '備份生活', color: '#5C9EF0', isVisible: true, isDefault: false, sortOrder: 1, ...timestamps },
  ],
  events: [
    {
      ...event, id: id(3), title: '備份晨會', allDay: false,
      startsAt: '2026-09-30T01:00:00.000Z', endsAt: '2026-09-30T02:00:00.000Z',
      timezone: 'Asia/Taipei', recurrence: { rule: 'FREQ=DAILY;COUNT=3' },
    },
    {
      ...event, id: id(4), title: '備份改期晨會', allDay: false,
      startsAt: '2026-10-02T03:00:00.000Z', endsAt: '2026-10-02T04:00:00.000Z',
      timezone: 'Asia/Taipei',
    },
    {
      ...event, id: id(5), title: '備份夜班', allDay: false,
      startsAt: '2026-09-30T15:30:00.000Z', endsAt: '2026-09-30T17:00:00.000Z',
      timezone: 'Asia/Taipei',
    },
    {
      ...event, id: id(6), calendarId: id(2), title: '備份假期', allDay: true,
      startDate: '2026-09-30', endDate: '2026-10-02',
    },
  ],
  eventExceptions: [
    {
      id: id(7), eventId: id(3), occurrence: { kind: 'timed', startsAt: '2026-10-01T01:00:00.000Z' },
      isCancelled: true, replacementEventId: null, ...timestamps,
    },
    {
      id: id(8), eventId: id(3), occurrence: { kind: 'timed', startsAt: '2026-10-02T01:00:00.000Z' },
      isCancelled: false, replacementEventId: id(4), ...timestamps,
    },
  ],
  eventAttachments: [],
  todos: [
    { ...todo, id: id(9), parentId: null, title: '備份待辦', completedAt: null, sortOrder: 0 },
    { ...todo, id: id(10), parentId: id(9), title: '備份子項', completedAt: '2026-09-29T02:00:00.000Z', sortOrder: 1 },
  ],
  stickers: [
    { id: id(11), calendarId: id(2), date: '2026-09-30', glyph: '⭐', assetKey: null, sortOrder: 0, ...timestamps },
  ],
  preferences: {
    timezone: 'Asia/Taipei', weekStartsOn: 1, theme: 'light', themeId: 'warm',
    calendarGridMode: 'fixed-six', defaultReminderMinutes: [10, 30],
    petName: '備份夥伴', petEnabled: false,
  },
};
