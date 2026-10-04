import { describe, expect, it } from 'vitest';
import { createEmptyUserData, type TimedCalendarEvent } from './types';
import { draggedInterval, seriesIntervalForDrag } from './weekDrag';

function event(startsAt: string, endsAt: string, timezone = 'Asia/Taipei'): TimedCalendarEvent {
  return {
    id: '72000000-0000-4000-8000-000000000001', calendarId: createEmptyUserData().calendars[0]!.id,
    title: '夜班', allDay: false, startsAt, endsAt, timezone, recurrence: null,
    location: null, notes: null, reminderMinutes: [], sharingScope: 'inherit',
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  };
}
const overnight = () => event('2026-08-12T15:00:00.000Z', '2026-08-12T16:30:00.000Z');

describe('complete week drag intervals (DP-072)', () => {
  it('moves both endpoints across midnight instead of moving one display segment', () => {
    expect(draggedInterval(overnight(), 'Asia/Taipei', 60, 0, 'move')).toEqual({
      startsAt: '2026-08-12T16:00:00.000Z', endsAt: '2026-08-12T17:30:00.000Z',
    });
  });
  it('carries negative minute overflow into the preceding date', () => {
    expect(draggedInterval(overnight(), 'Asia/Taipei', -60, -1, 'move')).toEqual({
      startsAt: '2026-08-11T14:00:00.000Z', endsAt: '2026-08-11T15:30:00.000Z',
    });
  });
  it('keeps an imported three-day span when shifting columns', () => {
    expect(draggedInterval(event('2026-08-11T12:00:00.000Z', '2026-08-13T18:00:00.000Z'), 'Asia/Taipei', 0, 1, 'move'))
      .toEqual({ startsAt: '2026-08-12T12:00:00.000Z', endsAt: '2026-08-14T18:00:00.000Z' });
  });
  it('uses display clocks even when the event belongs to a different zone', () => {
    expect(draggedInterval({ ...overnight(), timezone: 'America/New_York' }, 'Asia/Taipei', 60, 1, 'move'))
      .toEqual({ startsAt: '2026-08-13T16:00:00.000Z', endsAt: '2026-08-13T17:30:00.000Z' });
  });
  it('reparses each endpoint on its own shifted calendar date across DST', () => {
    const source = event('2026-03-06T14:00:00.000Z', '2026-03-08T14:00:00.000Z', 'America/New_York');
    expect(draggedInterval(source, 'America/New_York', 0, 3, 'move')).toEqual({
      startsAt: '2026-03-09T13:00:00.000Z', endsAt: '2026-03-11T14:00:00.000Z',
    });
  });
  it('resizes only the final endpoint and keeps precise start seconds', () => {
    const source = { ...overnight(), startsAt: '2026-08-12T15:00:13.000Z' };
    expect(draggedInterval(source, 'Asia/Taipei', 60, 0, 'resize')).toEqual({
      startsAt: source.startsAt, endsAt: '2026-08-12T17:30:00.000Z',
    });
  });
  it('can resize across columns without shifting the starting endpoint', () => {
    expect(draggedInterval(overnight(), 'Asia/Taipei', 0, 1, 'resize')).toEqual({
      startsAt: '2026-08-12T15:00:00.000Z', endsAt: '2026-08-13T16:30:00.000Z',
    });
  });
  it.each([-90, -120])('rejects a zero/reversed resize (%i)', (minutes) => {
    expect(draggedInterval(overnight(), 'Asia/Taipei', minutes, 0, 'resize')).toBeNull();
  });
  it('rejects a resize shorter than a quarter hour', () => {
    expect(draggedInterval(event('2026-08-12T15:00:13.000Z', '2026-08-12T16:30:00.000Z'), 'Asia/Taipei', -75, 0, 'resize')).toBeNull();
  });
  it('keeps an unchanged later DST fold instant intact', () => {
    const source = event('2026-11-01T06:15:13.000Z', '2026-11-01T06:45:37.000Z', 'America/New_York');
    expect(draggedInterval(source, 'America/New_York', 0, 0, 'move')).toEqual({ startsAt: source.startsAt, endsAt: source.endsAt });
  });
  it('maps a summer occurrence to a winter series anchor without losing its overnight day', () => {
    const series = event('2026-01-29T04:00:00.000Z', '2026-01-29T06:30:00.000Z', 'America/New_York');
    const concrete = event('2026-08-13T03:00:00.000Z', '2026-08-13T05:30:00.000Z', series.timezone);
    const moved = draggedInterval(concrete, 'Asia/Taipei', 60, 1, 'move')!;
    expect(seriesIntervalForDrag(series, concrete, moved)).toEqual({
      startsAt: '2026-01-30T05:00:00.000Z', endsAt: '2026-01-30T07:30:00.000Z',
    });
  });
  it('maps an extended multi-day end span back to the series', () => {
    const series = overnight();
    const concrete = { ...series, startsAt: '2026-08-19T15:00:00.000Z', endsAt: '2026-08-19T16:30:00.000Z' };
    const moved = draggedInterval(concrete, 'Asia/Taipei', 0, 2, 'resize')!;
    expect(seriesIntervalForDrag(series, concrete, moved)).toEqual({ startsAt: series.startsAt, endsAt: '2026-08-14T16:30:00.000Z' });
  });
});
