/**
 * Canonical DayPop theme tokens.
 *
 * Every value here is transcribed verbatim from the `THEMES` getter of the
 * Claude Design source `日曆桌寵 Calendar Pet.dc.html`. Treat this file as a
 * mirror of that原檔: do not "improve" colours, radii or font stacks here — see
 * `docs/claude-design-source-of-truth.md`.
 *
 * All six themes stay in the product. 漫畫 (`manga`) light is the new-user
 * default and the first visual parity target; the other five are still part of
 * the design and must not be deleted.
 *
 * This module is presentation-only. DP-018 persists the selected id separately
 * from light/dark/system behaviour; defaults apply only when no saved value exists.
 */

import type { ThemeId as DomainThemeId } from '../domain/types';

export const THEME_IDS = ['manga', 'minimal', 'warm', 'business', 'vivid', 'pixel'] as const;

export type ThemeId = DomainThemeId;
export type ThemeMode = 'light' | 'dark';

/** Colour tokens that differ between the light and dark mode of one theme. */
export interface ThemePalette {
  bg: string;
  surface: string;
  surface2: string;
  fg: string;
  muted: string;
  faint: string;
  /**
   * Month-cell 農曆 text on **ordinary (non-festival)** days — DP-070.
   *
   * **Not from the原檔**: the source uses `--faint` there, which measures
   * 2.81:1 on 8px text and fails WCAG AA. This is a separate token rather than
   * a change to `faint` so the other secondary text keeps the transcribed
   * greys. Each value is the theme's own `faint` pushed until it clears 4.5:1
   * against every background a month cell can have (plain, zebra, selected,
   * today) — see `lunarContrast.test.ts`.
   *
   * Festival days stay on `accent` by product decision and are **not** covered
   * by that guarantee; 7 of the 12 theme/mode combinations fall below 4.5:1
   * there. The exception is pinned in the same test file.
   */
  lunarMuted: string;
  border: string;
  line: string;
  accent: string;
  accentFg: string;
  todayBg: string;
  todayFg: string;
  chip: string;
  shadow: string;
  /** Background image for the halftone dot texture, or `none`. */
  halftone: string;
  /** Background image for the CRT scanline overlay, or `none`. */
  scanline: string;
}

/** Shape tokens shared by both modes of one theme. */
export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  desc: string;
  /** Display font stack, used for screen titles and period labels. */
  head: string;
  /** Body font stack. */
  body: string;
  /** `letter-spacing` for titles. */
  titleLetterSpacing: string;
  /** `text-transform` for titles. */
  titleTextTransform: string;
  /** Border width in px; the manga/pixel themes rely on the thick 3px outline. */
  borderWidth: number;
  radius: number;
  radiusLg: number;
  /** Pet body fill and outline (App 內浮動寵物, DP-040). */
  pet: string;
  petOutline: string;
  light: ThemePalette;
  dark: ThemePalette;
}

