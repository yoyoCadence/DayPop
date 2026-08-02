import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays, fromDateKey, startOfWeek, toDateKey } from '../../domain/date';
import {
  blockGeometry,
  columnShift,
  COLUMN_WIDTH,
  GRID_HEIGHT,
  hourRail,
  minutesFromTime,
  moveRange,
  nowLineTop,
  resizeRange,
  snapMinutes,
  timeFromMinutes,
  type DragRange,
} from '../../domain/timeGrid';
import type { CalendarEvent } from '../../domain/types';
import type { EventPatch } from '../../storage/localRepository';

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export interface WeekViewProps {
  weekStartsOn: 0 | 1;
  /** Any date inside the week to show. */
  cursor: string;
  todayKey: string;
  events: CalendarEvent[];
  onUpdateEvent(id: string, patch: EventPatch): void;
  /** A press that did not turn into a drag opens the event, as in the原檔. */
  onOpenEvent(id: string): void;
}

interface DragState {
  id: string;
  dateKey: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  origin: DragRange;
  moved: boolean;
}

/**
 * 週檢視 — the 7-column time grid, ported from the `data-week-grid` block of
 * `日曆桌寵 Calendar Pet.dc.html`.
 *
 * Events can be dragged to another time or another day and resized from the
 * bottom edge, snapping to 15 minutes. All-day events are not drawn on the grid
 * in the原檔 either; the 全天 row is part of DP-014's remaining work.
 *
 * The原檔 additionally splits a recurring event when one occurrence is dragged.
 * DayPop has no recurrence model yet (DP-012/DP-027), so a drag simply updates
 * the single event it touched.
 */
