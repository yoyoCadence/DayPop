import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';

/**
 * Keyboard and focus rules every modal layer shares — DP-154.
 *
 * `aria-modal="true"` only tells assistive technology that the rest of the
 * page is out of reach; it stops nothing. Before this, Shift+Tab out of
 * 新增日曆 reached the tab bar, Enter switched tabs, and the dialog and its
 * typed name were gone. Every dialog measured in the 2026-10-13 review let
 * focus reach the page behind it (docs/review-2026-10-13-project-audit.md
 * §2.3).
 *
 * While a layer using this is open:
 *
 * - Everything outside it is `inert` — the siblings of the layer and of each
 *   of its ancestors up to `<body>` — so neither the keyboard, the pointer
 *   nor a screen reader reaches the page behind. Only what this layer made
 *   inert is released when it closes, so a layer stacked on another hands
 *   control back to the one below instead of to the page.
 * - Tab and Shift+Tab cycle inside the topmost layer. `inert` alone would
 *   let focus leave for the browser's own controls at either end.
 * - Escape goes to the topmost layer only, never while an input method is
 *   composing — the Escape that cancels a Chinese candidate list must not
 *   close the dialog holding the text. It is read once the key press has
 *   bubbled all the way up (DP-155), so a control inside the layer that
 *   handles Escape itself — 日詳情's inline title and date editors — claims it
 *   first with `stopPropagation()` or `preventDefault()`, and the layer stays.
 * - Focus returns to whatever had it before the layer opened, if that is
 *   still in the document and nothing else has taken focus since.
 *
 * `layerRef` is the layer's outermost element, backdrop included: a backdrop
 * that closes on click has to stay clickable, so it cannot be outside.
 */
export interface ModalFocusOptions {
  /** Called on Escape when this is the topmost layer. Omit to leave Escape alone. */
  onEscape?: () => void;
  /**
   * A notice the App puts up on its own — the update prompt, release notes —
   * rather than something the person opened. `useModalLayerOpen()` does not
   * count notices, so a notice can wait for the person's layers to close
   * instead of opening over them (DP-156).
   */
  notice?: boolean;
}

interface ModalLayer {
  layer: () => HTMLElement | null;
  onEscape: () => (() => void) | undefined;
  notice: boolean;
}

/** Open layers, oldest first; only the last one answers the keyboard. */
const openLayers: ModalLayer[] = [];
const layerListeners = new Set<() => void>();

function layersChanged() {
  for (const listener of layerListeners) listener();
}

/**
 * Whether a layer the person opened is open now; notices are not counted.
 *
 * The newest layer is the one the keyboard is held in, so it has to be the
 * one on top. Everything the person opens stacks upward — 日詳情, then the
 * event sheet, then the scope question — but a notice arrives whenever a
 * version check finishes, and it sits below the calendar dialog, the import
 * preview and the scope question (z-index 90 against 92–94). Opening it then
 * would hold the keyboard in a layer nobody can see and make the visible one
 * inert. So notices wait until this is false (DP-156).
 */
export function useModalLayerOpen(): boolean {
  return useSyncExternalStore(
    subscribeToLayers,
    () => openLayers.some((entry) => !entry.notice),
    () => false,
  );
}

function subscribeToLayers(listener: () => void) {
  layerListeners.add(listener);
  return () => {
    layerListeners.delete(listener);
  };
}

const FOCUSABLE = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[tabindex]',
  '[contenteditable="true"]',
].join(',');

export function useModalFocus(
  layerRef: RefObject<HTMLElement | null>,
  options: ModalFocusOptions = {},
): void {
  // What had focus at the first render. `autoFocus` moves focus into the layer
  // during commit, before any effect could see where it came from.
  const [focusedAtRender] = useState(() =>
    typeof document === 'undefined' ? null : document.activeElement,
  );
  // Where focus goes back to on close, decided once in the first effect run.
  const returnFocus = useRef<Element | null | undefined>(undefined);
  const onEscape = useRef(options.onEscape);
  const notice = options.notice ?? false;
  useEffect(() => {
    onEscape.current = options.onEscape;
  });

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    // Already inside means `autoFocus` moved it in, so the render-time element
    // is the opener. Otherwise whatever has focus now is: a component rendered
    // earlier may have moved it there in its own effect — the week grid hands
    // focus back to the dragged block before the scope question opens (DP-072).
    // Decided once, so StrictMode's second run cannot replace it.
    if (returnFocus.current === undefined) {
      returnFocus.current = layer.contains(document.activeElement)
        ? focusedAtRender
        : document.activeElement;
    }
    const entry: ModalLayer = {
      layer: () => layerRef.current,
      onEscape: () => onEscape.current,
      notice,
    };
    openLayers.push(entry);
    layersChanged();
    const release = makeOutsideInert(layer);
    if (!layer.contains(document.activeElement)) focusables(layer)[0]?.focus();
    if (openLayers.length === 1) {
      window.addEventListener('keydown', onTab, true);
      window.addEventListener('keydown', onEscapeKey);
    }

    return () => {
      const index = openLayers.indexOf(entry);
      if (index >= 0) openLayers.splice(index, 1);
      layersChanged();
      if (openLayers.length === 0) {
        window.removeEventListener('keydown', onTab, true);
        window.removeEventListener('keydown', onEscapeKey);
      }
      release();
      // Still in the document means it did not close: StrictMode re-runs
      // effects in development without removing anything.
      if (layer.isConnected) return;
      const active = document.activeElement;
      const focusWasHere = !active || active === document.body || layer.contains(active);
      const opener = returnFocus.current;
      if (focusWasHere && opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
    // One registration per opened layer; the Escape handler is read through a ref.
  }, [layerRef, focusedAtRender, notice]);
}

/** Bubble phase: whatever inside the layer handles Escape itself has had its turn. */
function onEscapeKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  // Safari reports an input method's own keys as 229 rather than composing.
  if (event.isComposing || event.keyCode === 229) return;
  const close = openLayers.at(-1)?.onEscape();
  if (!close) return;
  event.preventDefault();
  close();
}

/** Capture phase, so focus is kept in before anything else moves it. */
function onTab(event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const layer = openLayers.at(-1)?.layer();
  if (!layer) return;
  const candidates = focusables(layer);
  if (candidates.length === 0) {
    // Everything is disabled while a write is waiting (DP-141); stay put
    // rather than let focus leave the layer.
    event.preventDefault();
    return;
  }
  const first = candidates[0]!;
  const last = candidates[candidates.length - 1]!;
  const active = document.activeElement;
  if (!layer.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** What Tab can reach inside a layer, in document order. */
function focusables(layer: HTMLElement): HTMLElement[] {
  return Array.from(layer.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      !element.closest('[inert]') &&
      // Skips `display: none` and the inside of a closed <details>.
      (!laysOut() || element.getClientRects().length > 0),
  );
}

let layout: boolean | null = null;
/** False in jsdom, which lays out nothing; every element then counts as shown. */
function laysOut(): boolean {
  layout ??= document.body.getClientRects().length > 0;
  return layout;
}

/**
 * Marks the siblings of the layer and of each ancestor up to `<body>` inert,
 * skipping anything already inert — that belongs to a layer below, which will
 * release it itself. Returns the release for exactly what was marked here.
 */
function makeOutsideInert(layer: HTMLElement): () => void {
  const marked: Element[] = [];
  for (let node: Element = layer; node.parentElement && node !== document.body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || sibling.hasAttribute('inert')) continue;
      sibling.setAttribute('inert', '');
      marked.push(sibling);
    }
  }
  return () => {
    for (const element of marked) element.removeAttribute('inert');
  };
}