export const DEFAULT_THEME_ID: ThemeId = 'manga';
export const DEFAULT_THEME_MODE: ThemeMode = 'light';

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  manga: {
    id: 'manga',
    name: '漫畫',
    desc: '粗黑線・網點・爆炸感',
    head: "'Bangers','Noto Sans TC',sans-serif",
    body: "'Noto Sans TC',sans-serif",
    titleLetterSpacing: '.02em',
    titleTextTransform: 'none',
    borderWidth: 3,
    radius: 14,
    radiusLg: 24,
    pet: '#ffd23f',
    petOutline: '#111111',
    light: {
      bg: '#ffffff',
      surface: '#ffffff',
      surface2: '#f0f0f0',
      fg: '#111111',
      muted: '#555555',
      faint: '#9a9a9a',
      lunarMuted: '#646464',
      border: '#111111',
      line: '#111111',
      accent: '#e4002b',
      accentFg: '#ffffff',
      todayBg: '#ffe08a',
      todayFg: '#111111',
      chip: '#ffffff',
      shadow: '4px 4px 0 #111111',
      halftone: 'radial-gradient(rgba(17,17,17,.16) 1.2px, transparent 1.4px)',
      scanline: 'none',
    },
    dark: {
      bg: '#121212',
      surface: '#1a1a1a',
      surface2: '#000000',
      fg: '#ffffff',
      muted: '#bbbbbb',
      faint: '#777777',
      lunarMuted: '#989898',
      border: '#ffffff',
      line: '#ffffff',
      accent: '#ff2d4b',
      accentFg: '#111111',
      todayBg: '#3a2f00',
      todayFg: '#ffe08a',
      chip: '#1a1a1a',
      shadow: '4px 4px 0 #000000',
      halftone: 'radial-gradient(rgba(255,255,255,.12) 1.2px, transparent 1.4px)',
      scanline: 'none',
    },
  },
  minimal: {
    id: 'minimal',
    name: '極簡',
    desc: '留白・細線・單色',
    head: "'Helvetica Neue',Helvetica,Arial,'Noto Sans TC',sans-serif",
    body: "'Helvetica Neue',Helvetica,Arial,'Noto Sans TC',sans-serif",
    titleLetterSpacing: '-.01em',
    titleTextTransform: 'none',
    borderWidth: 1,
    radius: 12,
    radiusLg: 22,
    pet: '#e4e4e7',
    petOutline: '#3f3f46',
    light: {
      bg: '#fafafa',
      surface: '#ffffff',
      surface2: '#f4f4f5',
      fg: '#18181b',
      muted: '#71717a',
      faint: '#a1a1aa',
      lunarMuted: '#6a6a70',
      border: '#e4e4e7',
      line: '#eeeef0',
      accent: '#18181b',
      accentFg: '#ffffff',
      todayBg: '#eeeef0',
      todayFg: '#18181b',
      chip: '#ffffff',
      shadow: '0 1px 2px rgba(0,0,0,.05)',
      halftone: 'none',
      scanline: 'none',
    },
    dark: {
      bg: '#0a0a0a',
      surface: '#151515',
      surface2: '#1d1d1d',
      fg: '#fafafa',
      muted: '#a1a1aa',
      faint: '#52525b',
      lunarMuted: '#8b8b91',
      border: '#282828',
      line: '#1f1f1f',
      accent: '#fafafa',
      accentFg: '#0a0a0a',
      todayBg: '#242424',
      todayFg: '#fafafa',
      chip: '#151515',
      shadow: '0 1px 2px rgba(0,0,0,.4)',
      halftone: 'none',
      scanline: 'none',
    },
  },
  warm: {
    id: 'warm',
    name: '暖陽',
    desc: '奶油紙感・襯線・柔和',
    head: "'Newsreader','Noto Serif TC',serif",
    body: "'Noto Serif TC','Noto Sans TC',serif",
    titleLetterSpacing: '0',
    titleTextTransform: 'none',
    borderWidth: 1,
    radius: 18,
    radiusLg: 28,
    pet: '#e8a06a',
    petOutline: '#7a4a2a',
    light: {
      bg: '#f4ede1',
      surface: '#fffaf1',
      surface2: '#efe3d0',
      fg: '#3d2f24',
      muted: '#7a6a58',
      faint: '#a89684',
      lunarMuted: '#6c6054',
      border: '#e2d3bd',
      line: '#ece0cd',
      accent: '#c2683f',
      accentFg: '#fff8f0',
      todayBg: '#f3ddc4',
      todayFg: '#8a3f1c',
      chip: '#fffaf1',
      shadow: '0 8px 22px rgba(120,90,60,.14)',
      halftone: 'none',
      scanline: 'none',
    },
    dark: {
      bg: '#241d17',
      surface: '#2e251d',
      surface2: '#392d22',
      fg: '#f0e6d8',
      muted: '#c3b3a0',
      faint: '#8a7a67',
      lunarMuted: '#afa598',
      border: '#463726',
      line: '#3a2e22',
      accent: '#e0895c',
      accentFg: '#241d17',
      todayBg: '#4a3820',
      todayFg: '#f0c79a',
      chip: '#2e251d',
      shadow: '0 8px 22px rgba(0,0,0,.4)',
      halftone: 'none',
      scanline: 'none',
    },
  },
  business: {
    id: 'business',
    name: '商務',
    desc: '俐落・資訊密度・可信賴',
    head: "'IBM Plex Sans','Noto Sans TC',sans-serif",
    body: "'IBM Plex Sans','Noto Sans TC',sans-serif",
    titleLetterSpacing: '-.01em',
    titleTextTransform: 'none',
    borderWidth: 1,
    radius: 12,
    radiusLg: 20,
    pet: '#6ea8ff',
    petOutline: '#123a6b',
    light: {
      bg: '#eef1f6',
      surface: '#ffffff',
      surface2: '#f4f7fb',
      fg: '#0f2440',
      muted: '#5a6b82',
      faint: '#93a1b5',
      lunarMuted: '#606976',
      border: '#dbe2ec',
      line: '#e9eef5',
      accent: '#1e5fd6',
      accentFg: '#ffffff',
      todayBg: '#dde9ff',
      todayFg: '#1747a8',
      chip: '#ffffff',
      shadow: '0 4px 14px rgba(15,36,64,.09)',
      halftone: 'none',
      scanline: 'none',
    },
    dark: {
      bg: '#0c1626',
      surface: '#13233d',
      surface2: '#1a2c49',
      fg: '#e8eef7',
      muted: '#9db0cb',
      faint: '#64768f',
      lunarMuted: '#8c9aac',
      border: '#25384f',
      line: '#1e2f47',
      accent: '#4b8bff',
      accentFg: '#08122a',
      todayBg: '#183056',
      todayFg: '#a9cbff',
      chip: '#13233d',
      shadow: '0 4px 14px rgba(0,0,0,.45)',
      halftone: 'none',
      scanline: 'none',
    },
  },
  vivid: {
    id: 'vivid',
    name: '鮮活',
    desc: '高彩度・大字・撞色',
    head: "'Space Grotesk','Noto Sans TC',sans-serif",
    body: "'Space Grotesk','Noto Sans TC',sans-serif",
    titleLetterSpacing: '-.02em',
    titleTextTransform: 'none',
    borderWidth: 2,
    radius: 22,
    radiusLg: 30,
    pet: '#ff8a3d',
    petOutline: '#151515',
    light: {
      bg: '#f5f4ef',
      surface: '#ffffff',
      surface2: '#eceae1',
      fg: '#141414',
      muted: '#5b5b52',
      faint: '#93938a',
      lunarMuted: '#676761',
      border: '#141414',
      line: '#e3e1d7',
      accent: '#ff5a1f',
      accentFg: '#ffffff',
      todayBg: '#ffe1d1',
      todayFg: '#c23c08',
      chip: '#ffffff',
      shadow: '0 10px 26px rgba(255,90,31,.26)',
      halftone: 'none',
      scanline: 'none',
    },
    dark: {
      bg: '#141019',
      surface: '#1f1826',
      surface2: '#291f33',
      fg: '#f6f1fb',
      muted: '#b4a6c4',
      faint: '#7c6e8c',
      lunarMuted: '#968ba3',
      border: '#372b45',
      line: '#2b2135',
      accent: '#ff6a2b',
      accentFg: '#1a0f08',
      todayBg: '#3a2214',
      todayFg: '#ffb083',
      chip: '#1f1826',
      shadow: '0 10px 26px rgba(255,106,43,.3)',
      halftone: 'none',
      scanline: 'none',
    },
  },
  pixel: {
    id: 'pixel',
    name: '像素',
    desc: '8-bit・點陣・硬邊',
    head: "'DotGothic16','Pixelify Sans',monospace",
    body: "'DotGothic16','Pixelify Sans',monospace",
    titleLetterSpacing: '0',
    titleTextTransform: 'none',
    borderWidth: 3,
    radius: 0,
    radiusLg: 0,
    pet: '#7bd86f',
    petOutline: '#173a1c',
    light: {
      bg: '#e8e6d0',
      surface: '#f4f2df',
      surface2: '#dcd9be',
      fg: '#2b2b22',
      muted: '#5c5a45',
      faint: '#8a866a',
      lunarMuted: '#615e4a',
      border: '#2b2b22',
      line: '#c3bf9e',
      accent: '#2f8f3e',
      accentFg: '#f4f2df',
      todayBg: '#cfe6b8',
      todayFg: '#1f5c26',
      chip: '#f4f2df',
      shadow: '3px 3px 0 #2b2b22',
      halftone: 'none',
      scanline: 'repeating-linear-gradient(0deg, rgba(43,43,34,.07) 0 1px, transparent 1px 3px)',
    },
    dark: {
      bg: '#0f120e',
      surface: '#161d14',
      surface2: '#1e261b',
      fg: '#cfeccb',
      muted: '#7fa87a',
      faint: '#4d6349',
      lunarMuted: '#92a090',
      border: '#cfeccb',
      line: '#25301f',
      accent: '#46d160',
      accentFg: '#0f120e',
      todayBg: '#1c3a1f',
      todayFg: '#8ef58a',
      chip: '#161d14',
      shadow: '3px 3px 0 #000000',
      halftone: 'none',
      scanline: 'repeating-linear-gradient(0deg, rgba(207,236,203,.05) 0 1px, transparent 1px 3px)',
    },
  },
};

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

