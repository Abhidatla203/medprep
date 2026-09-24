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
//   3. STATUS OWNS THE FILL. Class type rides on a stripe and a letter — see
//      Section 6 for why colouring tiles by category cannot work here.
// =============================================================================

import { useMemo } from 'react';

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


// -----------------------------------------------------------------------------
// SECTION 2 — Status and category maps
// -----------------------------------------------------------------------------

/**
 * Session status is what was RECORDED. Tile status is what the student should
 * SEE — they differ in exactly one case: an unmarked class that has not happened
 * yet is "future", not an outstanding action. Getting that wrong is what would
 * have made the whole feature annoying — Thursday nagging on Monday evening.
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

/**
 * The three greys, ordered by how much each wants a tap:
 *   unmarked  → light, SOLID    the live item
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
 *   Hard-coded for the same reason as the rings: a CSS class that stops
 *   resolving fails silently and would take the type indicator with it.
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
// ★ WHY CLASS LENGTH IS NOW VISIBLE. An earlier version built one column per
//   distinct start/end pair, then skipped any slot contained inside a longer
//   one. A 10:30–13:00 posting swallowed the 11:00 and 12:00 columns, leaving
//   nothing to span — so it rendered exactly as wide as a one-hour lecture.
//
//   NOW: collect EVERY boundary minute in the week; a SEGMENT is the span
//   between two consecutive boundaries; width is proportional to duration; a
//   session spans every segment it covers.
//
// BREAK INFERENCE (spec §7.2): the student NEVER configures break times. A
// segment no working day covers is a break. Consecutive breaks merge. Gaps under
// 20 minutes are changeover, not lunch.
//
// College hours fall out free: no segment exists before the first class or after
// the last, so nothing is padded.
// -----------------------------------------------------------------------------

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

    const covered = sessions.some(
      (s) => toMinutes(s.start) <= startMin && toMinutes(s.end) >= endMin,
    );

    // A short uncovered sliver is changeover, not lunch — keep it as a class
    // segment so it renders as an empty cell rather than a break divider.
    const isBreak = !covered && endMin - startMin >= BREAK_THRESHOLD_MINUTES;

    raw.push({
      kind: isBreak ? 'break' : 'class',
      startMin,
      endMin,
      isSessionStart: startMinutes.has(startMin),
    });
  }

  // Merge consecutive breaks: a sparse timetable would otherwise render three
  // dividers where one long lunch exists.
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
// SECTION 4 — Placing a day's sessions
//
// ★ DURATION BECOMES WIDTH. A session spans every segment it covers, like a
//   Gantt bar — including any break it straddles, because a class running
//   through lunch really does run through lunch.
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

    // Free for this day, but other days have class here. Spec §7.2: the slot
    // stays and this day gets an empty cell, visually distinct from a break.
    cells.push({ kind: 'empty', span: 1, sessions: [], key: `e${i}` });
    i += 1;
  }

  return cells;
}


// -----------------------------------------------------------------------------
// SECTION 5 — Component
// -----------------------------------------------------------------------------

export interface WeekStripProps {
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
  const anchor = props.anchorDate ?? today;

  const settings = getSettings();
  const year = settings.currentYear;
  const workingDays = settings.college.workingDays;

  const model = useMemo(() => {
    void revision;

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

  if (model.segments.length === 0) {
    return (
      <section className="card p-5 text-center">
        <p className="text-sm text-ink-muted">
          {model.isCurrentWeek
            ? 'No classes this week. Add your timetable in setup to see it here.'
            : 'No classes that week.'}
        </p>
      </section>
    );
  }

  /**
   * ★ WIDTH ∝ DURATION. Class segments get fr units equal to their minute count,
   *   so a 150-minute posting is 2.5× the width of a 60-minute lecture. The
   *   minmax floor keeps short segments legible; once the total exceeds the
   *   container the wrapper scrolls, which is the point of this orientation.
   *
   *   Breaks are fixed and narrow: visible, but never winning space from a class.
   */
  const template = [
    '2.5rem',
    ...model.segments.map((seg) =>
      seg.kind === 'break'
        ? '1.5rem'
        : `minmax(2.75rem, ${seg.endMin - seg.startMin}fr)`,
    ),
  ].join(' ');

  return (
    <section className="card overflow-hidden p-3">
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
            {model.segments.map((seg, i) =>
              seg.kind === 'break' ? (
                <span
                  key={`h${i}`}
                  title={`Break · ${formatTime(seg.startMin)} – ${formatTime(seg.endMin)}`}
                  className="text-center text-[0.5rem] font-medium leading-none text-ink-faint"
                >
                  {formatDuration(seg.endMin - seg.startMin)}
                </span>
              ) : (
                <span
                  key={`h${i}`}
                  className="tnum truncate text-center text-[0.625rem] font-medium leading-none text-ink-muted"
                >
                  {/* Label only where a class actually begins. Mid-session
                      boundaries from an overlapping posting would otherwise
                      print times that no class starts at. */}
                  {seg.isSessionStart ? formatTime(seg.startMin) : ''}
                </span>
              ),
            )}
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
                  } ${isSelected && !day.isToday ? 'bg-surface-sunk' : ''}`}
                  style={{ gridTemplateColumns: template }}
                >
                  {/* day label doubles as the jump control */}
                  <button
                    type="button"
                    onClick={() => onSelectDay?.(day.date)}
                    aria-current={day.isToday ? 'date' : undefined}
                    aria-label={`${DAY_NAMES_SHORT[day.dayIndex]} ${day.date}`}
                    className="flex flex-col items-center justify-center rounded-md py-0.5 leading-none"
                  >
                    <span
                      className={`text-[0.5625rem] font-semibold uppercase tracking-wide ${
                        day.isToday ? 'text-brand-ink' : 'text-ink-faint'
                      }`}
                    >
                      {DAY_NAMES_SHORT[day.dayIndex]}
                    </span>
                    <span
                      className={`tnum mt-0.5 text-[0.6875rem] ${
                        day.isToday
                          ? 'font-semibold text-brand-ink'
                          : 'text-ink-muted'
                      }`}
                    >
                      {Number(day.date.slice(8, 10))}
                    </span>
                  </button>

                  {/* ---- cells ---- */}
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
          TWO ROWS, because tiles carry two independent signals. Fill = status,
          stripe and letter = type. Merging them into one row would imply they
          were the same scale, which is exactly the confusion to avoid. */}
      <div className="mt-3 border-t border-line pt-2.5">
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
    </section>
  );
}


// -----------------------------------------------------------------------------
// SECTION 6 — One session tile
//
// ★ SEGMENT COUNT EQUALS WEIGHT (spec §4.8). A 3-hour posting logged as ONE
//   class draws a single bar; counted as THREE it draws three side by side. The
//   marking list still shows one row and one tap — the student marks what they
//   did, and sees what it costs.
//
// ★ CLASS TYPE IS ON THE TILE, AND IT IS NOT THE FILL.
//
//   ⚠ The obvious fix is the wrong one. Colouring tiles by category cannot work
//     here: practical green is the SAME green as "present", so every practical
//     would read as attended merely by existing. Status must keep the fill — it
//     is the louder question in this component.
//
//   So type rides on two quieter channels, both of which survive a 40px tile:
//     1. a 3px LEFT STRIPE in the category colour — instant group marker, costs
//        no horizontal space, never competes with the fill
//     2. a LETTER BADGE (T / P / C) at the right edge — redundant on purpose,
//        because colour alone fails for a colour-blind student and one letter is
//        legible where a second word is not
// -----------------------------------------------------------------------------

function SessionTile(props: { session: Session; status: WeekTileStatus }) {
  const { session, status } = props;

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

  /**
   * Inline style, not a utility class. `.tile` already sets a transparent border
   * on all four sides, so overriding only the left edge keeps the box model
   * identical whatever the category — no shifting between a theory tile and a
   * clinical one.
   */
  const stripe = {
    borderLeftWidth: '3px',
    borderLeftColor: CATEGORY_STRIPE[session.category],
  } as const;

  if (count === 1) {
    return (
      <div
        title={title}
        style={stripe}
        className={`tile relative ${TILE_CLASS[status]} ${
          isOffTimetable ? 'tile-offgrid' : ''
        } min-h-[1.75rem] flex-1 pl-1.5 pr-3.5`}
      >
        <span className="truncate">{code}</span>
        {/* Takes the fill's text colour and is knocked back — a second coloured
            element inside a coloured tile is noise. */}
        <span
          className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[0.5rem] font-bold uppercase opacity-70"
          aria-hidden
        >
          {CATEGORY_LETTER[session.category]}
        </span>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[1.75rem] flex-1 gap-0.5" title={title}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          /* Stripe on the first segment only. Repeating it would read as three
             separate classes rather than one weighted block. */
          style={i === 0 ? stripe : undefined}
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
      <span
        className={`pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[0.5rem] font-bold uppercase opacity-70 ${LABEL_CLASS[status]}`}
        aria-hidden
      >
        {CATEGORY_LETTER[session.category]}
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
