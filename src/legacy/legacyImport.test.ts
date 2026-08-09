import { describe, expect, it } from 'vitest';
import { createEmptyUserData } from '../domain/types';
import {
  buildLegacyImportPlan,
  fingerprintLegacyData,
  legacyPlanToPayload,
  LegacyImportValidationError,
} from './legacyImport';

const DEFAULT_CALENDAR_ID = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-08-09T02:30:00.000Z';

function idFactory() {
  let next = 10;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
}

function currentData() {
  return createEmptyUserData({ idFactory: () => DEFAULT_CALENDAR_ID, now: NOW });
}

function legacy(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    calendars: [
      { id: 'work', name: '工作', color: '#3366AA', text: '#fff', visible: true },
    ],
    events: [
      {
        id: 'e1',
        title: '跨午夜部署',
        cal: 'work',
        date: '2026-03-07',
        allDay: false,
        start: '23:30',
        end: '03:30',
        repeat: 'weekly',
        reminder: '30',
        location: '線上',
        notes: 'DST 邊界',
        invitees: ['dev@example.com'],
        attachments: [{ name: 'secret.txt' }],
        tz: 'America/New_York',
        exdates: ['2026-03-14'],
      },
    ],
    todos: [
      {
        id: 't1',
        title: '主待辦',
        when: 'tomorrow',
        done: true,
        priority: 'mid',
        subs: [{ id: 't1', title: '子待辦', done: false }],
      },
    ],
    stickers: [{ id: 's1', date: '2026-08-09', glyph: '🌱' }],
    settings: {
      themeId: 'pixel',
      dark: true,
      weekStart: 1,
      aiKey: 'must-never-leave-this-device',
      petName: '豆豆',
      petEnabled: false,
      tz: 'Asia/Taipei',
      weeksShown: 6,
      defaultRem: '10',
    },
    ...overrides,
  });
}

describe('legacy calpet.v2 import', () => {
  it('previews and converts legacy rows without importing secrets or deferred fields', () => {
    const plan = buildLegacyImportPlan(legacy(), currentData(), {
      idFactory: idFactory(),
      now: NOW,
      today: '2026-08-09',
    });

    expect(plan.preview).toEqual({
      calendars: 1,
      events: 1,
      eventExceptions: 1,
      todos: 2,
      stickers: 1,
      remappedDuplicateIds: 1,
      skippedInvitees: 1,
      skippedAttachments: 1,
      containedAiKey: true,
    });
    expect(plan.preferences).toEqual({
      timezone: 'Asia/Taipei',
      weekStartsOn: 1,
      theme: 'dark',
      themeId: 'pixel',
      calendarGridMode: 'fixed-six',
      defaultReminderMinutes: [10],
      petName: '豆豆',
      petEnabled: false,
    });

    const [event] = plan.imported.events;
    expect(event).toMatchObject({
      allDay: false,
      recurrence: { rule: 'FREQ=WEEKLY' },
      reminderMinutes: [30],
      startsAt: '2026-03-08T04:30:00.000Z',
      endsAt: '2026-03-08T07:30:00.000Z',
    });
    expect(plan.imported.eventExceptions[0]).toMatchObject({
      eventId: event?.id,
      occurrence: { kind: 'timed', startsAt: '2026-03-15T03:30:00.000Z' },
      isCancelled: true,
    });
    expect(plan.imported.todos).toEqual([
      expect.objectContaining({
        calendarId: DEFAULT_CALENDAR_ID,
        parentId: null,
        dueDate: '2026-08-10',
        priority: 'medium',
        completedAt: NOW,
      }),
      expect.objectContaining({
        calendarId: DEFAULT_CALENDAR_ID,
        parentId: plan.imported.todos[0]?.id,
        dueDate: '2026-08-10',
        priority: 'none',
        completedAt: null,
      }),
    ]);

    const payloadText = JSON.stringify(legacyPlanToPayload(plan));
    expect(payloadText).not.toContain('aiKey');
    expect(payloadText).not.toContain('must-never-leave-this-device');
    expect(payloadText).not.toContain('invitees');
    expect(payloadText).not.toContain('attachments');
    expect(payloadText).not.toContain('owner_id');
  });

  it('rejects corrupt JSON and missing collection shapes before creating a plan', () => {
    expect(() => buildLegacyImportPlan('{oops', currentData())).toThrow(
      LegacyImportValidationError,
    );
    expect(() =>
      buildLegacyImportPlan(JSON.stringify({ calendars: [], settings: {} }), currentData()),
    ).toThrow(/events 必須是陣列/);
  });

  it('rejects ambiguous calendar IDs and dangling event calendar references', () => {
    const duplicateCalendars = [
      { id: 'same', name: 'A', color: '#112233' },
      { id: 'same', name: 'B', color: '#445566' },
    ];
    expect(() =>
      buildLegacyImportPlan(legacy({ calendars: duplicateCalendars }), currentData()),
    ).toThrow(/id 重複/);

    const events = [
      {
        id: 'e',
        title: '未知日曆',
        cal: 'missing',
        date: '2026-08-09',
        allDay: true,
      },
    ];
    expect(() => buildLegacyImportPlan(legacy({ events }), currentData())).toThrow(
      /指向不存在的舊日曆/,
    );
  });

  it('rejects invalid dates, clocks, reminders, timezones, and excessive rows', () => {
    const invalidEvent = [
      {
        id: 'e',
        title: 'bad',
        cal: 'work',
        date: '2026-02-30',
        start: '25:00',
        end: '10:00',
        reminder: '10081',
        tz: 'Not/A_Timezone',
      },
    ];
    expect(() => buildLegacyImportPlan(legacy({ events: invalidEvent }), currentData())).toThrow(
      /YYYY-MM-DD/,
    );

    const calendars = Array.from({ length: 101 }, (_, index) => ({
      id: `c${index}`,
      name: `Calendar ${index}`,
      color: '#123456',
    }));
    expect(() => buildLegacyImportPlan(legacy({ calendars, events: [] }), currentData())).toThrow(
      /calendars 超過上限 100/,
    );
  });

  it('hashes only stable importable content for retry idempotence', async () => {
    const first = legacy();
    const sameImportWithDifferentSecret = legacy({
      settings: {
        themeId: 'pixel',
        dark: true,
        weekStart: 1,
        aiKey: 'a-different-secret',
        petName: '豆豆',
        petEnabled: false,
        tz: 'Asia/Taipei',
        weeksShown: 6,
        defaultRem: '10',
      },
    });
    await expect(fingerprintLegacyData(first)).resolves.toBe(
      await fingerprintLegacyData(sameImportWithDifferentSecret),
    );
    await expect(fingerprintLegacyData(legacy({ events: [] }))).resolves.not.toBe(
      await fingerprintLegacyData(first),
    );
  });
});
