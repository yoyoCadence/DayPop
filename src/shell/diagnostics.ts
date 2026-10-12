import { useEffect, useState, type RefObject } from 'react';

/**
 * A short, copyable report for when a screen fails — DP-146.
 *
 * The owner's rule for anything that might leave the device: version, screen
 * and error type, and never event text, attachments, an email address or a
 * credential. Nothing here is sent anywhere; the user copies it and decides.
 *
 * The error **message** is deliberately left out. It is free text: an
 * exception thrown while handling a row can quote its title, and a failed
 * request can echo what the server said. It stays visible on screen, in the
 * fallback's 錯誤訊息 details, for the user to read and pass on themselves.
 *
 * `Error.name` is normally a constructor name such as `TypeError`, but code can
 * set it to any string, so only identifier-shaped names are reported.
 */
export function buildDiagnostics({
  error,
  screen,
  now,
  version = __APP_VERSION__,
}: {
  error: Error;
  /** Which screen failed, as the user sees it (分頁名稱, or 啟動). */
  screen: string;
  /** When the error was caught. */
  now: Date;
  version?: string;
}): string {
  const type = /^[A-Za-z][A-Za-z0-9_$]{0,63}$/.test(error.name) ? error.name : '（其他）';
  return ['日蹦診斷資訊', `版本：${version}`, `畫面：${screen}`, `錯誤類型：${type}`, `發生時間：${now.toISOString()}`].join('\n');
}

export type DiagnosticsCopyStatus = 'idle' | 'copied' | 'manual';

/**
 * The copy button's behaviour, shared by both error fallbacks.
 *
 * The time is fixed when the fallback first renders, which is when the error
 * was caught, not when the button is pressed. Where the clipboard is missing
 * or refuses (an insecure context, a denied permission), the report is shown
 * in a read-only field instead, selected and focused, so it can be copied by
 * hand — the user is never left with nothing.
 *
 * The caller owns the field's ref and passes it in, so everything returned
 * here is a plain value the component may read while rendering.
 */
export function useDiagnosticsCopy(error: Error, screen: string, manual: RefObject<HTMLTextAreaElement | null>) {
  const [caughtAt] = useState(() => new Date());
  const [status, setStatus] = useState<DiagnosticsCopyStatus>('idle');
  const text = buildDiagnostics({ error, screen, now: caughtAt });

  useEffect(() => {
    if (status !== 'manual') return;
    manual.current?.focus();
    manual.current?.select();
    // Focus leaves a partly visible field where it is; on a short phone the
    // field's last lines sat under the tab bar.
    manual.current?.scrollIntoView?.({ block: 'nearest' });
  }, [status, manual]);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch {
      setStatus('manual');
    }
  }

  const message =
    status === 'copied'
      ? '已複製診斷資訊，可以貼到訊息裡。'
      : status === 'manual'
        ? '無法自動複製，請手動選取下方文字。'
        : null;

  return { text, status, message, copy };
}