/** Resolve a theme, falling back to the canonical default instead of throwing. */
export function getTheme(id: string | null | undefined): ThemeDefinition {
  return isThemeId(id) ? THEMES[id] : THEMES[DEFAULT_THEME_ID];
}

export function getPalette(id: string | null | undefined, mode: ThemeMode): ThemePalette {
  const theme = getTheme(id);
  return mode === 'dark' ? theme.dark : theme.light;
}

/**
 * Build the CSS custom property map applied to the App viewport.
 *
 * Mirrors `phoneStyle()` in the原檔 — same property names, same order — so that
 * markup ported in DP-051/DP-014 can keep using `var(--accent)` etc. unchanged.
 */
export function themeCssVariables(
  id: string | null | undefined,
  mode: ThemeMode,
): Record<string, string> {
  const theme = getTheme(id);
  const palette = mode === 'dark' ? theme.dark : theme.light;

  return {
    '--bg': palette.bg,
    '--surface': palette.surface,
    '--surface-2': palette.surface2,
    '--fg': palette.fg,
    '--muted': palette.muted,
    '--faint': palette.faint,
    '--lunar-muted': palette.lunarMuted,
    '--border': palette.border,
    '--line': palette.line,
    '--accent': palette.accent,
    '--accent-fg': palette.accentFg,
    '--today-bg': palette.todayBg,
    '--today-fg': palette.todayFg,
    '--chip': palette.chip,
    '--shadow': palette.shadow,
    '--halftone': palette.halftone,
    '--scanline': palette.scanline,
    '--bd': `${theme.borderWidth}px`,
    '--radius': `${theme.radius}px`,
    '--radius-lg': `${theme.radiusLg}px`,
    '--title-ls': theme.titleLetterSpacing,
    '--title-tt': theme.titleTextTransform,
    '--font-head': theme.head,
    '--font-body': theme.body,
    '--pet': theme.pet,
    '--pet-outline': theme.petOutline,
  };
}
