import { afterEach, describe, expect, it, vi } from 'vitest';
import { smoothScrollBehavior } from './motion';

/** DP-168: a scroll started from script follows 減少動態效果 too. */
describe('smoothScrollBehavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function prefersReducedMotion(reduce: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: reduce && query.includes('reduce'), media: query })),
    );
  }

  it('glides normally', () => {
    prefersReducedMotion(false);
    expect(smoothScrollBehavior()).toBe('smooth');
  });

  it('jumps when the person asked for reduced motion', () => {
    prefersReducedMotion(true);
    expect(smoothScrollBehavior()).toBe('auto');
  });

  it('keeps the glide where matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(smoothScrollBehavior()).toBe('smooth');
  });
});
