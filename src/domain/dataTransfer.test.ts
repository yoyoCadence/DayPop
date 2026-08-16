import { describe, expect, it } from 'vitest';
import {
  backupFileName,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  buildIcsExport,
  buildJsonBackup,
  DataTransferError,
  documentRowCount,
  planIcsImport,
  planJsonImport,
  previewTotal,
  serializeJsonBackup,
} from './dataTransfer';
import { timedEventFromWallTime } from './eventTime';
import { createEmptyUserData, type CalendarEvent, type DayPopUserData } from './types';

/**
 * DP-056. The rule the原檔 broke is the one most of these assert: **nothing is
 * written before the user confirms**, so every rejection path is checked for
 * having produced no plan at all rather than a half-applied one.
 */

const ZONE = 'Asia/Taipei';

function baseData(): DayPopUserData {
  const data = createEmptyUserData();
  data.preferences.timezone = ZONE;
  return data;
}

function timed(data: DayPopUserData, id: string, title: string, date: string): CalendarEvent {
  return timedEventFromWallTime(
    {
      id,
      calendarId: data.calendars[0]!.id,
      title,
      location: null,
      notes: null,
      reminderMinutes: [],
      recurrence: null,
      sharingScope: 'inherit' as const,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    { date, start: '09:00', end: '10:00' },
    ZONE,
  );
}

function populated(): DayPopUserData {
  const data = baseData();
  data.events = [
    timed(data, '11111111-1111-4111-8111-111111111111', '晨會', '2026-08-16'),
    timed(data, '22222222-2222-4222-8222-222222222222', '夜班', '2026-08-17'),
  ];
  data.todos = [
    {
      id: '33333333-3333-4333-8333-333333333333',
      calendarId: data.calendars[0]!.id,
      parentId: null,
      title: '買菜',
      dueDate: '2026-08-16',
      priority: 'none',
      completedAt: null,
      sortOrder: 0,
      sharingScope: 'inherit',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  ];
  data.stickers = [
    {
      id: '44444444-4444-4444-8444-444444444444',
      calendarId: data.calendars[0]!.id,
      date: '2026-08-16',
      glyph: '🌸',
      assetKey: null,
      sortOrder: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  ];
  return data;
}

describe('JSON backup', () => {
  it('round-trips a populated document', () => {
    const source = populated();
    const text = serializeJsonBackup(buildJsonBackup(source, { now: '2026-08-16T00:00:00.000Z' }));

    const plan = planJsonImport(text, baseData());

    expect(plan.next.events).toEqual(source.events);
    expect(plan.next.todos).toEqual(source.todos);
    expect(plan.next.stickers).toEqual(source.stickers);
    expect(plan.next.calendars).toEqual(source.calendars);
    expect(plan.next.preferences).toEqual(source.preferences);
  });

  it('carries no attachment rows and says how many it dropped', () => {
    const source = populated();
    source.eventAttachments = [
      {
        id: '55555555-5555-4555-8555-555555555555',
        eventId: source.events[0]!.id,
        objectPath: 'private/user-a/secret.pdf',
        fileName: 'secret.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ];

    const text = serializeJsonBackup(buildJsonBackup(source));
    // The private Storage path must not be in a file the user hands around.
    expect(text).not.toContain('private/user-a');
    expect(text).not.toContain('eventAttachments');

    const plan = planJsonImport(text, baseData());
    expect(plan.next.eventAttachments).toEqual([]);
    expect(plan.preview.skippedAttachments).toBe(0);
  });

  it('counts an attachment array that a hand-edited file still carries', () => {
    const backup = buildJsonBackup(populated());
    const withAttachments = {
      ...backup,
      data: { ...backup.data, eventAttachments: [{ id: 'x' }, { id: 'y' }] },
    };

    const plan = planJsonImport(JSON.stringify(withAttachments), baseData());
    expect(plan.preview.skippedAttachments).toBe(2);
    expect(plan.next.eventAttachments).toEqual([]);
  });

  it('never lets an AI key ride along', () => {
    const backup = buildJsonBackup(populated());
    const poisoned = {
      ...backup,
      data: { ...backup.data, settings: { aiKey: 'sk-should-not-survive' } },
      aiKey: 'sk-should-not-survive',
    };

    const plan = planJsonImport(JSON.stringify(poisoned), baseData());
    expect(JSON.stringify(plan.next)).not.toContain('sk-should-not-survive');
  });

  it('reports what a replace would discard', () => {
    const current = populated();
    const text = serializeJsonBackup(buildJsonBackup(baseData()));

    const plan = planJsonImport(text, current);
    expect(plan.preview.mode).toBe('replace');
    expect(plan.preview.replacedTotal).toBe(documentRowCount(current));
    expect(plan.preview.replacedTotal).toBeGreaterThan(0);
  });

  it('names the file after the day it was taken', () => {
    expect(backupFileName('json', new Date(2026, 7, 6))).toBe('daypop-backup-2026-08-06.json');
    expect(backupFileName('ics', new Date(2026, 7, 6))).toBe('daypop-2026-08-06.ics');
  });
});

describe('JSON import refuses without touching anything', () => {
  const current = populated();

  /** Every rejection must throw, which is what leaves the document untouched. */
  function rejects(text: string, match: RegExp) {
    const before = JSON.stringify(current);
    expect(() => planJsonImport(text, current)).toThrow(DataTransferError);
    expect(() => planJsonImport(text, current)).toThrow(match);
    expect(JSON.stringify(current)).toBe(before);
  }

  it('rejects a truncated file', () => {
    const text = serializeJsonBackup(buildJsonBackup(populated())).slice(0, 80);
    rejects(text, /不是有效的 JSON/);
  });

  it('points a prototype backup at the legacy importer instead', () => {
    // The原檔's `dump()` has top-level events and settings.
    rejects(JSON.stringify({ events: [], todos: [], settings: { aiKey: 'x' } }), /舊版/);
  });

  it('refuses a file from a newer format version', () => {
    const backup = { ...buildJsonBackup(populated()), formatVersion: BACKUP_FORMAT_VERSION + 1 };
    rejects(JSON.stringify(backup), /較新版本/);
  });

  it('refuses a file whose rows are not valid canonical data', () => {
    const backup = buildJsonBackup(populated());
    const broken = {
      ...backup,
      data: { ...backup.data, events: [{ id: 'not-a-uuid', title: 5 }] },
    };
    rejects(JSON.stringify(broken), /不完整或格式有誤/);
  });

  it('refuses a file over the row limit', () => {
    const backup = buildJsonBackup(populated());
    const huge = {
      ...backup,
      data: { ...backup.data, events: new Array(10_001).fill({ id: 'x' }) },
    };
    rejects(JSON.stringify(huge), /超過單次匯入上限/);
  });

  it('rejects something that is not a backup at all', () => {
    rejects('[1,2,3]', /不是 DayPop 備份格式|內容不是/);
  });
});

describe('duplicate ids inside one backup file', () => {
  it('is refused rather than silently collapsed, because a canonical document cannot repeat an id', () => {
    const source = populated();
    // Two rows, one id — saving this as-is would lose one of them.
    source.events = [source.events[0]!, { ...source.events[1]!, id: source.events[0]!.id }];
    const current = populated();
    const before = JSON.stringify(current);

    expect(() => planJsonImport(JSON.stringify(buildJsonBackup(source)), current)).toThrow(
      /不完整或格式有誤/,
    );
    // Which is the point: a corrupt file changes nothing.
    expect(JSON.stringify(current)).toBe(before);
  });
});

describe('ICS import adds without touching what is there', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    'BEGIN:VEVENT',
    'UID:imported-1@example.com',
    'DTSTAMP:20260801T000000Z',
    'DTSTART:20260816T010000Z',
    'DTEND:20260816T020000Z',
    'SUMMARY:外部會議',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

  it('keeps every existing row and appends the new one', () => {
    const current = populated();
    const plan = planIcsImport(ics, current, { defaultTimezone: ZONE });

    expect(plan.preview.mode).toBe('append');
    expect(plan.preview.events).toBe(1);
    expect(plan.preview.replacedTotal).toBe(0);
    expect(plan.next.events).toHaveLength(current.events.length + 1);
    for (const event of current.events) {
      expect(plan.next.events).toContainEqual(event);
    }
    expect(plan.next.events.at(-1)?.title).toBe('外部會議');
  });

  it('round-trips DayPop events through the .ics it exports', () => {
    const source = populated();
    const exported = buildIcsExport(source);

    const plan = planIcsImport(exported, baseData(), { defaultTimezone: ZONE });

    expect(plan.preview.events).toBe(source.events.length);
    const titles = plan.next.events.map((event) => event.title).sort();
    expect(titles).toEqual(['夜班', '晨會']);
    // Same instants, even though the ids are re-minted by the importer.
    const instants = (events: CalendarEvent[]) =>
      events.flatMap((event) => (event.allDay ? [] : [event.startsAt])).sort();
    expect(instants(plan.next.events)).toEqual(instants(source.events));
  });

  it('renames an imported id that collides with an existing event', () => {
    const current = populated();
    const collidingId = current.events[0]!.id;
    const plan = planIcsImport(ics, current, {
      defaultTimezone: ZONE,
      idFactory: () => collidingId,
    });

    expect(plan.preview.remappedDuplicateIds).toBe(1);
    // The row that was already there keeps its id and its title.
    const kept = plan.next.events.find((event) => event.id === collidingId);
    expect(kept?.title).toBe('晨會');
    expect(plan.next.events).toHaveLength(current.events.length + 1);
  });

  it('refuses a file with no events, leaving the document alone', () => {
    const current = populated();
    const before = JSON.stringify(current);

    expect(() => planIcsImport('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', current, {
      defaultTimezone: ZONE,
    })).toThrow(/無法從此檔案辨識出行程/);
    expect(JSON.stringify(current)).toBe(before);
  });

  it('refuses a file that is not iCalendar at all', () => {
    expect(() => planIcsImport('just some text', populated(), { defaultTimezone: ZONE })).toThrow(
      DataTransferError,
    );
  });

  it('refuses when there is no calendar to put the events in', () => {
    const empty = baseData();
    empty.calendars = [];
    expect(() => planIcsImport(ics, empty, { defaultTimezone: ZONE })).toThrow(/先建立一個日曆/);
  });
});

describe('preview totals', () => {
  it('adds up the rows the user is about to get', () => {
    const plan = planJsonImport(serializeJsonBackup(buildJsonBackup(populated())), baseData());
    expect(previewTotal(plan.preview)).toBe(documentRowCount(populated()));
  });
});

describe('backup envelope', () => {
  it('is marked so a foreign file can be told apart', () => {
    const backup = buildJsonBackup(populated(), {
      now: '2026-08-16T01:02:03.000Z',
      appVersion: '0.3.0',
    });
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(backup.exportedAt).toBe('2026-08-16T01:02:03.000Z');
    expect(backup.appVersion).toBe('0.3.0');
  });
});
