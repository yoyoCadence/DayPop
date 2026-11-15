/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOOT_FADE_MS, BOOT_RELEASE_WAIT_MS, dismissBoot, dismissBootAfter } from './boot';

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

describe('bounded wait for the version check (DP-258)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.getElementById('boot')?.remove();
  });

  it('lifts the cover when the CSS wait ends, even if timers never fire', () => {
    vi.useFakeTimers();
    preferReducedMotion(false);
    const boot = addBoot();
    dismissBootAfter(BOOT_RELEASE_WAIT_MS);
    expect(boot.classList.contains('is-waiting')).toBe(true);
    const other = new Event('animationend');
    Object.defineProperty(other, 'animationName', { value: 'dp-boot-hop' });
    boot.dispatchEvent(other);
    expect(boot.dataset.done).toBeUndefined();
    const end = new Event('animationend');
    Object.defineProperty(end, 'animationName', { value: 'dp-boot-wait' });
    boot.dispatchEvent(end);
    expect(boot.dataset.done).toBe('true');
  });

  it('cancels cleanly when the check settles first', () => {
    vi.useFakeTimers();
    preferReducedMotion(false);
    const boot = addBoot();
    const cancel = dismissBootAfter(BOOT_RELEASE_WAIT_MS);
    cancel();
    expect(boot.classList.contains('is-waiting')).toBe(false);
    vi.advanceTimersByTime(BOOT_RELEASE_WAIT_MS);
    expect(boot.dataset.done).toBeUndefined();
  });

  it('keeps the CSS wait as long as BOOT_RELEASE_WAIT_MS', () => {
    const css = readFileSync(join(process.cwd(), 'src/shell/boot.css'), 'utf8');
    const lengths = [...css.matchAll(/dp-boot-wait ([\d.]+)s/g)].map((match) => Number(match[1]) * 1000);
    expect(lengths.length).toBe(2);
    for (const length of lengths) expect(length).toBe(BOOT_RELEASE_WAIT_MS);
  });
});
