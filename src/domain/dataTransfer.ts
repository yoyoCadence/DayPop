import { exportCalendarToIcs, importCalendarFromIcs, IcsFormatError } from './ics';
import { createDomainId, type CalendarEvent, type DayPopUserData, type EventException } from './types';
import { parseDayPopUserData } from './validation';

/**
 * 資料匯入匯出 — DP-056.
 *
 * Pure: this module never touches the file system, `Blob`, `FileReader` or the
 * repository. It turns a document into bytes and bytes into a *plan*, and the
 * screen owns picking files and asking the user to confirm.
 *
 * That split is the point of the task's 「匯入成功前不得覆寫既有資料」. The
 *原檔's `onImportFile()` parsed and called `commit()` in the same breath inside a
 * bare `try/catch`, so a truncated or foreign file replaced the user's calendar
 * with whatever happened to parse. Here nothing is written until the caller
 * applies `ImportPlan.next`, and an unusable file throws before a plan exists.
 *
 * Two deliberate departures from the原檔, both required by the task rather than
 * chosen here (recorded in `docs/prototype-behavior-baseline.md`):
 *
 * - **JSON import previews too.** The原檔 previewed `.ics` only and replaced
 *   everything on a JSON import with no confirmation.
 * - **No AI key travels.** The原檔 restored `settings.aiKey` from the file.
 *   DayPop's canonical document has no such field, and this module builds its
 *   output from parsed canonical values rather than copying the input, so an
 *   unknown field cannot ride along even if the file carries one.
 *
 * Attachments are **not** in a backup: the file only holds a private Storage
 * `objectPath`, which is useless outside the account that owns it and is not
 * something to hand around in a file. They are counted in the preview so the
 * user is told rather than left to notice.
 */

export const BACKUP_FORMAT = 'daypop.backup';
/** Bumped only when the file layout changes in a way an older App cannot read. */
export const BACKUP_FORMAT_VERSION = 1;

/** Fail closed on absurd input rather than building a giant plan — as DP-025 does. */
const LIMITS = {
  calendars: 100,
  events: 10_000,
  eventExceptions: 50_000,
  todos: 20_000,
  stickers: 10_000,
} as const;

/** What a backup file contains. `eventAttachments` is deliberately absent. */
export interface DayPopBackup {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: string;
  appVersion: string;
  /**
   * What the export left out, as counts only — never a path, a file name or a
   * URL. Without this a normal backup could not tell the person importing it
   * that anything was missing: the rows are gone from `data`, so there is
   * nothing left to count on the way back in.
   */
  omitted: { eventAttachments: number };
  data: Omit<DayPopUserData, 'eventAttachments'>;
}

export class DataTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataTransferError';
  }
}

/** JSON replaces the document, `.ics` adds to it — both as in the原檔. */
export type ImportMode = 'replace' | 'append';

export interface ImportPreview {
  mode: ImportMode;
  calendars: number;
  events: number;
  eventExceptions: number;
  todos: number;
  stickers: number;
  /** Ids that collided and were given new ones rather than overwriting. */
  remappedDuplicateIds: number;
  /** Attachment rows found in the file and dropped; see the module comment. */
  skippedAttachments: number;
  /**
   * Rows the user currently has that a `replace` would discard; `0` for
   * `append`. A destructive action should say what it costs, not only what it
   * brings.
   */
  replacedTotal: number;
}

export interface ImportPlan {
  preview: ImportPreview;
  /** The document to save when the user confirms. Nothing is written before that. */
  next: DayPopUserData;
}

export interface BuildBackupOptions {
  now?: string;
  appVersion?: string;
}

export function buildJsonBackup(
  data: DayPopUserData,
  options: BuildBackupOptions = {},
): DayPopBackup {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: options.now ?? new Date().toISOString(),
    appVersion: options.appVersion ?? 'unknown',
    omitted: { eventAttachments: data.eventAttachments.length },
    // Listed field by field rather than spread-minus-attachments: this object
    // leaves the device, so what travels should be an allowlist. A field added
    // to `DayPopUserData` later then fails to compile here — which is the moment
    // to decide whether it belongs in a file at all — instead of shipping
    // silently.
    data: {
      calendars: data.calendars,
      events: data.events,
      eventExceptions: data.eventExceptions,
      todos: data.todos,
      stickers: data.stickers,
      preferences: data.preferences,
    },
  };
}

/** Pretty-printed, as in the原檔 — a backup is something people open and read. */
export function serializeJsonBackup(backup: DayPopBackup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function buildIcsExport(data: DayPopUserData): string {
  return exportCalendarToIcs({ events: data.events, eventExceptions: data.eventExceptions });
}

/** `daypop-backup-2026-08-16.json` / `daypop-2026-08-16.ics`, following the原檔's shape. */
export function backupFileName(kind: 'json' | 'ics', now: Date = new Date()): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return kind === 'json' ? `daypop-backup-${date}.json` : `daypop-${date}.ics`;
}

