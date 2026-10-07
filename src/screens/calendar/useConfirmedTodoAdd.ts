import { useEffect, useRef, useState } from 'react';
import { createDomainId } from '../../domain/types';

/** Shown under either add form in 日詳情 when the write was not confirmed. */
export const TODO_ADD_UNCONFIRMED_MESSAGE =
  '待辦尚未確認新增，輸入內容已保留；請先確認清單再重試。';

/**
 * Keeps a typed todo title until the queued write confirms — DP-137.
 *
 * The two add forms in 日詳情 used to clear their input the moment they called
 * `onAddTodo`, so a failed or refused write lost what the user had typed and
 * left only the App-wide warning. `addTodo` has returned the queue's
 * confirmation since DP-133; this waits for it.
 *
 * Callers mark the field `readOnly` rather than `disabled` while `saving`: a
 * disabled input drops focus and closes the phone keyboard, which would break
 * adding several todos in a row. A second submit is ignored here instead.
 * Nothing is re-sent automatically — a transport failure cannot tell whether
 * the server already has the row, so the retry is left to the user.
 *
 * That retry is safe because every attempt at one draft proposes the same id
 * (DP-142): if the first attempt was stored after all, the second reaches that
 * row instead of adding another. The id changes only once an add is confirmed.
 */
export function useConfirmedTodoAdd() {
  const [draft, setDraft] = useState('');
  const [draftId, setDraftId] = useState(createDomainId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** A synchronous `add` has already confirmed, exactly as in `EventSheet`. */
  async function submit(add: (draftId: string) => Promise<void> | void) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = add(draftId);
      if (result !== undefined) await result;
      if (mounted.current) {
        setDraft('');
        setDraftId(createDomainId());
      }
    } catch {
      if (mounted.current) setError(TODO_ADD_UNCONFIRMED_MESSAGE);
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return { draft, setDraft, saving, error, submit };
}
