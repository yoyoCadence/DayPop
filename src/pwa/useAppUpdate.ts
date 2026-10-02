import { useCallback, useEffect, useRef, useState } from 'react';
import { getAppStorage, type StorageLike } from '../storage/browserStorage';
import { readSeenRelease, recordSeenRelease, shouldShowReleaseNotes } from './releaseNotesSeen';
import { isNewerVersion, type ReleaseInfo } from './version';

/** What a manual 檢查更新 found when it did not find an update — DP-090. */
export type UpdateCheckResult =
  | { kind: 'latest'; release: ReleaseInfo | null }
  | { kind: 'failed'; message: string };

export interface AppUpdateState {
  currentVersion: string;
  currentRelease: ReleaseInfo | null;
  availableRelease: ReleaseInfo | null;
  /**
   * The running version's notes, until this device has shown them once — DP-090.
   *
   * Without this nobody saw release notes at all: the service worker serves
   * navigations network-first, so relaunching the app already runs the new
   * build, and a version check then finds nothing newer to announce.
   */
  whatsNew: ReleaseInfo | null;
  /** Outcome of the last manual check, when it found no update — DP-090. */
  checkResult: UpdateCheckResult | null;
  checking: boolean;
  preparing: boolean;
  error: string | null;
  /** Update-attempt feedback belongs in the open update dialog, not the check result. */
  updateError: string | null;
  /** The manual 檢查更新: never throttled, always ends in visible feedback. */
  checkForUpdate: () => Promise<void>;
  updateNow: () => Promise<void>;
  dismissUpdate: () => void;
  acknowledgeWhatsNew: () => void;
  clearCheckResult: () => void;
}

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Floor between checks that nothing asked for — DP-035.
 *
 * `visibilitychange` and `online` fire far more often than a release ships. On a
 * phone, every switch away and back is one more `version.json` request, and a
 * flaky connection can produce a burst of `online` events; the 30-minute timer
 * below already guarantees the app notices a release on its own.
 *
 * The window is measured from the moment a check *starts*, which also means a
 * second trigger arriving while one is still in flight is skipped rather than
 * duplicating the request. A failed attempt starts the window too: coming back
 * online right after a failure therefore waits, which is the deliberate trade —
 * being up to five minutes late to an update beats hammering an endpoint that is
 * failing while the tab flaps. 手動「檢查更新」 is never throttled, so the user
 * always has an immediate way out.
 */
const AUTO_CHECK_MIN_INTERVAL_MS = 5 * 60 * 1000;

