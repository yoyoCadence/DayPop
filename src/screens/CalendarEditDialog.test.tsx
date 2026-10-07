import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Calendar } from '../domain/types';
import { CalendarEditDialog, type CalendarEditDialogProps } from './CalendarEditDialog';

/**
 * DP-141. The dialog used to be closed by its parent the moment 儲存 or
 * 刪除此日曆 was pressed, so a failed write had nowhere to say so and the typed
 * name was gone. These pin the waiting and failure behaviour of the dialog on
 * its own; `SettingsCalendars.test.tsx` covers the wiring.
 */
const WORK: Calendar = {
  id: '22222222-2222-4222-8222-222222222222',
  name: '工作',
  color: '#2563eb',
  isVisible: true,
  isDefault: false,
  sortOrder: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

function render(overrides: Partial<CalendarEditDialogProps> = {}) {
  const props: CalendarEditDialogProps = {
    calendar: WORK,
    suggestedColor: '#F06C5C',
    canDelete: true,
    itemCount: 3,
    reassignTargetName: '我的日曆',
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  act(() => root.render(<CalendarEditDialog {...props} />));
  return props;
}

const dialog = () => container.querySelector<HTMLFormElement>('.cal-manage-dialog')!;
const nameInput = () => container.querySelector<HTMLInputElement>('.cal-manage-input')!;
const saveButton = () => container.querySelector<HTMLButtonElement>('.cal-manage-save')!;
const cancelButton = () => container.querySelector<HTMLButtonElement>('.cal-manage-cancel')!;
const deleteButton = () => container.querySelector<HTMLButtonElement>('.cal-manage-delete')!;
const alertText = () => container.querySelector('[role="alert"]')?.textContent;

function typeName(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(nameInput(), value);
    nameInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const submit = () =>
  act(async () => { dialog().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
const click = (element: Element) => act(async () => { (element as HTMLElement).click(); });

/** Focus that fell to `<body>`, as it does when the focused control is disabled. */
function dropFocus() {
  const lost = document.createElement('button');
  document.body.append(lost);
  lost.focus();
  lost.remove();
}

describe('CalendarEditDialog confirmed writes (DP-141)', () => {
  it('a synchronous save still closes straight away', async () => {
    const props = render();
    typeName('健身');
    await submit();
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith({ name: '健身', color: '#2563eb' }, expect.stringMatching(UUID));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('proposes one draft id for every attempt from this dialog, and a new one the next time it opens (DP-142)', async () => {
    const onSave = vi.fn<(values: { name: string; color: string }, draftId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('網路中斷'))
      .mockResolvedValue(undefined);
    render({ calendar: null, canDelete: false, onSave });
    typeName('工作');
    await submit();
    typeName('工作（改過）');
    await submit();
    expect(onSave.mock.calls.map(([values]) => values.name)).toEqual(['工作', '工作（改過）']);
    expect(onSave.mock.calls[0]![1]).toMatch(UUID);
    expect(onSave.mock.calls[1]![1]).toBe(onSave.mock.calls[0]![1]);

    act(() => root.render(<div />));
    render({ calendar: null, canDelete: false, onSave });
    await submit();
    expect(onSave.mock.calls[2]![1]).toMatch(UUID);
    expect(onSave.mock.calls[2]![1]).not.toBe(onSave.mock.calls[0]![1]);
  });

  it('stays open and locked until the save is confirmed, and sends it once', async () => {
    let finish!: () => void;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = render({ onSave });
    typeName('健身');
    await submit();
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ name: '健身', color: '#2563eb' }, expect.stringMatching(UUID));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(dialog().getAttribute('aria-busy')).toBe('true');
    expect(saveButton().textContent).toBe('保存中…');
    expect([nameInput().disabled, saveButton().disabled, cancelButton().disabled, deleteButton().disabled]).toEqual([true, true, true, true]);
    await submit();
    await click(container.querySelector('.cal-manage-backdrop')!);
    await click(cancelButton());
    await click(deleteButton());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the name and colour after a rejected save and closes only on an explicit retry', async () => {
    const onSave = vi.fn<(values: { name: string; color: string }) => Promise<void>>()
      .mockRejectedValueOnce(new Error('網路中斷'))
      .mockResolvedValue(undefined);
    const props = render({ onSave });
    typeName('健身');
    await click(container.querySelector('[aria-label="顏色 #16a34a"]') ?? container.querySelectorAll('.cal-manage-swatch')[1]!);
    const chosen = container.querySelector('.cal-manage-swatch[aria-pressed="true"]')!.getAttribute('aria-label');
    dropFocus();
    await submit();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(nameInput().value).toBe('健身');
    expect(container.querySelector('.cal-manage-swatch[aria-pressed="true"]')!.getAttribute('aria-label')).toBe(chosen);
    expect(alertText()).toBe('網路中斷 名稱與顏色已保留；請先確認資料再重試。');
    expect([nameInput().disabled, saveButton().disabled, cancelButton().disabled]).toEqual([false, false, false]);
    expect(saveButton().textContent).toBe('儲存');
    expect(document.activeElement).toBe(saveButton());
    await submit();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1]).toEqual(onSave.mock.calls[0]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open until the deletion is confirmed, then explains a failure next to 刪除此日曆', async () => {
    let fail!: (error: Error) => void;
    const onDelete = vi.fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
      .mockResolvedValue(undefined);
    const props = render({ onDelete });
    typeName('未保存的名稱');
    await click(deleteButton());
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(deleteButton().textContent).toBe('刪除中…');
    expect(saveButton().textContent).toBe('儲存');
    expect([saveButton().disabled, cancelButton().disabled, deleteButton().disabled]).toEqual([true, true, true]);
    await click(deleteButton());
    await submit();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(props.onSave).not.toHaveBeenCalled();
    dropFocus();
    await act(async () => { fail(new Error('搬移 events 失敗')); });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(alertText()).toBe('搬移 events 失敗 尚未確認刪除；請先確認資料再重試。');
    expect(deleteButton().nextElementSibling).toBe(container.querySelector('[role="alert"]'));
    expect(nameInput().value).toBe('未保存的名稱');
    expect(deleteButton().textContent).toBe('刪除此日曆');
    expect(document.activeElement).toBe(deleteButton());
    await click(deleteButton());
    expect(onDelete).toHaveBeenCalledTimes(2);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not take focus back from another control when a write fails', async () => {
    let fail!: (error: Error) => void;
    render({ onSave: () => new Promise<void>((_resolve, reject) => { fail = reject; }) });
    await submit();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    await act(async () => { fail(new Error('無法確認')); });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('keeps the 編輯日曆 heading while a confirmed deletion removes the calendar underneath it', async () => {
    let finish!: () => void;
    const props = render({ onDelete: () => new Promise<void>((resolve) => { finish = resolve; }) });
    await click(deleteButton());
    // The data updates before the awaiting dialog is told: the row is gone.
    act(() => root.render(<CalendarEditDialog {...props} calendar={null} canDelete={false} />));
    expect(dialog().getAttribute('aria-label')).toBe('編輯日曆');
    expect(container.querySelector('.cal-manage-title')?.textContent).toBe('編輯日曆');
    await act(async () => { finish(); });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('a write that settles after the dialog is gone closes nothing', async () => {
    let finish!: () => void;
    const props = render({ onSave: () => new Promise<void>((resolve) => { finish = resolve; }) });
    await submit();
    act(() => root.render(<div />));
    await act(async () => { finish(); });
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
