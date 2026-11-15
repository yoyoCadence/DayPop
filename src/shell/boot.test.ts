import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOT_FADE_MS, dismissBoot } from './boot';

function addBoot(): HTMLElement {
  const boot = document.createElement('div');
  boot.id = 'boot';
  boot.setAttribute('role', 'status');
  document.body.append(boot);
  return boot;
}

function preferReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
}

describe('start-up screen (DP-258)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.getElementById('boot')?.remove();
  });

  it('fades the cover out, hides it from assistive tech, then removes it', () => {
    preferReducedMotion(false);
    const boot = addBoot();
    dismissBoot();
    expect(boot.classList.contains('is-done')).toBe(true);
    expect(boot.getAttribute('aria-hidden')).toBe('true');
    expect(boot.hasAttribute('role')).toBe(false);
    expect(boot.isConnected).toBe(true);
    vi.advanceTimersByTime(BOOT_FADE_MS + 200);
    expect(boot.isConnected).toBe(false);
  });

  it('removes it when the fade ends, without waiting for the fallback timer', () => {
    preferReducedMotion(false);
    const boot = addBoot();
    dismissBoot();
    boot.dispatchEvent(new Event('transitionend'));
    expect(boot.isConnected).toBe(false);
  });

  it('removes it at once when reduced motion is asked for', () => {
    preferReducedMotion(true);
    const boot = addBoot();
    dismissBoot();
    expect(boot.isConnected).toBe(false);
  });

  it('runs once, and does nothing when there is no cover', () => {
    preferReducedMotion(false);
    expect(() => dismissBoot()).not.toThrow();
    const boot = addBoot();
    dismissBoot();
    const classes = boot.className;
    dismissBoot();
    expect(boot.className).toBe(classes);
    expect(vi.getTimerCount()).toBe(1);
  });
});
