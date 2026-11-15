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
