import { addDays, fromDateKey, toDateKey } from './date';
import { topLevelTodos } from './todos';
import type { TodoItem } from './types';

/**
 * What the pet's speech bubble lists and counts — DP-169, ported from the
 * 原檔's `todayTodos`／`tomorrowTodos`／`openToday` (`:1298-1307`).
 *
 * Only todos that stand on their own (DP-121): the原檔 keeps subtasks inside
 * their parent, so neither its bubble nor its badge ever lists one. A subtask
 * the day sheet draws as its own card — its parent is on another day — counts
 * here too, because `topLevelTodos` decides that per date exactly as the day
 * sheet does.
 */
export interface PetBubbleTodos {
  /** Due today, done or not, plus anything due earlier that is still open. */
  today: TodoItem[];
  /** Due tomorrow, done or not. */
  tomorrow: TodoItem[];
  tomorrowKey: string;
  /** Open and due today or earlier. The badge and the greeting both count these. */
  open: number;
  /** Of those, the ones marked 高. */
  important: number;
}

/**
 * `todayKey` is today in the display timezone (`useTodayKey`), so the bubble,
 * the badge and the day sheet's overdue marker agree about which day it is.
 *
 * Ordered by date, then by the saved order: overdue rows first, oldest first,
 * then today's in the order the day sheet shows them. The原檔 used its array
 * order, which is the same thing — older todos were added earlier, and its
 * drag reordering is what `sortOrder` stores.
 */
export function petBubbleTodos(todos: TodoItem[], todayKey: string): PetBubbleTodos {
  const tomorrowKey = toDateKey(addDays(fromDateKey(todayKey), 1));
  const dated = topLevelTodos(todos)
    .filter((todo): todo is TodoItem & { dueDate: string } => todo.dueDate !== null)
    .sort((left, right) =>
      left.dueDate === right.dueDate
        ? left.sortOrder - right.sortOrder
        : left.dueDate < right.dueDate
          ? -1
          : 1,
    );
  const today = dated.filter(
    (todo) => todo.dueDate === todayKey || (todo.completedAt === null && todo.dueDate < todayKey),
  );
  const open = today.filter((todo) => todo.completedAt === null);
  return {
    today,
    tomorrow: dated.filter((todo) => todo.dueDate === tomorrowKey),
    tomorrowKey,
    open: open.length,
    important: open.filter((todo) => todo.priority === 'high').length,
  };
}

/** The原檔's `greetingText` (`:1307`), word for word. */
export function petGreeting(petName: string, open: number, important: number): string {
  if (open === 0) return `嗨，我是${petName}！今天的待辦都清光啦，要看看明天的安排嗎？`;
  const importantPart = important > 0 ? `，其中 ${important} 件重要` : '';
  return `嗨，我是${petName}！今天還有 ${open} 件待辦${importantPart}，要一起看看嗎？`;
}
