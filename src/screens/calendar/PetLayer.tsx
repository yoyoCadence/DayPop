import { useMemo, useRef, useState } from 'react';
import type { NewTodoInput } from '../../domain/mutations';
import { petBubbleTodos } from '../../domain/petBubble';
import type { TodoItem } from '../../domain/types';
import { PetBubble, type PetBubbleMode } from './PetBubble';
import { usePetPlacement } from './usePetPlacement';
import { ViewportLayer } from '../../shell/ViewportLayer';
import { PetArtwork } from './PetArtwork';

export interface PetLayerProps {
  petName: string;
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
 * DP-188 adds the approved default cat's idle/look/grab artwork. Still to come: walking and
 * the seven-state machine (DP-171), choosing a partner (DP-172).
 */
export function PetLayer({
  petName,
  todos,
  todayKey,
  greeted,
  onGreeted,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
}: PetLayerProps) {
  const [bubble, setBubble] = useState<PetBubbleMode | null>(null);
  const [lookCue, setLookCue] = useState<number | null>(null);
  const cueSequence = useRef(0);
  const layerRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLButtonElement>(null);
  const bubbleLayerRef = useRef<HTMLDivElement>(null);
  const placement = usePetPlacement(bubble !== null, layerRef, controlRef, bubbleLayerRef);
  // One count for the badge and the greeting, so they cannot disagree.
  const lists = useMemo(() => petBubbleTodos(todos, todayKey), [todos, todayKey]);
  const label =
    lists.open > 0
      ? `${petName}，今天還有 ${lists.open} 件待辦`
      : `${petName}，今天沒有未完成的待辦`;

  function openBubble(detail: number) {
    if (placement.consumeClick(detail) || bubble) return;
    setLookCue(null);
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
          style={placement.position ? { transform: `translate(${placement.position.x}px, ${placement.position.y}px)` } : undefined}
          aria-haspopup="dialog"
          aria-label={label}
          aria-describedby={placement.moving ? 'pet-move-instructions' : undefined}
          onClick={event => openBubble(event.detail)}
          onKeyDown={placement.onKeyDown}
          onBlur={placement.onBlur}
          onPointerDown={placement.onPointerDown}
          onPointerMove={event => { if (placement.onPointerMove(event)) setLookCue(null); }}
          onPointerUp={placement.onPointerUp}
          onPointerCancel={placement.onPointerCancel}
          onLostPointerCapture={placement.onPointerCancel}
        >
          <PetArtwork pose={placement.moving || placement.dragging ? 'grab' : lookCue !== null ? 'look' : 'idle'}
            paused={bubble !== null} hidden={placement.hidden} cue={lookCue}
            onLookDone={cue => setLookCue(current => current === cue ? null : current)} />
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
          onMove={() => { setLookCue(null); setBubble(null); placement.startMoving(); }}
          onCollapse={() => { setLookCue(null); setBubble(null); placement.setCollapsed(true); }}
          onAddTodo={onAddTodo}
          onToggleTodo={onToggleTodo}
          onDeleteTodo={onDeleteTodo}
        />
      )}
    </>
  );
}
