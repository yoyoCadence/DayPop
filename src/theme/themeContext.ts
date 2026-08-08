import { createContext, useContext, type CSSProperties } from 'react';
import type { ThemePreference } from '../domain/types';
import type { ThemeDefinition, ThemeId, ThemeMode, ThemePalette } from './themes';

export interface ThemeContextValue {
  themeId: ThemeId;
  /** Saved preference; `system` resolves through prefers-color-scheme. */
  mode: ThemePreference;
  resolvedMode: ThemeMode;
  theme: ThemeDefinition;
  palette: ThemePalette;
  /**
   * CSS custom properties for the App viewport element. Applied by `AppShell`
   * so that ported markup can keep using `var(--accent)` and friends.
   */
  cssVariables: CSSProperties;
  selectTheme(id: ThemeId): void;
  selectMode(mode: ThemePreference): void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme 必須在 ThemeProvider 內使用。');
  return value;
}
