import { describe, expect, it } from 'vitest';
import {
  applyImportCommand,
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
  type ImportPlan,
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

/**
 * The document a confirmed plan produces — reached through the same call the
 * repositories make, so these assertions exercise the real commit path rather
 * than a snapshot the plan happened to carry.
 *
 * An `appendIcs` plan must be applied to the *same* document it was planned
 * against: `baseData()` mints a new calendar id each call, so the default is
 * only safe for `replace`, which does not read the current rows.
 */
function applied(plan: ImportPlan, current: DayPopUserData = baseData()): DayPopUserData {
  return applyImportCommand(current, plan.command);
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

    expect(applied(plan).events).toEqual(source.events);
    expect(applied(plan).todos).toEqual(source.todos);
    expect(applied(plan).stickers).toEqual(source.stickers);
    expect(applied(plan).calendars).toEqual(source.calendars);
    expect(applied(plan).preferences).toEqual(source.preferences);
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
    // Neither the private Storage path nor the file name may be in a file the
    // user hands around — only a count.
    expect(text).not.toContain('private/user-a');
    expect(text).not.toContain('secret.pdf');
    expect(text).not.toContain('objectPath');

    const plan = planJsonImport(text, baseData());
    expect(applied(plan).eventAttachments).toEqual([]);
    // A normal export has no attachment rows left to count, so the number has
    // to be carried explicitly or the person importing is never told.
    expect(plan.preview.skippedAttachments).toBe(1);
  });

  it('counts an attachment array that a hand-edited file still carries', () => {
    const backup = buildJsonBackup(populated());
    const withAttachments = {
      ...backup,
      data: { ...backup.data, eventAttachments: [{ id: 'x' }, { id: 'y' }] },
    };

    const plan = planJsonImport(JSON.stringify(withAttachments), baseData());
    expect(plan.preview.skippedAttachments).toBe(2);
    expect(applied(plan).eventAttachments).toEqual([]);
  });

  it('never lets an AI key ride along', () => {
    const backup = buildJsonBackup(populated());
    const poisoned = {
      ...backup,
      data: { ...backup.data, settings: { aiKey: 'sk-should-not-survive' } },
      aiKey: 'sk-should-not-survive',
    };

    const plan = planJsonImport(JSON.stringify(poisoned), baseData());
    expect(JSON.stringify(applied(plan))).not.toContain('sk-should-not-survive');
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

  it('accepts only the one format version that exists', () => {
    // There is no v0 and no fractional layout, so nothing can read one. The
    // accepted set widens when a migrator exists, not before.
    for (const formatVersion of [0, -1, 0.5, 1.5, '1', null]) {
      const backup = { ...buildJsonBackup(populated()), formatVersion };
      rejects(JSON.stringify(backup), /格式版本無法辨識|較新版本/);
    }
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
    expect(applied(plan, current).events).toHaveLength(current.events.length + 1);
    for (const event of current.events) {
      expect(applied(plan, current).events).toContainEqual(event);
    }
    expect(applied(plan, current).events.at(-1)?.title).toBe('外部會議');
  });

  it('round-trips DayPop events through the .ics it exports', () => {
    const source = populated();
    const exported = buildIcsExport(source);

    const current = baseData();
    const plan = planIcsImport(exported, current, { defaultTimezone: ZONE });

    expect(plan.preview.events).toBe(source.events.length);
    const titles = applied(plan, current).events.map((event) => event.title).sort();
    expect(titles).toEqual(['夜班', '晨會']);
    // Same instants, even though the ids are re-minted by the importer.
    const instants = (events: CalendarEvent[]) =>
      events.flatMap((event) => (event.allDay ? [] : [event.startsAt])).sort();
    expect(instants(applied(plan, current).events)).toEqual(instants(source.events));
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
    const kept = applied(plan, current).events.find((event) => event.id === collidingId);
    expect(kept?.title).toBe('晨會');
    expect(applied(plan, current).events).toHaveLength(current.events.length + 1);
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

  it('refuses a calendar id that is not in this document', () => {
    const current = populated();
    const before = JSON.stringify(current);
    // Otherwise every imported event points at a calendar that does not exist.
    expect(() =>
      planIcsImport(ics, current, {
        defaultTimezone: ZONE,
        calendarId: '99999999-9999-4999-8999-999999999999',
      }),
    ).toThrow(/選定的日曆不存在/);
    expect(JSON.stringify(current)).toBe(before);
  });

  it('moves a replacement exception with the event it points at', () => {
    // An .ics with RECURRENCE-ID produces an exception whose replacement is the
    // imported event. If the event is renamed on a collision but the pointer is
    // not, it lands on the user's own event instead.
    const recurring = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      'BEGIN:VEVENT',
      'UID:series-1@example.com',
      'DTSTAMP:20260801T000000Z',
      'DTSTART:20260816T010000Z',
      'DTEND:20260816T020000Z',
      'RRULE:FREQ=DAILY;COUNT=3',
      'SUMMARY:每日站會',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:series-1@example.com',
      'RECURRENCE-ID:20260817T010000Z',
      'DTSTAMP:20260801T000000Z',
      'DTSTART:20260817T030000Z',
      'DTEND:20260817T040000Z',
      'SUMMARY:改期的站會',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');

    // Sequential ids so the same import can be run twice and land identically.
    const sequential = () => {
      let n = 0;
      return () => `aaaaaaaa-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`;
    };

    // Pass 1: learn which generated id the replacement event gets.
    const dryCurrent = baseData();
    const dry = planIcsImport(recurring, dryCurrent, {
      defaultTimezone: ZONE,
      idFactory: sequential(),
    });
    const dryReplacement = applied(dry, dryCurrent).eventExceptions.find(
      (exception) => !exception.isCancelled,
    );
    expect(dryReplacement).toBeDefined();
    const replacementId = (dryReplacement as { replacementEventId: string }).replacementEventId;

    // Pass 2: the user already owns an event with exactly that id, so the
    // imported replacement must be renamed — and the pointer must follow it.
    const current = populated();
    current.events = [
      ...current.events,
      timed(current, replacementId, '使用者自己的行程', '2026-08-20'),
    ];
    const existingIds = new Set(current.events.map((event) => event.id));

    const plan = planIcsImport(recurring, current, {
      defaultTimezone: ZONE,
      idFactory: sequential(),
    });

    expect(plan.preview.remappedDuplicateIds).toBeGreaterThan(0);

    // Applied once and reused: a rename mints a fresh id, so two applications of
    // the same command do not agree on it — which is fine, since a commit
    // applies it exactly once.
    const next = applied(plan, current);
    const replacements = next.eventExceptions.filter((exception) => !exception.isCancelled);
    expect(replacements.length).toBeGreaterThan(0);
    for (const exception of replacements) {
      // Never the user's own event, which is what a stale pointer would hit.
      expect(existingIds.has(exception.replacementEventId)).toBe(false);
      expect(next.events.some((event) => event.id === exception.replacementEventId)).toBe(true);
    }
    // The user's row is untouched.
    expect(next.events.find((event) => event.id === replacementId)?.title).toBe('使用者自己的行程');
  });
});

describe('replace fails closed when the account still has attachments', () => {
  function withAttachment(): DayPopUserData {
    const data = populated();
    data.eventAttachments = [
      {
        id: '55555555-5555-4555-8555-555555555555',
        eventId: data.events[0]!.id,
        objectPath: `77777777-7777-4777-8777-777777777777/${data.events[0]!.id}/55555555-5555-4555-8555-555555555555`,
        fileName: 'file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ];
    return data;
  }

  it('refuses rather than orphaning or deleting them', () => {
    // A backup carries no attachments, so replacing would either strand the
    // rows or destroy files the user never agreed to lose.
    const current = withAttachment();
    const plan = planJsonImport(serializeJsonBackup(buildJsonBackup(baseData())), current);

    expect(() => applyImportCommand(current, plan.command)).toThrow(DataTransferError);
    expect(() => applyImportCommand(current, plan.command)).toThrow(/附件/);
    expect(current.eventAttachments).toHaveLength(1);
  });

  it('still allows an .ics append, which does not touch attachments', () => {
    const current = withAttachment();
    const plan = planIcsImport(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//test//EN',
        'BEGIN:VEVENT',
        'UID:appended@example.com',
        'DTSTAMP:20260801T000000Z',
        'DTSTART:20260816T010000Z',
        'DTEND:20260816T020000Z',
        'SUMMARY:外部會議',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
      current,
      { defaultTimezone: ZONE },
    );

    const next = applyImportCommand(current, plan.command);
    expect(next.eventAttachments).toEqual(current.eventAttachments);
    expect(next.events).toHaveLength(current.events.length + 1);
  });
});

describe('a command applies to the data as it is at commit time', () => {
  it('appends onto rows added after the plan was made', () => {
    const atPlanTime = populated();
    const plan = planIcsImport(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//test//EN',
        'BEGIN:VEVENT',
        'UID:appended@example.com',
        'DTSTAMP:20260801T000000Z',
        'DTSTART:20260816T010000Z',
        'DTEND:20260816T020000Z',
        'SUMMARY:外部會議',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
      atPlanTime,
      { defaultTimezone: ZONE },
    );

    // The user adds something between seeing the preview and confirming.
    const atCommitTime: DayPopUserData = {
      ...atPlanTime,
      events: [
        ...atPlanTime.events,
        timed(atPlanTime, '66666666-6666-4666-8666-666666666666', '確認前才加的', '2026-08-18'),
      ],
    };

    const next = applyImportCommand(atCommitTime, plan.command);

    // Writing back a document assembled at plan time would have dropped this.
    expect(next.events.some((event) => event.title === '確認前才加的')).toBe(true);
    expect(next.events.some((event) => event.title === '外部會議')).toBe(true);
    expect(next.events).toHaveLength(atCommitTime.events.length + 1);
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
