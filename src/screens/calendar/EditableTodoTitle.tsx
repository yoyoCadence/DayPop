import { useContext,useEffect, useRef, useState, type ReactNode } from 'react';
import { DataContext } from '../../data/dataContext';
import { calendarPermission,type SharingWriteOptions } from '../../data/calendarSharing';
import { useRetainedSharingDraft } from '../../data/retainedSharingDraft';
import type { TodoItem } from '../../domain/types';
import { isTitleTooLong, MAX_TITLE_INPUT_LENGTH, TITLE_LENGTH_MESSAGE } from '../../domain/titles';

interface EditableTodoTitleProps {
  todo: TodoItem;
  children: ReactNode;
  onRename(id: string, title: string,options?:SharingWriteOptions): Promise<void>;
}

/** Inline title-only edit; other card actions keep their original meaning. */
export function EditableTodoTitle({ todo, children, onRename }: EditableTodoTitleProps) {
  const context=useContext(DataContext);
  const readonly=calendarPermission(context?.sharing,todo.calendarId)==='view';
  const [baseVersion,setBaseVersion]=useState(todo.updatedAt);
  const [baseTitle,setBaseTitle]=useState(todo.title);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const protection=useRetainedSharingDraft(`todo-title-${todo.id}`,'待辦標題草稿',draft,editing && draft!==baseTitle,
    Boolean(context?.sharing?.shares.some(share=>share.calendarId===todo.calendarId)));
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
    protection.discard();
    restoreFocus.current = true;
    setEditing(false);
  }

  async function save() {
    const title = draft.trim();
    if (!title || isTitleTooLong(title) || pending.current) return;
    if (title === todo.title) {
      close();
      return;
    }
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      if(readonly) throw new Error('目前只能查看。');
      if(context?.sharing) await onRename(todo.id,title,{versions:{todos:{[todo.id]:baseVersion}}});
      else await onRename(todo.id, title);
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
          <input ref={input} aria-label="待辦標題" maxLength={MAX_TITLE_INPUT_LENGTH} aria-invalid={isTitleTooLong(draft)} value={draft} disabled={saving} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" disabled={readonly || saving || !draft.trim() || isTitleTooLong(draft)}>{saving ? '保存中' : '儲存'}</button>
          <button type="button" disabled={saving} onClick={close}>取消</button>
          {(isTitleTooLong(draft) || error) && <span className="cal-day-title-error" role="alert">{isTitleTooLong(draft) ? TITLE_LENGTH_MESSAGE : error}</span>}
        </form>
      ) : <>
        {children}
        <button ref={trigger} className="cal-day-rename" type="button" disabled={readonly} aria-label={`修改 ${todo.title} 的標題`} onClick={() => {
          setBaseVersion(todo.updatedAt);
          setBaseTitle(todo.title);
          setDraft(todo.title);
          setError(null);
          setEditing(true);
        }}>✎</button>
      </>}
    </div>
  );
}
