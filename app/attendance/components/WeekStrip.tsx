'use client';

// =============================================================================
// app/attendance/components/WeekStrip.tsx
// -----------------------------------------------------------------------------
//   ROWS    = days  (one per working day, fixed height)
//   COLUMNS = time  (segments between boundaries, width ∝ duration)
//
// ═════════════════════════════════════════════════════════════════════════════
//  WHY DAYS ARE ROWS AND TIME RUNS ACROSS
// ═════════════════════════════════════════════════════════════════════════════
//   1. IT MATCHES THE PRINTED TIMETABLE. Indian college timetables are almost
//      universally days-down, periods-across. That is the model the student
//      already holds for their own schedule — not the Google Calendar one.
//   2. OVERFLOW GOES SIDEWAYS. The variable axis is TIME. With days as columns,
//      extra slots made the strip TALLER, competing with the marking list for
//      the most valuable space on screen. Now they scroll horizontally.
//   3. HEIGHT IS FIXED. Six working days is six rows, every week.
//   4. BREAKS COST ALMOST NOTHING — a narrow column instead of a full row.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ★ THE SEGMENT MODEL — THE FIX FOR "ALL CLASSES LOOK THE SAME WIDTH"
// ═════════════════════════════════════════════════════════════════════════════
// The previous version built one column per DISTINCT start/end pair, then
// skipped any slot contained inside a longer one. A 10:30–13:00 posting
// therefore swallowed the 11:00 and 12:00 columns, leaving nothing for it to
// span — so it rendered exactly as wide as a one-hour lecture. Class length was
// invisible, which defeats half the point of the strip.
//
// THE MODEL NOW:
//   • collect EVERY boundary minute in the week (all starts, all ends)
//   • a SEGMENT is the span between two consecutive boundaries
//   • a segment is a CLASS segment if any session covers it, else a BREAK
//   • each class segment's width is proportional to its duration in minutes
//   • a session spans every segment it covers
//
// Consequences, all of them wanted:
//   - a 150-minute posting is 150 units wide; a 60-minute lecture is 60
//   - a class that straddles a break spans the break too, which is honest
//   - college hours fall out for free: no segment exists before the first class
//     or after the last, so nothing is padded
//
// ═════════════════════════════════════════════════════════════════════════════
//  ★ BREAK INFERENCE (spec §7.2)
// ═════════════════════════════════════════════════════════════════════════════
// The student NEVER configures break times. A segment where NO working day has
// a class is a break. Consecutive breaks merge. Gaps under 20 minutes are
// changeover, not lunch — they stay as empty class segments so back-to-back
// classes do not look separated.
//
// A break is now a VISIBLE column: dashed rule, its duration in the header, its
// range in the tooltip. Previously it was 6px of nothing, which is the same as
// not implementing it.
//
// ═════════════════════════════════════════════════════════════════════════════
//  THREE HARD RULES
//   1. READ-ONLY. Renders sessions, computes nothing. Marking is the list below.
//   2. NO PERCENTAGES. Ever. A figure here gets read as a standing.
//   3. NO CATEGORY COLOUR. --color-practical is the same green as --color-safe,
//      so a practical tile would read as "present" just by existing. Colour
//      means STATUS here; category is carried by the subject code.
// =============================================================================

import { useMemo } from 'react';

import type { DayIndex, ISODate, Session, WeekTileStatus } from '../types';
import { DAY_NAMES_SHORT } from '../types';
import { generateForWeek } from '../generate';
import { getSettings } from '../store';
import { todayISO } from '@/lib/attendance/datetime';
import { subjectShort } from '@/lib/attendance/curriculum';


// -----------------------------------------------------------------------------
// SECTION 1 — Time helpers
//
// Local rather than imported: this is LAYOUT arithmetic, not domain logic, and
// the strip should not gain a dependency on datetime.ts for minute maths.
// -----------------------------------------------------------------------------

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * ★ ALWAYS CARRIES am/pm.
 *
 * The previous version printed bare hours to save width — headers read
 * "9  10:30  2  3", and "2" is not a time anyone can read at a glance. A
 * student looking at this would have to decode it, which is exactly the work
 * the strip exists to remove. Meridiem costs four pixels and is non-negotiable.
 *
 *   540 → "9am"     810 → "1:30pm"     840 → "2pm"
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

