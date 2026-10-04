import { useId, useState, type FormEvent } from 'react';
import type { DayTodoGroup } from '../../domain/todos';
import type { NewTodoInput } from '../../domain/mutations';
import { EditableTodoTitle } from './EditableTodoTitle';
import { isTitleTooLong, MAX_TITLE_INPUT_LENGTH, TITLE_LENGTH_MESSAGE } from '../../domain/titles';

interface DayTodoCardProps extends DayTodoGroup {
  dateKey: string;
  todayKey: string;
  onAddTodo(input: NewTodoInput): void;
  onToggleTodo(id: string): void;
  onDeleteTodo(id: string): void;
  onRenameTodo(id: string, title: string): Promise<void>;
}

/** Original day sheet card / sublist (:561), with native keyboard controls. */
export function DayTodoCard({ todo, subtasks, dateKey, todayKey, onAddTodo, onToggleTodo, onDeleteTodo, onRenameTodo }: DayTodoCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const detailsId = useId();
  const canAdd = todo.parentId === null;
  const expandable = canAdd || subtasks.length > 0;
  const complete = todo.completedAt !== null;
  const doneCount = subtasks.filter((item) => item.todo.completedAt !== null).length;
  const overdue = !complete && todo.dueDate !== null && todo.dueDate < todayKey;
  const title = <span className="cal-day-todo-title-text" style={{ color: complete ? 'var(--faint)' : 'var(--fg)', textDecoration: complete ? 'line-through' : 'none' }}>{todo.title}</span>;

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || isTitleTooLong(draft)) return;
    onAddTodo({ title: draft.trim(), date: dateKey, parentId: todo.id });
    setDraft('');
  }

  return (
    <div className="cal-day-todo">
      <div className="cal-day-todo-row">
        <button className="cal-day-check" type="button" aria-pressed={complete} aria-label={`完成 ${todo.title}`} onClick={() => onToggleTodo(todo.id)} style={{ background: complete ? 'var(--accent)' : 'transparent' }}>
          {complete ? '✓' : ''}
        </button>
        <EditableTodoTitle todo={todo} onRename={onRenameTodo}>{expandable ? (
          <button className="cal-day-todo-title" type="button" aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded ? '收合' : '展開'} ${todo.title} 的子項`} onClick={() => setExpanded((value) => !value)}>
            {title}
            {subtasks.length > 0 && <span className="cal-day-sub-count" aria-label={`${doneCount}/${subtasks.length} 子項完成`}>{expanded ? '▾' : '▸'} {doneCount}/{subtasks.length}</span>}
          </button>
        ) : <span className="cal-day-todo-title">{title}</span>}</EditableTodoTitle>
        {overdue && <span className="cal-day-overdue">逾期・原{Number(dateKey.slice(5, 7))}/{Number(dateKey.slice(8, 10))}</span>}
        <button className="cal-day-delete" type="button" aria-label={`刪除 ${todo.title}`} onClick={() => onDeleteTodo(todo.id)}>×</button>
      </div>
      {expanded && (
        <div className="cal-day-subtasks" id={detailsId} role="group" aria-label={`${todo.title} 的子項`}>
          {subtasks.map(({ todo: sub, depth }) => {
            const done = sub.completedAt !== null;
            return (
              <div className="cal-day-subtask" key={sub.id} style={{ paddingLeft: `${Math.min(depth - 1, 3) * 8}px` }}>
                <button className="cal-day-sub-check" type="button" aria-pressed={done} aria-label={`完成 ${sub.title}`} onClick={() => onToggleTodo(sub.id)} style={{ background: done ? 'var(--accent)' : 'transparent' }}>{done ? '✓' : ''}</button>
                <EditableTodoTitle todo={sub} onRename={onRenameTodo}><span className="cal-day-sub-title" style={{ color: done ? 'var(--faint)' : 'var(--fg)', textDecoration: done ? 'line-through' : 'none' }}>{sub.title}</span></EditableTodoTitle>
                <button className="cal-day-sub-delete" type="button" aria-label={`刪除 ${sub.title}`} onClick={() => onDeleteTodo(sub.id)}>×</button>
              </div>
            );
          })}
          {canAdd && (
            <form className="cal-day-sub-add" onSubmit={add}>
              <input value={draft} maxLength={MAX_TITLE_INPUT_LENGTH} aria-invalid={isTitleTooLong(draft)} onChange={(event) => setDraft(event.target.value)} placeholder="新增細項…" aria-label={`新增 ${todo.title} 的細項`} />
              <button type="submit" disabled={isTitleTooLong(draft)} aria-label={`新增 ${todo.title} 的子項`}>＋</button>
            </form>
          )}
          {isTitleTooLong(draft) && <div className="cal-day-title-error" role="alert">{TITLE_LENGTH_MESSAGE}</div>}
        </div>
      )}
    </div>
  );
}
