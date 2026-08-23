import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useDayPopDataState } from '../data/dataContext';
import type { ThemePreference } from '../domain/types';
import { ThemeContext, type ThemeContextValue } from './themeContext';
import {
  DEFAULT_THEME_ID,
  getTheme,
  isThemeId,
  themeCssVariables,
  type ThemeMode,
} from './themes';

export interface ThemeProviderProps {
  children: ReactNode;
}

/** Consumed by `shell.css` to paint the page canvas — see the effect below. */
const CANVAS_BG_PROPERTY = '--canvas-bg';

/**
 * Resolves the persisted theme preferences owned by `DataProvider`.
 * `system` follows the live media query; explicit light/dark never does.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const { state, actions } = useDayPopDataState();
  const preferences = state.status === 'ready' ? state.data.preferences : null;
  const themeId = isThemeId(preferences?.themeId) ? preferences.themeId : DEFAULT_THEME_ID;
  const mode: ThemePreference = preferences?.theme ?? 'light';
  const [systemMode, setSystemMode] = useState<ThemeMode>(readSystemMode);
  const resolvedMode: ThemeMode = mode === 'system' ? systemMode : mode;

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemMode(query.matches ? 'dark' : 'light');
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const theme = getTheme(themeId);
    return {
      themeId,
      mode,
      resolvedMode,
      theme,
      palette: resolvedMode === 'dark' ? theme.dark : theme.light,
      cssVariables: themeCssVariables(themeId, resolvedMode) as CSSProperties,
      selectTheme: (id) => actions.updatePreferences({ themeId: id }),
      selectMode: (nextMode) => actions.updatePreferences({ theme: nextMode }),
    };
  }, [actions, mode, resolvedMode, themeId]);

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousMeta = meta?.content;
    const previousScheme = document.documentElement.style.colorScheme;
    const previousCanvas = document.documentElement.style.getPropertyValue(CANVAS_BG_PROPERTY);
    if (meta) meta.content = value.palette.bg;
    document.documentElement.style.colorScheme = resolvedMode;
    // The theme tokens live on `.dp-preview`, so the page canvas — which is an
    // ancestor — cannot reach `var(--bg)`. Publishing one dedicated property on
    // the root element is what lets `shell.css` paint the canvas in the active
    // theme. A dedicated name rather than the token set itself: `--muted`,
    // `--surface`, `--line` and `--accent` collide with the scaffold's own
    // `:root` declarations in `styles.css`, and hoisting all of them would put
    // those four into a cascade fight that the scaffold blocks would lose.
    // A custom property rather than an inline `background-color`: that would
    // beat every stylesheet rule and take the canvas away from CSS — DP-074.
    document.documentElement.style.setProperty(CANVAS_BG_PROPERTY, value.palette.bg);
    return () => {
      if (meta && previousMeta !== undefined) meta.content = previousMeta;
      document.documentElement.style.colorScheme = previousScheme;
      if (previousCanvas) {
        document.documentElement.style.setProperty(CANVAS_BG_PROPERTY, previousCanvas);
      } else {
        document.documentElement.style.removeProperty(CANVAS_BG_PROPERTY);
      }
    };
  }, [resolvedMode, value.palette.bg]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function readSystemMode(): ThemeMode {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