/** "1h", "45m", "2h 30m" — for break headers and tooltips. */
function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Local calendar date, never UTC.
 *
 * toISOString() converts to UTC first, so in IST any date computed after 18:30
 * shifts back a day — the "today" highlight would land on the wrong row every
 * evening. The kind of bug reported as "it's just broken sometimes".
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


// -----------------------------------------------------------------------------
// SECTION 2 — Status mapping
//
// Session status is what was RECORDED. Tile status is what the student should
// SEE — they differ in exactly one case: an unmarked class that has not
// happened yet is "future", not an outstanding action. Getting that wrong is
// what would have made the feature annoying: Thursday nagging on Monday.
// -----------------------------------------------------------------------------

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

/**
 * The three greys, ordered by how much each wants a tap:
 *   unmarked  → light, SOLID    the live item, eye lands here first
 *   future    → palest, dashed  nothing owed yet
 *   cancelled → dark, struck    closed, not pending
 */
const TILE_CLASS: Record<WeekTileStatus, string> = {
  present: 'tile-present',
  absent: 'tile-absent',
  unmarked: 'tile-unmarked',
  future: 'tile-future',
  cancelled: 'tile-cancelled',
};

/** Overlay label colour, so a multi-segment tile stays readable. */
const LABEL_CLASS: Record<WeekTileStatus, string> = {
  present: 'text-white',
  absent: 'text-white',
  unmarked: 'text-[--color-ink-soft]',
  future: 'text-[--color-ink-faint]',
  cancelled: 'text-white line-through',
};


// -----------------------------------------------------------------------------
// SECTION 3 — Segments
// -----------------------------------------------------------------------------

/** Under this, a gap is changeover between rooms, not a break. */
const BREAK_THRESHOLD_MINUTES = 20;

interface Segment {
  kind: 'class' | 'break';
  startMin: number;
  endMin: number;
  /** True when at least one session begins exactly here — drives the header. */
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

    // Covered if ANY session on ANY working day spans this whole segment.
    const covered = sessions.some(
      (s) => toMinutes(s.start) <= startMin && toMinutes(s.end) >= endMin,
    );

    // A short uncovered sliver is changeover, not lunch. Keep it as a class
    // segment so it renders as an empty cell rather than a "Break" divider.
    const isBreak = !covered && endMin - startMin >= BREAK_THRESHOLD_MINUTES;

    raw.push({
      kind: isBreak ? 'break' : 'class',
      startMin,
      endMin,
      isSessionStart: startMinutes.has(startMin),
    });
  }

  // Merge consecutive breaks. A sparse first-year timetable would otherwise
  // render three dividers where one long lunch exists.
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
// SECTION 4 — Placing a day's sessions across the segments
//
// ★ DURATION BECOMES WIDTH. A session spans every segment it covers, exactly
//   like a Gantt bar — including any break segment it straddles, because a
//   class running through lunch really does run through lunch.
// -----------------------------------------------------------------------------

interface Cell {
  kind: 'class' | 'break' | 'empty';
  span: number;
  sessions: Session[];
  key: string;
  /** Only set for break cells, for the tooltip. */
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

    // Free for this day, but other days have class here. Spec §7.2: the slot
    // stays and this day gets an EMPTY CELL, visually distinct from a break.
    cells.push({ kind: 'empty', span: 1, sessions: [], key: `e${i}` });
    i += 1;
  }

  return cells;
}


// -----------------------------------------------------------------------------
// SECTION 5 — Component
// -----------------------------------------------------------------------------

export interface WeekStripProps {
  /** Any date inside the week to display. Defaults to today. */
  anchorDate?: ISODate;
  /** Day label tapped — the marking list below should jump to this date. */
  onSelectDay?: (date: ISODate) => void;
  /** Currently selected day in the marking list, echoed here. */
  selectedDate?: ISODate;
  /**
   * Store revision.
   *
   * ⚠ Not decorative. The strip reads generated sessions, memoised by
   *   DataVersion — without this in the dependency list a mark made below
   *   would not repaint the tile above it.
   */
  revision?: number;
}

