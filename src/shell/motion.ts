/**
 * Scroll behaviour that respects 減少動態效果 — DP-168.
 *
 * CSS media queries cover the stylesheets; a scroll started from script has to
 * ask for itself. A person who turned motion down gets the jump to the
 * position instead of the glide there.
 */
export function smoothScrollBehavior(): ScrollBehavior {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  } catch {
    // No matchMedia (an old engine, or a test environment): keep the glide.
    return 'smooth';
  }
}
