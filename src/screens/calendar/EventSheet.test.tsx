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
    onCancelOccurrence: vi.fn(),
    onReplaceOccurrence: vi.fn(),
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

  /**
   * DP-076. The原檔 never lets an event fail to save: `commitEvent()` and
   * `scopeApply()` both commit `title:(dr.title||'').trim()||'新事件'`. DayPop
   * had dropped that fallback and kept a silent `return`, so a quick add of
   * `明天下午3點` — a time with no subject — opened a sheet whose 儲存 did
   * nothing and explained nothing.
   *
   * 新事件 is written out here rather than imported from the component. The
   * point of these two cases is that DayPop uses the原檔's exact word; an
   * expectation taken from the code under test would follow it anywhere and
   * assert nothing.
   */
  it('names an untitled event rather than silently refusing to save', () => {
    const props = render();

    click('.cal-cal-chip:nth-child(2)');
    submit();

    expect(props.onAddEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: '新事件', calendarId: CAL_B }),
    );
    expect(props.onClose).toHaveBeenCalled();
  });

  it('applies the same fallback when an existing title is cleared to whitespace', () => {
    const props = render({ editing: timedEvent() });

    type('.cal-title-input', '   ');
    submit();

    expect(props.onUpdateEvent).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ title: '新事件' }),
    );
  });

  /**
   * The other half of DP-076, and the asymmetry is deliberate: the原檔's
   * `addTodo()` guards with `if(!v) return;` and invents no title, so an
   * untitled todo is still discarded. Naming one 新事件 would be wrong twice
   * over — it is not an event, and the原檔 never names a todo.
   */
  it('still discards an untitled todo instead of naming it', () => {
    const props = render();

    click('.cal-segmented button:nth-child(2)');
    submit();

    expect(props.onAddTodo).not.toHaveBeenCalled();
    expect(props.onAddEvent).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
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

  it('全天 是原稿的開關，按下後隱藏時間欄位並存成全天', () => {
    const props = render();
    const toggle = () => container.querySelector('.cal-allday-toggle');

    // 原稿 :586 是 44×25 開關，不是 checkbox。
    expect(container.querySelector('.cal-allday input[type="checkbox"]')).toBeNull();
    expect(toggle()?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[aria-label="開始"]')).not.toBeNull();

    type('.cal-title-input', '出差');
    click('.cal-allday-toggle');

    expect(toggle()?.getAttribute('aria-pressed')).toBe('true');
    // 原稿在全天時收起開始／結束。
    expect(container.querySelector('[aria-label="開始"]')).toBeNull();

    submit();
    expect(props.onAddEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: '出差', allDay: true }),
    );
  });

  it('全天 開關可以再按一次關掉，時間欄位會回來', () => {
    render();

    click('.cal-allday-toggle');
    click('.cal-allday-toggle');

    expect(container.querySelector('.cal-allday-toggle')?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[aria-label="開始"]')).not.toBeNull();
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
        repeat: 'weekly',
      },
    });

    expect((container.querySelector('.cal-title-input') as HTMLInputElement).value).toBe('專案驗收');
    expect((container.querySelector('[aria-label="日期"]') as HTMLInputElement).value).toBe('2026-08-09');
    expect((container.querySelector('[aria-label="開始"]') as HTMLInputElement).value).toBe('14:00');
    expect((container.querySelector('[aria-label="地點"]') as HTMLInputElement).value).toBe('會議室A');
    // 重複 travels the same way — quick add parses 每週 and the sheet shows it.
    expect((container.querySelector('[aria-label="重複"]') as HTMLSelectElement).value).toBe('weekly');
    // Nothing is stored until the user confirms.
    expect(props.onAddEvent).not.toHaveBeenCalled();

    submit();
    expect(props.onAddEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '專案驗收',
        date: '2026-08-09',
        location: '會議室A',
        recurrenceRule: 'FREQ=WEEKLY',
      }),
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
        repeat: 'daily',
      },
    });

    expect((container.querySelector('.cal-title-input') as HTMLInputElement).value).toBe('既有會議');
    expect((container.querySelector('[aria-label="重複"]') as HTMLSelectElement).value).toBe('none');
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

/**
 * 原稿 `:430-439` 的範圍對話框（DP-082）。取代了 DP-081 那段「只改其中一次還沒做好」
 * 的提示 —— 那個提示存在的理由就是這個選擇還沒接上。
 */
