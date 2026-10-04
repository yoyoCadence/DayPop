import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TodoItem } from '../../domain/types';

interface EditableTodoTitleProps {
  todo: TodoItem;
  children: ReactNode;
  onRename(id: string, title: string): Promise<void>;
}

/** Inline title-only edit; other card actions keep their original meaning. */
export function EditableTodoTitle({ todo, children, onRename }: EditableTodoTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const pending = useRef(false);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus();
    }
  }, [editing]);

  function close() {
    restoreFocus.current = true;
    setEditing(false);
  }

  async function save() {
    const title = draft.trim();
    if (!title || pending.current) return;
    if (title === todo.title) {
      close();
      return;
    }
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await onRename(todo.id, title);
      close();
    } catch {
      setError('標題尚未保存，請重試。');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="cal-day-editable-title">
      {editing ? (
        <form className="cal-day-title-editor" aria-label={`修改 ${todo.title} 的標題`} onSubmit={(event) => {
          event.preventDefault();
          void save();
        }} onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          if (!pending.current) close();
        }}>
          <input ref={input} aria-label="待辦標題" value={draft} disabled={saving} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" disabled={saving || !draft.trim()}>{saving ? '保存中' : '儲存'}</button>
          <button type="button" disabled={saving} onClick={close}>取消</button>
          {error && <span className="cal-day-title-error" role="alert">{error}</span>}
        </form>
      ) : <>
        {children}
        <button ref={trigger} className="cal-day-rename" type="button" aria-label={`修改 ${todo.title} 的標題`} onClick={() => {
          setDraft(todo.title);
          setError(null);
          setEditing(true);
        }}>✎</button>
      </>}
    </div>
  );
}
