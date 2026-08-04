import { useMemo, useState } from 'react';
import { toDateKey } from '../domain/date';
import {
  buildOverviewGroups,
  overviewLabel,
  stepOverviewCursor,
  type OverviewPeriod,
  type OverviewType,
} from '../domain/overview';
import { useDayPopData } from '../data/dataContext';
import './screens.css';
import './overview.css';

export interface OverviewScreenProps {
  /** Opens the event on the 日曆 tab, as the原檔 does. */
  onOpenEvent(id: string): void;
}

const TYPE_OPTIONS: { type: OverviewType; label: string }[] = [
  { type: 'events', label: '行程' },
  { type: 'todos', label: '待辦' },
  { type: 'stickers', label: '貼圖' },
];

const PERIOD_OPTIONS: { period: OverviewPeriod; label: string }[] = [
  { period: 'year', label: '年' },
  { period: 'month', label: '月' },
  { period: 'week', label: '週' },
];

/**
 * 綜覽 tab, ported from the overview screen of
 * `日曆桌寵 Calendar Pet.dc.html`: type and period segmented controls, period
 * stepper, collapsible groups and a total count.
 *
 * 貼圖 keeps its place in the type control. DP-055 still needs to wire Sticker
 * storage into this view, so it shows an explicit note rather than an empty
 * state that would imply the user simply has none.
 */
export function OverviewScreen({ onOpenEvent }: OverviewScreenProps) {
  const { data, toggleTodo } = useDayPopData();
  const [type, setType] = useState<OverviewType>('events');
  const [period, setPeriod] = useState<OverviewPeriod>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const weekStartsOn = data.preferences.weekStartsOn;
  const todayKey = toDateKey(new Date());
  const groups = useMemo(
    () =>
      buildOverviewGroups({
        events: data.events,
        todos: data.todos,
        type,
        period,
        cursor,
        weekStartsOn,
        todayKey,
      }),
    [data.events, data.todos, type, period, cursor, weekStartsOn, todayKey],
  );
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const collapsedSet = new Set(collapsed);

  function toggleGroup(key: string) {
    setCollapsed((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  return (
    <div className="dp-screen overview-screen">
      <div className="overview-header">
        <div className="overview-title-row">
          <div className="dp-screen-title">綜覽</div>
          <div className="overview-total">共 {total} 筆</div>
        </div>

        <div className="cal-segmented overview-segmented" role="group" aria-label="資料類型">
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.type}
              type="button"
              aria-pressed={type === option.type}
              onClick={() => setType(option.type)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="overview-stepper">
          <button
            className="cal-step-button"
            type="button"
            aria-label="上一期"
            onClick={() => setCursor((current) => stepOverviewCursor(current, period, -1))}
          >
            ‹
          </button>
          <div className="overview-label">{overviewLabel(cursor, period, weekStartsOn)}</div>
          <button
            className="cal-step-button"
            type="button"
            aria-label="下一期"
            onClick={() => setCursor((current) => stepOverviewCursor(current, period, 1))}
          >
            ›
          </button>
        </div>

        <div className="overview-period-row">
          <div className="cal-segmented" role="group" aria-label="時間範圍">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.period}
                type="button"
                aria-pressed={period === option.period}
                onClick={() => setPeriod(option.period)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            className="cal-chip-button"
            type="button"
            onClick={() => setCursor(new Date())}
          >
            今天
          </button>
        </div>

        {period === 'year' && (
          <div className="overview-bulk">
            <button type="button" onClick={() => setCollapsed(groups.map((group) => group.key))}>
              – 全部收合
            </button>
            <button type="button" onClick={() => setCollapsed([])}>
              + 全部展開
            </button>
          </div>
        )}
      </div>

      <div className="overview-body">
        {type === 'stickers' && (
          <div className="dp-note">
            <span className="dp-note-task">DP-055</span>
            <strong>貼圖統計尚未接上</strong>
            <p>Sticker 已可保存；原稿的區間統計與列表會在 DP-055 接上，現在不顯示假的空資料。</p>
          </div>
        )}

        {type !== 'stickers' && groups.length === 0 && (
          <div className="overview-empty">
            這個區間沒有資料
            <br />
            試著切換年/月/週或行程/待辦/貼圖
          </div>
        )}

        {groups.map((group) => {
          const open = !collapsedSet.has(group.key);
          return (
            <div className="overview-group" key={group.key}>
              <button
                className="overview-group-head"
                type="button"
                aria-expanded={open}
                onClick={() => toggleGroup(group.key)}
              >
                <span className="overview-chevron">{open ? '▾' : '▸'}</span>
                <span className="overview-group-title">{group.title}</span>
                <span className="overview-group-sub">{group.sub}</span>
                <span className="overview-group-spacer" />
                <span className="overview-group-count">({group.count})</span>
              </button>
              {open && (
                <div className="overview-group-body">
                  {group.days.map((day) => (
                    <div key={day.dateKey}>
                      {group.labelDays && <div className="overview-day-label">{day.dayLabel}</div>}
                      {day.items.map((item) => (
                        <button
                          className="overview-item"
                          key={`${item.kind}-${item.id}`}
                          type="button"
                          onClick={() =>
                            item.kind === 'event' ? onOpenEvent(item.id) : toggleTodo(item.id)
                          }
                        >
                          <span
                            className="overview-item-bar"
                            style={{
                              background: item.done ? 'var(--faint)' : 'var(--accent)',
                            }}
                          />
                          <span className="overview-item-time">{item.time}</span>
                          <span className="overview-item-body">
                            <span
                              className="overview-item-title"
                              style={{
                                textDecoration: item.done ? 'line-through' : 'none',
                              }}
                            >
                              {item.title}
                            </span>
                            {item.sub && <span className="overview-item-sub">{item.sub}</span>}
                          </span>
                          {item.kind === 'todo' && (
                            <span
                              className="overview-item-right"
                              style={{ color: item.done ? 'var(--accent)' : 'var(--faint)' }}
                            >
                              {item.done ? '✓' : '○'}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
