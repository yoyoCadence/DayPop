import { useEffect, useRef, useState, type RefObject } from 'react';

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
 *   close the dialog holding the text.
 * - Focus returns to whatever had it before the layer opened, if that is
 *   still in the document and nothing else has taken focus since.
 *
 * `layerRef` is the layer's outermost element, backdrop included: a backdrop
 * that closes on click has to stay clickable, so it cannot be outside.
 */
export interface ModalFocusOptions {
  /** Called on Escape when this is the topmost layer. Omit to leave Escape alone. */
  onEscape?: () => void;
}

interface ModalLayer {
  layer: () => HTMLElement | null;
  onEscape: () => (() => void) | undefined;
}

/** Open layers, oldest first; only the last one answers the keyboard. */
const openLayers: ModalLayer[] = [];

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
  // Read during the first render: `autoFocus` moves focus into the layer
  // during commit, before any effect could see what had it.
  const [returnFocus] = useState(() =>
    typeof document === 'undefined' ? null : document.activeElement,
  );
  const onEscape = useRef(options.onEscape);
  useEffect(() => {
    onEscape.current = options.onEscape;
  });

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const entry: ModalLayer = { layer: () => layerRef.current, onEscape: () => onEscape.current };
    openLayers.push(entry);
    const release = makeOutsideInert(layer);
    if (!layer.contains(document.activeElement)) focusables(layer)[0]?.focus();
    if (openLayers.length === 1) window.addEventListener('keydown', onKeyDown, true);

    return () => {
      const index = openLayers.indexOf(entry);
      if (index >= 0) openLayers.splice(index, 1);
      if (openLayers.length === 0) window.removeEventListener('keydown', onKeyDown, true);
      release();
      // Still in the document means it did not close: StrictMode re-runs
      // effects in development without removing anything.
      if (layer.isConnected) return;
      const active = document.activeElement;
      const focusWasHere = !active || active === document.body || layer.contains(active);
      if (focusWasHere && returnFocus instanceof HTMLElement && returnFocus.isConnected) {
        returnFocus.focus();
      }
    };
    // One registration per opened layer; the Escape handler is read through a ref.
  }, [layerRef, returnFocus]);
}

function onKeyDown(event: KeyboardEvent) {
  const top = openLayers.at(-1);
  const layer = top?.layer();
  if (!top || !layer) return;

  if (event.key === 'Escape') {
    // Safari reports an input method's own keys as 229 rather than composing.
    if (event.isComposing || event.keyCode === 229) return;
    const close = top.onEscape();
    if (!close) return;
    // The layer below must not also act on the same key press.
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }

  if (event.key !== 'Tab') return;
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
