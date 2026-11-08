import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { NewTodoInput } from '../../domain/mutations';
import { petBubbleTodos } from '../../domain/petBubble';
import type { PetKind, TodoItem } from '../../domain/types';
import { PetBubble, type PetBubbleMode } from './PetBubble';
import { usePetPlacement } from './usePetPlacement';
import { ViewportLayer } from '../../shell/ViewportLayer';
import { PetArtwork } from './PetArtwork';
import { IdlePetArtwork } from './IdlePetArtwork';
import { PET_ASSETS } from './petAssets';
import type { PetPoint } from './petPlacement';
import { usePetWander } from './usePetWander';
import type { TodoCompletionSource } from '../../data/dataContext';

export interface PetLayerProps {
  petName: string;
  petKind?: PetKind;
  todos: TodoItem[];
  /** Today in the display timezone — the day the badge and the bubble count from. */
  todayKey: string;
  /**
   * Whether the pet has said hello in this App session — the原檔's `greeted`.
   * Owned by `App`: this screen unmounts on every tab switch, which would
   * otherwise bring the greeting back each time.
   */
  greeted: boolean;
  onGreeted(): void;
  onAddTodo(input: NewTodoInput): Promise<void> | void;
  onToggleTodo(id: string): void;
  onDeleteTodo(id: string): void;
  todoCompletions?: TodoCompletionSource;
}

/**
 * App 內浮動寵物 (DP-051) and its speech bubble (DP-169).
 *
 * The原檔 floats the pet in a zero-height layer pinned above the tab bar.
 * DP-051 fixed that geometry — the layer inset, the 60 × 60 footprint, the
 * resting position and the badge — with a CSS character in the原檔's
 * proportions and outline. DP-169 makes it a button: tapping it, or Enter and
 * Space on it, opens the bubble, a greeting the first time in a session and
 * the lists after that, as the原檔's `petTap()` (`:1155`) does.
 *
 * DP-170 adds device-local placement, dragging, docking and a collapsed tab.
 * DP-188 adds the approved default cat's idle/look/grab artwork. DP-193/197
 * add foreground sleep and confirmed-command jump feedback. DP-239 chooses the
 * partner. DP-240 lets partners with a real walk animation take short
 * excursions along their own row and come back; the saved position never
 * changes, and any interaction ends the excursion at once.
 */
