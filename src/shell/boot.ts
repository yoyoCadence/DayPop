/**
 * The start-up screen in index.html (DP-258) covers the page until the app
 * has something real to show. Fades it out once, then takes it out of the
 * document; a no-op when it is already gone or was never there (tests).
 *
 * Removal follows the fade's `transitionend`, which runs on the page's real
 * clock even where timers are faked; the timeout is only the fallback for a
 * browser that skips the transition.
 */
export const BOOT_FADE_MS = 300;
/**
 * Longest the cover waits, once the data is ready, for the first version
 * check: a slow or offline check must not hold the app behind it. boot.css
 * runs the same wait as the `dp-boot-wait` animation; keep the two equal.
 */
export const BOOT_RELEASE_WAIT_MS = 2500;

/**
 * Dismisses the cover after at most `ms`, unless something dismisses it first.
 * The wait is a CSS animation as well as a timer: an animation ends on the
 * page's real clock even when its timers are paused or faked, so the cover can
 * never be left up by a timer that does not fire. Returns a cancel.
 */
export function dismissBootAfter(ms: number, doc: Document = document): () => void {
  const boot = doc.getElementById('boot');
  if (!boot || boot.dataset.done) return () => {};
  const onEnd = (event: Event) => {
    if ((event as AnimationEvent).animationName === 'dp-boot-wait') dismissBoot(doc);
  };
  boot.addEventListener('animationend', onEnd);
  boot.classList.add('is-waiting');
  const timer = doc.defaultView?.setTimeout(() => dismissBoot(doc), ms);
  return () => {
    boot.removeEventListener('animationend', onEnd);
    boot.classList.remove('is-waiting');
    if (timer !== undefined) doc.defaultView?.clearTimeout(timer);
  };
}

export function dismissBoot(doc: Document = document): void {
  const boot = doc.getElementById('boot');
  if (!boot || boot.dataset.done) return;
  boot.dataset.done = 'true';
  boot.setAttribute('aria-hidden', 'true');
  boot.removeAttribute('role');
  const reduce = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduce) {
    boot.remove();
    return;
  }
  const remove = () => boot.remove();
  boot.addEventListener('transitionend', remove, { once: true });
  boot.classList.add('is-done');
  doc.defaultView?.setTimeout(remove, BOOT_FADE_MS + 200);
}
