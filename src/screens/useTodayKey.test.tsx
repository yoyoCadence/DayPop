import { act, Profiler, type ProfilerOnRenderCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataProvider';
import { LocalDayPopRepository } from '../storage/localRepository';
import { MemoryStorage } from '../storage/browserStorage';
import { createEmptyUserData } from '../domain/types';
import { writeUserData } from '../storage/versionedStorage';
import { OverviewScreen } from './OverviewScreen';
import { useTodayKey } from './useTodayKey';

let container: HTMLDivElement;
let root: Root;
const onRender = vi.fn<ProfilerOnRenderCallback>();

function Today({ timezone }: { timezone: string }) {
  const key = useTodayKey(timezone);
  return <span>{key}</span>;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-30T15:59:30.000Z'));
  onRender.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const render = (timezone = 'Asia/Taipei') => act(() => root.render(<Profiler id="today" onRender={onRender}><Today timezone={timezone} /></Profiler>));

describe('today subscription (DP-150)', () => {
  it('updates only when the saved-zone date changes, without redraws on ordinary minute ticks', () => {
    vi.setSystemTime(new Date('2026-09-30T15:57:30.000Z'));
    render();
    const before = onRender.mock.calls.length;
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(container.textContent).toBe('2026-09-30');
    expect(onRender).toHaveBeenCalledTimes(before);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(container.textContent).toBe('2026-10-01');
    expect(onRender.mock.calls.length).toBeGreaterThan(before);
  });

  it('reads a changed display zone immediately instead of waiting for a tick', () => {
    render();
    expect(container.textContent).toBe('2026-09-30');
    render('Pacific/Kiritimati');
    expect(container.textContent).toBe('2026-10-01');
    render('America/New_York');
    expect(container.textContent).toBe('2026-09-30');
  });

  it('refreshes on becoming visible after suspended timers, but not on hiding', () => {
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    render();
    vi.setSystemTime(new Date('2026-10-01T16:01:00.000Z'));
    visibility = 'hidden';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(container.textContent).toBe('2026-09-30');
    visibility = 'visible';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(container.textContent).toBe('2026-10-02');
  });

  it('removes its timer and foreground listeners when the screen is removed', () => {
    render();
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    act(() => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
    expect(removeWindow).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('refreshes overview overdue markers at midnight while keeping its period and data', async () => {
    const storage = new MemoryStorage();
    const data = createEmptyUserData();
    data.preferences.timezone = 'Asia/Taipei';
    writeUserData(data, 0, storage);
    const repository = new LocalDayPopRepository(storage);
    await repository.load();
    const before = await repository.addTodo({ title: '當日待辦', date: '2026-09-30' });
    await act(async () => root.render(<DataProvider repository={repository}><OverviewScreen onOpenEvent={vi.fn()} onOpenDay={vi.fn()} /></DataProvider>));
    act(() => (container.querySelectorAll('.overview-header .cal-segmented button')[1] as HTMLButtonElement).click());
    const label = container.querySelector('.overview-label')!.textContent;
    expect(container.textContent).toContain('當日待辦');
    expect(container.textContent).not.toContain('逾期');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(container.textContent).toContain('逾期・原9/30');
    expect(container.querySelector('.overview-label')!.textContent).toBe(label);
    expect(await repository.load()).toEqual(before);
  });
});
