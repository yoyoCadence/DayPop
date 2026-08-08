import { describe, expect, it } from 'vitest';
import type { Tables } from '../lib/database.types';
import {
  calendarFromRow,
  calendarToInsert,
  eventExceptionFromRow,
  eventExceptionToInsert,
  eventFromRow,
  eventToInsert,
  preferencesFromRow,
  preferencesToInsert,
  stickerFromRow,
  stickerToInsert,
  todoFromRow,
  todoToInsert,
} from './databaseMapping';

const OWNER_ID = '00000000-0000-4000-8000-0000000000a1';
const CALENDAR_ID = '00000000-0000-4000-8000-0000000000c1';
const EVENT_ID = '00000000-0000-4000-8000-0000000000e1';
const EVENT_2_ID = '00000000-0000-4000-8000-0000000000e2';
const NOW = '2026-08-04T02:00:00.000Z';

describe('domain ↔ DB mapping', () => {
  it('maps calendar rows without allowing client timestamps on insert', () => {
    const row: Tables<'calendars'> = {
      id: CALENDAR_ID,
      owner_id: OWNER_ID,
      name: '工作',
      color: '#123ABC',
      is_visible: true,
      is_default: true,
      sort_order: 0,
      created_at: NOW,
      updated_at: NOW,
    };
    const domain = calendarFromRow(row);
    expect(calendarToInsert(domain, OWNER_ID)).toEqual({
      id: CALENDAR_ID,
      owner_id: OWNER_ID,
      name: '工作',
      color: '#123ABC',
      is_visible: true,
      is_default: true,
      sort_order: 0,
    });
    expect(() => calendarToInsert(domain, 'not-an-owner-id')).toThrow(/UUID/);
  });

  it('round-trips timed events as instants plus an IANA timezone', () => {
    const row = eventRow({
      is_all_day: false,
      starts_at: '2026-08-04T01:00:00.000Z',
      ends_at: '2026-08-04T02:00:00.000Z',
      timezone: 'Asia/Taipei',
      recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU',
    });
    const domain = eventFromRow(row);
    expect(domain).toMatchObject({
      allDay: false,
      startsAt: '2026-08-04T01:00:00.000Z',
      endsAt: '2026-08-04T02:00:00.000Z',
      timezone: 'Asia/Taipei',
      recurrence: { rule: 'FREQ=WEEKLY;BYDAY=TU' },
    });
    expect(eventToInsert(domain, OWNER_ID)).toMatchObject({
      owner_id: OWNER_ID,
      start_date: null,
      end_date: null,
      starts_at: '2026-08-04T01:00:00.000Z',
      ends_at: '2026-08-04T02:00:00.000Z',
      timezone: 'Asia/Taipei',
    });
  });

  it('keeps all-day end_date inclusive', () => {
    const domain = eventFromRow(
      eventRow({
        is_all_day: true,
        start_date: '2026-08-04',
        end_date: '2026-08-06',
        starts_at: null,
        ends_at: null,
        timezone: null,
      }),
    );
    expect(domain).toMatchObject({
      allDay: true,
      startDate: '2026-08-04',
      endDate: '2026-08-06',
    });
    expect(eventToInsert(domain, OWNER_ID)).toMatchObject({
      start_date: '2026-08-04',
      end_date: '2026-08-06',
      starts_at: null,
      ends_at: null,
      timezone: null,
    });
  });

  it('maps exception occurrence and replacement shape', () => {
    const row: Tables<'event_exceptions'> = {
      id: '00000000-0000-4000-8000-0000000000f1',
      owner_id: OWNER_ID,
      event_id: EVENT_ID,
      occurrence_date: null,
      occurrence_starts_at: '2026-08-11T01:00:00.000Z',
      is_cancelled: false,
      replacement_event_id: EVENT_2_ID,
      created_at: NOW,
      updated_at: NOW,
    };
    const domain = eventExceptionFromRow(row);
    expect(domain).toMatchObject({
      occurrence: { kind: 'timed', startsAt: '2026-08-11T01:00:00.000Z' },
      isCancelled: false,
      replacementEventId: EVENT_2_ID,
    });
    expect(eventExceptionToInsert(domain, OWNER_ID)).toMatchObject({
      occurrence_date: null,
      occurrence_starts_at: '2026-08-11T01:00:00.000Z',
      is_cancelled: false,
      replacement_event_id: EVENT_2_ID,
    });
  });

  it('maps todo and sticker storage fields explicitly', () => {
    const todoRow: Tables<'todos'> = {
      id: '00000000-0000-4000-8000-0000000000d1',
      owner_id: OWNER_ID,
      calendar_id: CALENDAR_ID,
      parent_id: null,
      title: '買菜',
      due_date: '2026-08-04',
      priority: 'high',
      completed_at: null,
      sort_order: 2,
      sharing_scope: 'private',
      created_at: NOW,
      updated_at: NOW,
    };
    expect(todoToInsert(todoFromRow(todoRow), OWNER_ID)).toMatchObject({
      due_date: '2026-08-04',
      priority: 'high',
      sort_order: 2,
      sharing_scope: 'private',
    });

    const stickerRow: Tables<'stickers'> = {
      id: '00000000-0000-4000-8000-0000000000b1',
      owner_id: OWNER_ID,
      calendar_id: CALENDAR_ID,
      sticker_date: '2026-08-04',
      glyph: '🎉',
      asset_key: null,
      sort_order: 1,
      created_at: NOW,
      updated_at: NOW,
    };
    expect(stickerToInsert(stickerFromRow(stickerRow), OWNER_ID)).toMatchObject({
      sticker_date: '2026-08-04',
      glyph: '🎉',
      asset_key: null,
      sort_order: 1,
    });
  });

  it('maps semantic grid and visual theme preferences without numeric encoding', () => {
    const row: Tables<'user_preferences'> = {
      user_id: OWNER_ID,
      timezone: 'Asia/Taipei',
      week_starts_on: 1,
      fixed_six_week_grid: false,
      theme: 'dark',
      theme_id: 'warm',
      default_reminder_minutes: [10],
      pet_name: '摩卡',
      pet_enabled: true,
      created_at: NOW,
      updated_at: NOW,
    };
    const domain = preferencesFromRow(row);
    expect(domain.calendarGridMode).toBe('adaptive');
    expect(domain.themeId).toBe('warm');
    expect(preferencesToInsert(domain, OWNER_ID)).toMatchObject({
      user_id: OWNER_ID,
      fixed_six_week_grid: false,
      theme_id: 'warm',
    });
  });
});

function eventRow(overrides: Partial<Tables<'events'>>): Tables<'events'> {
  return {
    id: EVENT_ID,
    owner_id: OWNER_ID,
    calendar_id: CALENDAR_ID,
    title: '會議',
    is_all_day: false,
    start_date: null,
    end_date: null,
    starts_at: '2026-08-04T01:00:00.000Z',
    ends_at: '2026-08-04T02:00:00.000Z',
    timezone: 'Asia/Taipei',
    location: null,
    notes: null,
    reminder_minutes: [10],
    recurrence_rule: null,
    sharing_scope: 'inherit',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}
