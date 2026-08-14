import { describe, expect, it } from 'vitest';
import { THEMES, THEME_IDS, type ThemeMode, type ThemePalette } from './themes';

/**
 * The **ordinary (non-festival)** 農曆 line in every month cell must clear
 * WCAG AA — DP-070.
 *
 * The原檔 draws it in `--faint`, which measures 2.81:1 against the plain cell.
 * DP-070 gave it its own `--lunar-muted` token so the fix does not drag every
 * other secondary grey with it. This test is the reason the token can be
 * trusted: it re-derives the ratio for all six themes in both modes, against
 * every background a cell can actually have.
 *
 * **Festival days are out of scope and deliberately so.** They are drawn in
 * `--accent`, which the product decision kept as-is, and that colour does not
 * clear AA on every cell background — 7 of the 12 theme/mode combinations fail,
 * down to 2.52:1 (鮮活 light on the today cell). The exception is pinned below
 * rather than asserted away, so nobody reads this file as covering them.
 */

const REQUIRED_RATIO = 4.5;

/** The four backgrounds `cellBackground()` in `MonthView.tsx` can produce. */
function cellBackgrounds(palette: ThemePalette): { label: string; color: RGB }[] {
  const base = parseHex(palette.bg);
  return [
    { label: 'plain', color: base },
    // Zebra shading for alternating months: rgba(130,130,130,0.06) over the bg.
    { label: 'zebra', color: composite({ r: 130, g: 130, b: 130 }, 0.06, base) },
    { label: 'selected', color: parseHex(palette.surface2) },
    { label: 'today', color: parseHex(palette.todayBg) },
  ];
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

function parseHex(value: string): RGB {
  const hex = value.replace('#', '');
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function composite(front: RGB, alpha: number, back: RGB): RGB {
  return {
    r: Math.round(front.r * alpha + back.r * (1 - alpha)),
    g: Math.round(front.g * alpha + back.g * (1 - alpha)),
    b: Math.round(front.b * alpha + back.b * (1 - alpha)),
  };
}

function luminance({ r, g, b }: RGB): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: RGB, b: RGB): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const cases = THEME_IDS.flatMap((id) =>
  (['light', 'dark'] as ThemeMode[]).map((mode) => ({
    id,
    mode,
    palette: mode === 'dark' ? THEMES[id].dark : THEMES[id].light,
  })),
);

describe('月格一般日農曆文字的對比', () => {
  it.each(cases)('$id $mode clears AA on every cell background', ({ palette }) => {
    const lunar = parseHex(palette.lunarMuted);

    // The raw ratio decides; rounding is for the failure message only. Comparing
    // the rounded value would let 4.495 pass as 4.5.
    const failures = cellBackgrounds(palette)
      .map(({ label, color }) => ({ label, ratio: contrast(lunar, color) }))
      .filter(({ ratio }) => ratio < REQUIRED_RATIO)
      .map(({ label, ratio }) => `${label} ${round(ratio)}:1`);

    expect(failures).toEqual([]);
  });

  it('is a distinct token, not a rename of faint', () => {
    // If these ever match again the fix has been undone: `faint` is the
    // transcribed grey and is 2.81:1 on the manga light cell.
    const manga = THEMES.manga.light;
    expect(manga.lunarMuted).not.toBe(manga.faint);
    expect(round(contrast(parseHex(manga.faint), parseHex(manga.bg)))).toBeLessThan(REQUIRED_RATIO);
  });

  it('keeps the festival colour a separate value from the ordinary one', () => {
    // Palette-level only. Which token a cell actually uses is beyond what this
    // file can see — `MonthView.test.tsx` asserts that wiring, because a change
    // there would leave every assertion here green.
    for (const { palette } of cases) {
      expect(palette.accent).not.toBe(palette.lunarMuted);
    }
  });

  /**
   * Characterisation, not a target. The product decision kept festivals on
   * `--accent` knowing it fails AA on some cells; this pins exactly where, so
   * the failure list cannot quietly grow — and so that if a future palette
   * change makes them all pass, this test fails and forces the "非節日" wording
   * in the docs to be revisited.
   */
  it('pins the known festival exceptions', () => {
    const failing = cases
      .filter(({ palette }) => {
        const accent = parseHex(palette.accent);
        return cellBackgrounds(palette).some(({ color }) => contrast(accent, color) < REQUIRED_RATIO);
      })
      .map(({ id, mode }) => `${id}.${mode}`);

    expect(failing).toEqual([
      'manga.light',
      'manga.dark',
      'warm.light',
      'warm.dark',
      'business.dark',
      'vivid.light',
      'pixel.light',
    ]);
  });
});
