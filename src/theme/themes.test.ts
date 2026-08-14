import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_ID,
  DEFAULT_THEME_MODE,
  THEMES,
  THEME_IDS,
  getPalette,
  getTheme,
  isThemeId,
  themeCssVariables,
  type ThemePalette,
} from './themes';

const PALETTE_KEYS: (keyof ThemePalette)[] = [
  'bg',
  'surface',
  'surface2',
  'fg',
  'muted',
  'faint',
  // DP-070 addition — not part of the原檔 palette; see `lunarContrast.test.ts`.
  'lunarMuted',
  'border',
  'line',
  'accent',
  'accentFg',
  'todayBg',
  'todayFg',
  'chip',
  'shadow',
  'halftone',
  'scanline',
];

/**
 * The custom properties written by `phoneStyle()` in the原檔, plus the one
 * addition DayPop made deliberately: `--lunar-muted` (DP-070).
 */
const EXPECTED_CSS_VARIABLES = [
  '--bg',
  '--surface',
  '--surface-2',
  '--fg',
  '--muted',
  '--faint',
  '--lunar-muted',
  '--border',
  '--line',
  '--accent',
  '--accent-fg',
  '--today-bg',
  '--today-fg',
  '--chip',
  '--shadow',
  '--halftone',
  '--scanline',
  '--bd',
  '--radius',
  '--radius-lg',
  '--title-ls',
  '--title-tt',
  '--font-head',
  '--font-body',
  '--pet',
  '--pet-outline',
];

describe('theme tokens', () => {
  it('keeps all six original themes in the原檔 order', () => {
    expect(THEME_IDS).toEqual(['manga', 'minimal', 'warm', 'business', 'vivid', 'pixel']);
    expect(Object.keys(THEMES)).toHaveLength(6);
  });

  it('defaults new users to 漫畫 light', () => {
    expect(DEFAULT_THEME_ID).toBe('manga');
    expect(DEFAULT_THEME_MODE).toBe('light');
    expect(getTheme(DEFAULT_THEME_ID).name).toBe('漫畫');
  });

  it('defines every palette token in both modes for every theme', () => {
    for (const id of THEME_IDS) {
      for (const mode of ['light', 'dark'] as const) {
        const palette = getPalette(id, mode);
        for (const key of PALETTE_KEYS) {
          expect(palette[key], `${id}.${mode}.${key}`).toBeTruthy();
        }
      }
    }
  });

  it('falls back to the default theme instead of throwing on unknown ids', () => {
    expect(isThemeId('manga')).toBe(true);
    expect(isThemeId('neon')).toBe(false);
    expect(getTheme('neon').id).toBe(DEFAULT_THEME_ID);
    expect(getTheme(null).id).toBe(DEFAULT_THEME_ID);
    expect(getTheme(undefined).id).toBe(DEFAULT_THEME_ID);
  });

  it('emits exactly the custom properties the ported markup relies on', () => {
    for (const id of THEME_IDS) {
      expect(Object.keys(themeCssVariables(id, 'light')), id).toEqual(EXPECTED_CSS_VARIABLES);
    }
  });

  it('maps 漫畫 light to the原檔 values', () => {
    const vars = themeCssVariables('manga', 'light');
    expect(vars['--bg']).toBe('#ffffff');
    expect(vars['--fg']).toBe('#111111');
    expect(vars['--border']).toBe('#111111');
    expect(vars['--accent']).toBe('#e4002b');
    expect(vars['--accent-fg']).toBe('#ffffff');
    expect(vars['--today-bg']).toBe('#ffe08a');
    expect(vars['--shadow']).toBe('4px 4px 0 #111111');
    expect(vars['--halftone']).toBe('radial-gradient(rgba(17,17,17,.16) 1.2px, transparent 1.4px)');
    expect(vars['--bd']).toBe('3px');
    expect(vars['--radius']).toBe('14px');
    expect(vars['--radius-lg']).toBe('24px');
    expect(vars['--font-head']).toBe("'Bangers','Noto Sans TC',sans-serif");
    expect(vars['--pet']).toBe('#ffd23f');
  });

  it('switches to the dark palette without changing the shape tokens', () => {
    const light = themeCssVariables('manga', 'light');
    const dark = themeCssVariables('manga', 'dark');
    expect(dark['--bg']).toBe('#121212');
    expect(dark['--fg']).toBe('#ffffff');
    expect(dark['--accent']).toBe('#ff2d4b');
    expect(dark['--bd']).toBe(light['--bd']);
    expect(dark['--radius']).toBe(light['--radius']);
    expect(dark['--font-head']).toBe(light['--font-head']);
  });

  it('keeps the pixel theme scanline that the texture overlay renders', () => {
    expect(themeCssVariables('pixel', 'light')['--scanline']).toContain('repeating-linear-gradient');
    expect(themeCssVariables('manga', 'light')['--scanline']).toBe('none');
  });
});
