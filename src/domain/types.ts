export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
  createdAt: string;
  updatedAt: string;
}

export interface TodoItem {
  id: string;
  title: string;
  date: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserPreferences {
  weekStartsOn: 0 | 1;
  theme: 'system' | 'light' | 'dark';
  petName: string;
}

export interface DayPopUserData {
  events: CalendarEvent[];
  todos: TodoItem[];
  preferences: UserPreferences;
}

export function createEmptyUserData(): DayPopUserData {
  return {
    events: [],
    todos: [],
    preferences: {
      weekStartsOn: 0,
      theme: 'system',
      petName: '摩卡',
    },
  };
}
