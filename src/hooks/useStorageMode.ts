import { useSyncExternalStore } from 'react';
import { getStorageMode, subscribeStorageMode, type StorageMode } from '../storage/browserStorage';

/**
 * Whether this tab is still persisting data (DP-017).
 *
 * Subscribed rather than read once: storage can start out fine and refuse a
 * write later — a full quota is the common case — and the warning has to appear
 * at that moment, not only on the next reload.
 */
export function useStorageMode(): StorageMode {
  return useSyncExternalStore(subscribeStorageMode, getStorageMode, getStorageMode);
}