export function useAppUpdate(storage: StorageLike = getAppStorage()): AppUpdateState {
  const [currentRelease, setCurrentRelease] = useState<ReleaseInfo | null>(null);
  const [availableRelease, setAvailableRelease] = useState<ReleaseInfo | null>(null);
  const [seenRelease, setSeenRelease] = useState(() => readSeenRelease(storage));
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const applyWhenReadyRef = useRef(false);
  const reloadOnControllerChangeRef = useRef(false);
  const dismissedVersionRef = useRef<string | null>(null);
  /** When the last check of any kind began; `null` until the first one — DP-035. */
  const lastCheckStartedAtRef = useRef<number | null>(null);

  const failUpdate = useCallback((message: string) => {
    applyWhenReadyRef.current = false;
    reloadOnControllerChangeRef.current = false;
    waitingWorkerRef.current = null;
    setPreparing(false);
    setUpdateError(message);
  }, []);

  const captureWorker = useCallback((registration: ServiceWorkerRegistration) => {
    registrationRef.current = registration;
    if (registration.waiting) waitingWorkerRef.current = registration.waiting;

    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      let previousState = worker.state;
      worker.addEventListener('statechange', () => {
        const failedInstall = previousState === 'installing' && worker.state === 'redundant';
        previousState = worker.state;
        // An old activated worker also becomes redundant during a successful
        // update. Only installation failure should cancel this page's intent.
        if (failedInstall && applyWhenReadyRef.current) {
          failUpdate('新版安裝未完成。請確認網路連線或裝置儲存空間後再試一次；你的行程與設定不受影響。');
          return;
        }
        if (worker.state !== 'installed' || !navigator.serviceWorker.controller) return;
        waitingWorkerRef.current = registration.waiting ?? worker;
        if (applyWhenReadyRef.current) {
          reloadOnControllerChangeRef.current = true;
          try {
            waitingWorkerRef.current.postMessage({ type: 'SKIP_WAITING' });
          } catch {
            failUpdate('暫時無法啟用新版。請稍後再試一次；你的行程與設定不受影響。');
          }
        }
      });
    });
  }, [failUpdate]);

  /**
   * One version check. Automatic checks stay silent unless there is an update;
   * a manual one always ends in feedback — the update dialog, or a result — and
   * re-offers a release the user earlier put off with 稍後提醒, since pressing
   * the button is asking for exactly that (DP-090).
   */
  const runCheck = useCallback(async (manual: boolean) => {
    // Recorded for every trigger, manual included: a check the user just asked
    // for makes an automatic one moments later redundant.
    lastCheckStartedAtRef.current = Date.now();
    setChecking(true);
    setError(null);
    if (manual) setCheckResult(null);
    try {
      const versionUrl = `${import.meta.env.BASE_URL}version.json?ts=${Date.now()}`;
      const response = await fetch(versionUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const release = (await response.json()) as ReleaseInfo;

      if (release.version === __APP_VERSION__) setCurrentRelease(release);
      const newer = isNewerVersion(release.version, __APP_VERSION__);
      if (newer && (manual || dismissedVersionRef.current !== release.version)) {
        if (manual) dismissedVersionRef.current = null;
        setAvailableRelease(release);
        await registrationRef.current?.update();
      } else if (manual && !newer) {
        // An older answer (a stale cache in front of version.json) is still
        // "nothing newer", but its notes are not this version's to show.
        setCheckResult({
          kind: 'latest',
          release: release.version === __APP_VERSION__ ? release : null,
        });
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '無法檢查更新';
      setError(message);
      if (manual) setCheckResult({ kind: 'failed', message });
    } finally {
      setChecking(false);
    }
  }, []);

  const checkForUpdate = useCallback(() => runCheck(true), [runCheck]);

  const acknowledgeRelease = useCallback(
    (version: string) => {
      recordSeenRelease(storage, version);
      setSeenRelease(version);
    },
    [storage],
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD) {
      const initialCheck = window.setTimeout(() => void runCheck(false), 0);
      return () => window.clearTimeout(initialCheck);
    }

    const onControllerChange = () => {
      if (reloadOnControllerChangeRef.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((registration) => {
        captureWorker(registration);
        return runCheck(false);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '無法註冊離線更新服務');
      });

    // The timer is not throttled: it fires every 30 minutes, which is already
    // well outside the window, and it is the guarantee that a release is noticed
    // without any user action.
    const timer = window.setInterval(() => void runCheck(false), CHECK_INTERVAL_MS);

    /** An automatic trigger; runs only if the window has passed — DP-035. */
    const checkIfDue = () => {
      const startedAt = lastCheckStartedAtRef.current;
      if (startedAt !== null && Date.now() - startedAt < AUTO_CHECK_MIN_INTERVAL_MS) return;
      void runCheck(false);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkIfDue();
    };
    const onOnline = () => checkIfDue();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, [captureWorker, runCheck]);

  const updateNow = useCallback(async () => {
    // The user just read these notes in the update dialog; the build that the
    // reload brings up must not announce them a second time — DP-090.
    if (availableRelease) acknowledgeRelease(availableRelease.version);
    setUpdateError(null);
    setPreparing(true);
    applyWhenReadyRef.current = true;
    reloadOnControllerChangeRef.current = true;

    try {
      const registration = registrationRef.current;
      const worker = registration?.waiting ?? waitingWorkerRef.current;
      if (worker) {
        worker.postMessage({ type: 'SKIP_WAITING' });
        return;
      }

      if (registration) {
        await registration.update();
        // A redundant event can report failure before update() settles.
        if (!applyWhenReadyRef.current) return;
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          return;
        }
        // update() can resolve while install/cache.addAll is still running. Keep
        // this page's applyWhenReady listener alive until it activates the worker;
        // an early reload loses that intent and leaves the old worker controlling.
        if (registration.installing) return;
      }

      // No controlling worker yet (for example an old HTTP-cached page on first
      // PWA registration). Reloading fetches the new app shell without touching
      // localStorage or IndexedDB.
      window.location.reload();
    } catch {
      failUpdate('無法取得新版程式。請確認連線後再試一次；你的行程與設定不受影響。');
    }
  }, [acknowledgeRelease, availableRelease, failUpdate]);

  const whatsNew =
    currentRelease &&
    !availableRelease &&
    shouldShowReleaseNotes(currentRelease.version, seenRelease)
      ? currentRelease
      : null;

  return {
    currentVersion: __APP_VERSION__,
    currentRelease,
    availableRelease,
    whatsNew,
    checkResult,
    checking,
    preparing,
    error,
    updateError,
    checkForUpdate,
    updateNow,
    dismissUpdate: () => {
      dismissedVersionRef.current = availableRelease?.version ?? null;
      setAvailableRelease(null);
      setUpdateError(null);
    },
    acknowledgeWhatsNew: () => {
      if (currentRelease) acknowledgeRelease(currentRelease.version);
    },
    clearCheckResult: () => {
      // The 已是最新 dialog shows the running version's notes, so closing it
      // counts as having seen them.
      if (checkResult?.kind === 'latest' && checkResult.release) {
        acknowledgeRelease(checkResult.release.version);
      }
      setCheckResult(null);
    },
  };
}
