import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { addDays, daysBetween, fromDateKey, startOfWeek, toDateKey } from '../../domain/date';
import { instantDateInZone, instantTimeInZone } from '../../domain/eventTime';
import {
  allDayDisplaySegments,
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
import type { OccurrenceWindow, ResolvedEventOccurrence } from '../../domain/recurrence';
import type { Calendar, TimedCalendarEvent } from '../../domain/types';
import type { EventPatch } from '../../domain/mutations';
import { draggedInterval, type TimedInterval } from '../../domain/weekDrag';
import { occurrenceTarget, type OccurrenceTarget } from './occurrenceTarget';

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
  /**
   * Expands the visible calendars into occurrences for one window — DP-081.
   * This grid asks for exactly the week it draws.
   */
  resolveOccurrences(window: OccurrenceWindow): ResolvedEventOccurrence[];
  calendars: Calendar[];
  /** The screen asks for scope before persisting a recurring drag — DP-083. */
  onDragEvent(target: OccurrenceTarget, patch: EventPatch): void;
  /** A press that did not turn into a drag opens the event, as in the原檔. */
  onOpenEvent(target: OccurrenceTarget): void;
}

interface DragState {
  /** Occurrence key — what the preview lights up. */
  key: string;
  dateKey: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  origin: DragRange;
  moved: boolean;
  pointerId: number;
  /** Only multi-day blocks use complete endpoints; single-day maths stays put. */
  intervalEvent?: TimedCalendarEvent;
}

/**
 * 週檢視 — the 7-column time grid, ported from the `data-week-grid` block of
 * `日曆桌寵 Calendar Pet.dc.html`.
 *
 * Events can be dragged to another time or another day and resized from the
 * bottom edge, snapping to 15 minutes. DP-114 adds an all-day strip above the
 * rail, deliberately extending the原檔 which omitted all-day events (DP-015).
 *
 * DP-083 lets recurring blocks drag and resize, handing the concrete occurrence
 * to the screen's 單次／全部 dialog. Unlike the原檔's silent split, no mutation
 * happens until scope is chosen. DP-072 moves complete cross-midnight intervals
 * from any segment; only their final segment exposes the resize handle.
 */
