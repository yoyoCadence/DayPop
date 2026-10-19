import { useContext,useId, useState, type FormEvent } from 'react';
import { DataContext } from '../../data/dataContext';
import { calendarPermission,receivedCalendar } from '../../data/calendarSharing';
import { useRetainedSharingDraft } from '../../data/retainedSharingDraft';
import type { DayTodoGroup } from '../../domain/todos';
import type { NewTodoInput } from '../../domain/mutations';
import { EditableTodoTitle } from './EditableTodoTitle';
import { EditableTodoDate } from './EditableTodoDate';
import { TodoPrioritySelect } from './TodoPrioritySelect';
import type { TodoPriority,TodoItem } from '../../domain/types';
import { isTitleTooLong, MAX_TITLE_INPUT_LENGTH, TITLE_LENGTH_MESSAGE } from '../../domain/titles';
import { useConfirmedTodoAdd } from './useConfirmedTodoAdd';

interface DayTodoCardProps extends DayTodoGroup {
  dateKey: string;
  todayKey: string;
  onAddTodo(input: NewTodoInput): Promise<void> | void;
  onToggleTodo(id: string): void;
  onDeleteTodo(id: string): void;
  onRenameTodo(id: string, title: string): Promise<void>;
  onSetTodoPriority(id: string, priority: TodoPriority): Promise<void>;
  onRescheduleTodo(id: string, date: string): Promise<void>;
  onDateSaved(): void;
  datePending: boolean;
}

