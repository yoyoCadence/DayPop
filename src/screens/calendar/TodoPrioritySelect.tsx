import { useContext,useRef, useState } from 'react';
import { DataContext } from '../../data/dataContext';
import { calendarPermission,type SharingWriteOptions } from '../../data/calendarSharing';
import type { TodoItem, TodoPriority } from '../../domain/types';

interface TodoPrioritySelectProps {
  todo: TodoItem;
  onSetPriority(id: string, priority: TodoPriority,options?:SharingWriteOptions): Promise<void>;
}

/** Display confirmed data; a failed write leaves the saved selection in place. */
export function TodoPrioritySelect({ todo, onSetPriority }: TodoPrioritySelectProps) {
  const context=useContext(DataContext);const readonly=calendarPermission(context?.sharing,todo.calendarId)==='view';
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);

  async function change(priority: TodoPriority) {
    if (pending.current || priority === todo.priority) return;
    pending.current = true;
    setSaving(true);
    setError(false);
    try {
      if(readonly) throw new Error('目前只能查看。');
      if(context?.sharing) await onSetPriority(todo.id,priority,{versions:{todos:{[todo.id]:todo.updatedAt}}});
      else await onSetPriority(todo.id, priority);
    } catch {
      setError(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="cal-day-priority" aria-busy={saving}>
      <select aria-label={`${todo.title} 的優先度`} title="優先度" value={todo.priority} disabled={readonly || saving}
        onChange={(event) => { void change(event.target.value as TodoPriority); }}>
        <option value="none">無優先</option>
        <option value="low">低優先</option>
        <option value="medium">中優先</option>
        <option value="high">高優先</option>
      </select>
      {error && <small role="alert">優先度尚未保存，請重新選擇。</small>}
    </div>
  );
}
