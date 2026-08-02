import { useMemo, useState } from 'react';
import type { DayPopUserData } from '../domain/types';
import {
  LOCAL_DATA_BLOCKED_EVENT,
  LocalDataBlockedError,
  LocalDayPopRepository,
  type EventPatch,
  type NewEventInput,
  type NewTodoInput,
} from '../storage/localRepository';

export function useDayPopData() {
  const repository = useMemo(() => new LocalDayPopRepository(), []);
  const [data, setData] = useState<DayPopUserData>(() => repository.load());

  /**
   * `App` checks the stored data before any screen mounts, so a blocked write
   * here means the bytes changed mid-session — another tab, or a manual edit.
   * Swallow the error and announce it: the repository already refused to write,
   * and `App` swaps in the recovery screen when it hears the event.
   */
  function guard(mutate: () => DayPopUserData) {
    try {
      setData(mutate());
    } catch (error) {
      if (!(error instanceof LocalDataBlockedError)) throw error;
      window.dispatchEvent(new CustomEvent(LOCAL_DATA_BLOCKED_EVENT));
    }
  }

  return {
    data,
    addEvent(input: NewEventInput) {
      if (!input.title.trim()) return;
      guard(() => repository.addEvent(input));
    },
    updateEvent(id: string, patch: EventPatch) {
      guard(() => repository.updateEvent(id, patch));
    },
    deleteEvent(id: string) {
      guard(() => repository.deleteEvent(id));
    },
    addTodo(input: NewTodoInput) {
      if (!input.title.trim()) return;
      guard(() => repository.addTodo(input));
    },
    toggleTodo(id: string) {
      guard(() => repository.toggleTodo(id));
    },
    deleteTodo(id: string) {
      guard(() => repository.deleteTodo(id));
    },
  };
}
