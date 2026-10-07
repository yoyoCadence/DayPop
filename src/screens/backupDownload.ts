import { downloadTextFile } from '../browser/dataTransferFiles';
import { backupFileName, buildJsonBackup, serializeJsonBackup } from '../domain/dataTransfer';
import type { DayPopUserData } from '../domain/types';

/**
 * Starts the JSON backup download.
 *
 * The one definition of "export my data", shared by 設定 → 匯出資料 and the
 * screen error fallback (DP-143) so the two can never produce different files.
 *
 * Returns how many attachments the file leaves out: a backup never contains
 * them, and both callers have to say so. Throws whatever the serializer or
 * `downloadTextFile` throws; each caller reports that in its own place.
 */
export function downloadJsonBackup(data: DayPopUserData, appVersion: string): number {
  downloadTextFile(
    backupFileName('json'),
    serializeJsonBackup(buildJsonBackup(data, { appVersion })),
    'application/json;charset=utf-8',
  );
  return data.eventAttachments.length;
}
