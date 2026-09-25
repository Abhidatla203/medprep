'use client';

// =============================================================================
// app/attendance/components/WeekStrip.tsx
// -----------------------------------------------------------------------------
//   ROWS    = days  (one per working day, fixed height)
//   COLUMNS = time  (segments between boundaries, width ∝ duration)
//
// WHY DAYS ARE ROWS: it matches the printed college timetable, it sends overflow
// SIDEWAYS instead of making the strip taller (the variable axis is time), the
// height stays fixed at six rows, and a break costs a narrow column instead of
// a full row.
//
// THREE HARD RULES
//   1. READ-ONLY. Marking happens in the list below. A preview you can edit is
//      not a preview.
//   2. NO PERCENTAGES. Ever. A figure here gets read as a standing.
//   3. STATUS OWNS THE FILL. Class type rides on a stripe and a letter.
//
// ═════════════════════════════════════════════════════════════════════════════
//  TWO ANCHORS — compact is TODAY, overlay is BROWSE
// ═════════════════════════════════════════════════════════════════════════════
//
//  COMPACT CARD → pinned to the week containing TODAY. Permanently. It is not
//    navigable and it cannot be left. A resting instrument that shows an
//    arbitrary past week because of something the user did a minute ago is
//    lying about "now" — and this strip sits directly above the marking list,
//    where "now" is the entire question.
//
//  OVERLAY → browseAnchor, which exists ONLY while expanded and is thrown away
//    on close. History is a thing you go and look at, then come back from.
//    Week changes in the overlay NEVER call onSelectDay, so the attendance
//    page (MarkList, selectedDate) stays on the current week.
//
//  ⚠ DO NOT "simplify" these back into one anchor. That WAS one anchor, and
//    the bug it produced is exactly this note.
//
//  LONG-PRESS (450ms, 10px tolerance) opens the overlay. Chevrons are gone
//    from the compact card — they are a desktop habit. Swipe-to-change-week
//    lives ONLY in the overlay, with the week following the finger.
//
//  TIMES LIVE ON THE RAIL, NOT ON EVERY TILE.
//    • start time at the LEFT edge of every column a class begins in
//    • end time at the RIGHT edge ONLY where a gap follows — because where
//      classes run back-to-back, the next column's start time IS this one's
//      end, and printing both says the same thing twice
//    • end time also on the LAST column, since nothing follows it to imply
//      when the day finishes
// =============================================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import type {
  ClassCategory,
  DayIndex,
  ISODate,
  Session,
  WeekTileStatus,
} from '../types';
import { DAY_NAMES_SHORT } from '../types';
import { generateForWeek } from '../generate';
import { getSettings } from '../store';
import { todayISO } from '@/lib/attendance/datetime';
import { subjectShort } from '@/lib/attendance/curriculum';


// -----------------------------------------------------------------------------
// SECTION 1 — Time helpers (layout arithmetic, not domain logic)
// -----------------------------------------------------------------------------

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * ★ ALWAYS CARRIES am/pm. An earlier version printed bare hours to save width —
 * headers read "9  10:30  2  3", and "2" is not a time anyone can read at a
 * glance. The meridiem costs four pixels and is non-negotiable.
 */