/**
 * Reads a DayPop backup and plans a full replacement.
 *
 * A file from the old prototype is *not* accepted here: it has a different
 * shape, and importing it is DP-025's one-time legacy path, which knows how to
 * remap its ids and exclude its AI key. Saying so is more useful than a generic
 * validation error.
 */
export function planJsonImport(text: string, current: DayPopUserData): ImportPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DataTransferError('這個檔案不是有效的 JSON，請確認選到的是 DayPop 匯出的備份檔。');
  }

  if (!isRecord(parsed)) {
    throw new DataTransferError('這個檔案的內容不是 DayPop 備份格式。');
  }
  if (parsed.format !== BACKUP_FORMAT) {
    // The prototype's dump has top-level `events`, so name the right door.
    const looksLegacy = Array.isArray(parsed.events) || isRecord(parsed.settings);
    throw new DataTransferError(
      looksLegacy
        ? '這看起來是舊版「日曆桌寵」的備份檔。舊資料請用登入後的一次性匯入，不要走這裡。'
        : '這個檔案不是 DayPop 備份格式（缺少 format 標記）。',
    );
  }
  // Exactly 1, not "at most 1": there is no v0 and no fractional format, so
  // nothing exists that could read one. The accepted set widens only when a
  // migrator for an older layout actually exists.
  if (parsed.formatVersion !== BACKUP_FORMAT_VERSION) {
    const newer =
      typeof parsed.formatVersion === 'number' && parsed.formatVersion > BACKUP_FORMAT_VERSION;
    throw new DataTransferError(
      newer
        ? '這個備份檔來自較新版本的 DayPop，請先更新 App 再匯入，以免讀錯資料。'
        : '這個備份檔的格式版本無法辨識，沒有匯入任何資料。',
    );
  }

  const body = parsed.data;
  if (!isRecord(body)) throw new DataTransferError('這個備份檔沒有可讀取的資料內容。');

  // Two sources: the count a normal export records, and a raw array a
  // hand-edited file might still carry. Neither is trusted for anything but a
  // number shown to the user.
  const omitted = isRecord(parsed.omitted) ? parsed.omitted.eventAttachments : undefined;
  const skippedAttachments =
    (typeof omitted === 'number' && Number.isInteger(omitted) && omitted >= 0 ? omitted : 0) +
    countArray(body.eventAttachments);
  assertWithinLimits(body);

  // Validated as a whole canonical document, so a file that is internally
  // inconsistent is rejected before anything is planned. Attachments are
  // emptied rather than parsed: they are not carried in a backup.
  let next: DayPopUserData;
  try {
    next = parseDayPopUserData({ ...body, eventAttachments: [] });
  } catch (cause) {
    throw new DataTransferError(
      `這個備份檔的內容不完整或格式有誤，沒有匯入任何資料。（${
        cause instanceof Error ? cause.message : '未知原因'
      }）`,
    );
  }

  return {
    preview: {
      mode: 'replace',
      calendars: next.calendars.length,
      events: next.events.length,
      eventExceptions: next.eventExceptions.length,
      todos: next.todos.length,
      stickers: next.stickers.length,
      // A canonical document may not repeat an id, and `parseDayPopUserData()`
      // enforces that above — so a *replace* never has anything to remap. The
      // duplicates worth handling are the ones between an imported file and the
      // rows already on the device, which only the append path can produce.
      remappedDuplicateIds: 0,
      skippedAttachments,
      replacedTotal: documentRowCount(current),
    },
    next,
  };
}

export interface IcsImportOptions {
  /** Which calendar the imported events join; defaults to the first one. */
  calendarId?: string;
  /** Used for floating times; the display timezone, as everywhere else. */
  defaultTimezone: string;
  now?: string;
  idFactory?: () => string;
}

/**
 * Reads an iCalendar file and plans an **addition**, as the原檔 does
 * (`confirmImport()` concatenates). Nothing existing is touched, so a `.ics`
 * import can never lose data — only add to it.
 */
