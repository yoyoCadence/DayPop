import { downloadTextFile } from '../browser/dataTransferFiles';
import { backupFileName, buildJsonBackup, serializeJsonBackup } from '../domain/dataTransfer';
import type { DayPopUserData } from '../domain/types';
import { getAppStorage, type StorageLike } from '../storage/browserStorage';
import { recordLastBackup, summarizeBackup, type LastBackup } from './lastBackup';

/**
 * Starts the JSON backup download.
 *
 * The one definition of "export my data", shared by 設定 → 匯出資料 and the
 * screen error fallback (DP-143) so the two can never produce different files.
 * It is also the one place that records the export for 設定's 上次匯出
 * (DP-175), under `accountId` — `null` for the guest document — so a backup
 * from either place is counted and neither can forget to.
 *
 * Returns that record; its `omittedAttachments` is how many attachments the
 * file leaves out, which both callers have to say. Throws whatever the
 * serializer or `downloadTextFile` throws, without recording anything; each
 * caller reports that in its own place.
 */
export function downloadJsonBackup(
  data: DayPopUserData,
  appVersion: string,
  accountId: string | null,
  storage: StorageLike = getAppStorage(),
): LastBackup {
  const backup = buildJsonBackup(data, { appVersion });
  downloadTextFile(
    backupFileName('json'),
    serializeJsonBackup(backup),
    'application/json;charset=utf-8',
  );
  const record = summarizeBackup(data, backup.exportedAt);
  recordLastBackup(storage, accountId, record);
  return record;
}
