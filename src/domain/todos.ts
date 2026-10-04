import type { TodoItem } from './types';

/** A refused UI command, distinct from an invalid persisted document. */
export class TodoInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TodoInputError';
  }
}

export interface DayTodoGroup {
  todo: TodoItem;
  subtasks: { todo: TodoItem; depth: number }[];
}

/**
 * The todos that stand on their own outside the day sheet — DP-121.
 *
 * The原檔 keeps subtasks inside their parent (`t.subs`), so its list view,
 * overview and pet badge only ever count top-level todos. DayPop stores a
 * subtask as its own row, so those screens must drop the ones the day sheet
 * draws under a parent. Decided by `todoGroupsOn` itself, per date, so every
 * row they show is a card the day sheet shows too — including a subtask due on
 * another day than its parent, and one member of an imported cycle. Undated
 * todos have no day sheet; there only real subtasks are dropped.
 */
export function topLevelTodos(todos: TodoItem[]): TodoItem[] {
  const byDate = new Map<string, TodoItem[]>();
  for (const todo of todos) {
    if (todo.dueDate === null) continue;
    const dated = byDate.get(todo.dueDate) ?? [];
    dated.push(todo);
    byDate.set(todo.dueDate, dated);
  }
  const roots = new Set<string>();
  for (const [date, dated] of byDate) {
    for (const group of todoGroupsOn(dated, date)) roots.add(group.todo.id);
  }
  return todos.filter((todo) => (todo.dueDate === null ? todo.parentId === null : roots.has(todo.id)));
}

/** Groups only the rows already visible on this date; never changes persisted data. */
export function todoGroupsOn(todos: TodoItem[], date: string): DayTodoGroup[] {
  const ordered = todos.filter((todo) => todo.dueDate === date).sort((a, b) => a.sortOrder - b.sortOrder);
  const ids = new Set(ordered.map((todo) => todo.id));
  const children = new Map<string, TodoItem[]>();
  for (const todo of ordered) {
    if (todo.parentId === null) continue;
    const siblings = children.get(todo.parentId) ?? [];
    siblings.push(todo);
    children.set(todo.parentId, siblings);
  }
  const roots = ordered.filter((todo) => todo.parentId === null || !ids.has(todo.parentId));
  const visited = new Set<string>();
  const groups: DayTodoGroup[] = [];
  // The second pass keeps cyclic imported rows visible rather than hanging or
  // silently hiding them. Normal trees are already visited from their roots.
  for (const root of [...roots, ...ordered]) {
    if (visited.has(root.id)) continue;
    visited.add(root.id);
    const group: DayTodoGroup = { todo: root, subtasks: [] };
    const stack = (children.get(root.id) ?? []).map((todo) => ({ todo, depth: 1 })).reverse();
    while (stack.length) {
      const entry = stack.pop()!;
      if (visited.has(entry.todo.id)) continue;
      visited.add(entry.todo.id);
      group.subtasks.push(entry);
      const nested = children.get(entry.todo.id) ?? [];
      for (let index = nested.length - 1; index >= 0; index -= 1) stack.push({ todo: nested[index]!, depth: entry.depth + 1 });
    }
    groups.push(group);
  }
  return groups;
}
