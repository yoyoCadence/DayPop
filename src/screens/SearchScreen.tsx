import { useMemo, useState } from 'react';
import { calendarColor, sortedCalendars } from '../domain/calendars';
import { searchEntries } from '../domain/search';
import { useDayPopData } from '../data/dataContext';
import './screens.css';
import './search.css';

export interface SearchScreenProps {
  /** Opens the event on the 日曆 tab, as the原檔 does. */
  onOpenEvent(id: string): void;
  /** Todos have no editor of their own yet, so they open their day. */
  onOpenDay(dateKey: string): void;
}

/**
 * 搜尋 tab, ported from the search screen of `日曆桌寵 Calendar Pet.dc.html`.
 *
 * The chip row under the field is the原檔's `searchCal` filter: 全部 plus one
 * chip per calendar. It filters events only — see `searchEntries`.
 */
export function SearchScreen({ onOpenEvent, onOpenDay }: SearchScreenProps) {
  const { data } = useDayPopData();
  const [query, setQuery] = useState('');
  const [calendarFilter, setCalendarFilter] = useState<string | null>(null);
  const calendars = sortedCalendars(data.calendars);
  const results = useMemo(
    () => searchEntries(query, data.events, data.todos, calendarFilter),
    [query, data.events, data.todos, calendarFilter],
  );
  const trimmed = query.trim();

  return (
    <div className="dp-screen search-screen">
      <div className="search-header">
        <h1 className="dp-screen-title">搜尋</h1>
        <div className="search-field">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--muted)"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋事件、地點、待辦…"
            aria-label="搜尋"
          />
        </div>
      </div>

      <div className="search-chips" role="group" aria-label="依日曆篩選">
        <button
          className="search-chip"
          type="button"
          aria-pressed={calendarFilter === null}
          onClick={() => setCalendarFilter(null)}
        >
          <span className="search-chip-dot" />
          全部
        </button>
        {calendars.map((calendar) => (
          <button
            key={calendar.id}
            className="search-chip"
            type="button"
            aria-pressed={calendarFilter === calendar.id}
            onClick={() => setCalendarFilter(calendar.id)}
          >
            <span className="search-chip-dot" style={{ background: calendar.color }} />
            {calendar.name}
          </button>
        ))}
      </div>

      <div className="search-results">
        {!trimmed && (
          <div className="search-hint">
            輸入關鍵字開始搜尋
            <br />
            試試「客戶」「評審」「報銷」
          </div>
        )}
        {trimmed && results.length === 0 && (
          <div className="search-hint">找不到「{trimmed}」的相關結果</div>
        )}
        {results.map((result) => (
          <button
            className="search-result"
            key={`${result.kind}-${result.id}`}
            type="button"
            // A todo without a due date has no day to open — DayPop substitutes
            // the day for the原檔's pet bubble (DP-040), and there is no honest
            // substitute when the todo is not on a day at all. The row stays
            // visible and its 無到期日 sub line says why it cannot be opened.
            disabled={result.kind === 'todo' && !result.dueDate}
            onClick={() => {
              if (result.kind === 'event') onOpenEvent(result.id);
              else if (result.dueDate) onOpenDay(result.dueDate);
            }}
          >
            <span
              className="search-result-dot"
              style={
                result.calendarId
                  ? { background: calendarColor(data.calendars, result.calendarId) }
                  : undefined
              }
            />
            <span className="search-result-body">
              <span className="search-result-title">{result.title}</span>
              <span className="search-result-sub">{result.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