export function PetLayer({
  petName,
  petKind = 'moon_cat',
  todos,
  todayKey,
  greeted,
  onGreeted,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
  todoCompletions,
}: PetLayerProps) {
  const [bubble, setBubble] = useState<PetBubbleMode | null>(null);
  const [lookCue, setLookCue] = useState<number | null>(null);
  const [jumpCue, setJumpCue] = useState<number | null>(null);
  const cueSequence = useRef(0);
  const layerRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLButtonElement>(null);
  const bubbleLayerRef = useRef<HTMLDivElement>(null);
  const placement = usePetPlacement(bubble !== null, layerRef, controlRef, bubbleLayerRef);
  const completed = useEffectEvent(() => {
    if (document.hidden || placement.hidden || placement.collapsed || placement.moving || placement.dragging || bubble || lookCue !== null) return;
    setJumpCue(++cueSequence.current);
  });
  useEffect(() => todoCompletions?.subscribe(() => completed()), [todoCompletions]);
  // One count for the badge and the greeting, so they cannot disagree.
  const lists = useMemo(() => petBubbleTodos(todos, todayKey), [todos, todayKey]);
  // A primary pointer that lands on the pet mid-excursion holds it where it is
  // drawn, so a drag starts under the pointer rather than from the saved spot;
  // a plain tap releases it home. State for rendering, ref for the handlers.
  const [held, setHeld] = useState<PetPoint | null>(null);
  const heldRef = useRef<PetPoint | null>(null);
  function hold(point: PetPoint | null) {
    heldRef.current = point;
    setHeld(point);
  }
  const wander = usePetWander({
    // Only partners that really walk; the others would slide. No excursion
    // while the user is moving, reading, typing or the pet is reacting.
    enabled: Boolean(PET_ASSETS[petKind].walk) && !placement.hidden && !placement.collapsed && !placement.moving &&
      !placement.dragging && held === null && bubble === null && lookCue === null && jumpCue === null,
    home: placement.position,
    area: placement.area,
    onInput: event => {
      const control = controlRef.current;
      const position = placement.position;
      if (wander.phase === 'rest' || placement.moving || !control || !position || event.type !== 'pointerdown') return;
      const pointer = event as MouseEvent & { isPrimary?: boolean };
      if (pointer.button !== 0 || pointer.isPrimary === false || !(event.target instanceof Node) || !control.contains(event.target)) return;
      hold(drawnPoint(control) ?? { x: position.x + wander.offset, y: position.y });
    },
  });
  const pose = placement.moving || placement.dragging ? 'grab' : lookCue !== null ? 'look' : jumpCue !== null ? 'jump'
    : wander.phase === 'sit' ? (PET_ASSETS[petKind].sit ? 'sit' : 'idle')
    : wander.phase === 'out' || wander.phase === 'back' ? 'walk' : 'idle';
  const walkingStyle = wander.legMs > 0 && !held ? { transition: `transform ${wander.legMs}ms linear` } : undefined;
  const drawn = held ?? (placement.position ? { x: placement.position.x + wander.offset, y: placement.position.y } : null);
  const label =
    lists.open > 0
      ? `${petName}，今天還有 ${lists.open} 件待辦`
      : `${petName}，今天沒有未完成的待辦`;

  function openBubble(detail: number) {
    if (placement.consumeClick(detail) || bubble) return;
    setLookCue(null);
    setJumpCue(null);
    setBubble(greeted ? 'todos' : 'greeting');
    if (!greeted) onGreeted();
  }

  return (
    <>
      <div className="cal-pet-layer" ref={layerRef}>
        {placement.collapsed ? (
          <button className="cal-pet-tab" type="button" ref={controlRef}
            hidden={placement.hidden} aria-label={`展開夥伴 ${petName}`}
            style={placement.position ? { transform: `translate(${placement.position.x}px, ${placement.position.y}px)` } : undefined}
            onClick={() => placement.setCollapsed(false)}>🐾</button>
        ) : <button
          className="cal-pet"
          ref={controlRef}
          type="button"
          hidden={placement.hidden}
          style={drawn ? { transform: `translate(${drawn.x}px, ${drawn.y}px)`, ...walkingStyle } : undefined}
          data-wander={wander.phase === 'rest' ? undefined : wander.phase}
          aria-haspopup="dialog"
          aria-label={label}
          aria-describedby={placement.moving ? 'pet-move-instructions' : undefined}
          onClick={event => openBubble(event.detail)}
          onKeyDown={placement.onKeyDown}
          onBlur={placement.onBlur}
          onPointerDown={event => { if (!placement.onPointerDown(event, heldRef.current ?? undefined)) hold(null); }}
          onPointerMove={event => { if (placement.onPointerMove(event)) { setLookCue(null); setJumpCue(null); } }}
          onPointerUp={event => { placement.onPointerUp(event); hold(null); }}
          onPointerCancel={() => { placement.onPointerCancel(); hold(null); }}
          onLostPointerCapture={() => { placement.onPointerCancel(); hold(null); }}
        >
          {pose === 'idle' ? <IdlePetArtwork kind={petKind} paused={bubble !== null} hidden={placement.hidden} /> : <PetArtwork kind={petKind} pose={pose}
            paused={bubble !== null} hidden={placement.hidden} cue={lookCue ?? jumpCue}
            onCueDone={cue => {
              setLookCue(current => current === cue ? null : current);
              setJumpCue(current => current === cue ? null : current);
            }} />}
          {lists.open > 0 && (
            <span className="cal-pet-badge" aria-hidden="true">
              {lists.open}
            </span>
          )}
        </button>}
      </div>
      {placement.moving && <ViewportLayer><p className="cal-pet-move-note" id="pet-move-instructions" role="status">方向鍵移動，Enter 保存，Escape 取消</p></ViewportLayer>}
      {bubble && (
        <PetBubble
          layerRef={bubbleLayerRef}
          mode={bubble}
          petName={petName}
          todayKey={todayKey}
          lists={lists}
          onShowTodos={() => setBubble('todos')}
          onClose={() => { placement.restoreFocus(); setBubble(null); setLookCue(++cueSequence.current); }}
          onMove={() => { setLookCue(null); setJumpCue(null); setBubble(null); placement.startMoving(); }}
          onCollapse={() => { setLookCue(null); setJumpCue(null); setBubble(null); placement.setCollapsed(true); }}
          onAddTodo={onAddTodo}
          onToggleTodo={onToggleTodo}
          onDeleteTodo={onDeleteTodo}
        />
      )}
    </>
  );
}

/** Where the pet is drawn right now, mid-transition included; null where the browser cannot say. */
function drawnPoint(element: HTMLElement): PetPoint | null {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === 'none' || typeof DOMMatrixReadOnly !== 'function') return null;
  const matrix = new DOMMatrixReadOnly(transform);
  return { x: matrix.m41, y: matrix.m42 };
}
