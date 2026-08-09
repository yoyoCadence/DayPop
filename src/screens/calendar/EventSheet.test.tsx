import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timedEventFromWallTime } from '../../domain/eventTime';
import type { Calendar, CalendarEvent } from '../../domain/types';
import { EventSheet, type EventSheetProps } from './EventSheet';

/**
 * The fields DP-060 added — 日曆, 地點, 備註 — plus the quick-add draft
 * prefill, driven through real input events.
 */

const CAL_A = '11111111-1111-4111-8111-111111111111';
const CAL_B = '22222222-2222-4222-8222-222222222222';

function calendar(id: string, name: string, isDefault: boolean, sortOrder: number): Calendar {
  return {
    id,
    name,
    color: isDefault ? '#F06C5C' : '#2563eb',
    isVisible: true,
    isDefault,
    sortOrder,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

const CALENDARS = [calendar(CAL_A, '我的日曆', true, 0), calendar(CAL_B, '工作', false, 1)];

function timedEvent(): CalendarEvent {
  return timedEventFromWallTime(
    {
      id: '33333333-3333-4333-8333-333333333333',
      calendarId: CAL_B,
      title: '既有會議',
      location: '會議室A',
      notes: '帶筆電',
      reminderMinutes: [],
      recurrence: null,
      sharingScope: 'inherit',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    { date: '2026-08-06', start: '09:00', end: '10:00' },
    'Asia/Taipei',
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(overrides: Partial<EventSheetProps> = {}) {
  const props: EventSheetProps = {
    open: true,
    defaultDate: '2026-08-06',
    editing: null,
    draft: null,
    calendars: CALENDARS,
    onClose: vi.fn(),
    onAddEvent: vi.fn(),
    onUpdateEvent: vi.fn(),
    onDeleteEvent: vi.fn(),
    onAddTodo: vi.fn(),
    onUploadAttachment: vi.fn(),
    onDeleteAttachment: vi.fn(),
    onOpenAttachment: vi.fn(),
    ...overrides,
    attachments: overrides.attachments ?? [],
    attachmentsAvailable: overrides.attachmentsAvailable ?? false,
  };
  act(() => root.render(<EventSheet {...props} />));
  return props;
}

function type(selector: string, value: string) {
  const field = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  if (!field) throw new Error(`missing ${selector}`);
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const click = (selector: string) => {
  const el = container.querySelector(selector);
  if (!el) throw new Error(`missing ${selector}`);
  act(() => (el as HTMLElement).click());
};

const submit = () =>
  act(() => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

const chips = () => [...container.querySelectorAll('.cal-cal-chip')];

describe('EventSheet fields', () => {
  it('offers one chip per calendar and preselects the default', () => {
    render();

    expect(chips().map((c) => c.textContent)).toEqual(['我的日曆', '工作']);
    expect(chips()[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(chips()[1]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('saves calendar, location and notes on a new event', () => {
    const props = render();

    type('.cal-title-input', '客戶會議');
    click('.cal-cal-chip:nth-child(2)');
    type('[aria-label="地點"]', ' 會議室B ');
    type('[aria-label="備註"]', '帶合約');
    submit();

    expect(props.onAddEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '客戶會議',
        calendarId: CAL_B,
        location: ' 會議室B ',
        notes: '帶合約',
      }),
    );
  });

  it('prefills an existing event and keeps its calendar selected', () => {
    const props = render({ editing: timedEvent() });

    expect((container.querySelector('.cal-title-input') as HTMLInputElement).value).toBe('既有會議');
    expect((container.querySelector('[aria-label="地點"]') as HTMLInputElement).value).toBe('會議室A');
    expect((container.querySelector('[aria-label="備註"]') as HTMLTextAreaElement).value).toBe('帶筆電');
    expect(chips()[1]?.getAttribute('aria-pressed')).toBe('true');

    type('[aria-label="地點"]', '');
    submit();

    // An emptied field must reach the repository as a clear, not as "unchanged".
    expect(props.onUpdateEvent).toHaveBeenCalledWith(
      timedEvent().id,
      expect.objectContaining({ location: '', calendarId: CAL_B }),
    );
  });

  it('prefills from a quick-add draft without saving anything yet', () => {
    const props = render({
      draft: {
        title: '專案驗收',
        date: '2026-08-09',
        allDay: false,
        start: '14:00',
        end: '15:00',
        location: '會議室A',
      },
    });

    expect((container.querySelector('.cal-title-input') as HTMLInputElement).value).toBe('專案驗收');
    expect((container.querySelector('[aria-label="日期"]') as HTMLInputElement).value).toBe('2026-08-09');
    expect((container.querySelector('[aria-label="開始"]') as HTMLInputElement).value).toBe('14:00');
    expect((container.querySelector('[aria-label="地點"]') as HTMLInputElement).value).toBe('會議室A');
    // Nothing is stored until the user confirms.
    expect(props.onAddEvent).not.toHaveBeenCalled();

    submit();
    expect(props.onAddEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: '專案驗收', date: '2026-08-09', location: '會議室A' }),
    );
  });

  it('ignores the draft while editing an existing event', () => {
    render({
      editing: timedEvent(),
      draft: {
        title: '不該出現',
        date: '2026-08-09',
        allDay: false,
        start: '14:00',
        end: '15:00',
        location: '',
      },
    });

    expect((container.querySelector('.cal-title-input') as HTMLInputElement).value).toBe('既有會議');
  });

  it('shows the private attachment controls only for an existing signed-in event', () => {
    render({
      editing: timedEvent(),
      attachmentsAvailable: true,
      attachments: [
        {
          id: '44444444-4444-4444-8444-444444444445',
          eventId: timedEvent().id,
          objectPath: `owner/${timedEvent().id}/44444444-4444-4444-8444-444444444445`,
          fileName: 'agenda.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1536,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });

    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(container.textContent).toContain('agenda.pdf');
    expect(container.textContent).toContain('2 KB');
    expect(container.textContent).not.toContain('附件等 DP-028');
  });

  it('validates and uploads the file selected for an existing event', async () => {
    const onUploadAttachment = vi.fn().mockResolvedValue(undefined);
    render({
      editing: timedEvent(),
      attachmentsAvailable: true,
      onUploadAttachment,
    });
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['agenda'], 'agenda.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onUploadAttachment).toHaveBeenCalledWith(timedEvent().id, file);
  });

  it('opens and deletes only the selected private attachment', async () => {
    const attachment = {
      id: '44444444-4444-4444-8444-444444444445',
      eventId: timedEvent().id,
      objectPath: `owner/${timedEvent().id}/44444444-4444-4444-8444-444444444445`,
      fileName: 'agenda.pdf',
      mimeType: 'application/pdf' as const,
      sizeBytes: 1536,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    const onOpenAttachment = vi.fn().mockResolvedValue('https://signed.example/agenda.pdf');
    const onDeleteAttachment = vi.fn().mockResolvedValue(undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render({
      editing: timedEvent(),
      attachmentsAvailable: true,
      attachments: [attachment],
      onOpenAttachment,
      onDeleteAttachment,
    });
    const buttons = [...container.querySelectorAll('.cal-attachment-list button')];

    await act(async () => {
      (buttons[0] as HTMLButtonElement).click();
    });
    await act(async () => {
      (buttons[1] as HTMLButtonElement).click();
    });

    expect(onOpenAttachment).toHaveBeenCalledWith(attachment.id);
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(onDeleteAttachment).toHaveBeenCalledWith(attachment.id);
    anchorClick.mockRestore();
  });

  it('explains that guest attachments require an account instead of faking success', () => {
    render({ editing: timedEvent(), attachmentsAvailable: false });

    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).toContain('登入帳號後');
  });

  it('sends the chosen calendar when adding a todo', () => {
    const props = render();

    click('.cal-segmented button:nth-child(2)');
    type('.cal-title-input', '買菜');
    click('.cal-cal-chip:nth-child(2)');
    submit();

    expect(props.onAddTodo).toHaveBeenCalledWith(
      expect.objectContaining({ title: '買菜', calendarId: CAL_B }),
    );
  });
});
