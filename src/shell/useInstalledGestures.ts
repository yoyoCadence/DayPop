import { useEffect } from 'react';

/** Installed App keeps a stable scale; native panning and all single-touch input remain available. */
export function useInstalledGestures(viewport: HTMLElement | null) {
  useEffect(() => {
    if (!viewport) return;
    const display = window.matchMedia?.('(display-mode: standalone)');
    const installed = () => display?.matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const update = () => viewport.toggleAttribute('data-installed', installed());
    // WebKit also exposes GestureEvents. Cancel only its zoom gesture, rather
    // than touchmove, which would block sheet scrolling and calendar gestures.
    const preventZoom = (event: Event) => { if (installed()) event.preventDefault(); };
    update();
    display?.addEventListener('change', update);
    viewport.addEventListener('gesturestart', preventZoom, { passive: false });
    viewport.addEventListener('gesturechange', preventZoom, { passive: false });
    return () => {
      display?.removeEventListener('change', update);
      viewport.removeEventListener('gesturestart', preventZoom);
      viewport.removeEventListener('gesturechange', preventZoom);
      viewport.removeAttribute('data-installed');
    };
  }, [viewport]);
}
