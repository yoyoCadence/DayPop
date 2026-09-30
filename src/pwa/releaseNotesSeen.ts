import type { StorageLike } from '../storage/browserStorage';
import { isNewerVersion } from './version';

/**
 * Which release's notes this device has already shown — DP-090.
 *
 * Device-level UI state, deliberately outside `daypop.user-data`: it is not the
 * user's data, it is not synced, and losing it costs one extra announcement.
 * So every storage failure below degrades to "not seen" or "not recorded"
 * instead of throwing — the worst outcome is the notes appearing once more.
 */
export const RELEASE_NOTES_SEEN_KEY = 'daypop.release-notes-seen';

export function readSeenRelease(storage: StorageLike): string | null {
  try {
    const value = storage.getItem(RELEASE_NOTES_SEEN_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function recordSeenRelease(storage: StorageLike, version: string): void {
  try {
    storage.setItem(RELEASE_NOTES_SEEN_KEY, version);
  } catch {
    // Not persisted; the notes may show again next launch. Nothing else breaks.
  }
}

/**
 * Whether the running version's notes still need showing.
 *
 * "Newer than what was seen" rather than "different from": pressing 立即更新
 * records the *incoming* version before the reload, so if that reload lands on
 * the old build after all, its older notes must not pop up as if they were new.
 */
export function shouldShowReleaseNotes(current: string, seen: string | null): boolean {
  return seen === null || isNewerVersion(current, seen);
}
