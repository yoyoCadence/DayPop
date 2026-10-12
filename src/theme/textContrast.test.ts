import { describe, expect, it } from 'vitest';
import { THEMES, THEME_IDS, type ThemeMode, type ThemePalette } from './themes';

/**
 * Text that every screen draws from the palette must clear WCAG AA — DP-140.
 *
 * Three pairings are guaranteed for all six themes in both modes:
 *
 * - `accentFg` on `accent`: the label of every primary button. All fifteen
 *   uses of `--accent-fg` in the stylesheets sit on `background: var(--accent)`.
 * - `muted` on `bg`, `surface`, `surface2` and `todayBg`: secondary text, on
 *   each background a screen can put it on (the last is today's week column).
 * - `todayFg` on `todayBg`: the date in today's month cell and week column.
 *
 * Seven values in `themes.ts` were moved off the transcribed原檔 colours to get
 * here; each says so where it is defined. `lunarContrast.test.ts` covers the
 * one earlier departure (DP-070).
 *
 * `dangerText` clears the same four backgrounds — DP-144. Accent-coloured
 * text is still pinned at the bottom so the list cannot grow unnoticed — DP-144 in
 * `tasks.md`. `faint` as text and white text on calendar colours are not
 * covered here at all — DP-145.
 */

const REQUIRED_RATIO = 4.5;

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

function luminance({ r, g, b }: RGB): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
  const [high, low] = [luminance(parseHex(foreground)), luminance(parseHex(background))].sort(
    (x, y) => y - x,
  );
  return (high! + 0.05) / (low! + 0.05);
}

const round = (value: number) => Math.round(value * 100) / 100;

const cases = THEME_IDS.flatMap((id) =>
  (['light', 'dark'] as ThemeMode[]).map((mode) => ({
    id,
    mode,
    palette: mode === 'dark' ? THEMES[id].dark : THEMES[id].light,
  })),
);

/** `[label, foreground, background]` for everything this file guarantees. */
function guaranteedPairs(palette: ThemePalette): [string, string, string][] {
  return [
    ['accentFg on accent', palette.accentFg, palette.accent],
    ['muted on bg', palette.muted, palette.bg],
    ['muted on surface', palette.muted, palette.surface],
    ['muted on surface2', palette.muted, palette.surface2],
    // The week view labels today's column (週三) in `muted` on `todayBg`.
    ['muted on todayBg', palette.muted, palette.todayBg],
    ['todayFg on todayBg', palette.todayFg, palette.todayBg],
    ...(['bg', 'surface', 'surface2', 'todayBg'] as const).map(
      (background): [string, string, string] => [
        `dangerText on ${background}`, palette.dangerText, palette[background],
      ],
    ),
  ];
}

describe('主題色票的文字對比', () => {
  it.each(cases)('$id $mode: button labels, secondary text and today clear AA', ({ palette }) => {
    // The raw ratio decides; rounding is for the failure message only.
    const failures = guaranteedPairs(palette)
      .map(([label, foreground, background]) => ({ label, ratio: contrast(foreground, background) }))
      .filter(({ ratio }) => ratio < REQUIRED_RATIO)
      .map(({ label, ratio }) => `${label} ${round(ratio)}:1`);

    expect(failures).toEqual([]);
  });

  it('keeps each adjusted theme on its own accent colour', () => {
    // DP-140 changed what is written on the accent, never the accent itself:
    // these are the transcribed原檔 values and the themes' identities.
    expect(THEMES.warm.light.accent).toBe('#c2683f');
    expect(THEMES.vivid.light.accent).toBe('#ff5a1f');
    expect(THEMES.pixel.light.accent).toBe('#2f8f3e');
  });

  /**
   * Characterisation, not a target — DP-144.
   *
   * `--accent` is also used as a *text* colour straight on the page (the sheet
   * bar's 取消／儲存, the active tab). It does not clear AA everywhere.
   * Fixing it needs another token and a sweep of the stylesheets,
   * which DP-140 did not take on. The lists are exact so that a palette change
   * which worsens or fixes one of them fails here and gets looked at.
   */
  it('pins where accent-coloured text falls short', () => {
    const failing = cases
      .filter(({ palette }) => contrast(palette.accent, palette.surface) < REQUIRED_RATIO || contrast(palette.accent, palette.bg) < REQUIRED_RATIO)
      .map(({ id, mode }) => `${id}.${mode}`);

    expect(failing).toEqual(['warm.light', 'vivid.light', 'pixel.light']);
  });
});
