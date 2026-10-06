import { useEffect, useId, useRef, useState } from 'react';
import type { TodoItem } from '../../domain/types';
import { isDateKey } from '../../domain/validation';

interface EditableTodoDateProps {
  todo: TodoItem;
  datePending: boolean;
  onReschedule(id: string, date: string): Promise<void>;
  /** The edited row leaves this day; return focus to the surviving sheet. */
  onSaved(): void;
}

export function EditableTodoDate({ todo, datePending, onReschedule, onSaved }: EditableTodoDateProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const restoreFocus = useRef(false);
  const pending = useRef(false);
  const hintId = useId();
  const errorId = useId();
  const issue = !isDateKey(draft) ? '請選擇有效的待辦日期。' : error;

  useEffect(() => {
    if (editing) input.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus();
    }
  }, [editing]);

  function close(restore = true) {
    restoreFocus.current = restore;
    setEditing(false);
  }

  async function save() {
    if (!isDateKey(draft) || pending.current || datePending) return;
    if (draft === todo.dueDate) {
      close();
      return;
    }
    const editor = form.current;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await onReschedule(todo.id, draft);
      close(false);
      // Do not steal focus if the user opened another control while waiting.
      if (document.activeElement === document.body || editor?.contains(document.activeElement)) onSaved();
    } catch {
      setError('日期尚未保存，請重試。');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="cal-day-date">
      {editing ? (
        <form ref={form} className="cal-day-date-editor" noValidate aria-label={`修改 ${todo.title} 的日期`} onSubmit={(event) => {
          event.preventDefault();
          void save();
        }} onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          if (!pending.current && !datePending) close();
        }}>
          <input ref={input} type="date" required min="0100-01-01" max="9999-12-31" aria-label={`${todo.title} 的日期`} aria-invalid={!isDateKey(draft)} aria-describedby={`${hintId}${issue ? ` ${errorId}` : ''}`} value={draft} disabled={saving || datePending} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" disabled={saving || datePending || !isDateKey(draft)}>{saving ? '保存中' : '儲存'}</button>
          <button type="button" disabled={saving || datePending} onClick={() => close()}>取消</button>
          <span className="cal-day-date-hint" id={hintId}>只更改這一項，其他待辦日期不變。</span>
          {issue && <span className="cal-day-title-error" id={errorId} role="alert">{issue}</span>}
        </form>
      ) : <button ref={trigger} className="cal-day-date-trigger" type="button" disabled={datePending} aria-label={`修改 ${todo.title} 的日期`} onClick={() => {
        setDraft(todo.dueDate ?? '');
        setError(null);
        setEditing(true);
      }}>改日期</button>}
    </div>
  );
}