function formatTime(mins: number): string {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? 'am' : 'pm';
  return m === 0
    ? `${h12}${suffix}`
    : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

/** Compact form, used only inside expanded tiles where context is unambiguous. */
function formatTimeCompact(mins: number): string {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, '0')}`;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Local calendar date, never UTC. toISOString() converts to UTC first, so in IST
 * any date computed after 18:30 shifts back a day — "today" would highlight the
 * wrong row every evening.
 */
function toISO(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ⚠ TRAP 4 — Monday is 0 in this codebase. JS getDay() returns 0 for Sunday. */
function isoToDayIndex(iso: ISODate): DayIndex {
  return ((new Date(`${iso}T00:00:00`).getDay() + 6) % 7) as DayIndex;
}

function addDays(iso: ISODate, n: number): ISODate {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

function weekStartFor(iso: ISODate): ISODate {
  return addDays(iso, -isoToDayIndex(iso));
}

/** "22–27 Sept". Always shown — the overlay navigates, so it must say where. */
function formatRange(start: ISODate, end: ISODate): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const startMonth = s.toLocaleDateString(undefined, { month: 'short' });
  const endMonth = e.toLocaleDateString(undefined, { month: 'short' });

  return s.getMonth() === e.getMonth()
    ? `${s.getDate()}–${e.getDate()} ${endMonth}`
    : `${s.getDate()} ${startMonth} – ${e.getDate()} ${endMonth}`;
}


// -----------------------------------------------------------------------------
// SECTION 2 — Status and category maps
// -----------------------------------------------------------------------------

/**
 * Session status is what was RECORDED. Tile status is what the student should
 * SEE — they differ in exactly one case: an unmarked class that has not happened
 * yet is "future", not an outstanding action.
 */
function tileStatusFor(session: Session, today: ISODate): WeekTileStatus {
  switch (session.status) {
    case 'present':
      return 'present';
    case 'absent':
      return 'absent';
    case 'not-conducted':
      return 'cancelled';
    default:
      return session.date > today ? 'future' : 'unmarked';
  }
}

const TILE_CLASS: Record<WeekTileStatus, string> = {
  present: 'tile-present',
  absent: 'tile-absent',
  unmarked: 'tile-unmarked',
  future: 'tile-future',
  cancelled: 'tile-cancelled',
};

const LABEL_CLASS: Record<WeekTileStatus, string> = {
  present: 'text-white',
  absent: 'text-white',
  unmarked: 'text-ink-soft',
  future: 'text-ink-faint',
  cancelled: 'text-white line-through',
};

/**
 * ★ SAME COLOURS AS THE RING GRID — purple theory, orange practical, cyan
 *   clinical — so class type means one thing across the whole screen.
 */
const CATEGORY_STRIPE: Record<ClassCategory, string> = {
  theory: '#7c3aed',
  practical: '#ea580c',
  clinical: '#0891b2',
};

const CATEGORY_LETTER: Record<ClassCategory, string> = {
  theory: 'T',
  practical: 'P',
  clinical: 'C',
};

const CATEGORY_WORD: Record<ClassCategory, string> = {
  theory: 'Theory',
  practical: 'Practical',
  clinical: 'Clinical',
};


// -----------------------------------------------------------------------------
// SECTION 3 — Segments
//
// Collect EVERY boundary minute in the week; a SEGMENT is the span between two
// consecutive boundaries; width is proportional to duration; a session spans
// every segment it covers.
//
// BREAK INFERENCE (spec §7.2): the student NEVER configures break times. A
// segment no working day covers is a break. Consecutive breaks merge. Gaps under
// 20 minutes are changeover, not lunch.
// -----------------------------------------------------------------------------

const BREAK_THRESHOLD_MINUTES = 20;

interface Segment {
  kind: 'class' | 'break';
  startMin: number;
  endMin: number;
  /** True when at least one session begins exactly here — drives the rail. */
  isSessionStart: boolean;
}

function buildSegments(sessions: Session[]): Segment[] {
  if (sessions.length === 0) return [];

  const boundaries = new Set<number>();
  const startMinutes = new Set<number>();

  for (const s of sessions) {
    const a = toMinutes(s.start);
    const b = toMinutes(s.end);
    if (b <= a) continue; // defensive: a zero-length slot would break spanning
    boundaries.add(a);
    boundaries.add(b);
    startMinutes.add(a);
  }

  const points = [...boundaries].sort((x, y) => x - y);
  const raw: Segment[] = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const startMin = points[i];
    const endMin = points[i + 1];

    const covered = sessions.some(
      (s) => toMinutes(s.start) <= startMin && toMinutes(s.end) >= endMin,
    );

    const isBreak = !covered && endMin - startMin >= BREAK_THRESHOLD_MINUTES;

    raw.push({
      kind: isBreak ? 'break' : 'class',
      startMin,
      endMin,
      isSessionStart: startMinutes.has(startMin),
    });
  }

  const merged: Segment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.kind === 'break' && seg.kind === 'break') {
      last.endMin = seg.endMin;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged;
}


// -----------------------------------------------------------------------------
// SECTION 3b — THE TIME RAIL
//
//   start  → printed at the LEFT edge of any column where a class begins
//   end    → printed at the RIGHT edge ONLY when the information is not already
//            supplied by the next column
//
//   "Not already supplied" means exactly two cases:
//     a) a BREAK follows. The next start time is after the gap, so it says
//        nothing about when this block finished.
//     b) NOTHING follows. Last column of the week — no neighbour to imply it.
//
//   Where two class columns touch, the end is DELIBERATELY omitted: "3pm"
//   printed as the right edge of one column and again as the left edge of the
//   next is the same fact twice, and two numbers 4px apart read as a range
//   when they are not one.
// -----------------------------------------------------------------------------

interface RailLabel {
  start: string | null;
  end: string | null;
}

function buildRail(segments: Segment[]): RailLabel[] {
  return segments.map((seg, i) => {
    if (seg.kind === 'break') return { start: null, end: null };

    const next = segments[i + 1];
    const endIsImplied = Boolean(next) && next.kind === 'class';

    return {
      start: seg.isSessionStart ? formatTime(seg.startMin) : null,
      end: endIsImplied ? null : formatTime(seg.endMin),
    };
  });
}


// -----------------------------------------------------------------------------
// SECTION 4 — Placing a day's sessions
// -----------------------------------------------------------------------------

interface Cell {
  kind: 'class' | 'break' | 'empty';
  span: number;
  sessions: Session[];
  key: string;
  label?: string;
}

function placeDay(segments: Segment[], daySessions: Session[]): Cell[] {
  const cells: Cell[] = [];
  let i = 0;

  while (i < segments.length) {
    const seg = segments[i];
    const starting = daySessions.filter(
      (s) => toMinutes(s.start) === seg.startMin,
    );

    if (starting.length > 0) {
      const maxEnd = starting.reduce(
        (m, s) => Math.max(m, toMinutes(s.end)),
        seg.endMin,
      );

      let span = 0;
      while (i + span < segments.length && segments[i + span].endMin <= maxEnd) {
        span += 1;
      }
      span = Math.max(1, span);

      cells.push({ kind: 'class', span, sessions: starting, key: `c${i}` });
      i += span;
      continue;
    }

    if (seg.kind === 'break') {
      cells.push({
        kind: 'break',
        span: 1,
        sessions: [],
        key: `b${i}`,
        label: `${formatTime(seg.startMin)} – ${formatTime(seg.endMin)}`,
      });
      i += 1;
      continue;
    }

    cells.push({ kind: 'empty', span: 1, sessions: [], key: `e${i}` });
    i += 1;
  }

  return cells;
}


// -----------------------------------------------------------------------------
// SECTION 5 — Gestures
//
// LONG PRESS (compact card only) — opens the expanded view.
//   Fires at 450ms. Cancelled by any movement over 10px, so scrolling the strip
//   sideways never expands it. The click that lands after the finger lifts is
//   swallowed in the capture phase, otherwise expanding would also re-select
//   whichever day was under the thumb.
//
// SWIPE (expanded view only) — changes week, with the grid following the finger.
// -----------------------------------------------------------------------------

const LONG_PRESS_MS = 450;
const LONG_PRESS_TOLERANCE = 10; // px of drift allowed before it cancels
const SWIPE_THRESHOLD = 56;      // px. Below this it was a tap.
const EDGE_TOLERANCE = 2;        // px. Sub-pixel scroll positions are normal.
const HINT_KEY = 'weekstrip.longPressSeen';
const HINT_EVENT = 'weekstrip-hint';

interface SwipeState {
  x: number;
  y: number;
  atStart: boolean;
  atEnd: boolean;
}

function subscribeHint(onStoreChange: () => void): () => void {
  const handler = () => onStoreChange();
  window.addEventListener('storage', handler);
  window.addEventListener(HINT_EVENT, handler);
  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener(HINT_EVENT, handler);
  };
}

function getHintSnapshot(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return true;
  }
}

function getHintServerSnapshot(): boolean {
  // SSR and first paint: hide the hint. Showing it after hydration would
  // mismatch; hiding it for returning users until the store hydrates is the
  // cheaper lie, and useSyncExternalStore then corrects on the client.
  return true;
}

function markHintSeen(): void {
  try {
    window.localStorage.setItem(HINT_KEY, '1');
    window.dispatchEvent(new Event(HINT_EVENT));
  } catch {
    // private mode — hint will keep showing, which is fine
  }
}


// -----------------------------------------------------------------------------
// SECTION 6 — Model
// -----------------------------------------------------------------------------

interface DayModel {
  dayIndex: DayIndex;
  date: ISODate;
  isToday: boolean;
  sessions: Session[];
}

interface WeekModel {
  days: DayModel[];
  segments: Segment[];
  rail: RailLabel[];
  weekStart: ISODate;
  weekEnd: ISODate;
  isCurrentWeek: boolean;
  unmarkedCount: number;
  outsideTerm: boolean;
  /** Expanded-view tallies. Never shown in the compact card — no numbers there. */
  tally: Record<WeekTileStatus, number>;
}

/**
 * Built twice: once for the compact card (anchor = today) and once for the
 * overlay (anchor = browseAnchor). Same function, two owners — that is the
 * whole point of extracting it.
 */
function useWeekModel(anchor: ISODate, today: ISODate, revision?: number): WeekModel {
  const settings = getSettings();
  const year = settings.currentYear;
  const workingDays = settings.college.workingDays;
  const term = settings.term;

  return useMemo(() => {
    void revision;

    const weekStart = weekStartFor(anchor);
    const weekEnd = addDays(weekStart, 6);
    const all = generateForWeek(year, weekStart, weekEnd);
    const sortedDays = [...workingDays].sort((a, b) => a - b);

    const days = sortedDays.map((dayIndex) => {
      const date = addDays(weekStart, dayIndex);
      return {
        dayIndex,
        date,
        isToday: date === today,
        sessions: all
          .filter((s) => s.date === date)
          .sort((a, b) => a.start.localeCompare(b.start)),
      };
    });

    const visible = all.filter((s) =>
      workingDays.includes(isoToDayIndex(s.date)),
    );

    const tally: Record<WeekTileStatus, number> = {
      present: 0,
      absent: 0,
      unmarked: 0,
      future: 0,
      cancelled: 0,
    };
    for (const s of visible) tally[tileStatusFor(s, today)] += 1;

    const segments = buildSegments(visible);

    return {
      days,
      segments,
      rail: buildRail(segments),
      weekStart,
      weekEnd,
      isCurrentWeek: weekStart === weekStartFor(today),
      unmarkedCount: visible.filter(
        (s) => s.status === 'unmarked' && s.date <= today,
      ).length,
      outsideTerm: weekEnd < term.startDate || weekStart > term.endDate,
      tally,
    };
  }, [anchor, year, workingDays, today, revision, term.startDate, term.endDate]);
}


// -----------------------------------------------------------------------------
// SECTION 7 — Component
// -----------------------------------------------------------------------------

export interface WeekStripProps {
  /**
   * Kept so page.tsx does not need a matching edit. Ignored on purpose: the
   * compact card is pinned to today, and the overlay owns its own browse date.
   * Feeding selectedDate in as the week anchor was the leak that left the
   * resting strip on a past week after close.
   */
  anchorDate?: ISODate;
  onSelectDay?: (date: ISODate) => void;
  selectedDate?: ISODate;
  /**
   * ⚠ Not decorative. The strip reads generated sessions, memoised by
   *   DataVersion — without this in the dependency list a mark made below would
   *   not repaint the tile above it.
   */
  revision?: number;
}

export default function WeekStrip(props: WeekStripProps) {
  const { onSelectDay, selectedDate, revision } = props;

  const today = todayISO();

  const compactModel = useWeekModel(today, today, revision);

  // ⚠ ALL useState CALLS SIT ABOVE ANY CALLBACK THAT TOUCHES THEM.
  //   React Compiler's immutability lint treats a setter used before its
  //   useState line as a temporal dead zone, even though JS closures would
  //   be fine at runtime. Declare first, close over second.
  const [browseAnchor, setBrowseAnchor] = useState<ISODate>(today);
  const [expanded, setExpanded] = useState(false);
  /** Drives the transition. Mount first, THEN animate, or there is no frame to
   *  animate from and the overlay simply appears. */
  const [shown, setShown] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [gliding, setGliding] = useState(false);

  const browseModel = useWeekModel(browseAnchor, today, revision);

  const goToWeek = useCallback((delta: number) => {
    setBrowseAnchor((prev) => addDays(weekStartFor(prev), delta * 7));
  }, []);

  const goToToday = useCallback(() => setBrowseAnchor(today), [today]);

  const jumpTo = useCallback((iso: string) => {
    if (iso) setBrowseAnchor(iso as ISODate);
  }, []);

  const openExpanded = useCallback(() => {
    // ★ ALWAYS OPEN ON THIS WEEK. Resuming where you last browsed sounds
    //   helpful and is not: reopening into March when it is September reads as
    //   a bug every single time.
    setBrowseAnchor(today);
    setDragX(0);
    setGliding(false);
    setExpanded(true);
    markHintSeen();
    navigator.vibrate?.(8);
  }, [today]);

  const closeExpanded = useCallback(() => {
    setShown(false);
    window.setTimeout(() => {
      setExpanded(false);
      setBrowseAnchor(today); // discard the wandering
      setDragX(0);
    }, 180);
  }, [today]);

  useEffect(() => {
    if (!expanded) return;

    const raf = requestAnimationFrame(() => setShown(true));

    // Scroll lock. Without it the page behind scrolls under the overlay, which
    // is the single most common "this feels like a website" tell.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeExpanded();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded, closeExpanded]);

  // ---- long press (compact card only) --------------------------------------

  const pressTimer = useRef<number | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  /** Set when a long press fires, read by the capture-phase click guard. */
  const pressFired = useRef(false);

  const cancelPress = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressOrigin.current = null;
  }, []);

  const onPressStart = useCallback(
    (e: PointerEvent) => {
      pressFired.current = false;
      pressOrigin.current = { x: e.clientX, y: e.clientY };

      pressTimer.current = window.setTimeout(() => {
        pressFired.current = true;
        pressTimer.current = null;
        openExpanded();
      }, LONG_PRESS_MS);
    },
    [openExpanded],
  );

  const onPressMove = useCallback(
    (e: PointerEvent) => {
      const o = pressOrigin.current;
      if (!o || pressTimer.current === null) return;

      if (
        Math.abs(e.clientX - o.x) > LONG_PRESS_TOLERANCE ||
        Math.abs(e.clientY - o.y) > LONG_PRESS_TOLERANCE
      ) {
        cancelPress();
      }
    },
    [cancelPress],
  );

  /**
   * ⚠ CAPTURE PHASE, deliberately. A long press over a day button would
   *   otherwise ALSO fire that button's onClick when the finger lifts — the
   *   overlay would open and the selected day would change underneath it.
   */
  const onClickCapture = useCallback((e: MouseEvent) => {
    if (!pressFired.current) return;
    pressFired.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // ---- swipe, with the week following the finger ---------------------------
  //
  //  THREE PHASES:
  //    DRAG   — transform tracks the finger 1:1 while armed, at 0.22 resistance
  //             when not. Resistance instead of a dead stop: a panel that
  //             ignores the finger feels broken; one that pushes back feels
  //             like an edge.
  //    GLIDE  — past 56px, the week slides fully out (180ms).
  //    ENTER  — the new week is placed off the OPPOSITE edge with the
  //             transition OFF, then animated to 0. Direction of travel is the
  //             whole message: going back must visibly come from the left.
  //
  //  ⚠ THE DOUBLE rAF: set position → paint → animate. One frame is not
  //    enough; React batches, the browser coalesces, and the panel teleports.

  const expandedScrollerRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<SwipeState | null>(null);
  const animating = useRef(false);

  const commitWeek = useCallback(
    (dir: 1 | -1) => {
      if (animating.current) return;

      const reduced =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

      if (reduced) {
        goToWeek(dir);
        setDragX(0);
        return;
      }

      animating.current = true;
      const w = (deckRef.current?.clientWidth ?? 340) * 1.05;

      setGliding(true);
      setDragX(-dir * w); // next week → current content exits left

      window.setTimeout(() => {
        goToWeek(dir);
        setGliding(false);
        setDragX(dir * w); // new week waits off the far edge

        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            setGliding(true);
            setDragX(0);
            window.setTimeout(() => {
              animating.current = false;
            }, 200);
          }),
        );
      }, 180);
    },
    [goToWeek, setDragX, setGliding],
  );

  useEffect(() => {
    if (!expanded) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') commitWeek(-1);
      else if (e.key === 'ArrowRight') commitWeek(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, commitWeek]);

  const onSwipeStart = useCallback((e: PointerEvent) => {
    if (animating.current) return;
    const el = expandedScrollerRef.current;
    const max = el ? el.scrollWidth - el.clientWidth : 0;

    swipe.current = {
      x: e.clientX,
      y: e.clientY,
      atStart: !el || max <= 0 || el.scrollLeft <= EDGE_TOLERANCE,
      atEnd: !el || max <= 0 || el.scrollLeft >= max - EDGE_TOLERANCE,
    };
    setGliding(false);
  }, [setGliding]);

  const onSwipeMove = useCallback((e: PointerEvent) => {
    const s = swipe.current;
    if (!s || animating.current) return;

    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;

    if (Math.abs(dy) > Math.abs(dx)) return; // vertical → leave it alone

    const armed = dx > 0 ? s.atStart : s.atEnd;
    setDragX(armed ? dx : dx * 0.22);
  }, [setDragX]);

  const onSwipeEnd = useCallback(
    (e: PointerEvent) => {
      const s = swipe.current;
      swipe.current = null;
      if (!s || animating.current) return;

      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;

      const armed = dx > 0 ? s.atStart : s.atEnd;
      const passed = Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy);

      if (armed && passed) {
        commitWeek(dx > 0 ? -1 : 1);
        return;
      }

      setGliding(true); // snap back
      setDragX(0);
    },
    [commitWeek, setDragX, setGliding],
  );

  const onSwipeCancel = useCallback(() => {
    swipe.current = null;
    setGliding(true);
    setDragX(0);
  }, [setDragX, setGliding]);

  // ---- render --------------------------------------------------------------

  return (
    <>
      {/* ================= COMPACT CARD =================
          One control, one gesture. Nothing else. Always THIS WEEK. */}
      <section
        className="card overflow-hidden p-3 select-none"
        onPointerDown={onPressStart}
        onPointerMove={onPressMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
        onClickCapture={onClickCapture}
        onContextMenu={(e) => e.preventDefault()}
        style={{ WebkitTouchCallout: 'none' } as CSSProperties}
      >
        <CompactHeader model={compactModel} />

        {compactModel.outsideTerm && <OutsideTermNote />}

        {compactModel.segments.length === 0 ? (
          <p className="px-1 pb-3 pt-4 text-center text-sm text-ink-muted">
            No classes this week. Add your timetable in setup to see it here.
          </p>
        ) : (
          <div
            className="-mx-1 overflow-x-auto px-1 pb-1"
            style={{ touchAction: 'pan-y pan-x' }}
          >
            <WeekGrid
              model={compactModel}
              today={today}
              selectedDate={selectedDate}
              onSelectDay={onSelectDay}
              expanded={false}
            />
          </div>
        )}

        <CompactLegend />
      </section>

      {/* ================= EXPANDED OVERLAY ================= */}
      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Week preview"
          className="fixed inset-0 z-50 flex items-center justify-center p-3"
        >
          <div
            onClick={closeExpanded}
            className={`absolute inset-0 bg-ink/30 backdrop-blur-xl transition-opacity duration-200 ${
              shown ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ WebkitBackdropFilter: 'blur(24px)' } as CSSProperties}
            aria-hidden
          />

          <div
            onPointerDown={onSwipeStart}
            onPointerMove={onSwipeMove}
            onPointerUp={onSwipeEnd}
            onPointerCancel={onSwipeCancel}
            style={{ touchAction: 'pan-y' }}
            className={`card relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden p-4 shadow-2xl transition-all duration-200 ${
              shown ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
            }`}
          >
            <ExpandedHeader
              model={browseModel}
              anchor={browseAnchor}
              onPrev={() => commitWeek(-1)}
              onNext={() => commitWeek(1)}
              onToday={goToToday}
              onJump={jumpTo}
              onClose={closeExpanded}
            />

            {browseModel.outsideTerm && <OutsideTermNote />}

            <div ref={deckRef} className="min-h-0 flex-1 overflow-hidden">
              <div
                className="h-full"
                style={{
                  transform: `translate3d(${dragX}px,0,0)`,
                  transition: gliding
                    ? 'transform 180ms cubic-bezier(0.22,0.61,0.36,1)'
                    : 'none',
                  willChange: 'transform',
                }}
              >
                <div
                  ref={expandedScrollerRef}
                  className="-mx-1 h-full overflow-auto px-1 pb-1"
                >
                  {browseModel.segments.length === 0 ? (
                    <p className="px-1 py-8 text-center text-sm text-ink-muted">
                      {browseModel.isCurrentWeek
                        ? 'No classes this week.'
                        : 'No classes that week.'}
                    </p>
                  ) : (
                    <WeekGrid
                      model={browseModel}
                      today={today}
                      selectedDate={selectedDate}
                      expanded
                    />
                  )}
                </div>
              </div>
            </div>

            <WeekTally tally={browseModel.tally} />
            <CompactLegend />

            <p className="mt-2 text-center text-[0.625rem] text-ink-faint">
              Swipe to change week · tap outside to close
            </p>
          </div>
        </div>
      )}
    </>
  );
}


