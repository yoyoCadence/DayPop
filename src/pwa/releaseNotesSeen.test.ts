import { describe, expect, it } from 'vitest';
import { MemoryStorage, type StorageLike } from '../storage/browserStorage';
import {
  RELEASE_NOTES_SEEN_KEY,
  readSeenRelease,
  recordSeenRelease,
  shouldShowReleaseNotes,
} from './releaseNotesSeen';

/** A storage that refuses everything, as Safari private mode or a full quota can. */
const brokenStorage: StorageLike = {
  get length() {
    return 0;
  },
  key: () => null,
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};

describe('release notes seen record', () => {
  it('round-trips the version through storage', () => {
    const storage = new MemoryStorage();
    expect(readSeenRelease(storage)).toBeNull();
    recordSeenRelease(storage, '0.4.1');
    expect(storage.getItem(RELEASE_NOTES_SEEN_KEY)).toBe('0.4.1');
    expect(readSeenRelease(storage)).toBe('0.4.1');
  });

  it('treats a blank value as never seen', () => {
    const storage = new MemoryStorage();
    storage.setItem(RELEASE_NOTES_SEEN_KEY, '  ');
    expect(readSeenRelease(storage)).toBeNull();
  });

  it('degrades to "not seen" and "not recorded" instead of throwing', () => {
    expect(readSeenRelease(brokenStorage)).toBeNull();
    expect(() => recordSeenRelease(brokenStorage, '0.4.1')).not.toThrow();
  });
});

describe('shouldShowReleaseNotes', () => {
  it('shows a version this device has never shown', () => {
    expect(shouldShowReleaseNotes('0.4.1', null)).toBe(true);
  });

  it('shows a version newer than the last one shown', () => {
    expect(shouldShowReleaseNotes('0.4.1', '0.4.0')).toBe(true);
  });

  it('does not repeat the version already shown', () => {
    expect(shouldShowReleaseNotes('0.4.1', '0.4.1')).toBe(false);
  });

  it('does not announce an older build than the one already shown', () => {
    // 立即更新 records the incoming version before reloading; if the reload
    // lands on the old build anyway, its notes are not news.
    expect(shouldShowReleaseNotes('0.4.0', '0.4.1')).toBe(false);
  });
});
