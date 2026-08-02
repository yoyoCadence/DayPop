import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { addDays, fromDateKey, startOfWeek, toDateKey } from '../../domain/date';
import { parseQuickAdd, unsupportedQuickAddParts } from '../../domain/quickAdd';
import { useDayPopData } from '../../hooks/useDayPopData';
import { AddSheet } from './AddSheet';
import { MonthView, type MonthViewHandle } from './MonthView';
import { PetLayer } from './PetLayer';
import '../screens.css';
import './calendar.css';

export type CalendarView = 'month' | 'week' | 'agenda';

export interface CalendarScreenProps {
  /** The header's magnifier goes to the 搜尋 tab, as in the原檔. */
  onGoSearch(): void;
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
 * DP-051 covers the shell: header, 月／週／列表 segmented control, quick-add row,
 * the continuously scrolling month grid, the FAB and the floating pet position.
 * The 週 and 列表 panes keep their place in the control but say plainly that
 * they are not migrated — DP-014 brings them over, along with the day detail and
 * event editing sheets.
 */
export function CalendarScreen({ onGoSearch }: CalendarScreenProps) {
  const { data, addEvent, addTodo } = useDayPopData();
  const monthRef = useRef<MonthViewHandle>(null);

  const todayKey = toDateKey(new Date());
  const [view, setView] = useState<CalendarView>('month');
  const [cursor, setCursor] = useState(todayKey);
  const [selected, setSelected] = useState(todayKey);
  const [monthLabel, setMonthLabel] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}年 ${now.getMonth() + 1}月`;
  });
  const [flashToday, setFlashToday] = useState(false);
  const [quick, setQuick] = useState('');
  const [quickNote, setQuickNote] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const flashTimer = useRef<number | undefined>(undefined);

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

  const openTodoCount = data.todos.filter((todo) => !todo.done && todo.date <= todayKey).length;

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

    // The原檔 hands the parsed draft to the event sheet, which keeps 重複／地點／
    // 提醒. DayPop has nowhere to store them yet, so say so rather than drop them
    // silently. Removed when DP-014 brings the sheet over.
    const dropped = unsupportedQuickAddParts(draft);
    setQuickNote(
      dropped.length > 0
        ? `已新增「${draft.title}」。${dropped.join('、')}也讀到了，但目前的資料模型還存不下來（DP-012／DP-027）。`
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
            onSelectDate={setSelected}
            onPeriodLabelChange={handlePeriodLabelChange}
          />
        )}

        {view === 'week' && (
          <PendingViewPane
            title="週檢視還沒有搬過來"
            summary="原稿的週檢視是 7 欄時間格：可拖曳事件、可調整長度、有目前時間線與全天列。"
          />
        )}

        {view === 'agenda' && (
          <PendingViewPane
            title="列表檢視還沒有搬過來"
            summary="原稿的列表檢視依日期分段列出即將到來的行程與待辦，含天氣列與空狀態。"
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

      <AddSheet
        open={sheetOpen}
        defaultDate={selected}
        onClose={() => setSheetOpen(false)}
        onAddEvent={addEvent}
        onAddTodo={addTodo}
      />
    </div>
  );
}

function PendingViewPane({ title, summary }: { title: string; summary: string }) {
  return (
    <div className="cal-view-pane" style={{ overflowY: 'auto', padding: 16 }}>
      <div className="dp-note">
        <span className="dp-note-task">DP-014</span>
        <strong>{title}</strong>
        <p>{summary}</p>
      </div>
    </div>
  );
}
