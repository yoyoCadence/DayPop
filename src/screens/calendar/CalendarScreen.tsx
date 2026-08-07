import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { addDays, fromDateKey, startOfWeek, toDateKey } from '../../domain/date';
import { parseQuickAdd, unsupportedQuickAddParts } from '../../domain/quickAdd';
import { useDayPopData } from '../../data/dataContext';
import { AgendaView } from './AgendaView';
import { DayDetailSheet } from './DayDetailSheet';
import { EventSheet } from './EventSheet';
import { MonthView, type MonthViewHandle } from './MonthView';
import { PetLayer } from './PetLayer';
import { WeekView } from './WeekView';
import '../screens.css';
import './calendar.css';

export type CalendarView = 'month' | 'week' | 'agenda';

/** Something another tab asked the calendar to open when it mounts. */
export type CalendarFocus = { kind: 'event'; id: string } | { kind: 'day'; dateKey: string };

export interface CalendarScreenProps {
  /** The header's magnifier goes to the 搜尋 tab, as in the原檔. */
  onGoSearch(): void;
  /**
   * Set when 搜尋 or 綜覽 sent the user here to look at something. Read once as
   * initial state: tab screens unmount on switch, so arriving with a focus is
   * always a fresh mount.
   */
  focus?: CalendarFocus | null;
}

const WEEKDAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
const VIEW_OPTIONS: { view: CalendarView; label: string }[] = [
  { view: 'month', label: '月' },
  { view: 'week', label: '週' },
  { view: 'agenda', label: '列表' },
];

/**
 * 日曆 tab, ported from the calendar screen of `日曆桌寵 Calendar Pet.dc.html`.
 *
 * Owns the header, the 月／週／列表 segmented control, the quick-add row, the
 * three view panes, the FAB, the floating pet position and the two sheets
 * (日詳情 and 新增／編輯行程).
 */
