import { useMemo, useState } from 'react';
import { searchEntries } from '../domain/search';
import { useDayPopData } from '../hooks/useDayPopData';
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
 * The原檔 puts a per-calendar filter chip row under the field. The Calendar
 * model exists; the row keeps its single working 全部 chip until DP-014 wires
 * the filter interaction.
 */
export function SearchScreen({ onOpenEvent, onOpenDay }: SearchScreenProps) {
  const { data } = useDayPopData();
  const [query, setQuery] = useState('');
  const results = useMemo(
    () => searchEntries(query, data.events, data.todos),
    [query, data.events, data.todos],
  );
  const trimmed = query.trim();

  return (
    <div className="dp-screen search-screen">
      <div className="search-header">
        <div className="dp-screen-title">搜尋</div>
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

      <div className="search-chips">
        <button className="search-chip" type="button" aria-pressed="true">
          <span className="search-chip-dot" />
          全部
        </button>
        <span className="search-chip-pending">依日曆篩選待 DP-014</span>
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
            onClick={() =>
              result.kind === 'event'
                ? onOpenEvent(result.id)
                : onOpenDay(data.todos.find((todo) => todo.id === result.id)?.dueDate ?? '')
            }
          >
            <span className="search-result-dot" />
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
