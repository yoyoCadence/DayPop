import type { TodoCompletionSource } from './dataContext';

/** Owned by one data identity. No history, identifiers or persistent state. */
export function createTodoCompletionFeedback() {
  const listeners = new Set<{ notify(): void }>();
  const source: TodoCompletionSource = {
    subscribe(notify) {
      const subscription = { notify };
      listeners.add(subscription);
      return () => { listeners.delete(subscription); };
    },
  };
  return {
    source,
    clear() { listeners.clear(); },
    capture() {
      const recipients = [...listeners];
      return () => {
        for (const recipient of recipients) {
          if (!listeners.has(recipient)) continue;
          // Optional presentation feedback must never reject a saved command.
          try { recipient.notify(); } catch { /* Keep the data confirmation intact. */ }
        }
      };
    },
  };
}
