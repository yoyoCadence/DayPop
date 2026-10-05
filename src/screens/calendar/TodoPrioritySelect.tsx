import { useRef, useState } from 'react';
import type { TodoItem, TodoPriority } from '../../domain/types';

interface TodoPrioritySelectProps {
  todo: TodoItem;
  onSetPriority(id: string, priority: TodoPriority): Promise<void>;
}

/** Display confirmed data; a failed write leaves the saved selection in place. */
export function TodoPrioritySelect({ todo, onSetPriority }: TodoPrioritySelectProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);

  async function change(priority: TodoPriority) {
    if (pending.current || priority === todo.priority) return;
    pending.current = true;
    setSaving(true);
    setError(false);
    try {
      await onSetPriority(todo.id, priority);
    } catch {
      setError(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="cal-day-priority" aria-busy={saving}>
      <select aria-label={`${todo.title} 的優先度`} title="優先度" value={todo.priority} disabled={saving}
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
