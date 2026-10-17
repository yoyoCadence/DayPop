import { useEffect, useId, useRef, type FormEvent } from 'react';
import type { NewTodoInput } from '../../domain/mutations';
import { petGreeting, type PetBubbleTodos } from '../../domain/petBubble';
import { isTitleTooLong, MAX_TITLE_INPUT_LENGTH, TITLE_LENGTH_MESSAGE } from '../../domain/titles';
import type { TodoItem } from '../../domain/types';
import { useModalFocus } from '../../shell/useModalFocus';
import { ViewportLayer } from '../../shell/ViewportLayer';
import { useConfirmedTodoAdd } from './useConfirmedTodoAdd';
import './petBubble.css';

/** The原檔's `bubbleMode`, without `ai` — the assistant is DP-043. */
export type PetBubbleMode = 'greeting' | 'todos';

export interface PetBubbleProps {
  mode: PetBubbleMode;
  petName: string;
  /** Today in the display timezone; new 今日 todos get it, and overdue is read against it. */
  todayKey: string;
  lists: PetBubbleTodos;
  onShowTodos(): void;
  onClose(): void;
  /** A synchronous callback has already confirmed; production awaits the queue (DP-137). */
  onAddTodo(input: NewTodoInput): Promise<void> | void;
  onToggleTodo(id: string): void;
  onDeleteTodo(id: string): void;
}

/**
 * The pet's speech bubble — DP-169, ported from the `bubbleOpen` blocks of
 * `日曆桌寵 Calendar Pet.dc.html` (`:488-530`).
 *
 * Two modes, as in the原檔: a greeting that counts what is left today and
 * offers 看待辦, and the lists — 今日 (with anything overdue and still open)
 * and 明日 — where todos can be ticked, deleted and added. Tapping outside,
 * ✕ and Escape close it.
 *
 * Left out on purpose, each for its own reason (ADR §4):
 * - 給我建議 and the AI mode: no assistant exists (DP-043), and DayPop says
 *   what is missing in 設定 rather than showing a control that does nothing.
 * - The greeting the原檔 pops up by itself 950ms after launch: it would cover
 *   the calendar on every start.
 * - The praise after ticking a todo: that is the原檔's XP and level system,
 *   DP-041.
 *
 * A modal layer like every other sheet here (DP-154): the rest of the App is
 * inert while it is open, Tab stays inside, focus goes back to the pet.
 */
