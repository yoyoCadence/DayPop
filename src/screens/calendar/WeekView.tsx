import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays, fromDateKey, startOfWeek, toDateKey } from '../../domain/date';
import { instantDateInZone, instantTimeInZone } from '../../domain/eventTime';
import {
  eventDisplaySegments,
  hourRangeForSegments,
  segmentClock,
  segmentTimeRange,
  type DisplaySegment,
} from '../../domain/displaySegments';
import {
  blockGeometry,
  columnShift,
  COLUMN_WIDTH,
  gridHeight,
  hourRail,
  minutesFromTime,
  moveRange,
  nowLineTop,
  resizeRange,
  snapMinutes,
  timeFromMinutes,
  type DragRange,
} from '../../domain/timeGrid';
import { calendarColor, CALENDAR_TEXT_COLOR } from '../../domain/calendars';
import type { Calendar, CalendarEvent } from '../../domain/types';
import type { EventPatch } from '../../domain/mutations';

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** Marks the second and later days of a cross-midnight event — DP-064. */
const CONTINUATION_LABEL = '續';

export interface WeekViewProps {
  weekStartsOn: 0 | 1;
  /**
   * The one timezone this grid is drawn in — DP-064. A drag therefore hands
   * back a wall coordinate in *this* zone, not in the event's own.
   */
  displayTimezone: string;
  /** Any date inside the week to show. */
  cursor: string;
  todayKey: string;
  events: CalendarEvent[];
  calendars: Calendar[];
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
 * DP-027 provides occurrence splitting and DST-safe domain mutations. Wiring
 * a generated block to the canonical single/all scope dialog remains DP-014,
 * so this view still receives base events and a drag updates the base for now.
 */
export function WeekView({
  weekStartsOn,
  displayTimezone,
  cursor,
  todayKey,
  events,
  calendars,
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

  const weekStartKey = toDateKey(weekStart);
  const weekEndKey = toDateKey(addDays(weekStart, 6));

  // Cut once for the whole week, not once per column — DP-064. The window is
  // the week itself, so a multi-month event walks seven days rather than its
  // own length.
  const segmentsByDate = useMemo(() => {
    const byDate = new Map<string, DisplaySegment[]>();
    for (const event of events) {
      // All-day events are not drawn on the grid in the原檔 either (DP-015).
      if (event.allDay) continue;
      for (const segment of eventDisplaySegments(event, event.id, displayTimezone, {
        startDateKey: weekStartKey,
        endDateKey: weekEndKey,
      })) {
        const list = byDate.get(segment.dateKey);
        if (list) list.push(segment);
        else byDate.set(segment.dateKey, [segment]);
      }
    }
    return byDate;
  }, [displayTimezone, events, weekEndKey, weekStartKey]);

  // The rail is derived from what this week actually contains, so a 23:00 event
  // is drawn at 23:00 instead of being clamped onto the 22:00 line — DP-064 §9.
  // A drag preview is deliberately left out: it is bounded by the day rather
  // than by the rail, and growing the range mid-drag would slide every block
  // out from under the pointer. The range settles when the drag commits.
  const range = useMemo(
    () => hourRangeForSegments([...segmentsByDate.values()].flat()),
    [segmentsByDate],
  );

  const columns = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index);
      const key = toDateKey(date);
      const blocks = (segmentsByDate.get(key) ?? [])
        .slice()
        .sort((left, right) => left.startMinutes - right.startMinutes)
        .map((segment) => {
          const dragging = preview?.id === segment.event.id;
          const startMinutes = dragging ? preview.startMinutes : segment.startMinutes;
          const endMinutes = dragging ? preview.endMinutes : segment.endMinutes;
          return {
            segment,
            dragging,
            // The segment's own clock, where a day ends at 24:00 — writing
            // 23:00–00:00 on the first night would read as zero length.
            timeLabel: segment.isContinuation
              ? `${CONTINUATION_LABEL} ${segmentClock(startMinutes)}`
              : segmentClock(startMinutes),
            rangeLabel: segmentTimeRange({ ...segment, startMinutes, endMinutes }),
            // A drag rewrites one wall-clock range on one day, which cannot
            // express an occurrence that spans several — see the ADR §6 note on
            // 跨午夜拖曳 and DP-072. Those blocks open the event instead.
            draggable: !segment.isContinuation && !segment.continuesNextDay,
            ...blockGeometry(startMinutes, endMinutes, range),
          };
        });
      return { key, date, isToday: key === todayKey, blocks };
    });
  }, [preview, range, segmentsByDate, todayKey, weekStart]);

  // Both the "is now inside this week" test and the line's height are read in
  // the display zone — the columns are, so the line has to be too (DP-064).
  const nowKey = instantDateInZone(now.toISOString(), displayTimezone);
  const nowTop =
    nowKey >= weekStartKey && nowKey <= weekEndKey
      ? nowLineTop(minutesFromTime(instantTimeInZone(now.toISOString(), displayTimezone)), range)
      : null;

  function beginDrag(
    domEvent: ReactPointerEvent<HTMLElement>,
    segment: DisplaySegment,
    mode: 'move' | 'resize',
  ) {
    domEvent.preventDefault();
    if (mode === 'resize') domEvent.stopPropagation();
    dragRef.current = {
      id: segment.event.id,
      dateKey: segment.dateKey,
      mode,
      startX: domEvent.clientX,
      startY: domEvent.clientY,
      // The segment's minutes, which for a draggable block are the whole
      // occurrence's — the grid and the drag then start from one reading.
      origin: { startMinutes: segment.startMinutes, endMinutes: segment.endMinutes },
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
        // The numbers above are positions on a grid drawn in the display zone,
        // not the event's own wall clock — DP-064.
        wallTimeZone: displayTimezone,
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
  }, [displayTimezone, onOpenEvent, onUpdateEvent, preview, weekStart]);

  const rail = hourRail(range);

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
          <div className="cal-week-grid" ref={gridRef} style={{ height: `${gridHeight(range)}px` }}>
            {rail.map((hour) => (
              <div className="cal-week-hour-line" key={hour.label} style={{ top: `${hour.top}px` }} />
            ))}
            <div className="cal-week-columns">
              {columns.map((column) => (
                <div className="cal-week-col" key={column.key} style={{ width: `${COLUMN_WIDTH}px` }}>
                  {column.blocks.map((block) => (
                    <div
                      className={`cal-week-event${block.dragging ? ' dragging' : ''}`}
                      // Keyed by day as well: one occurrence draws a block in
                      // every column it crosses.
                      key={`${block.segment.key}-${block.segment.dateKey}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${block.segment.isContinuation ? `${CONTINUATION_LABEL} ` : ''}${block.rangeLabel} ${block.segment.event.title}`}
                      onPointerDown={
                        block.draggable
                          ? (domEvent) => beginDrag(domEvent, block.segment, 'move')
                          : undefined
                      }
                      // A block with no drag handler needs its own way to open:
                      // the draggable ones open from the pointerup that turned
                      // out not to be a drag.
                      onClick={
                        block.draggable ? undefined : () => onOpenEvent(block.segment.event.id)
                      }
                      onKeyDown={(domEvent) => {
                        if (domEvent.key === 'Enter' || domEvent.key === ' ') {
                          domEvent.preventDefault();
                          onOpenEvent(block.segment.event.id);
                        }
                      }}
                      style={{
                        top: `${block.top}px`,
                        height: `${block.height}px`,
                        background: calendarColor(calendars, block.segment.event.calendarId),
                        color: CALENDAR_TEXT_COLOR,
                      }}
                    >
                      <div className="cal-week-event-time">{block.timeLabel}</div>
                      <div className="cal-week-event-title">{block.segment.event.title}</div>
                      {block.draggable && (
                        <div
                          className="cal-week-event-resize"
                          onPointerDown={(domEvent) => beginDrag(domEvent, block.segment, 'resize')}
                        />
                      )}
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
