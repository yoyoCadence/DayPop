import { useMemo, useState } from 'react';
import type { NewTodoInput } from '../../domain/mutations';
import { petBubbleTodos } from '../../domain/petBubble';
import type { TodoItem } from '../../domain/types';
import { PetBubble, type PetBubbleMode } from './PetBubble';

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
 * Still to come: walking, dragging and docking (DP-170), the real assets and
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
  // One count for the badge and the greeting, so they cannot disagree.
  const lists = useMemo(() => petBubbleTodos(todos, todayKey), [todos, todayKey]);
  const label =
    lists.open > 0
      ? `${petName}，今天還有 ${lists.open} 件待辦`
      : `${petName}，今天沒有未完成的待辦`;

  function openBubble() {
    if (bubble) return;
    setBubble(greeted ? 'todos' : 'greeting');
    if (!greeted) onGreeted();
  }

  return (
    <>
      <div className="cal-pet-layer">
        <button
          className="cal-pet"
          type="button"
          aria-haspopup="dialog"
          aria-label={label}
          onClick={openBubble}
        >
          <span className="cal-pet-body" aria-hidden="true">
            <span className="cal-pet-shadow" />
            <span className="cal-pet-head">
              <span className="cal-pet-ear left" />
              <span className="cal-pet-ear right" />
              <span className="cal-pet-eye left" />
              <span className="cal-pet-eye right" />
              <span className="cal-pet-cheek left" />
              <span className="cal-pet-cheek right" />
              <span className="cal-pet-mouth" />
            </span>
            <span className="cal-pet-foot left" />
            <span className="cal-pet-foot right" />
          </span>
          {lists.open > 0 && (
            <span className="cal-pet-badge" aria-hidden="true">
              {lists.open}
            </span>
          )}
        </button>
      </div>
      {bubble && (
        <PetBubble
          mode={bubble}
          petName={petName}
          todayKey={todayKey}
          lists={lists}
          onShowTodos={() => setBubble('todos')}
          onClose={() => setBubble(null)}
          onAddTodo={onAddTodo}
          onToggleTodo={onToggleTodo}
          onDeleteTodo={onDeleteTodo}
        />
      )}
    </>
  );
}