export function CalendarScreen({ onGoSearch, focus = null }: CalendarScreenProps) {
  const { data, addEvent, updateEvent, deleteEvent, addTodo, toggleTodo, deleteTodo } =
    useDayPopData();
  const monthRef = useRef<MonthViewHandle>(null);

  const todayKey = toDateKey(new Date());
  const [view, setView] = useState<CalendarView>('month');
  const [cursor, setCursor] = useState(focus?.kind === 'day' ? focus.dateKey : todayKey);
  const [selected, setSelected] = useState(focus?.kind === 'day' ? focus.dateKey : todayKey);
  const [monthLabel, setMonthLabel] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}年 ${now.getMonth() + 1}月`;
  });
  const [flashToday, setFlashToday] = useState(false);
  const [quick, setQuick] = useState('');
  const [quickNote, setQuickNote] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(focus?.kind === 'event');
  const [editingId, setEditingId] = useState<string | null>(
    focus?.kind === 'event' ? focus.id : null,
  );
  const [dayDetailKey, setDayDetailKey] = useState<string | null>(
    focus?.kind === 'day' ? focus.dateKey : null,
  );
  const flashTimer = useRef<number | undefined>(undefined);

  const editingEvent = editingId ? (data.events.find((item) => item.id === editingId) ?? null) : null;

  const openEvent = useCallback((id: string) => {
    setEditingId(id);
    setSheetOpen(true);
  }, []);

  // Tapping a month cell selects the day and opens 日詳情, as in the原檔.
  const openDayDetail = useCallback((key: string) => {
    setSelected(key);
    setDayDetailKey(key);
  }, []);

  function closeSheet() {
    setSheetOpen(false);
    setEditingId(null);
  }

  // One Escape handler for both sheets, so a keypress closes only the topmost.
  // The event sheet can be opened from inside 日詳情, and two independent window
  // listeners would dismiss both at once.
  useEffect(() => {
    if (!sheetOpen && !dayDetailKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (sheetOpen) {
        setSheetOpen(false);
        setEditingId(null);
      } else {
        setDayDetailKey(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sheetOpen, dayDetailKey]);

  const weekStartsOn = data.preferences.weekStartsOn;

  const todayFull = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()} / ${now.getMonth() + 1} / ${now.getDate()}  ${WEEKDAY_NAMES[now.getDay()]}`;
  }, []);

  const periodLabel = useMemo(() => {
    if (view === 'month') return monthLabel;
    if (view === 'agenda') return '即將到來';
    const start = startOfWeek(fromDateKey(cursor), weekStartsOn);
    const end = addDays(start, 6);
    return `${start.getMonth() + 1}/${start.getDate()} – ${end.getMonth() + 1}/${end.getDate()}`;
  }, [cursor, monthLabel, view, weekStartsOn]);

  const openTodoCount = data.todos.filter(
    (todo) => todo.completedAt === null && todo.dueDate !== null && todo.dueDate <= todayKey,
  ).length;

  const handlePeriodLabelChange = useCallback((label: string) => setMonthLabel(label), []);

  function step(direction: 1 | -1) {
    if (view === 'month') {
      monthRef.current?.page(direction);
      return;
    }
    setCursor((current) => toDateKey(addDays(fromDateKey(current), direction * (view === 'week' ? 7 : 1))));
  }

  function goToday() {
    const now = new Date();
    const key = toDateKey(now);
    setFlashToday(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashToday(false), 1300);
    setSelected(key);
    if (view === 'month') {
      setMonthLabel(`${now.getFullYear()}年 ${now.getMonth() + 1}月`);
      monthRef.current?.scrollToToday(true);
      return;
    }
    setCursor(key);
  }

  function submitQuick(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = parseQuickAdd(quick);
    if (!draft || !draft.title) return;

    addEvent({
      title: draft.title,
      date: draft.date,
      allDay: draft.allDay,
      start: draft.start,
      end: draft.end,
    });
    setSelected(draft.date);
    setQuick('');

    // The canonical model can store these fields, but quick add must still hand
    // the draft to the full event sheet before they can be confirmed (DP-014).
    const dropped = unsupportedQuickAddParts(draft);
    setQuickNote(
      dropped.length > 0
        ? `已新增「${draft.title}」。${dropped.join('、')}也讀到了，等 DP-014 改由事件表單確認後才會保存。`
        : null,
    );
  }

  return (
    <div className="dp-screen cal-screen">
      <div className="cal-header">
        <div className="cal-header-top">
          <div className="cal-header-titles">
            <div className="cal-today-full">{todayFull}</div>
            <div className="cal-period">{periodLabel}</div>
          </div>
          <div className="cal-header-actions">
            <button className="cal-chip-button" type="button" onClick={goToday}>
              今天
            </button>
            <button className="cal-icon-button" type="button" onClick={onGoSearch} aria-label="搜尋">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="16.5" y1="16.5" x2="21" y2="21" />
              </svg>
            </button>
          </div>
        </div>

        <div className="cal-nav">
          <button className="cal-step-button" type="button" onClick={() => step(-1)} aria-label="上一頁">
            ‹
          </button>
          <button className="cal-step-button" type="button" onClick={() => step(1)} aria-label="下一頁">
            ›
          </button>
          <div className="cal-segmented" role="group" aria-label="檢視方式">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.view}
                type="button"
                aria-pressed={view === option.view}
                onClick={() => setView(option.view)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <form className="cal-quick" onSubmit={submitQuick}>
          <input
            value={quick}
            onChange={(event) => {
              setQuick(event.target.value);
              setQuickNote(null);
            }}
            placeholder="快速新增：明天下午3點 開會 @會議室A 提前15分"
            aria-label="快速新增"
          />
          <button type="submit" aria-label="快速新增">
            ＋
          </button>
        </form>
        {quickNote && (
          <div className="cal-quick-note" role="status">
            {quickNote}
          </div>
        )}
      </div>

      <div className="cal-view">
        {view === 'month' && (
          <MonthView
            ref={monthRef}
            weekStartsOn={weekStartsOn}
            events={data.events}
            selectedDate={selected}
            todayKey={todayKey}
            flashToday={flashToday}
            onSelectDate={openDayDetail}
            onPeriodLabelChange={handlePeriodLabelChange}
          />
        )}

        {view === 'week' && (
          <WeekView
            weekStartsOn={weekStartsOn}
            cursor={cursor}
            todayKey={todayKey}
            events={data.events}
            onUpdateEvent={updateEvent}
            onOpenEvent={openEvent}
          />
        )}

        {view === 'agenda' && (
          <AgendaView
            events={data.events}
            todos={data.todos}
            onOpenEvent={openEvent}
            onToggleTodo={toggleTodo}
          />
        )}
      </div>

      <PetLayer badge={openTodoCount} petName={data.preferences.petName} />

      <button className="cal-fab" type="button" onClick={() => setSheetOpen(true)} aria-label="新增">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <DayDetailSheet
        dateKey={dayDetailKey}
        events={data.events}
        todos={data.todos}
        onClose={() => setDayDetailKey(null)}
        onOpenEvent={openEvent}
        onNewEvent={() => setSheetOpen(true)}
        onAddTodo={addTodo}
        onToggleTodo={toggleTodo}
        onDeleteTodo={deleteTodo}
      />

      <EventSheet
        open={sheetOpen}
        defaultDate={selected}
        editing={editingEvent}
        onClose={closeSheet}
        onAddEvent={addEvent}
        onUpdateEvent={updateEvent}
        onDeleteEvent={deleteEvent}
        onAddTodo={addTodo}
      />
    </div>
  );
}
