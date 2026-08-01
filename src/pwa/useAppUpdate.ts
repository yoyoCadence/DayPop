import { useCallback, useEffect, useRef, useState } from 'react';
import { isNewerVersion, type ReleaseInfo } from './version';

export interface AppUpdateState {
  currentVersion: string;
  currentRelease: ReleaseInfo | null;
  availableRelease: ReleaseInfo | null;
  checking: boolean;
  preparing: boolean;
  error: string | null;
  checkForUpdate: () => Promise<void>;
  updateNow: () => Promise<void>;
  dismissUpdate: () => void;
}

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export function useAppUpdate(): AppUpdateState {
  const [currentRelease, setCurrentRelease] = useState<ReleaseInfo | null>(null);
  const [availableRelease, setAvailableRelease] = useState<ReleaseInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const applyWhenReadyRef = useRef(false);
  const reloadOnControllerChangeRef = useRef(false);
  const dismissedVersionRef = useRef<string | null>(null);

  const captureWorker = useCallback((registration: ServiceWorkerRegistration) => {
    registrationRef.current = registration;
    if (registration.waiting) waitingWorkerRef.current = registration.waiting;

    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state !== 'installed' || !navigator.serviceWorker.controller) return;
        waitingWorkerRef.current = registration.waiting ?? worker;
        if (applyWhenReadyRef.current) {
          reloadOnControllerChangeRef.current = true;
          waitingWorkerRef.current.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });
  }, []);

  const checkForUpdate = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const versionUrl = `${import.meta.env.BASE_URL}version.json?ts=${Date.now()}`;
      const response = await fetch(versionUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const release = (await response.json()) as ReleaseInfo;

      if (release.version === __APP_VERSION__) setCurrentRelease(release);
      if (
        isNewerVersion(release.version, __APP_VERSION__) &&
        dismissedVersionRef.current !== release.version
      ) {
        setAvailableRelease(release);
        await registrationRef.current?.update();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '無法檢查更新');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD) {
      const initialCheck = window.setTimeout(() => void checkForUpdate(), 0);
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
        return checkForUpdate();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '無法註冊離線更新服務');
      });

    const timer = window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkForUpdate();
    };
    const onOnline = () => void checkForUpdate();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, [captureWorker, checkForUpdate]);

  const updateNow = useCallback(async () => {
    setPreparing(true);
    applyWhenReadyRef.current = true;
    reloadOnControllerChangeRef.current = true;

    const registration = registrationRef.current;
    const worker = registration?.waiting ?? waitingWorkerRef.current;
    if (worker) {
      worker.postMessage({ type: 'SKIP_WAITING' });
      return;
    }

    if (registration) {
      await registration.update();
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
    }

    // No controlling worker yet (for example an old HTTP-cached page on first
    // PWA registration). Reloading fetches the new app shell without touching
    // localStorage or IndexedDB.
    window.location.reload();
  }, []);

  return {
    currentVersion: __APP_VERSION__,
    currentRelease,
    availableRelease,
    checking,
    preparing,
    error,
    checkForUpdate,
    updateNow,
    dismissUpdate: () => {
      dismissedVersionRef.current = availableRelease?.version ?? null;
      setAvailableRelease(null);
    },
  };
}
