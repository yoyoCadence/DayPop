import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ThemeContext, type ThemeContextValue } from './themeContext';
import {
  DEFAULT_THEME_ID,
  DEFAULT_THEME_MODE,
  getTheme,
  themeCssVariables,
  type ThemeId,
  type ThemeMode,
} from './themes';

export interface ThemeProviderProps {
  children: ReactNode;
  /**
   * Starting theme. Defaults to 漫畫 — the canonical new-user default decided on
   * 2026-08-02 and the first visual parity target.
   */
  initialThemeId?: ThemeId;
  initialMode?: ThemeMode;
}

/**
 * Holds the active design theme for the current session.
 *
 * DP-050 deliberately keeps this in memory only: the local data model is not
 * touched by this task, and the stored preference must never be overwritten by
 * a default. DP-018 replaces the `useState` seeds below with the persisted
 * `system / light / dark` preference plus a stored theme id, keeping any value
 * an existing user already saved.
 */
export function ThemeProvider({
  children,
  initialThemeId = DEFAULT_THEME_ID,
  initialMode = DEFAULT_THEME_MODE,
}: ThemeProviderProps) {
  const [themeId, setThemeId] = useState<ThemeId>(initialThemeId);
  const [mode, setMode] = useState<ThemeMode>(initialMode);

  const value = useMemo<ThemeContextValue>(() => {
    const theme = getTheme(themeId);
    return {
      themeId,
      mode,
      theme,
      palette: mode === 'dark' ? theme.dark : theme.light,
      cssVariables: themeCssVariables(themeId, mode) as CSSProperties,
      selectTheme: setThemeId,
      selectMode: setMode,
    };
  }, [themeId, mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
