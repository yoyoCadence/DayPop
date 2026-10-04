import { describe, expect, it } from 'vitest';
import { todoTree } from '../test/todoTree';
import { todoGroupsOn, topLevelTodos } from './todos';

describe('todoGroupsOn (DP-116)', () => {
  it('groups out-of-order descendants once, in saved sibling order', () => {
    const rows = todoTree('calendar');
    const before = structuredClone(rows);
    const groups = todoGroupsOn(rows, '2026-09-30');
    expect(groups.map((group) => group.todo.title)).toEqual(['父待辦', '保留待辦']);
    expect(groups[0]!.subtasks.map((item) => [item.todo.title, item.depth])).toEqual([['子項', 1], ['孫項', 2], ['已完成子項', 1]]);
    expect(rows).toEqual(before);
  });
  it('keeps a child on its own due date when the parent is on another date', () => {
    const rows = todoTree('calendar');
    const child = rows.find((todo) => todo.title === '子項')!;
    child.dueDate = '2026-10-01';
    expect(todoGroupsOn(rows, '2026-10-01').map((group) => group.todo.title)).toEqual(['子項']);
    expect(todoGroupsOn(rows, '2026-09-30').flatMap((group) => [group.todo, ...group.subtasks.map((item) => item.todo)]).map((todo) => todo.title)).not.toContain('子項');
  });
  it('leaves null-date rows out, matching the original day filter', () => {
    const rows = todoTree('calendar').map((todo) => ({ ...todo, dueDate: null }));
    expect(todoGroupsOn(rows, '2026-09-30')).toEqual([]);
  });
  it('keeps cyclic imported rows visible once and terminates', () => {
    const rows = todoTree('calendar');
    const a = { ...rows[0]!, id: 'a', parentId: 'b' };
    const b = { ...rows[0]!, id: 'b', parentId: 'a' };
    const groups = todoGroupsOn([a, b], '2026-09-30');
    expect(groups.flatMap((group) => [group.todo.id, ...group.subtasks.map((item) => item.todo.id)]).sort()).toEqual(['a', 'b']);
  });
});

describe('topLevelTodos (DP-121)', () => {
  const titles = (todos: { title: string }[]) => todos.map((todo) => todo.title);

  it('drops subtasks drawn under their parent, keeping saved order', () => {
    const rows = todoTree('calendar');
    const before = structuredClone(rows);
    expect(titles(topLevelTodos(rows))).toEqual(['保留待辦', '父待辦']);
    expect(rows).toEqual(before);
  });

  it('keeps a subtask whose parent is due on another date, as the day sheet does', () => {
    const rows = todoTree('calendar');
    rows.find((todo) => todo.title === '子項')!.dueDate = '2026-10-01';
    // 孫項 stays on 09-30 while its parent moved away, so it is a card there too.
    expect(titles(topLevelTodos(rows))).toEqual(['孫項', '保留待辦', '子項', '父待辦']);
    expect(todoGroupsOn(rows, '2026-10-01').map((group) => group.todo.title)).toEqual(['子項']);
    expect(todoGroupsOn(rows, '2026-09-30').map((group) => group.todo.title)).toEqual(['父待辦', '孫項', '保留待辦']);
  });

  it('lists exactly the day sheet cards for every date', () => {
    const rows = todoTree('calendar');
    rows.find((todo) => todo.title === '孫項')!.dueDate = '2026-10-02';
    const cards = ['2026-09-30', '2026-10-02'].flatMap((date) => todoGroupsOn(rows, date).map((group) => group.todo.id));
    expect(topLevelTodos(rows).map((todo) => todo.id).sort()).toEqual(cards.sort());
  });

  it('keeps one member of an imported cycle visible, like the day sheet', () => {
    const rows = todoTree('calendar');
    const a = { ...rows[0]!, id: 'a', parentId: 'b' };
    const b = { ...rows[0]!, id: 'b', parentId: 'a' };
    const listed = topLevelTodos([a, b]).map((todo) => todo.id);
    expect(listed).toEqual(todoGroupsOn([a, b], a.dueDate!).map((group) => group.todo.id));
    expect(listed).toHaveLength(1);
  });

  it('keeps undated top-level todos and drops undated subtasks', () => {
    const rows = todoTree('calendar').map((todo) => ({ ...todo, dueDate: null }));
    expect(titles(topLevelTodos(rows))).toEqual(['保留待辦', '父待辦']);
  });
});
