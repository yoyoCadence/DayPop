import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAppViewport } from './viewportContext';

export interface ViewportLayerProps {
  children: ReactNode;
}

/**
 * Renders sheets, dialogs and toasts as a direct child of the App viewport, so
 * they cover the tab bar and stay inside the desktop preview frame — matching
 * where the原檔 puts its modal layers.
 *
 * Falls back to rendering in place when there is no viewport yet (first paint,
 * or a component rendered outside `AppShell` in a test).
 */
export function ViewportLayer({ children }: ViewportLayerProps) {
  const viewport = useAppViewport();
  if (!viewport) return <>{children}</>;
  return createPortal(children, viewport);
}