/** Original day sheet card / sublist (:561), with native keyboard controls. */
export function DayTodoCard({ todo, subtasks, dateKey, todayKey, onAddTodo, onToggleTodo, onDeleteTodo, onRenameTodo, onSetTodoPriority, onRescheduleTodo, onDateSaved, datePending }: DayTodoCardProps) {
  const context=useContext(DataContext);const readonly=calendarPermission(context?.sharing,todo.calendarId)==='view';
  const [expanded, setExpanded] = useState(false);
  const subAdd = useConfirmedTodoAdd();
  const { draft, setDraft } = subAdd;
  useRetainedSharingDraft(`todo-child-${todo.id}`,'新增細項草稿',draft,Boolean(draft),
    Boolean(context?.sharing?.shares.some(share=>share.calendarId===todo.calendarId)));
  const detailsId = useId();
  const canAdd = todo.parentId === null;
  const expandable = canAdd || subtasks.length > 0;
  const complete = todo.completedAt !== null;
  const doneCount = subtasks.filter((item) => item.todo.completedAt !== null).length;
  const overdue = !complete && todo.dueDate !== null && todo.dueDate < todayKey;
  const title = <span className="cal-day-todo-title-text" style={{ color: complete ? 'var(--muted)' : 'var(--fg)', textDecoration: complete ? 'line-through' : 'none' }}>{todo.title}</span>;

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || isTitleTooLong(draft)) return;
    // Cleared only once the add is confirmed; a failure keeps the text (DP-137).
    void subAdd.submit((id) => onAddTodo({ id, title: draft.trim(), date: dateKey, parentId: todo.id }));
  }

  return (
    <div className="cal-day-todo">
      <div className="cal-day-todo-row">
        <button className="cal-day-check" type="button" disabled={readonly} aria-pressed={complete} aria-label={`完成 ${todo.title}`} onClick={() => onToggleTodo(todo.id)} style={{ background: complete ? 'var(--accent)' : 'transparent' }}>
          {complete ? '✓' : ''}
        </button>
        <EditableTodoTitle todo={todo} onRename={onRenameTodo}>{expandable ? (
          <button className="cal-day-todo-title" type="button" aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded ? '收合' : '展開'} ${todo.title} 的子項`} onClick={() => setExpanded((value) => !value)}>
            {title}
            {subtasks.length > 0 && <span className="cal-day-sub-count" aria-label={`${doneCount}/${subtasks.length} 子項完成`}>{expanded ? '▾' : '▸'} {doneCount}/{subtasks.length}</span>}
          </button>
        ) : <span className="cal-day-todo-title">{title}</span>}</EditableTodoTitle>
        <div className="cal-day-todo-meta">
          <TodoPrioritySelect todo={todo} onSetPriority={onSetTodoPriority} />
          {overdue && <span className="cal-day-overdue">逾期・原{Number(dateKey.slice(5, 7))}/{Number(dateKey.slice(8, 10))}</span>}
        </div>
        <TodoPrivacyButton todo={todo}/>
        <button className="cal-day-delete" type="button" disabled={readonly} aria-label={`刪除 ${todo.title}`} onClick={() => onDeleteTodo(todo.id)}>×</button>
      </div>
      <EditableTodoDate todo={todo} datePending={datePending} onReschedule={onRescheduleTodo} onSaved={onDateSaved} />
      {expanded && (
        <div className="cal-day-subtasks" id={detailsId} role="group" aria-label={`${todo.title} 的子項`}>
          {subtasks.map(({ todo: sub, depth }) => {
            const done = sub.completedAt !== null;
            return (
              <div key={sub.id} style={{ paddingLeft: `${Math.min(depth - 1, 3) * 8}px` }}>
                <div className="cal-day-subtask">
                  <button className="cal-day-sub-check" type="button" disabled={readonly} aria-pressed={done} aria-label={`完成 ${sub.title}`} onClick={() => onToggleTodo(sub.id)} style={{ background: done ? 'var(--accent)' : 'transparent' }}>{done ? '✓' : ''}</button>
                  <EditableTodoTitle todo={sub} onRename={onRenameTodo}><span className="cal-day-sub-title" style={{ color: done ? 'var(--muted)' : 'var(--fg)', textDecoration: done ? 'line-through' : 'none' }}>{sub.title}</span></EditableTodoTitle>
                  <TodoPrioritySelect todo={sub} onSetPriority={onSetTodoPriority} />
                  <TodoPrivacyButton todo={sub}/>
                  <button className="cal-day-sub-delete" type="button" disabled={readonly} aria-label={`刪除 ${sub.title}`} onClick={() => onDeleteTodo(sub.id)}>×</button>
                </div>
                <EditableTodoDate todo={sub} datePending={datePending} onReschedule={onRescheduleTodo} onSaved={onDateSaved} />
              </div>
            );
          })}
          {canAdd && !readonly && (
            <form className="cal-day-sub-add" onSubmit={add} aria-busy={subAdd.saving}>
              <input value={draft} readOnly={subAdd.saving} maxLength={MAX_TITLE_INPUT_LENGTH} aria-invalid={isTitleTooLong(draft)} onChange={(event) => setDraft(event.target.value)} placeholder="新增細項…" aria-label={`新增 ${todo.title} 的細項`} />
              <button type="submit" disabled={isTitleTooLong(draft)} aria-label={`新增 ${todo.title} 的子項`}>＋</button>
            </form>
          )}
          {isTitleTooLong(draft) && <div className="cal-day-title-error" role="alert">{TITLE_LENGTH_MESSAGE}</div>}
          {subAdd.error && !isTitleTooLong(draft) && <div className="cal-day-title-error" role="alert">{subAdd.error}</div>}
        </div>
      )}
    </div>
  );
}

function TodoPrivacyButton({todo}:{todo:TodoItem}) {
  const context=useContext(DataContext);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  if(!context?.actions.setTodoSharingScope || receivedCalendar(context.sharing,todo.calendarId)) return null;
  async function change() {
    if(busy || !context?.actions.setTodoSharingScope) return;
    setBusy(true);setError(null);
    try {await context.actions.setTodoSharingScope(todo.id,todo.sharingScope==='private'?'inherit':'private');}
    catch {setError('不分享設定尚未保存，請重試。');}finally{setBusy(false);}
  }
  return <span className="cal-todo-privacy"><button className="cal-day-rename" type="button" disabled={busy}
    aria-label={`${todo.title} 不分享`} aria-pressed={todo.sharingScope==='private'} onClick={()=>void change()}>{todo.sharingScope==='private'?'不分享':'可分享'}</button>
    {error?<span className="cal-day-title-error" role="alert">{error}</span>:null}</span>;
}
