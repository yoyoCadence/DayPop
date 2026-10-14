import { useId, useMemo, useRef, useState } from 'react';
import { useDayPopData } from '../data/dataContext';
import { todoGroupsOn } from '../domain/todos';
import { DayTodoCard } from './calendar/DayTodoCard';

export interface UndatedTodosProps {
  todayKey: string;
}

/**
 * 綜覽's 未排日期 — DP-173.
 *
 * A todo with no due date can only arrive through an import: the App's own
 * forms always give one. Until this, such a todo could be found in 搜尋 but
 * not opened, and no screen listed it, so it could not be renamed, given a
 * date, completed or deleted. This lists them with the day sheet's own card,
 * so they are managed exactly as any other todo; giving one a date moves it to
 * that day. A fuller inbox — creating undated todos, clearing a date — waits
 * until the pet's speech bubble needs somewhere to send them.
 *
 * Not in the原檔, whose todos always have a day; a DayPop addition recorded in
 * the ADR. Renders nothing while there are none, which is the usual case.
 */
export function UndatedTodos({ todayKey }: UndatedTodosProps) {
  const { data, addTodo, toggleTodo, deleteTodo, renameTodo, setTodoPriority, rescheduleTodo } =
    useDayPopData();
  const groups = useMemo(() => todoGroupsOn(data.todos, null), [data.todos]);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const pendingDate = useRef(false);
  const [datePending, setDatePending] = useState(false);

  // One date write at a time across the cards, as in the day sheet (DP-132):
  // giving a parent a date regroups its subtasks.
  async function reschedule(id: string, date: string) {
    if (pendingDate.current) throw new Error('請等待目前的日期保存完成。');
    pendingDate.current = true;
    setDatePending(true);
    try {
      await rescheduleTodo(id, date);
    } finally {
      pendingDate.current = false;
      setDatePending(false);
    }
  }

  if (groups.length === 0) return null;

  return (
    <section className="overview-undated" aria-labelledby={headingId}>
      <h2 className="overview-undated-title" id={headingId} ref={heading} tabIndex={-1}>
        未排日期
        <span className="overview-group-count">({groups.length})</span>
      </h2>
      <p className="overview-undated-hint">排上日期後，會移到那一天。</p>
      {groups.map((group) => (
        <DayTodoCard
          key={group.todo.id}
          {...group}
          // Only used as the date of a new subtask, which takes its parent's
          // (none) instead.
          dateKey={todayKey}
          todayKey={todayKey}
          onAddTodo={addTodo}
          onToggleTodo={toggleTodo}
          onDeleteTodo={deleteTodo}
          onRenameTodo={renameTodo}
          onSetTodoPriority={setTodoPriority}
          onRescheduleTodo={reschedule}
          // The card has just left this list; keep focus in the section.
          onDateSaved={() => heading.current?.focus()}
          datePending={datePending}
        />
      ))}
    </section>
  );
}