export function planIcsImport(
  text: string,
  current: DayPopUserData,
  options: IcsImportOptions,
): ImportPlan {
  const calendarId = options.calendarId ?? current.calendars[0]?.id;
  if (!calendarId) {
    throw new DataTransferError('目前沒有任何日曆可以放這些行程，請先建立一個日曆。');
  }
  // A caller-supplied id that is not one of this document's calendars would
  // leave every imported event pointing at nothing.
  if (!current.calendars.some((calendar) => calendar.id === calendarId)) {
    throw new DataTransferError('選定的日曆不存在，沒有匯入任何資料。');
  }

  let imported: { events: CalendarEvent[]; eventExceptions: EventException[] };
  try {
    imported = importCalendarFromIcs(text, {
      calendarId,
      defaultTimezone: options.defaultTimezone,
      now: options.now,
      idFactory: options.idFactory,
    });
  } catch (cause) {
    if (cause instanceof IcsFormatError) {
      throw new DataTransferError(
        `無法從這個檔案讀出行程，沒有匯入任何資料。（${cause.message}）`,
      );
    }
    throw cause;
  }

  if (imported.events.length === 0) {
    // The原檔 says exactly this in its preview sheet when nothing parses.
    throw new DataTransferError('無法從此檔案辨識出行程。請確認是有效的 .ics（iCalendar）匯出檔。');
  }

  const renamed = renameIncomingCollisions(imported, current);

  const next: DayPopUserData = {
    ...current,
    events: [...current.events, ...renamed.events],
    eventExceptions: [...current.eventExceptions, ...renamed.eventExceptions],
  };

  // The assembled document, not just the imported slice: a plan that cannot be
  // saved must not reach the confirm button. This is what catches a dangling
  // reference the renaming above could still have produced.
  try {
    parseDayPopUserData(next);
  } catch (cause) {
    throw new DataTransferError(
      `匯入後的資料無法通過驗證，沒有匯入任何資料。（${
        cause instanceof Error ? cause.message : '未知原因'
      }）`,
    );
  }

  return {
    preview: {
      mode: 'append',
      calendars: 0,
      events: imported.events.length,
      eventExceptions: imported.eventExceptions.length,
      todos: 0,
      stickers: 0,
      remappedDuplicateIds: renamed.remapped,
      skippedAttachments: 0,
      replacedTotal: 0,
    },
    next,
  };
}

/** Rows a document holds, for the 「會取代目前的 N 筆」 line. */
export function documentRowCount(data: DayPopUserData): number {
  return (
    data.calendars.length +
    data.events.length +
    data.eventExceptions.length +
    data.todos.length +
    data.stickers.length
  );
}

/** Total rows a preview describes, for the 「共 N 筆」 line. */
export function previewTotal(preview: ImportPreview): number {
  return (
    preview.calendars +
    preview.events +
    preview.eventExceptions +
    preview.todos +
    preview.stickers
  );
}

/**
 * Gives a fresh id to an **incoming** row whose id is already on the device,
 * and rewrites the exceptions that point at it.
 *
 * Only the incoming rows are ever renamed. An earlier version matched by id
 * value instead of by which side the row came from, which renamed the *existing*
 * row on a collision — the one case where the user's own data must not move.
 *
 * Colliding rows are renamed rather than dropped or merged: dropping loses the
 * imported row, and merging would silently overwrite an existing one with a
 * different event that merely shares a UID.
 */
function renameIncomingCollisions(
  imported: { events: CalendarEvent[]; eventExceptions: EventException[] },
  current: DayPopUserData,
): { events: CalendarEvent[]; eventExceptions: EventException[]; remapped: number } {
  const taken = new Set<string>([
    ...current.events.map((event) => event.id),
    ...current.eventExceptions.map((exception) => exception.id),
  ]);
  const eventIdMap = new Map<string, string>();
  let remapped = 0;

  const claim = (id: string): string => {
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
    let replacement = createDomainId();
    while (taken.has(replacement)) replacement = createDomainId();
    taken.add(replacement);
    remapped += 1;
    return replacement;
  };

  const events = imported.events.map((event) => {
    const id = claim(event.id);
    if (id !== event.id) eventIdMap.set(event.id, id);
    return id === event.id ? event : { ...event, id };
  });

  const eventExceptions = imported.eventExceptions.map((exception) => {
    const id = claim(exception.id);
    const eventId = eventIdMap.get(exception.eventId) ?? exception.eventId;
    // `replacementEventId` has to follow the rename as well. Leaving it alone
    // was the worse half of the same bug: the imported event moves to a new id
    // while its exception keeps pointing at the old one — which is now the
    // user's own event, so their row would be shown in place of an occurrence
    // it has nothing to do with.
    // `replacementEventId` has to follow the rename as well. Leaving it alone
    // was the worse half of the same bug: the imported event moves to a new id
    // while its exception keeps pointing at the old one — which is now the
    // user's own event, so their row would be shown in place of an occurrence
    // it has nothing to do with.
    if (!exception.isCancelled) {
      const replacementEventId =
        eventIdMap.get(exception.replacementEventId) ?? exception.replacementEventId;
      return id === exception.id &&
        eventId === exception.eventId &&
        replacementEventId === exception.replacementEventId
        ? exception
        : { ...exception, id, eventId, replacementEventId };
    }
    return id === exception.id && eventId === exception.eventId
      ? exception
      : { ...exception, id, eventId };
  });

  return { events, eventExceptions, remapped };
}

function assertWithinLimits(body: Record<string, unknown>): void {
  for (const [key, limit] of Object.entries(LIMITS)) {
    const length = countArray(body[key]);
    if (length > limit) {
      throw new DataTransferError(
        `這個備份檔的 ${key} 有 ${length} 筆，超過單次匯入上限 ${limit} 筆，沒有匯入任何資料。`,
      );
    }
  }
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
