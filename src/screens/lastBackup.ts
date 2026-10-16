import type { DayPopUserData } from '../domain/types';
import { isIsoInstant } from '../domain/validation';
import type { StorageLike } from '../storage/browserStorage';

/**
 * When this device last exported a JSON backup, and what that file held — DP-175.
 *
 * Device-level UI state, like `daypop.release-notes-seen` (DP-090): it is not
 * the user's data, it is not synced and it is never in a backup. Losing it —
 * another device, cleared site data, memory mode — only makes 設定 say no backup
 * was made yet, so every storage failure below degrades instead of throwing.
 *
 * Kept per data identity: the guest document and each account have their own
 * key, the same split as `daypop.account-cache.<id>`. A guest backup is not a
 * backup of the account someone signs into afterwards, and showing its time
 * there would say the account is covered when it is not.
 *
 * Only the time and row counts are stored, never a title or anything else a
 * row holds. The time is when the file was handed to the browser: a save sheet
 * the person then cancels still counts, which the page cannot observe.
 */
export const LAST_BACKUP_PREFIX = 'daypop.last-backup.';

export interface LastBackup {
  /** The file's own `exportedAt`. */
  exportedAt: string;
  calendars: number;
  events: number;
  todos: number;
  stickers: number;
  /** Attachments the file leaves out; a backup never contains them. */
  omittedAttachments: number;
}

const COUNT_FIELDS = ['calendars', 'events', 'todos', 'stickers', 'omittedAttachments'] as const;

export function lastBackupKey(accountId: string | null): string {
  return accountId === null
    ? `${LAST_BACKUP_PREFIX}guest`
    : `${LAST_BACKUP_PREFIX}account.${encodeURIComponent(accountId)}`;
}

export function summarizeBackup(data: DayPopUserData, exportedAt: string): LastBackup {
  return {
    exportedAt,
    calendars: data.calendars.length,
    events: data.events.length,
    todos: data.todos.length,
    stickers: data.stickers.length,
    omittedAttachments: data.eventAttachments.length,
  };
}

export function readLastBackup(storage: StorageLike, accountId: string | null): LastBackup | null {
  let raw: string | null;
  try {
    raw = storage.getItem(lastBackupKey(accountId));
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (!isIsoInstant(value.exportedAt)) return null;
  for (const field of COUNT_FIELDS) {
    const count = value[field];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null;
  }
  // Rebuilt field by field, so nothing else in the stored value reaches the page.
  return {
    exportedAt: value.exportedAt,
    calendars: value.calendars as number,
    events: value.events as number,
    todos: value.todos as number,
    stickers: value.stickers as number,
    omittedAttachments: value.omittedAttachments as number,
  };
}

export function recordLastBackup(
  storage: StorageLike,
  accountId: string | null,
  record: LastBackup,
): void {
  try {
    storage.setItem(lastBackupKey(accountId), JSON.stringify(record));
  } catch {
    // Not persisted; 設定 shows the export for this visit only. Nothing else breaks.
  }
}

/**
 * `2026/10/16 14:05` in the display timezone, the one source for which day
 * something happened (DP-064).
 *
 * Assembled from parts: `format()` puts whatever separator the engine's ICU
 * chooses between date and time (Node's is a thin space), so the text would
 * differ between browsers.
 */
export function formatBackupTime(exportedAt: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(exportedAt));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
}

export function backupCoverage(record: LastBackup): string {
  const rows = `含 ${record.calendars} 個日曆、${record.events} 筆行程、${record.todos} 筆待辦、${record.stickers} 張貼圖與設定`;
  return record.omittedAttachments > 0
    ? `${rows}；${record.omittedAttachments} 個附件不在備份內。`
    : `${rows}；不含附件。`;
}