export function WeekView({
  weekStartsOn,
  displayTimezone,
  cursor,
  todayKey,
  resolveOccurrences,
  calendars,
  onDragEvent,
  onOpenEvent,
}: WeekViewProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const blockRefs = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  // Keyed by occurrence, not by event id — DP-081. Every occurrence of one
  // series shares an event id, so an id-keyed preview would drag all of them at
  // once on screen.
  const [preview, setPreview] = useState<{ key: string } & DragRange | null>(null);
  const [intervalPreview, setIntervalPreview] = useState<{ key: string; interval: TimedInterval } | null>(null);
  const [now, setNow] = useState(() => new Date());

  // A preview can remove the grabbed day. Restore its committed block before
  // ScopeDialog captures return focus in its passive effect.
  useLayoutEffect(() => {
    if (intervalPreview || !pendingFocus.current) return;
    blockRefs.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  }, [intervalPreview]);

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
  const occurrences = useMemo(
    () => resolveOccurrences({ startDate: weekStartKey, endDate: weekEndKey }),
    [resolveOccurrences, weekStartKey, weekEndKey],
  );

  /** Occurrence key → what a tap on any of its blocks addresses — DP-082. */
  const targetsByOccurrence = useMemo(() => {
    const byKey = new Map<string, OccurrenceTarget>();
    for (const resolved of occurrences) byKey.set(resolved.key, occurrenceTarget(resolved));
    return byKey;
  }, [occurrences]);

  // All-day dates are inclusive and timezone-free. Bound even a years-long
  // occurrence to seven visible days; do not feed it into the timed rail.
  const allDayByDate = useMemo(() => {
    const byDate = new Map<string, ResolvedEventOccurrence[]>();
    for (const resolved of occurrences) {
      if (!resolved.event.allDay) continue;
      for (const { dateKey } of allDayDisplaySegments(resolved.event, { startDateKey: weekStartKey, endDateKey: weekEndKey })) {
        const list = byDate.get(dateKey) ?? [];
        list.push(resolved);
        byDate.set(dateKey, list);
      }
    }
    return byDate;
  }, [occurrences, weekEndKey, weekStartKey]);

  const segmentsByDate = useMemo(() => {
    const byDate = new Map<string, DisplaySegment[]>();
    for (const { key: occurrenceKey, event } of occurrences) {
      // DP-114 draws these in a separate strip, never on the timed rail.
      if (event.allDay) continue;
      // The occurrence key, not the event id — DP-081. Two occurrences of one
      // series in the same week need separate blocks.
      for (const segment of eventDisplaySegments(event, occurrenceKey, displayTimezone, {
        startDateKey: weekStartKey,
        endDateKey: weekEndKey,
      })) {
        const list = byDate.get(segment.dateKey);
        if (list) list.push(segment);
        else byDate.set(segment.dateKey, [segment]);
      }
    }
    return byDate;
  }, [displayTimezone, occurrences, weekEndKey, weekStartKey]);

  // Re-cut all segments of the dragged occurrence, including horizontal moves.
  // The rail below still reads committed segments so it cannot jump mid-gesture.
  const drawnSegmentsByDate = useMemo(() => {
    if (!intervalPreview) return segmentsByDate;
    const byDate = new Map<string, DisplaySegment[]>();
    for (const { key, event } of occurrences) {
      if (event.allDay) continue;
      const drawn = key === intervalPreview.key ? { ...event, ...intervalPreview.interval } : event;
      for (const segment of eventDisplaySegments(drawn, key, displayTimezone, {
        startDateKey: weekStartKey, endDateKey: weekEndKey,
      })) {
        const list = byDate.get(segment.dateKey) ?? [];
        list.push(segment);
        byDate.set(segment.dateKey, list);
      }
    }
    return byDate;
  }, [displayTimezone, intervalPreview, occurrences, segmentsByDate, weekEndKey, weekStartKey]);

  // The rail is derived from what this week actually contains, so a 23:00 event
  // is drawn at 23:00 instead of being clamped onto the 22:00 line — DP-064 §9.
  // A drag preview is deliberately left out: single-day drags are bounded by
  // the day, and growing the range mid-drag would slide every block
  // out from under the pointer. The range settles when the drag commits.
  const range = useMemo(
    () => hourRangeForSegments([...segmentsByDate.values()].flat()),
    [segmentsByDate],
  );

  const columns = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index);
      const key = toDateKey(date);
      const blocks = (drawnSegmentsByDate.get(key) ?? [])
        .slice()
        .sort((left, right) => left.startMinutes - right.startMinutes)
        .map((segment) => {
          const singlePreview = preview?.key === segment.key ? preview : null;
          const dragging = singlePreview !== null || intervalPreview?.key === segment.key;
          const startMinutes = singlePreview?.startMinutes ?? segment.startMinutes;
          const endMinutes = singlePreview?.endMinutes ?? segment.endMinutes;
          return {
            segment,
            dragging,
            // The segment's own clock, where a day ends at 24:00 — writing
            // 23:00–00:00 on the first night would read as zero length.
            timeLabel: segment.isContinuation
              ? `${CONTINUATION_LABEL} ${segmentClock(startMinutes)}`
              : segmentClock(startMinutes),
            rangeLabel: segmentTimeRange({ ...segment, startMinutes, endMinutes }),
            resizable: !segment.continuesNextDay,
            ...blockGeometry(startMinutes, endMinutes, range),
          };
        });
      return { key, date, isToday: key === todayKey, blocks };
    });
  }, [drawnSegmentsByDate, intervalPreview, preview, range, todayKey, weekStart]);

  // Both the "is now inside this week" test and the line's height are read in
  // the display zone — the columns are, so the line has to be too (DP-064).
  const nowKey = instantDateInZone(now.toISOString(), displayTimezone);
  const nowTop =
    nowKey >= weekStartKey && nowKey <= weekEndKey
      ? nowLineTop(minutesFromTime(instantTimeInZone(now.toISOString(), displayTimezone)), range)
      : null;

  /**
   * Opens the occurrence a block belongs to — DP-082.
   *
   * Resolved from the occurrence key rather than from `segment.event.id`,
   * which for a recurring occurrence is the *series* id and says nothing about
   * which one was tapped. Both halves of a cross-midnight block share the key,
   * so either half opens the same occurrence.
   */
  const openOccurrence = useCallback(
    (occurrenceKey: string) => {
      const target = targetsByOccurrence.get(occurrenceKey);
      if (target) onOpenEvent(target);
    },
    [onOpenEvent, targetsByOccurrence],
  );

  function beginDrag(
    domEvent: ReactPointerEvent<HTMLElement>,
    segment: DisplaySegment,
    mode: 'move' | 'resize',
  ) {
    if (domEvent.button !== 0 || dragRef.current) return;
    domEvent.preventDefault();
    if (mode === 'resize') domEvent.stopPropagation();
    domEvent.currentTarget.closest<HTMLElement>('.cal-week-event')?.focus();
    dragRef.current = {
      key: segment.key,
      dateKey: segment.dateKey,
      mode,
      startX: domEvent.clientX,
      startY: domEvent.clientY,
      // Single-day drags use this visible range. Multi-day drags ignore it
      // and carry both complete endpoints in intervalEvent below.
      origin: { startMinutes: segment.startMinutes, endMinutes: segment.endMinutes },
      moved: false,
      pointerId: domEvent.pointerId,
      ...(instantDateInZone(segment.event.startsAt, displayTimezone) !== instantDateInZone(segment.event.endsAt, displayTimezone)
        ? { intervalEvent: segment.event } : {}),
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
      if (!drag || domEvent.pointerId !== drag.pointerId) return;
      const factor = scale();
      if (
        Math.abs(domEvent.clientX - drag.startX) + Math.abs(domEvent.clientY - drag.startY) >
        4
      ) {
        drag.moved = true;
      }
      const delta = snapMinutes((domEvent.clientY - drag.startY) / factor);
      if (drag.intervalEvent) {
        const from = daysBetween(weekStart, fromDateKey(drag.dateKey));
        const to = columnShift((domEvent.clientX - drag.startX) / factor, from);
        const interval = draggedInterval(drag.intervalEvent, displayTimezone, delta, to - from, drag.mode);
        setIntervalPreview(interval ? { key: drag.key, interval } : null);
        return;
      }
      const range =
        drag.mode === 'move' ? moveRange(drag.origin, delta) : resizeRange(drag.origin, delta);
      setPreview({ key: drag.key, ...range });
    }

    function onUp(domEvent: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || domEvent.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      if (drag.intervalEvent) pendingFocus.current = `${drag.key}-${drag.dateKey}`;
      const range = preview?.key === drag.key ? preview : null;
      setPreview(null);
      setIntervalPreview(null);

      if (!drag.moved) {
        if (drag.mode === 'move') openOccurrence(drag.key);
        return;
      }
      if (drag.intervalEvent) {
        const factor = scale();
        const from = daysBetween(weekStart, fromDateKey(drag.dateKey));
        const to = columnShift((domEvent.clientX - drag.startX) / factor, from);
        const interval = draggedInterval(drag.intervalEvent, displayTimezone,
          snapMinutes((domEvent.clientY - drag.startY) / factor), to - from, drag.mode);
        const target = targetsByOccurrence.get(drag.key);
        if (target && interval && (interval.startsAt !== drag.intervalEvent.startsAt || interval.endsAt !== drag.intervalEvent.endsAt)) {
          onDragEvent(target, { timedInterval: interval });
        }
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
      const fromIndex = daysBetween(weekStart, fromDateKey(drag.dateKey));
      const toIndex = columnShift((domEvent.clientX - drag.startX) / factor, fromIndex);
      // Always include the displayed day: a recurring target is a later
      // occurrence, not the series anchor, even for a vertical-only drag.
      patch.date = toDateKey(addDays(weekStart, toIndex));

      const target = targetsByOccurrence.get(drag.key);
      if (target) onDragEvent(target, patch);
    }

    function onCancel(domEvent: PointerEvent) {
      if (domEvent.pointerId !== dragRef.current?.pointerId) return;
      if (dragRef.current?.intervalEvent) pendingFocus.current = `${dragRef.current.key}-${dragRef.current.dateKey}`;
      dragRef.current = null;
      setPreview(null);
      setIntervalPreview(null);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [displayTimezone, openOccurrence, onDragEvent, preview, targetsByOccurrence, weekStart]);

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

        {allDayByDate.size > 0 && (
          <section className="cal-week-all-day" aria-label="本週全天事件">
            <div className="cal-week-all-day-label">全天</div>
            {columns.map((column) => (
              <div className="cal-week-all-day-col" key={column.key} role="group" aria-label={`${column.key} 全天事件`}>
                {(allDayByDate.get(column.key) ?? []).map(({ key, event }) => {
                  const continuation = event.allDay && column.key > event.startDate;
                  return (
                    <button
                      type="button"
                      className="cal-week-all-day-event"
                      key={key}
                      aria-label={`${column.key} ${continuation ? `${CONTINUATION_LABEL} ` : ''}全天 ${event.title}`}
                      title={event.title}
                      onClick={() => openOccurrence(key)}
                      style={{ background: calendarColor(calendars, event.calendarId), color: CALENDAR_TEXT_COLOR }}
                    >
                      {continuation ? `${CONTINUATION_LABEL} ` : ''}{event.title}
                    </button>
                  );
                })}
              </div>
            ))}
          </section>
        )}

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
                      ref={(element) => {
                        const key = `${block.segment.key}-${block.segment.dateKey}`;
                        if (element) blockRefs.current.set(key, element);
                        else blockRefs.current.delete(key);
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${block.segment.isContinuation ? `${CONTINUATION_LABEL} ` : ''}${block.rangeLabel} ${block.segment.event.title}`}
                      onPointerDown={(domEvent) => beginDrag(domEvent, block.segment, 'move')}
                      onKeyDown={(domEvent) => {
                        if (domEvent.key === 'Enter' || domEvent.key === ' ') {
                          domEvent.preventDefault();
                          openOccurrence(block.segment.key);
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
                      {block.resizable && (
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
