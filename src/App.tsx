import { useMemo, useState, type FormEvent } from 'react';
import { buildMonthGrid, formatDayTitle, formatMonthTitle, toDateKey } from './domain/date';
import { useDayPopData } from './hooks/useDayPopData';
import { UpdateDialog } from './pwa/UpdateDialog';
import { useAppUpdate } from './pwa/useAppUpdate';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export default function App() {
  const todayKey = toDateKey(new Date());
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [eventTitle, setEventTitle] = useState('');
  const [eventTime, setEventTime] = useState('09:00');
  const [todoTitle, setTodoTitle] = useState('');
  const { data, addEvent, addTodo, toggleTodo } = useDayPopData();
  const updater = useAppUpdate();

  const days = useMemo(
    () => buildMonthGrid(cursor, data.preferences.weekStartsOn),
    [cursor, data.preferences.weekStartsOn],
  );
  const weekdayLabels = useMemo(() => {
    const start = data.preferences.weekStartsOn;
    return Array.from({ length: 7 }, (_, index) => WEEKDAYS[(start + index) % 7] ?? '');
  }, [data.preferences.weekStartsOn]);
  const selectedEvents = data.events
    .filter((event) => event.date === selectedDate)
    .sort((left, right) => left.start.localeCompare(right.start));
  const selectedTodos = data.todos.filter((todo) => todo.date === selectedDate);
  const openTodoCount = data.todos.filter((todo) => !todo.done && todo.date <= todayKey).length;

  function moveMonth(amount: number) {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  }

  function goToday() {
    const today = new Date();
    setCursor(today);
    setSelectedDate(toDateKey(today));
  }

  function submitEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addEvent({
      title: eventTitle,
      date: selectedDate,
      allDay: false,
      start: eventTime,
      end: addOneHour(eventTime),
    });
    setEventTitle('');
  }

  function submitTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addTodo({ title: todoTitle, date: selectedDate });
    setTodoTitle('');
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">DAILY CALENDAR COMPANION</div>
          <h1>日蹦 <span>DayPop</span></h1>
        </div>
        <button className="version-button" type="button" onClick={() => void updater.checkForUpdate()}>
          {updater.checking ? '檢查中…' : `v${updater.currentVersion}`}
        </button>
      </header>

      <section className="calendar-card" aria-label="月曆">
        <div className="calendar-toolbar">
          <button className="icon-button" type="button" onClick={() => moveMonth(-1)} aria-label="上個月">‹</button>
          <h2>{formatMonthTitle(cursor)}</h2>
          <button className="icon-button" type="button" onClick={() => moveMonth(1)} aria-label="下個月">›</button>
          <button className="today-button" type="button" onClick={goToday}>今天</button>
        </div>
        <div className="weekday-grid">
          {weekdayLabels.map((label) => <div key={label}>{label}</div>)}
        </div>
        <div className="month-grid">
          {days.map((day) => {
            const key = toDateKey(day);
            const eventCount = data.events.filter((event) => event.date === key).length;
            const todoCount = data.todos.filter((todo) => todo.date === key && !todo.done).length;
            const outside = day.getMonth() !== cursor.getMonth();
            return (
              <button
                className={`day-cell${key === selectedDate ? ' selected' : ''}${key === todayKey ? ' today' : ''}${outside ? ' outside' : ''}`}
                key={key}
                type="button"
                onClick={() => setSelectedDate(key)}
                aria-label={`${key}，${eventCount} 個行程，${todoCount} 個待辦`}
              >
                <span>{day.getDate()}</span>
                <div className="day-dots" aria-hidden="true">
                  {eventCount > 0 && <i className="event-dot" />}
                  {todoCount > 0 && <i className="todo-dot" />}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="day-panel">
        <div className="panel-title-row">
          <div>
            <div className="eyebrow">SELECTED DAY</div>
            <h2>{formatDayTitle(selectedDate)}</h2>
          </div>
          <div className="count-pill">{selectedEvents.length + selectedTodos.length} 項</div>
        </div>

        <div className="quick-forms">
          <form onSubmit={submitEvent} className="quick-form">
            <label htmlFor="event-title">新增行程</label>
            <div className="input-row">
              <input id="event-time" type="time" value={eventTime} onChange={(event) => setEventTime(event.target.value)} aria-label="行程時間" />
              <input id="event-title" value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} placeholder="例如：產品會議" />
              <button type="submit" aria-label="加入行程">＋</button>
            </div>
          </form>
          <form onSubmit={submitTodo} className="quick-form">
            <label htmlFor="todo-title">新增待辦</label>
            <div className="input-row">
              <input id="todo-title" value={todoTitle} onChange={(event) => setTodoTitle(event.target.value)} placeholder="例如：回覆 Email" />
              <button type="submit" aria-label="加入待辦">＋</button>
            </div>
          </form>
        </div>

        <div className="items-list">
          {selectedEvents.map((event) => (
            <article className="item-row event-item" key={event.id}>
              <time>{event.start}</time>
              <strong>{event.title}</strong>
            </article>
          ))}
          {selectedTodos.map((todo) => (
            <button className={`item-row todo-item${todo.done ? ' done' : ''}`} key={todo.id} type="button" onClick={() => toggleTodo(todo.id)}>
              <span className="checkbox" aria-hidden="true">{todo.done ? '✓' : ''}</span>
              <strong>{todo.title}</strong>
            </button>
          ))}
          {selectedEvents.length === 0 && selectedTodos.length === 0 && (
            <div className="empty-state">今天還沒有安排，留點空白也很好。</div>
          )}
        </div>
      </section>

      <aside className="pet-helper">
        <div className="pet-face" aria-hidden="true"><span>•</span><b>ᴗ</b><span>•</span></div>
        <div>
          <div className="pet-name">{data.preferences.petName}・App 小幫手</div>
          <p>{openTodoCount > 0 ? `目前有 ${openTodoCount} 件待辦等著完成，我會陪你慢慢清掉。` : '目前沒有逾期或今日待辦，做得很好！'}</p>
        </div>
      </aside>

      <section className="release-panel">
        <div>
          <div className="eyebrow">VERSION & UPDATES</div>
          <h2>版本與更新</h2>
          <p>目前版本 v{updater.currentVersion}。DayPop 會在啟動、回到前景與連線恢復時檢查新版。</p>
          {updater.currentRelease && (
            <details className="current-release">
              <summary>查看這個版本更新了什麼</summary>
              <ul>
                {updater.currentRelease.changes.map((change) => <li key={change}>{change}</li>)}
              </ul>
            </details>
          )}
          {updater.error && <p className="update-error">本次檢查失敗：{updater.error}</p>}
        </div>
        <button className="button secondary" type="button" onClick={() => void updater.checkForUpdate()} disabled={updater.checking}>
          {updater.checking ? '檢查中…' : '檢查更新'}
        </button>
      </section>

      <footer>使用者資料與 App cache 分開保存・更新不會清除行程與設定</footer>

      {updater.availableRelease && (
        <UpdateDialog
          release={updater.availableRelease}
          preparing={updater.preparing}
          onUpdate={() => void updater.updateNow()}
          onLater={updater.dismissUpdate}
        />
      )}
    </main>
  );
}

function addOneHour(time: string): string {
  const [hour = 9, minute = 0] = time.split(':').map(Number);
  return `${String((hour + 1) % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