describe('EventSheet 重複事件的單次／全部範圍選擇（DP-082）', () => {
  const SERIES = '33333333-3333-4333-8333-333333333333';
  const OCCURRENCE = { kind: 'timed' as const, startsAt: '2026-08-20T01:00:00.000Z' };

  function recurring(): CalendarEvent {
    return { ...timedEvent(), recurrence: { rule: 'FREQ=WEEKLY' } };
  }

  /** 從畫面上點開一次 occurrence 的完整情境。 */
  function openOccurrence(overrides: Partial<EventSheetProps> = {}) {
    return render({
      editing: recurring(),
      occurrence: OCCURRENCE,
      seriesEventId: SERIES,
      ...overrides,
    });
  }

  const dialog = () => container.querySelector('.cal-scope-card');
  const deleteButton = () => container.querySelector('.cal-delete-button') as HTMLButtonElement;

  it('儲存重複事件會先問範圍，還沒送出任何寫入', () => {
    const props = openOccurrence();

    expect(dialog()).toBeNull();
    submit();

    expect(props.onUpdateEvent).not.toHaveBeenCalled();
    expect(props.onReplaceOccurrence).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    // 文案逐字照原稿 :1372。
    expect(container.querySelector('.cal-scope-title')?.textContent).toBe('修改重複事件');
    expect(container.querySelector('.cal-scope-this')?.textContent).toBe('只改這一次');
    expect(container.querySelector('.cal-scope-all')?.textContent).toBe('套用全部');
  });

  it('套用全部走既有的 updateEvent，對象是系列本身', () => {
    const props = openOccurrence();
    type('.cal-title-input', '改過的標題');
    submit();
    click('.cal-scope-all');

    expect(props.onUpdateEvent).toHaveBeenCalledWith(
      SERIES,
      expect.objectContaining({ title: '改過的標題' }),
    );
    expect(props.onReplaceOccurrence).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('只改這一次走 replaceEventOccurrence，並帶上被點到的那一次', () => {
    const props = openOccurrence();
    type('.cal-title-input', '只有這次改');
    submit();
    click('.cal-scope-this');

    expect(props.onReplaceOccurrence).toHaveBeenCalledWith(
      SERIES,
      OCCURRENCE,
      expect.objectContaining({ title: '只有這次改' }),
    );
    expect(props.onUpdateEvent).not.toHaveBeenCalled();
  });

  it('刪除重複事件問的是刪除版本的文案', () => {
    const props = openOccurrence();

    expect(deleteButton().textContent).toBe('刪除事件');
    click('.cal-delete-button');

    expect(props.onDeleteEvent).not.toHaveBeenCalled();
    expect(container.querySelector('.cal-scope-title')?.textContent).toBe('刪除重複事件');
    expect(container.querySelector('.cal-scope-this')?.textContent).toBe('只刪這一次');
    expect(container.querySelector('.cal-scope-all')?.textContent).toBe('刪除全部');
  });

  it('刪除全部刪掉系列，只刪這一次寫成一筆取消例外', () => {
    const all = openOccurrence();
    click('.cal-delete-button');
    click('.cal-scope-all');
    expect(all.onDeleteEvent).toHaveBeenCalledWith(SERIES);
    expect(all.onCancelOccurrence).not.toHaveBeenCalled();

    const single = openOccurrence();
    click('.cal-delete-button');
    click('.cal-scope-this');
    expect(single.onCancelOccurrence).toHaveBeenCalledWith(SERIES, OCCURRENCE);
    expect(single.onDeleteEvent).not.toHaveBeenCalled();
  });

  it('取消對話框不會寫入任何東西，也不會關掉 sheet', () => {
    const props = openOccurrence();
    submit();
    click('.cal-scope-cancel');

    expect(dialog()).toBeNull();
    expect(props.onUpdateEvent).not.toHaveBeenCalled();
    expect(props.onReplaceOccurrence).not.toHaveBeenCalled();
    // 編輯內容還在，使用者可以改完再存一次。
    expect(props.onClose).not.toHaveBeenCalled();
    expect((container.querySelector('.cal-title-input') as HTMLInputElement).value).toBe('既有會議');
  });

  it('非重複事件完全不問，維持原稿的一次點擊就刪', () => {
    const props = render({ editing: timedEvent(), occurrence: OCCURRENCE, seriesEventId: SERIES });

    click('.cal-delete-button');

    expect(dialog()).toBeNull();
    expect(props.onDeleteEvent).toHaveBeenCalledWith(SERIES);
  });

  /**
   * 從搜尋／綜覽打開時沒有 occurrence 可指。那些畫面搜的是 base event，結果本身
   * 就是整個系列，所以維持整串編輯而不是猜一個 occurrence 出來。
   */
  it('沒有 occurrence 時不問範圍，直接當成整個系列編輯', () => {
    const props = render({ editing: recurring() });

    submit();

    expect(dialog()).toBeNull();
    expect(props.onUpdateEvent).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      expect.objectContaining({ title: '既有會議' }),
    );
  });
});

describe('EventSheet 的「重複」控制項（DP-082）', () => {
  const repeatSelect = () => container.querySelector('[aria-label="重複"]') as HTMLSelectElement;

  function choose(value: string) {
    const field = repeatSelect();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(field, value);
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  const optionValues = () => [...repeatSelect().options].map((option) => option.value);

  it('六個選項與順序逐字照原稿，預設是不重複', () => {
    render();

    expect(optionValues()).toEqual(['none', 'daily', 'weekday', 'weekly', 'monthly', 'yearly']);
    expect([...repeatSelect().options].map((option) => option.textContent)).toEqual([
      '不重複',
      '每日',
      '每個工作日',
      '每週',
      '每月',
      '每年',
    ]);
    expect(repeatSelect().value).toBe('none');
  });

  it('新事件選了重複，就送出對應的 RRULE', () => {
    const props = render();
    type('.cal-title-input', '每日站會');
    choose('weekday');
    submit();

    expect(props.onAddEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '每日站會',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      }),
    );
  });

  it('不重複的新事件送出的是 null，不是漏掉這個欄位', () => {
    const props = render();
    type('.cal-title-input', '單次會議');
    submit();

    expect(props.onAddEvent).toHaveBeenCalledWith(
      expect.objectContaining({ recurrenceRule: null }),
    );
  });

  it('編輯既有的重複事件時，選單顯示的是它現在的規則', () => {
    render({ editing: { ...timedEvent(), recurrence: { rule: 'FREQ=MONTHLY' } } });

    expect(repeatSelect().value).toBe('monthly');
    // 這裡的自訂選項只在真的是自訂規則時才出現。
    expect(optionValues()).not.toContain('custom');
  });

  it('把重複事件改回不重複，會清掉規則而不是留著', () => {
    const props = render({ editing: { ...timedEvent(), recurrence: { rule: 'FREQ=DAILY' } } });
    choose('none');
    submit();

    expect(props.onUpdateEvent).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      expect.objectContaining({ recurrenceRule: null }),
    );
  });

  it('BYDAY 的寫法順序不同仍然認得出是「每個工作日」', () => {
    render({
      editing: {
        ...timedEvent(),
        recurrence: { rule: 'FREQ=WEEKLY;BYDAY=FR,MO,TU,WE,TH;INTERVAL=1' },
      },
    });

    expect(repeatSelect().value).toBe('weekday');
  });

  it('六個選項以外的規則維持原樣，不會被靜默改寫', () => {
    const props = render({
      editing: { ...timedEvent(), recurrence: { rule: 'FREQ=DAILY;INTERVAL=3' } },
    });

    expect(repeatSelect().value).toBe('custom');
    expect(container.querySelector('.cal-field-note')?.textContent).toContain('FREQ=DAILY;INTERVAL=3');

    submit();
    // 沒有 recurrenceRule 這個 key，`applyEventPatch()` 才會保留原本的規則；
    // 送出 null 會清掉它，送出 preset 會覆蓋它，兩者都是資料損失。
    const patch = vi.mocked(props.onUpdateEvent).mock.calls[0]?.[1];
    expect(patch && 'recurrenceRule' in patch).toBe(false);
  });

  it('自訂規則的行程一旦改選六個選項之一，會明說原規則將被取代', () => {
    const props = render({
      editing: { ...timedEvent(), recurrence: { rule: 'FREQ=DAILY;INTERVAL=3' } },
    });
    choose('daily');

    expect(container.querySelector('.cal-field-note')?.textContent).toContain('會被取代');

    submit();
    expect(props.onUpdateEvent).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      expect.objectContaining({ recurrenceRule: 'FREQ=DAILY' }),
    );
  });

  it('待辦模式沒有重複選單', () => {
    render();
    click('.cal-segmented button:last-child');

    expect(repeatSelect()).toBeNull();
  });
});