// -----------------------------------------------------------------------------
// SECTION 7b — The grid, shared by both views
// -----------------------------------------------------------------------------

function WeekGrid(props: {
  model: WeekModel;
  today: ISODate;
  selectedDate?: ISODate;
  onSelectDay?: (d: ISODate) => void;
  expanded: boolean;
}) {
  const { model, today, selectedDate, onSelectDay, expanded } = props;

  /**
   * ★ WIDTH ∝ DURATION. Class segments get fr units equal to their minute count.
   *
   *   Compact floor is 2.75rem — tiles no longer carry times, times live on
   *   the rail. Expanded gets 5rem: there is room, and the tiles carry their
   *   own times there as supplementary detail.
   */
  const floor = expanded ? '5rem' : '2.75rem';
  const template = [
    expanded ? '3.5rem' : '2.75rem',
    ...model.segments.map((seg) =>
      seg.kind === 'break'
        ? '1.25rem'
        : `minmax(${floor}, ${seg.endMin - seg.startMin}fr)`,
    ),
  ].join(' ');

  return (
    <div className="min-w-full">
      <div className="grid gap-1" style={{ gridTemplateColumns: template }}>
        <div aria-hidden />
        {model.segments.map((seg, i) => {
          const label = model.rail[i];

          if (seg.kind === 'break' || (!label.start && !label.end)) {
            return <span key={`h${i}`} aria-hidden />;
          }

          return (
            <span
              key={`h${i}`}
              className="flex min-w-0 items-baseline justify-between gap-1 leading-none"
            >
              <span
                className={`tnum truncate font-semibold text-ink-muted ${
                  expanded ? 'text-[0.6875rem]' : 'text-[0.625rem]'
                }`}
              >
                {label.start ?? ''}
              </span>

              {label.end && (
                <span
                  className={`tnum shrink-0 text-ink-faint ${
                    expanded ? 'text-[0.625rem]' : 'text-[0.5625rem]'
                  }`}
                >
                  {label.end}
                </span>
              )}
            </span>
          );
        })}
      </div>

      <div className={expanded ? 'mt-2 space-y-1.5' : 'mt-1.5 space-y-1'}>
        {model.days.map((day) => {
          const cells = placeDay(model.segments, day.sessions);
          const isSelected = day.date === selectedDate;

          return (
            <div
              key={day.date}
              className={`grid items-stretch gap-1 rounded-lg ${
                day.isToday ? 'day-today' : ''
              } ${isSelected && !day.isToday ? 'bg-surface-sunk' : ''}`}
              style={{ gridTemplateColumns: template }}
            >
              <button
                type="button"
                onClick={() => onSelectDay?.(day.date)}
                aria-current={day.isToday ? 'date' : undefined}
                aria-label={`${DAY_NAMES_SHORT[day.dayIndex]} ${day.date}`}
                className="flex min-h-11 flex-col items-center justify-center rounded-md leading-none"
              >
                <span
                  className={`text-[0.5625rem] font-semibold uppercase tracking-wide ${
                    day.isToday ? 'text-brand-ink' : 'text-ink-faint'
                  }`}
                >
                  {DAY_NAMES_SHORT[day.dayIndex]}
                </span>
                <span
                  className={`tnum mt-0.5 ${expanded ? 'text-[0.875rem]' : 'text-[0.75rem]'} ${
                    day.isToday
                      ? 'font-semibold text-brand-ink'
                      : 'text-ink-muted'
                  }`}
                >
                  {Number(day.date.slice(8, 10))}
                </span>
              </button>

              {cells.map((cell) => {
                if (cell.kind === 'break') {
                  return (
                    <div
                      key={`${day.date}-${cell.key}`}
                      title={`Break · ${cell.label}`}
                      className="flex items-center justify-center"
                      style={{ gridColumn: `span ${cell.span}` }}
                    >
                      <span className="h-full w-px border-l border-dashed border-line-strong" />
                    </div>
                  );
                }

                if (cell.kind === 'empty') {
                  return (
                    <div
                      key={`${day.date}-${cell.key}`}
                      style={{ gridColumn: `span ${cell.span}` }}
                    />
                  );
                }

                return (
                  <div
                    key={`${day.date}-${cell.key}`}
                    className="flex min-h-11 flex-col gap-0.5"
                    style={{ gridColumn: `span ${cell.span}` }}
                  >
                    {cell.sessions.map((session) => (
                      <SessionTile
                        key={session.id}
                        session={session}
                        status={tileStatusFor(session, today)}
                        expanded={expanded}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}


// -----------------------------------------------------------------------------
// SECTION 8 — Compact header
//
// ★ ONE CONTROL. The arrows are gone; navigation lives in the expanded view.
//   The compact card cannot leave this week, so a date jump or Today chip
//   would be a control that does nothing.
//
//   Hint visibility is an external store (localStorage), not React state
//   written from an effect — React Compiler rejects setState-in-effect.
// -----------------------------------------------------------------------------

function CompactHeader(props: { model: WeekModel }) {
  const { model } = props;
  const seenHint = useSyncExternalStore(
    subscribeHint,
    getHintSnapshot,
    getHintServerSnapshot,
  );

  return (
    <div className="mb-2.5 flex items-center gap-1 px-0.5">
      <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center leading-tight">
        <span className="truncate text-[0.8125rem] font-semibold tracking-[-0.01em] text-ink">
          This week
        </span>
        <span className="tnum mt-0.5 text-[0.625rem] text-ink-faint">
          {seenHint
            ? formatRange(model.weekStart, model.weekEnd)
            : 'Hold to see past weeks'}
        </span>
      </div>

      {model.unmarkedCount > 0 && (
        <span className="chip chip-watch shrink-0 whitespace-nowrap">
          {model.unmarkedCount} unmarked
        </span>
      )}
    </div>
  );
}


// -----------------------------------------------------------------------------
// SECTION 8b — Expanded header
//
// Arrows live HERE and nowhere else. In the overlay they are the keyboard /
// desktop path to a gesture that a mouse cannot perform, and there is room.
// -----------------------------------------------------------------------------

function ExpandedHeader(props: {
  model: WeekModel;
  anchor: ISODate;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onJump: (iso: string) => void;
  onClose: () => void;
}) {
  const { model, anchor, onPrev, onNext, onToday, onJump, onClose } = props;

  return (
    <div className="mb-3 shrink-0">
      <div className="flex items-center gap-1">
        <NavButton label="Previous week" onClick={onPrev}>
          ‹
        </NavButton>

        <div className="relative min-w-0 flex-1">
          <div className="flex min-h-11 flex-col items-center justify-center leading-tight">
            <span className="truncate text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
              {model.isCurrentWeek
                ? 'This week'
                : formatRange(model.weekStart, model.weekEnd)}
            </span>
            <span className="tnum mt-0.5 text-[0.6875rem] text-ink-faint">
              {model.isCurrentWeek
                ? formatRange(model.weekStart, model.weekEnd)
                : 'Tap to jump'}
            </span>
          </div>

          <input
            type="date"
            value={anchor}
            onChange={(e) => onJump(e.target.value)}
            aria-label="Jump to date"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>

        <NavButton label="Next week" onClick={onNext}>
          ›
        </NavButton>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base text-ink-muted transition-all active:scale-90 active:bg-surface-sunk"
        >
          ✕
        </button>
      </div>

      {!model.isCurrentWeek && (
        <div className="mt-1 flex justify-center">
          <button
            type="button"
            onClick={onToday}
            className="chip chip-brand px-3 py-1 text-[0.6875rem] font-semibold"
          >
            Back to this week
          </button>
        </div>
      )}
    </div>
  );
}

function NavButton(props: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={props.label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-ink-muted transition-all active:scale-90 active:bg-surface-sunk"
    >
      {props.children}
    </button>
  );
}


// -----------------------------------------------------------------------------
// SECTION 8c — Shared small parts
// -----------------------------------------------------------------------------

function OutsideTermNote() {
  return (
    <p className="mb-2 shrink-0 rounded-[--radius-field] border border-[--color-watch-line] bg-[--color-watch-soft] px-3 py-2 text-[0.6875rem] leading-relaxed text-[--color-watch]">
      Outside your term dates. Anything marked here is saved, but will not count
      towards your attendance.
    </p>
  );
}

/**
 * ⚠ RULE 2 HOLDS. These are COUNTS, not percentages. A percentage in a week
 *   preview gets read as a standing, and a single bad week would look like a
 *   failing subject.
 */
function WeekTally(props: { tally: Record<WeekTileStatus, number> }) {
  const { tally } = props;

  const rows: Array<{ key: WeekTileStatus; label: string }> = [
    { key: 'present', label: 'Present' },
    { key: 'absent', label: 'Absent' },
    { key: 'unmarked', label: 'Not marked' },
    { key: 'cancelled', label: 'Cancelled' },
    { key: 'future', label: 'Upcoming' },
  ];

  const shown = rows.filter((r) => tally[r.key] > 0);
  if (shown.length === 0) return null;

  return (
    <div className="mt-3 shrink-0 border-t border-line pt-2.5">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
        {shown.map((r) => (
          <span key={r.key} className="inline-flex items-center gap-1.5">
            <span
              className={`tile ${TILE_CLASS[r.key]}`}
              style={{
                width: '0.6875rem',
                height: '0.6875rem',
                borderRadius: '0.1875rem',
              }}
              aria-hidden
            />
            <span className="tnum text-[0.8125rem] font-semibold text-ink">
              {tally[r.key]}
            </span>
            <span className="text-[0.6875rem] text-ink-faint">{r.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function CompactLegend() {
  return (
    <div className="mt-3 shrink-0 border-t border-line pt-2.5">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[0.625rem] text-ink-faint">
        <LegendDot className="tile-present" label="Present" />
        <LegendDot className="tile-absent" label="Absent" />
        <LegendDot className="tile-unmarked" label="Not marked" />
        <LegendDot className="tile-future" label="Upcoming" />
        <LegendDot className="tile-cancelled" label="Cancelled" />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[0.625rem] text-ink-faint">
        {(['theory', 'practical', 'clinical'] as ClassCategory[]).map((c) => (
          <span key={c} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-1 rounded-sm"
              style={{ backgroundColor: CATEGORY_STRIPE[c] }}
              aria-hidden
            />
            {CATEGORY_LETTER[c]} · {CATEGORY_WORD[c]}
          </span>
        ))}
      </div>
    </div>
  );
}

function LegendDot(props: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`tile ${props.className}`}
        style={{
          width: '0.75rem',
          height: '0.75rem',
          borderRadius: '0.1875rem',
        }}
        aria-hidden
      />
      {props.label}
    </span>
  );
}


// -----------------------------------------------------------------------------
// SECTION 9 — One session tile
//
// ★ TIMES ARE NOT PRINTED HERE IN THE COMPACT VIEW. The times describe the
//   COLUMN, so they live on the rail and are stated once.
//
//   In the EXPANDED view the tile does carry its own range, because there the
//   grid is large and per-tile detail is the reason the overlay exists.
// -----------------------------------------------------------------------------

function SessionTile(props: {
  session: Session;
  status: WeekTileStatus;
  expanded: boolean;
}) {
  const { session, status, expanded } = props;

  const count = Math.max(1, Math.round(session.weight));
  const code = subjectShort(session.subjectId);
  const isOffTimetable = session.origin === 'extra';

  const startMin = toMinutes(session.start);
  const endMin = toMinutes(session.end);

  const title = `${session.subjectName} · ${CATEGORY_WORD[session.category]} · ${formatTime(
    startMin,
  )} – ${formatTime(endMin)} · ${formatDuration(endMin - startMin)}${
    count > 1 ? ` · counts as ${count}` : ''
  }`;

  const stripe = {
    borderLeftWidth: '3px',
    borderLeftColor: CATEGORY_STRIPE[session.category],
  } as const;

  const face = (
    <>
      <span className="flex w-full items-center justify-center gap-1 leading-none">
        <span
          className={`truncate font-semibold ${
            expanded ? 'text-[0.8125rem]' : 'text-[0.6875rem]'
          }`}
        >
          {code}
        </span>
        <span className="shrink-0 text-[0.5rem] font-bold uppercase opacity-70">
          {CATEGORY_LETTER[session.category]}
        </span>
      </span>

      {expanded && (
        <span
          className="tnum pointer-events-none mt-0.5 w-full text-center text-[0.5625rem] font-medium leading-none opacity-70"
          aria-hidden
        >
          {formatTimeCompact(startMin)}–{formatTimeCompact(endMin)}
        </span>
      )}
    </>
  );

  if (count === 1) {
    return (
      <div
        title={title}
        style={stripe}
        className={`tile ${TILE_CLASS[status]} ${
          isOffTimetable ? 'tile-offgrid' : ''
        } flex min-h-11 flex-1 flex-col items-stretch justify-center px-1 py-0.5`}
      >
        {face}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-11 flex-1 gap-0.5" title={title}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          style={i === 0 ? stripe : undefined}
          className={`tile ${TILE_CLASS[status]} ${
            isOffTimetable ? 'tile-offgrid' : ''
          } flex-1`}
        />
      ))}

      <span
        className={`pointer-events-none absolute inset-0 flex flex-col items-stretch justify-center px-1 py-0.5 ${LABEL_CLASS[status]}`}
      >
        {face}
      </span>
    </div>
  );
}
