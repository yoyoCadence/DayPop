import { useMemo, useState } from 'react';
import type { DayPopUserData } from '../domain/types';
import {
  LocalDayPopRepository,
  type NewEventInput,
  type NewTodoInput,
} from '../storage/localRepository';

export function useDayPopData() {
  const repository = useMemo(() => new LocalDayPopRepository(), []);
  const [data, setData] = useState<DayPopUserData>(() => repository.load());

  return {
    data,
    addEvent(input: NewEventInput) {
      if (!input.title.trim()) return;
      setData(repository.addEvent(input));
    },
    addTodo(input: NewTodoInput) {
      if (!input.title.trim()) return;
      setData(repository.addTodo(input));
    },
    toggleTodo(id: string) {
      setData(repository.toggleTodo(id));
    },
  };
}
