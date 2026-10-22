import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useModalLayerOpen } from '../../shell/useModalFocus';
import { constrainPet, loadPetPlacement, placePet, rememberPet, savePetPlacement, type PetArea, type PetPoint } from './petPlacement';

/** UI-only movement. Pointer previews stay in refs/the DOM; commit is the only write. */
export function usePetPlacement(bubbleOpen: boolean, layer: RefObject<HTMLDivElement | null>, control: RefObject<HTMLButtonElement | null>, bubbleLayer: RefObject<HTMLDivElement | null>) {
  const [saved, setSaved] = useState(loadPetPlacement);
  const [geometry, setGeometry] = useState<{ area: PetArea; covered: boolean } | null>(null);
  const [moving, setMoving] = useState(false);
  const preview = useRef<PetPoint | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; origin: PetPoint; moved: boolean; scaleX: number; scaleY: number } | null>(null);
  const suppressClick = useRef(false);
  const pendingFocus = useRef(false);
  const modalOpen = useModalLayerOpen(bubbleLayer);
  const collapsed = saved?.collapsed ?? false;
  const size = collapsed ? 44 : 60;
  const position = geometry ? placePet(saved, geometry.area, size) : null;
  const hidden = (geometry ? geometry.covered || !position : false) || modalOpen;

  function paint(point: PetPoint | null) {
    preview.current = point;
    if (point) control.current?.style.setProperty('transform', `translate(${point.x}px, ${point.y}px)`);
  }
  function cancel() {
    drag.current = null;
    preview.current = null;
    setMoving(false);
    paint(position);
  }

  useLayoutEffect(() => {
    const element = layer.current;
    if (!element) return;
    const screen = element.closest('.cal-screen');
    const header = screen?.querySelector('.cal-header');
    const fab = screen?.querySelector('.cal-fab');
    let active = true;
    let previousMeasurement = '';
    function measure() {
      if (!active) return;
      const rect = element!.getBoundingClientRect();
      const content = screen?.getBoundingClientRect();
      // No invented fallback bounds: a zero-size real viewport is unavailable.
      const scaleX = rect.width / (element!.clientWidth || rect.width || 1);
      const scaleY = content && screen?.clientHeight ? content.height / screen.clientHeight : scaleX;
      const head = header?.getBoundingClientRect();
      const obstacle = fab?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const focused = document.activeElement;
      const editing = focused instanceof HTMLElement && focused.matches('input, textarea, select, [contenteditable="true"]');
      const next = {
        // Keep the original zero-height passthrough layer: a viewport-sized
        // transparent overlay makes axe unable to measure underlying text.
        // The original resting offset is 14px above the content's bottom.
        area: { width: rect.width / scaleX, height: content ? (content.bottom - rect.top) / scaleY - 14 : rect.height / scaleY,
          top: head ? Math.max(0, (head.bottom - rect.top) / scaleY + 8) : 0,
          obstacle: obstacle ? { left: (obstacle.left - rect.left) / scaleX, right: (obstacle.right - rect.left) / scaleX,
            top: (obstacle.top - rect.top) / scaleY, bottom: (obstacle.bottom - rect.top) / scaleY } : undefined },
        covered: editing || Boolean(viewport && ((content?.bottom ?? rect.bottom) > viewport.offsetTop + viewport.height || rect.top < viewport.offsetTop)),
      };
      const measurement = JSON.stringify(next);
      if (measurement !== previousMeasurement) {
        previousMeasurement = measurement;
        drag.current = null;
        preview.current = null;
        setMoving(false);
        setGeometry(next);
        const restored = placePet(saved, next.area, size);
        if (restored) control.current?.style.setProperty('transform', `translate(${restored.x}px, ${restored.y}px)`);
      }
    }
    const focusChanged = () => queueMicrotask(measure);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const target of [element, screen, header, fab]) if (target) observer?.observe(target);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    document.addEventListener('focusin', focusChanged);
    document.addEventListener('focusout', focusChanged);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
      document.removeEventListener('focusin', focusChanged);
      document.removeEventListener('focusout', focusChanged);
    };
  }, [layer, control, saved, size]);
  useEffect(() => {
    // Closing our bubble briefly leaves its modal registration in place until
    // passive cleanup. Do not cancel the keyboard move just requested there.
    if (hidden && !pendingFocus.current) {
      drag.current = null;
      preview.current = null;
      // Synchronize with the external modal store after its cleanup commits.
      queueMicrotask(() => setMoving(false));
    }
  }, [hidden]);
  useEffect(() => {
    if (pendingFocus.current && !hidden && !bubbleOpen) {
      control.current?.focus({ preventScroll: true });
      pendingFocus.current = false;
    }
  }, [collapsed, moving, hidden, bubbleOpen, control]);

  function commit(point: PetPoint) {
    if (!geometry) return;
    const next = rememberPet(point, geometry.area);
    savePetPlacement(next);
    setSaved(next);
    paint(placePet(next, geometry.area, 60));
    setMoving(false);
  }
  function setCollapsed(value: boolean) {
    // Collapsing is not a move: retain the initial 14px resting inset too.
    const next = { ...(saved ?? (geometry && position ? rememberPet(position, geometry.area, false) : { x: 0, y: 1, collapsed: false })), collapsed: value };
    savePetPlacement(next);
    setSaved(next);
    pendingFocus.current = true;
  }
  function startMoving() {
    preview.current = position;
    pendingFocus.current = true;
    setMoving(true);
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!moving || !geometry || !position || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const point = preview.current ?? position;
    const direction = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
    if (direction) {
      event.preventDefault();
      paint(constrainPet({ x: point.x + direction[0]!, y: point.y + direction[1]! }, geometry.area, 60));
    } else if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Enter') commit(point); else cancel();
    } else if (event.key === 'Tab') cancel();
  }
  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || event.isPrimary === false || !position || !geometry || moving) return;
    suppressClick.current = false;
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: position, moved: false,
      scaleX: rect.width / 60, scaleY: rect.height / 60 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId || !geometry) return;
    const dx = (event.clientX - active.x) / active.scaleX;
    const dy = (event.clientY - active.y) / active.scaleY;
    active.moved ||= Math.abs(dx) + Math.abs(dy) > 4;
    if (active.moved) paint(constrainPet({ x: active.origin.x + dx, y: active.origin.y + dy }, geometry.area, 60));
  }
  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    if (active.moved) {
      suppressClick.current = true;
      if (preview.current) commit(preview.current);
    }
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }
  function onPointerCancel() {
    if (!drag.current) return;
    if (drag.current?.moved) suppressClick.current = true;
    cancel();
  }
  return { collapsed, hidden, moving, position, setCollapsed, startMoving,
    restoreFocus: () => { pendingFocus.current = true; },
    onKeyDown, onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
    onBlur: () => { if (moving) cancel(); },
    consumeClick: (detail: number) => {
      const suppressed = (detail > 0 && suppressClick.current) || moving;
      suppressClick.current = false;
      return suppressed;
    } };
}
