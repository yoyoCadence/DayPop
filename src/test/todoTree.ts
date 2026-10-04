import type { TodoItem } from '../domain/types';

/** Synthetic, deliberately out-of-order descendants for deletion regressions. */
export function todoTree(calendarId: string): TodoItem[] {
  const id = (n: number) => `11500000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const common = {
    calendarId, dueDate: '2026-09-30', priority: 'none' as const, sharingScope: 'inherit' as const,
    createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z',
  };
  return [
    { ...common, id: id(3), parentId: id(2), title: '孫項', completedAt: null, sortOrder: 2 },
    { ...common, id: id(5), parentId: null, title: '保留待辦', completedAt: null, sortOrder: 4 },
    { ...common, id: id(2), parentId: id(1), title: '子項', completedAt: null, sortOrder: 1 },
    { ...common, id: id(4), parentId: id(1), title: '已完成子項', completedAt: '2026-09-29T02:00:00.000Z', sortOrder: 3 },
    { ...common, id: id(1), parentId: null, title: '父待辦', completedAt: null, sortOrder: 0 },
  ];
}
