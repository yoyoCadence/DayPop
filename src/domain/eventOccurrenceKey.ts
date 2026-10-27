import type { EventOccurrence } from './types';

const TIMED_INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/** Compare instants, not their transport encoding; never rewrite stored values. */
export function eventOccurrenceKey(occurrence: EventOccurrence): string {
  if (occurrence.kind === 'all-day') return `all-day:${occurrence.date}`;
  const parts = TIMED_INSTANT.exec(occurrence.startsAt);
  if (!parts) throw new RangeError('invalid timed occurrence instant');
  const seconds = new Date(`${parts[1]}${parts[3]}`);
  if (!Number.isFinite(seconds.getTime())) throw new RangeError('invalid timed occurrence instant');
  // Date handles the offset on whole seconds. Keep the fraction as text so
  // distinct microseconds do not collapse to JavaScript's millisecond precision.
  const fraction = (parts[2] ?? '').replace(/0+$/, '').padEnd(3, '0');
  return `timed:${seconds.toISOString().replace(/\.000Z$/, '')}.${fraction}Z`;
}