export function WeekView({
  weekStartsOn,
  cursor,
  todayKey,
  events,
  onUpdateEvent,
  onOpenEvent,
}: WeekViewProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<{ id: string } & DragRange | null>(null);
  const [now, setNow] = useState(() => new Date());

  // The current-time line only needs minute resolution.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const weekStart = useMemo(
    () => startOfWeek(fromDateKey(cursor), weekStartsOn),
    [cursor, weekStartsOn],
  );

  const columns = useMemo(() => {
    const byDate = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      if (event.allDay) continue;
      const list = byDate.get(event.date);
      if (list) list.push(event);
      else byDate.set(event.date, [event]);
    }

    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index);
      const key = toDateKey(date);
      const timed = (byDate.get(key) ?? [])
        .slice()
        .sort((left, right) => left.start.localeCompare(right.start))
        .map((event) => {
          const dragging = preview?.id === event.id;
          const startMinutes = dragging ? preview.startMinutes : minutesFromTime(event.start);
          const endMinutes = dragging
            ? preview.endMinutes
            : minutesFromTime(event.end || event.start);
          return {
            event,
            dragging,
            timeLabel: timeFromMinutes(startMinutes),
            ...blockGeometry(startMinutes, endMinutes),
          };
        });
      return { key, date, isToday: key === todayKey, timed };
    });
  }, [events, preview, todayKey, weekStart]);

  const nowTop = toDateKey(now) >= toDateKey(weekStart) && toDateKey(now) <= toDateKey(addDays(weekStart, 6))
    ? nowLineTop(now)
    : null;

  function beginDrag(
    domEvent: ReactPointerEvent<HTMLElement>,
    event: CalendarEvent,
    mode: 'move' | 'resize',
  ) {
    domEvent.preventDefault();
    if (mode === 'resize') domEvent.stopPropagation();
    dragRef.current = {
      id: event.id,
      dateKey: event.date,
      mode,
      startX: domEvent.clientX,
      startY: domEvent.clientY,
      origin: {
        startMinutes: minutesFromTime(event.start),
        endMinutes: minutesFromTime(event.end || event.start),
      },
      moved: false,
    };
  }

  useEffect(() => {
    // The原檔 listens on the window so a fast drag that leaves the block still
    // tracks, and a pointerup anywhere still commits.
    function scale(): number {
      const grid = gridRef.current;
      if (!grid || !grid.offsetHeight) return 1;
      return grid.getBoundingClientRect().height / grid.offsetHeight || 1;
    }

    function onMove(domEvent: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const factor = scale();
      if (
        Math.abs(domEvent.clientX - drag.startX) + Math.abs(domEvent.clientY - drag.startY) >
        4
      ) {
        drag.moved = true;
      }
      const delta = snapMinutes((domEvent.clientY - drag.startY) / factor);
      const range =
        drag.mode === 'move' ? moveRange(drag.origin, delta) : resizeRange(drag.origin, delta);
      setPreview({ id: drag.id, ...range });
    }

    function onUp(domEvent: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      const range = preview?.id === drag.id ? preview : null;
      setPreview(null);

      if (!drag.moved) {
        if (drag.mode === 'move') onOpenEvent(drag.id);
        return;
      }
      if (!range) return;

      const patch: EventPatch = {
        start: timeFromMinutes(range.startMinutes),
        end: timeFromMinutes(range.endMinutes),
      };

      const factor = scale();
      const fromIndex = Math.round(
        (fromDateKey(drag.dateKey).getTime() - weekStart.getTime()) / 86_400_000,
      );
      const toIndex = columnShift((domEvent.clientX - drag.startX) / factor, fromIndex);
      if (toIndex !== fromIndex) patch.date = toDateKey(addDays(weekStart, toIndex));

      onUpdateEvent(drag.id, patch);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [onOpenEvent, onUpdateEvent, preview, weekStart]);

  const rail = hourRail();

  return (
    <div className="cal-view-pane cal-week">
      <div className="cal-week-inner">
        <div className="cal-week-head">
          <div className="cal-week-rail-spacer" />
          {columns.map((column) => (
            <div
              className="cal-week-col-head"
              key={column.key}
              style={{ background: column.isToday ? 'var(--today-bg)' : 'transparent' }}
            >
              <div className="cal-week-col-label">週{WEEKDAY_LABELS[column.date.getDay()]}</div>
              <div
                className="cal-week-col-date"
                style={{ color: column.isToday ? 'var(--today-fg)' : 'var(--fg)' }}
              >
                {column.date.getDate()}
              </div>
            </div>
          ))}
        </div>

        <div className="cal-week-body">
          <div className="cal-week-rail">
            {rail.map((hour) => (
              <div className="cal-week-hour-label" key={hour.label} style={{ top: `${hour.top}px` }}>
                {hour.label}
              </div>
            ))}
          </div>
          <div className="cal-week-grid" ref={gridRef} style={{ height: `${GRID_HEIGHT}px` }}>
            {rail.map((hour) => (
              <div className="cal-week-hour-line" key={hour.label} style={{ top: `${hour.top}px` }} />
            ))}
            <div className="cal-week-columns">
              {columns.map((column) => (
                <div className="cal-week-col" key={column.key} style={{ width: `${COLUMN_WIDTH}px` }}>
                  {column.timed.map((block) => (
                    <div
                      className={`cal-week-event${block.dragging ? ' dragging' : ''}`}
                      key={block.event.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${block.timeLabel} ${block.event.title}`}
                      onPointerDown={(domEvent) => beginDrag(domEvent, block.event, 'move')}
                      onKeyDown={(domEvent) => {
                        if (domEvent.key === 'Enter' || domEvent.key === ' ') {
                          domEvent.preventDefault();
                          onOpenEvent(block.event.id);
                        }
                      }}
                      style={{ top: `${block.top}px`, height: `${block.height}px` }}
                    >
                      <div className="cal-week-event-time">{block.timeLabel}</div>
                      <div className="cal-week-event-title">{block.event.title}</div>
                      <div
                        className="cal-week-event-resize"
                        onPointerDown={(domEvent) => beginDrag(domEvent, block.event, 'resize')}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {nowTop !== null && (
              <div className="cal-week-now" style={{ top: `${nowTop}px` }} aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