export default function WeekStrip(props: WeekStripProps) {
  const { onSelectDay, selectedDate, revision } = props;

  const today = todayISO();
  const anchor = props.anchorDate ?? today;

  const settings = getSettings();
  const year = settings.currentYear;
  const workingDays = settings.college.workingDays;

  const model = useMemo(() => {
    void revision; // recompute whenever the store changes

    const weekStart = weekStartFor(anchor);
    const weekEnd = addDays(weekStart, 6);
    const all = generateForWeek(year, weekStart, weekEnd);

    // Working days only. A non-working day is ABSENT from the grid — not a
    // break, not an empty row. Enable Sunday in settings and it reappears.
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

    // Segments come only from visible days, so a stray Sunday entry cannot add
    // a column to a six-day grid.
    const visible = all.filter((s) =>
      workingDays.includes(isoToDayIndex(s.date)),
    );

    return {
      days,
      segments: buildSegments(visible),
      weekStart,
      weekEnd,
      isCurrentWeek: weekStart === weekStartFor(today),
      unmarkedCount: visible.filter(
        (s) => s.status === 'unmarked' && s.date <= today,
      ).length,
    };
  }, [anchor, year, workingDays, today, revision]);

  // ---- empty state ---------------------------------------------------------
  if (model.segments.length === 0) {
    return (
      <section className="card p-5 text-center">
        <p className="text-sm text-[--color-ink-muted]">
          {model.isCurrentWeek
            ? 'No classes this week. Add your timetable in setup to see it here.'
            : 'No classes that week.'}
        </p>
      </section>
    );
  }

  /**
   * ★ WIDTH ∝ DURATION.
   *
   * Class segments get fr units equal to their minute count, so a 150-minute
   * posting is two and a half times the width of a 60-minute lecture. The
   * minmax floor keeps a short segment tappable and the subject code legible;
   * once the total exceeds the container the wrapper scrolls sideways, which is
   * the entire reason for this orientation.
   *
   * Breaks are FIXED and narrow. They must be visible — the earlier 6px version
   * was indistinguishable from nothing — but must never win space from a class.
   */
  const template = [
    '2.5rem',
    ...model.segments.map((seg) =>
      seg.kind === 'break'
        ? '1.5rem'
        : `minmax(2.5rem, ${seg.endMin - seg.startMin}fr)`,
    ),
  ].join(' ');

  return (
    <section className="card overflow-hidden p-3">
      {/* ---- header ---- */}
      <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
        <span className="eyebrow">
          {model.isCurrentWeek
            ? 'This week'
            : formatRange(model.weekStart, model.weekEnd)}
        </span>

        {/* The one thing the strip may state in words: a COUNT OF ACTIONS, not
            a measure of standing. Nothing here is readable as a grade. */}
        {model.unmarkedCount > 0 && (
          <span className="chip chip-watch">{model.unmarkedCount} unmarked</span>
        )}
      </div>

      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="min-w-full">
          {/* ---- time header ---- */}
          <div className="grid gap-1" style={{ gridTemplateColumns: template }}>
            <div aria-hidden />
            {model.segments.map((seg, i) => {
              if (seg.kind === 'break') {
                return (
                  <span
                    key={`h${i}`}
                    title={`Break · ${formatTime(seg.startMin)} – ${formatTime(seg.endMin)}`}
                    className="text-center text-[0.5rem] font-medium leading-none text-[--color-ink-faint]"
                  >
                    {formatDuration(seg.endMin - seg.startMin)}
                  </span>
                );
              }

              // Label only where a class actually begins. Mid-session
              // boundaries created by an overlapping posting would otherwise
              // print times that no class starts at.
              return (
                <span
                  key={`h${i}`}
                  className="tnum truncate text-center text-[0.625rem] font-medium leading-none text-[--color-ink-muted]"
                >
                  {seg.isSessionStart ? formatTime(seg.startMin) : ''}
                </span>
              );
            })}
          </div>

          {/* ---- one row per working day ---- */}
          <div className="mt-1.5 space-y-1">
            {model.days.map((day) => {
              const cells = placeDay(model.segments, day.sessions);
              const isSelected = day.date === selectedDate;

              return (
                <div
                  key={day.date}
                  className={`grid items-stretch gap-1 rounded-lg ${
                    day.isToday ? 'day-today' : ''
                  } ${isSelected && !day.isToday ? 'bg-[--color-surface-sunk]' : ''}`}
                  style={{ gridTemplateColumns: template }}
                >
                  {/* ---- day label, doubles as the jump control ---- */}
                  <button
                    type="button"
                    onClick={() => onSelectDay?.(day.date)}
                    aria-current={day.isToday ? 'date' : undefined}
                    aria-label={`${DAY_NAMES_SHORT[day.dayIndex]} ${day.date}`}
                    className="flex flex-col items-center justify-center rounded-md py-0.5 leading-none"
                  >
                    <span
                      className={`text-[0.5625rem] font-semibold uppercase tracking-wide ${
                        day.isToday
                          ? 'text-[--color-brand-ink]'
                          : 'text-[--color-ink-faint]'
                      }`}
                    >
                      {DAY_NAMES_SHORT[day.dayIndex]}
                    </span>
                    <span
                      className={`tnum mt-0.5 text-[0.6875rem] ${
                        day.isToday
                          ? 'font-semibold text-[--color-brand-ink]'
                          : 'text-[--color-ink-muted]'
                      }`}
                    >
                      {Number(day.date.slice(8, 10))}
                    </span>
                  </button>

                  {/* ---- cells ---- */}
                  {cells.map((cell) => {
                    if (cell.kind === 'break') {
                      // A visible dashed rule. Narrow, quiet, unmistakably a
                      // gap rather than an unmarked class.
                      return (
                        <div
                          key={`${day.date}-${cell.key}`}
                          title={`Break · ${cell.label}`}
                          className="flex items-center justify-center"
                          style={{ gridColumn: `span ${cell.span}` }}
                        >
                          <span className="h-full w-px border-l border-dashed border-[--color-line-strong]" />
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
                        className="flex min-h-[1.75rem] flex-col gap-0.5"
                        style={{ gridColumn: `span ${cell.span}` }}
                      >
                        {cell.sessions.map((session) => (
                          <SessionTile
                            key={session.id}
                            session={session}
                            status={tileStatusFor(session, today)}
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
      </div>

      {/* ---- legend ----
          Permanent, and worth the space. The grey scale is the one part of this
          design nobody guesses correctly on first sight. */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-[--color-line] pt-2.5 text-[0.625rem] text-[--color-ink-faint]">
        <LegendDot className="tile-present" label="Present" />
        <LegendDot className="tile-absent" label="Absent" />
        <LegendDot className="tile-unmarked" label="Not marked" />
        <LegendDot className="tile-future" label="Upcoming" />
        <LegendDot className="tile-cancelled" label="Cancelled" />
      </div>
    </section>
  );
}


// -----------------------------------------------------------------------------
// SECTION 6 — One session tile
//
// ★ SEGMENT COUNT EQUALS WEIGHT (spec §4.8).
//
//   A 3-hour posting logged as ONE class draws a single bar. Counted as THREE
//   it draws three side by side. The marking list still shows one row and one
//   tap — same session, two renderings. The student marks what they did (one
//   posting) and sees what it costs (three classes).
//
//   The subject code is overlaid across the whole cell rather than printed on
//   each segment: three narrow segments cannot each hold "Surg".
// -----------------------------------------------------------------------------

function SessionTile(props: { session: Session; status: WeekTileStatus }) {
  const { session, status } = props;

  const count = Math.max(1, Math.round(session.weight));
  const code = subjectShort(session.subjectId);
  const isOffTimetable = session.origin === 'extra';

  const startMin = toMinutes(session.start);
  const endMin = toMinutes(session.end);

  const title = `${session.subjectName} · ${session.category} · ${formatTime(
    startMin,
  )} – ${formatTime(endMin)} · ${formatDuration(endMin - startMin)}${
    count > 1 ? ` · counts as ${count}` : ''
  }`;

  if (count === 1) {
    return (
      <div
        title={title}
        className={`tile ${TILE_CLASS[status]} ${
          isOffTimetable ? 'tile-offgrid' : ''
        } min-h-[1.75rem] flex-1 px-1`}
      >
        {code}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[1.75rem] flex-1 gap-0.5" title={title}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={`tile ${TILE_CLASS[status]} ${
            isOffTimetable ? 'tile-offgrid' : ''
          } flex-1`}
        />
      ))}
      <span
        className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[0.625rem] font-semibold ${LABEL_CLASS[status]}`}
      >
        {code}
      </span>
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

/** "22–27 Sept". Shown only when viewing a week other than the current one. */
function formatRange(start: ISODate, end: ISODate): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);

  const startMonth = s.toLocaleDateString(undefined, { month: 'short' });
  const endMonth = e.toLocaleDateString(undefined, { month: 'short' });

  return s.getMonth() === e.getMonth()
    ? `${s.getDate()}–${e.getDate()} ${endMonth}`
    : `${s.getDate()} ${startMonth} – ${e.getDate()} ${endMonth}`;
}