export function PetBubble({
  mode,
  petName,
  todayKey,
  lists,
  onShowTodos,
  onClose,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
}: PetBubbleProps) {
  // The catcher is inside the layer, so tapping outside the bubble stays
  // possible while everything behind it is inert.
  const layer = useRef<HTMLDivElement>(null);
  useModalFocus(layer, { onEscape: onClose });
  const greetingId = useId();

  return (
    <ViewportLayer>
      <div className="cal-pet-bubble-layer" ref={layer}>
        <div className="cal-pet-bubble-catcher" onClick={onClose} />
        <div
          className="cal-pet-bubble"
          role="dialog"
          aria-modal="true"
          aria-label={petName}
          aria-describedby={mode === 'greeting' ? greetingId : undefined}
        >
          <button className="cal-pet-bubble-close" type="button" aria-label="關閉" onClick={onClose}>
            ✕
          </button>
          <div className="cal-pet-bubble-body">
            {mode === 'greeting' ? (
              <>
                <p className="cal-pet-greeting" id={greetingId}>
                  {petGreeting(petName, lists.open, lists.important)}
                </p>
                <div className="cal-pet-actions">
                  {/* The answer to the question just asked, so it takes focus. */}
                  <button className="cal-pet-show-todos" type="button" autoFocus onClick={onShowTodos}>
                    看待辦
                  </button>
                </div>
              </>
            ) : (
              <>
                <PetTodoSection
                  icon="📋"
                  heading="今日待辦"
                  focusOnMount
                  todos={lists.today}
                  dateKey={todayKey}
                  todayKey={todayKey}
                  emptyText="今天清空啦，太棒了！"
                  placeholder="新增今日待辦…"
                  inputLabel="新增今日待辦"
                  addLabel="加入今日待辦"
                  onAddTodo={onAddTodo}
                  onToggleTodo={onToggleTodo}
                  onDeleteTodo={onDeleteTodo}
                />
                <PetTodoSection
                  icon="🗓"
                  heading="明日待辦"
                  todos={lists.tomorrow}
                  dateKey={lists.tomorrowKey}
                  todayKey={todayKey}
                  placeholder="新增明日待辦…"
                  inputLabel="新增明日待辦"
                  addLabel="加入明日待辦"
                  onAddTodo={onAddTodo}
                  onToggleTodo={onToggleTodo}
                  onDeleteTodo={onDeleteTodo}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </ViewportLayer>
  );
}

interface PetTodoSectionProps {
  icon: string;
  heading: string;
  /**
   * The lists open with focus on 今日待辦: either straight from the pet, or
   * from 看待辦, whose button is gone by then. A screen reader starts at the
   * heading, and the keyboard stays inside the bubble.
   */
  focusOnMount?: boolean;
  todos: TodoItem[];
  /** The date a todo added here gets. */
  dateKey: string;
  todayKey: string;
  /** Only 今日 says anything when it is empty, as in the原檔. */
  emptyText?: string;
  placeholder: string;
  inputLabel: string;
  addLabel: string;
  onAddTodo(input: NewTodoInput): Promise<void> | void;
  onToggleTodo(id: string): void;
  onDeleteTodo(id: string): void;
}

function PetTodoSection({
  icon,
  heading,
  focusOnMount = false,
  todos,
  dateKey,
  todayKey,
  emptyText,
  placeholder,
  inputLabel,
  addLabel,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
}: PetTodoSectionProps) {
  const add = useConfirmedTodoAdd();
  const { draft, setDraft } = add;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tooLong = isTitleTooLong(draft);

  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
  }, [focusOnMount]);

  function toggle(todo: TodoItem) {
    // An overdue todo leaves 今日待辦 once it is done (原檔 :1302), and the
    // checkbox that had focus goes with it. Keep focus in the section.
    if (isOverdue(todo, todayKey)) headingRef.current?.focus();
    onToggleTodo(todo.id);
  }

  function remove(todo: TodoItem) {
    headingRef.current?.focus();
    onDeleteTodo(todo.id);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || tooLong) return;
    // Cleared only once the add is confirmed; a failure keeps the text (DP-137).
    void add.submit((id) => onAddTodo({ id, title: draft.trim(), date: dateKey }));
  }

  return (
    <div className="cal-pet-section">
      <h2 className="cal-pet-heading" ref={headingRef} tabIndex={-1}>
        <span aria-hidden="true">{icon}</span> {heading}
      </h2>
      {todos.length > 0 && (
        <ul className="cal-pet-todos">
          {todos.map((todo) => {
            const done = todo.completedAt !== null;
            return (
              <li className="cal-pet-todo" key={todo.id}>
                <button
                  className="cal-pet-check"
                  type="button"
                  aria-pressed={done}
                  aria-label={`完成 ${todo.title}`}
                  onClick={() => toggle(todo)}
                >
                  {done ? '✓' : ''}
                </button>
                <span className={done ? 'cal-pet-todo-title done' : 'cal-pet-todo-title'}>{todo.title}</span>
                {isOverdue(todo, todayKey) && todo.dueDate && (
                  <span className="cal-pet-overdue">
                    逾期・原{Number(todo.dueDate.slice(5, 7))}/{Number(todo.dueDate.slice(8, 10))}
                  </span>
                )}
                <button
                  className="cal-pet-delete"
                  type="button"
                  aria-label={`刪除 ${todo.title}`}
                  onClick={() => remove(todo)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {todos.length === 0 && emptyText && <p className="cal-pet-empty">{emptyText}</p>}
      <form className="cal-pet-add" onSubmit={submit} aria-busy={add.saving}>
        <input
          value={draft}
          // Not `disabled`, which would drop focus and the phone keyboard
          // between consecutive todos — the day sheet's rule (DP-137).
          readOnly={add.saving}
          maxLength={MAX_TITLE_INPUT_LENGTH}
          aria-invalid={tooLong}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          aria-label={inputLabel}
        />
        <button type="submit" disabled={tooLong} aria-label={addLabel}>
          ＋
        </button>
      </form>
      {tooLong && (
        <div className="cal-pet-error" role="alert">
          {TITLE_LENGTH_MESSAGE}
        </div>
      )}
      {add.error && !tooLong && (
        <div className="cal-pet-error" role="alert">
          {add.error}
        </div>
      )}
    </div>
  );
}

function isOverdue(todo: TodoItem, todayKey: string): boolean {
  return todo.completedAt === null && todo.dueDate !== null && todo.dueDate < todayKey;
}
