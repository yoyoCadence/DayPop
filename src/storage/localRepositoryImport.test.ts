import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyImportCommand,
  planIcsImport,
  planJsonImport,
  buildJsonBackup,
  serializeJsonBackup,
  type ImportCommand,
} from '../domain/dataTransfer';
import { createEmptyUserData, type DayPopUserData } from '../domain/types';
import { MemoryStorage } from './browserStorage';
import { LocalDayPopRepository, LocalDataBlockedError } from './localRepository';
import { readUserData, USER_DATA_STORAGE_KEY, writeUserData } from './versionedStorage';

/**
 * DP-056 — the guest half of the import contract.
 *
 * The rules being checked come from the owner's decision: the command is
 * applied to the data as it is at commit time, the whole document is validated,
 * exactly one envelope write happens, the existing write barrier still refuses
 * unreadable bytes, and a failure leaves the stored data byte-identical.
 */

const ZONE = 'Asia/Taipei';

let storage: MemoryStorage;
let repository: LocalDayPopRepository;

/** Counts how many times anything is written under the user-data key. */
class CountingStorage extends MemoryStorage {
  writes = 0;
  override setItem(key: string, value: string): void {
    if (key === USER_DATA_STORAGE_KEY) this.writes += 1;
    super.setItem(key, value);
  }
}

beforeEach(async () => {
  storage = new MemoryStorage();
  repository = new LocalDayPopRepository(storage);
  await repository.load();
});

function stored(): DayPopUserData {
  const result = readUserData(storage);
  if (result.status !== 'ready') throw new Error('expected readable data');
  return result.envelope.data;
}

function backupOf(data: DayPopUserData): string {
  return serializeJsonBackup(buildJsonBackup(data));
}

const ICS = [
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

describe('guest importData', () => {
  it('replaces the document from a backup', async () => {
    const source = createEmptyUserData();
    source.preferences.timezone = ZONE;
    const plan = planJsonImport(backupOf(source), stored());

    const result = await repository.importData(plan.command);

    expect(result.preferences.timezone).toBe(ZONE);
    expect(stored().preferences.timezone).toBe(ZONE);
  });

  it('appends an .ics onto the rows that exist at commit time, not at plan time', async () => {
    const atPlanTime = stored();
    const plan = planIcsImport(ICS, atPlanTime, { defaultTimezone: atPlanTime.preferences.timezone });

    // The user adds something between seeing the preview and confirming.
    await repository.addEvent({
      title: '確認前才加的',
      allDay: false,
      date: '2026-08-18',
      start: '09:00',
      end: '10:00',
    });

    const result = await repository.importData(plan.command);

    // Writing back a document assembled at plan time would have dropped this.
    expect(result.events.some((event) => event.title === '確認前才加的')).toBe(true);
    expect(result.events.some((event) => event.title === '外部會議')).toBe(true);
  });

  it('writes the envelope exactly once', async () => {
    const counting = new CountingStorage();
    const repo = new LocalDayPopRepository(counting);
    // Planned against this repo's own document: a fresh one mints its own
    // calendar id, and an append has to name a calendar that exists here.
    const current = await repo.load();
    const plan = planIcsImport(ICS, current, { defaultTimezone: ZONE });
    // `load()` creates the envelope on first read, so count from here.
    counting.writes = 0;

    await repo.importData(plan.command);

    expect(counting.writes).toBe(1);
  });

  it('refuses when the stored bytes are unreadable, and leaves them alone', async () => {
    const plan = planIcsImport(ICS, stored(), { defaultTimezone: ZONE });
    storage.setItem(USER_DATA_STORAGE_KEY, '{ not json');

    await expect(repository.importData(plan.command)).rejects.toBeInstanceOf(LocalDataBlockedError);
    // The unreadable bytes are still there rather than replaced by an import.
    expect(storage.getItem(USER_DATA_STORAGE_KEY)).toBe('{ not json');
  });

  it('leaves the document byte-identical when the command cannot be applied', async () => {
    // An account with an attachment refuses a replace (DP-056 fail closed).
    const withAttachment = stored();
    const eventId = '77777777-7777-4777-8777-777777777777';
    withAttachment.events = [
      {
        id: eventId,
        calendarId: withAttachment.calendars[0]!.id,
        title: '有附件的行程',
        allDay: false,
        startsAt: '2026-08-16T01:00:00.000Z',
        endsAt: '2026-08-16T02:00:00.000Z',
        timezone: ZONE,
        location: null,
        notes: null,
        reminderMinutes: [],
        recurrence: null,
        sharingScope: 'inherit',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ];
    withAttachment.eventAttachments = [
      {
        id: '88888888-8888-4888-8888-888888888888',
        eventId,
        objectPath: `99999999-9999-4999-8999-999999999999/${eventId}/88888888-8888-4888-8888-888888888888`,
        fileName: 'note.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ];
    writeUserData(withAttachment, readUserData(storage).status === 'ready' ? 1 : 0, storage);
    const before = storage.getItem(USER_DATA_STORAGE_KEY);

    const command: ImportCommand = planJsonImport(
      backupOf(createEmptyUserData()),
      stored(),
    ).command;

    await expect(repository.importData(command)).rejects.toThrow(/附件/);
    expect(storage.getItem(USER_DATA_STORAGE_KEY)).toBe(before);
  });

  it('rejects a command that would produce an invalid document', async () => {
    const before = storage.getItem(USER_DATA_STORAGE_KEY);
    const broken = {
      kind: 'appendIcs',
      events: [{ id: 'not-a-uuid' }],
      eventExceptions: [],
    } as unknown as ImportCommand;

    await expect(repository.importData(broken)).rejects.toThrow();
    expect(storage.getItem(USER_DATA_STORAGE_KEY)).toBe(before);
  });

  it('applies the same command the domain layer would', async () => {
    const current = stored();
    const plan = planIcsImport(ICS, current, { defaultTimezone: ZONE });

    const viaRepository = await repository.importData(plan.command);
    const viaDomain = applyImportCommand(current, plan.command);

    expect(viaRepository.events.map((event) => event.title).sort()).toEqual(
      viaDomain.events.map((event) => event.title).sort(),
    );
  });
});
