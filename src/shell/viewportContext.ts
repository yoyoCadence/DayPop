import { createContext, useContext } from 'react';

/**
 * The App viewport element, published by `AppShell`.
 *
 * Sheets and dialogs must render inside the viewport: it is the element that
 * owns the rounded corners and `overflow: hidden` of the desktop preview frame,
 * so a `position: fixed` overlay would break out of the phone. `ViewportLayer`
 * is the normal way to use this.
 */
export const AppViewportContext = createContext<HTMLElement | null>(null);

export function useAppViewport(): HTMLElement | null {
  return useContext(AppViewportContext);
}
