import { useEffect } from 'react';

/** Installed App keeps a stable scale; native panning and all single-touch input remain available. */
export function useInstalledGestures(viewport: HTMLElement | null) {
  useEffect(() => {
    if (!viewport) return;
    const display = window.matchMedia?.('(display-mode: standalone)');
    const installed = () => display?.matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const originalMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const originalContent = originalMeta?.getAttribute('content') ?? null;
    let meta = originalMeta;
    const restoreMeta = () => {
      if (!originalMeta) { meta?.remove(); meta = null; }
      else if (originalContent === null) originalMeta.removeAttribute('content');
      else originalMeta.setAttribute('content', originalContent);
    };
    const update = () => {
      const active = installed();
      viewport.toggleAttribute('data-installed', active);
      document.documentElement.toggleAttribute('data-daypop-installed', active);
      if (!active) { restoreMeta(); return; }
      if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; document.head.append(meta); }
      const content = (originalContent ?? 'width=device-width, initial-scale=1, viewport-fit=cover')
        .split(',').filter(part => !/^\s*(maximum-scale|user-scalable)\s*=/i.test(part));
      meta.content = [...content, 'maximum-scale=1', 'user-scalable=no'].join(', ');
    };
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
      document.documentElement.removeAttribute('data-daypop-installed');
      restoreMeta();
    };
  }, [viewport]);
}
