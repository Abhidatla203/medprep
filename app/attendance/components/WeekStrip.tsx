'use client';

// =============================================================================
// app/attendance/components/WeekStrip.tsx
// -----------------------------------------------------------------------------
// The top-of-screen weekly preview.
//
// ITS JOB IS "HAVE I LOGGED EVERYTHING?" — nothing else.
//
// The rings answer "am I safe?". Keeping those two questions in two separate
// objects is what stops this screen becoming a wall of numbers. The strip is a
// LOG, not a metric: it shows what happened, never what it means. That is
// precisely why it can sit above the rings without violating the no-pooled-
// number rule — it contains no number at all.
//
// THREE HARD RULES
//   1. READ-ONLY. It renders sessions and computes nothing. Marking happens in
//      the list below. A preview you can edit is not a preview.
//   2. NO PERCENTAGES. Ever. The moment a figure appears here, someone reads it
//      as their standing, and we are back to the pooled-average problem.
//   3. NO CATEGORY COLOUR. --color-practical is the same green as --color-safe,
//      so a practical tile would read as "present" purely by being a practical.
//      Colour means STATUS here and nothing else; category is carried by the
//      subject short code.
//
// WHAT THE STUDENT SEES
//   One column per WORKING day — a non-working day is absent from the grid, not
//   drawn empty. Today gets a tinted spine. Inferred breaks collapse to a
//   hairline. Tile count equals weight, so a posting counted as 3 draws three
//   tiles while the marking list below still shows one row.
// =============================================================================

import { useMemo } from 'react';

import type { DayIndex, ISODate, Session, WeekTileStatus } from '../types';
import { DAY_NAMES_SHORT } from '../types';
import { generateForWeek } from '../generate';
import { getSettings } from '../store';
import { todayISO } from '@/lib/attendance/datetime';
import { subjectShort } from '@/lib/attendance/curriculum';


// -----------------------------------------------------------------------------
// SECTION 1 — Local date/time helpers
//
// Deliberately local rather than imported. This is LAYOUT arithmetic, not
// domain logic, and the strip should not acquire a dependency on datetime.ts
// for two lines of minute maths. Nothing here is exported.
// -----------------------------------------------------------------------------

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** "09:00" → "9" ; "14:30" → "2:30". Compact enough for a 2rem gutter. */
function shortLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, '0')}`;
}

/**
 * ⚠ TRAP 4 — Monday is 0 in this codebase, NOT Sunday.
 * JavaScript's getDay() returns 0 for Sunday, so every conversion goes
 * through (jsDay + 6) % 7. Never index DAY_NAMES_SHORT with a raw getDay().
 */
function isoToDayIndex(iso: ISODate): DayIndex {
  const jsDay = new Date(`${iso}T00:00:00`).getDay();
  return ((jsDay + 6) % 7) as DayIndex;
}

/** Monday-anchored start of the week containing `iso`. */
function weekStartFor(iso: ISODate): ISODate {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - isoToDayIndex(iso));
  return toISO(d);
}

function addDays(iso: ISODate, n: number): ISODate {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/**
 * Local calendar date, never UTC.
 * toISOString() would shift the date by a day for anyone east of Greenwich
 * after 18:30 IST — which is most of this app's users, most evenings.
 */
function toISO(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}


// -----------------------------------------------------------------------------
// SECTION 2 — Status mapping
//
// Session status is what was RECORDED. Tile status is what the student should
// SEE — and the two differ in exactly one case: an unmarked class that has not
// happened yet is "future", not an outstanding action.
//
// Getting that wrong is the bug that would have made this whole feature
// annoying: Thursday's classes nagging on Monday evening.
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
 * Status → CSS class. Defined in globals.css.
 *
 * The three greys are ordered by how much each wants a tap:
 *   unmarked  → light, SOLID   — the live item, eye lands here first
 *   future    → palest, dashed — nothing owed yet
 *   cancelled → dark, struck   — settled and closed, not pending
 */
const TILE_CLASS: Record<WeekTileStatus, string> = {
  present: 'tile-present',
  absent: 'tile-absent',
  unmarked: 'tile-unmarked',
  future: 'tile-future',
  cancelled: 'tile-cancelled',
};


// -----------------------------------------------------------------------------
// SECTION 3 — Row skeleton and break inference
//
// Every column shares ONE row skeleton. That shared skeleton is the only thing
// keeping the grid aligned — without it, a day with three classes and a day
// with six would render at different heights and the week would be unreadable.
//
// BREAK INFERENCE, as specified: the student never configures break times. We
// infer them. A time span where NO working day has a class is a break, and it
// collapses to a hairline. A span where only SOME days are free is a partial
// gap — the row stays and those days get an empty cell.
//
// Two guards on top of that:
//   • consecutive breaks MERGE into one row, so a sparse first-year timetable
//     cannot render more break rows than class rows
//   • gaps under 20 minutes are changeover time, not a break — collapsing them
//     would make back-to-back classes look separated
//
// College hours also fall out of this for free: rows are built only from slots
// that actually exist, so nothing is drawn before the first class or after the
// last one. No empty 8am row, no padding.
// -----------------------------------------------------------------------------

/** Minimum gap that counts as a real break rather than a changeover. */
const BREAK_THRESHOLD_MINUTES = 20;

interface Row {
  kind: 'class' | 'break';
  start: string;
  end: string;
}

function buildRows(sessions: Session[]): Row[] {
  if (sessions.length === 0) return [];

  // Distinct start/end pairs, in time order.
  const seen = new Set<string>();
  const slots: Array<{ start: string; end: string }> = [];

  for (const s of sessions) {
    const key = `${s.start}-${s.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push({ start: s.start, end: s.end });
  }

  slots.sort(
    (a, b) => toMinutes(a.start) - toMinutes(b.start) || toMinutes(a.end) - toMinutes(b.end),
  );

  const rows: Row[] = [];
  let furthestEnd = 0;

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    rows.push({ kind: 'class', start: slot.start, end: slot.end });
    furthestEnd = Math.max(furthestEnd, toMinutes(slot.end));

    const next = slots[i + 1];
    if (!next) continue;

    // Measure the gap from the FURTHEST end seen so far, not this slot's end.
    // Overlapping slots (a 3-hour posting beside three 1-hour classes) would
    // otherwise produce a phantom negative gap.
    const gap = toMinutes(next.start) - furthestEnd;
    if (gap < BREAK_THRESHOLD_MINUTES) continue;

    const last = rows[rows.length - 1];
    if (last.kind === 'break') {
      // Merge consecutive breaks rather than stacking hairlines.
      last.end = next.start;
    } else {
      rows.push({
        kind: 'break',
        start: minutesToLabel(furthestEnd),
        end: next.start,
      });
    }
  }

  return rows;
}

function minutesToLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}


// -----------------------------------------------------------------------------
// SECTION 4 — Component
// -----------------------------------------------------------------------------

export interface WeekStripProps {
  /** Any date inside the week to display. Defaults to today. */
  anchorDate?: ISODate;
  /** Day header tapped — the marking list below should jump to this date. */
  onSelectDay?: (date: ISODate) => void;
  /** Currently selected day in the marking list, echoed here. */
  selectedDate?: ISODate;
  /**
   * Store revision counter. Changing it forces a recompute.
   *
   * ⚠ Not decorative. The strip reads generated sessions, which are derived
   *   and memoised by DataVersion — without this in the dependency list, a
   *   mark made below would not repaint the tile above it.
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

    // Working days only. A non-working day is absent from the grid entirely —
    // it is not a break, and it is not an empty column. If the student later
    // enables Sunday in settings, the column and its sessions simply reappear.
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

    // Rows are built only from sessions on visible days, so a stray Sunday
    // entry cannot add a row to a six-day grid.
    const visible = all.filter((s) => workingDays.includes(isoToDayIndex(s.date)));

    return {
      days,
      rows: buildRows(visible),
      weekStart,
      weekEnd,
      isCurrentWeek: weekStart === weekStartFor(today),
      unmarkedCount: visible.filter(
        (s) => s.status === 'unmarked' && s.date <= today,
      ).length,
    };
  }, [anchor, year, workingDays, today, revision]);

  // ---- Empty state -----------------------------------------------------------
  if (model.rows.length === 0) {
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

  const gridCols = `2rem repeat(${model.days.length}, minmax(0, 1fr))`;

  return (
    <section className="card overflow-hidden p-3">
      {/* ---- header: which week, and the unmarked nag ---- */}
      <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
        <span className="eyebrow">
          {model.isCurrentWeek ? 'This week' : formatRange(model.weekStart, model.weekEnd)}
        </span>

        {/*
          The one piece of information the strip is allowed to state in words.
          It is a COUNT OF ACTIONS, not a measure of standing — no percentage,
          no score, nothing that could be misread as a grade.
        */}
        {model.unmarkedCount > 0 && (
          <span className="chip chip-watch">
            {model.unmarkedCount} unmarked
          </span>
        )}
      </div>

      {/* ---- day headers ---- */}
      <div className="grid gap-1" style={{ gridTemplateColumns: gridCols }}>
        <div aria-hidden />
        {model.days.map((day) => {
          const isSelected = day.date === selectedDate;
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => onSelectDay?.(day.date)}
              aria-current={day.isToday ? 'date' : undefined}
              aria-label={`${DAY_NAMES_SHORT[day.dayIndex]} ${day.date}`}
              className={`rounded-md py-1 transition-colors ${
                isSelected ? 'bg-[--color-brand-soft]' : 'hover:bg-[--color-surface-sunk]'
              }`}
            >
              <span
                className={`block text-[0.625rem] font-semibold uppercase tracking-wide ${
                  day.isToday ? 'text-[--color-brand-ink]' : 'text-[--color-ink-faint]'
                }`}
              >
                {DAY_NAMES_SHORT[day.dayIndex]}
              </span>
              <span
                className={`tnum block text-xs ${
                  day.isToday
                    ? 'font-semibold text-[--color-brand-ink]'
                    : 'text-[--color-ink-muted]'
                }`}
              >
                {Number(day.date.slice(8, 10))}
              </span>
            </button>
          );
        })}
      </div>

      {/* ---- rows ---- */}
      <div className="mt-1 space-y-1">
        {model.rows.map((row) => {
          // ---- inferred break: one hairline, spanning the whole width ----
          if (row.kind === 'break') {
            return (
              <div
                key={`break-${row.start}-${row.end}`}
                className="break-row flex items-center justify-center py-[3px]"
              >
                Break
              </div>
            );
          }

          return (
            <div
              key={`row-${row.start}-${row.end}`}
              className="grid items-stretch gap-1"
              style={{ gridTemplateColumns: gridCols }}
            >
              <span className="tnum flex items-center justify-end pr-1 text-[0.625rem] leading-none text-[--color-ink-faint]">
                {shortLabel(row.start)}
              </span>

              {model.days.map((day) => {
                const inSlot = day.sessions.filter(
                  (s) => s.start === row.start && s.end === row.end,
                );

                return (
                  <div
                    key={`${day.date}-${row.start}`}
                    className={`flex min-h-[1.75rem] flex-col gap-0.5 p-px ${
                      day.isToday ? 'day-today' : ''
                    }`}
                  >
                    {inSlot.flatMap((session) => {
                      const status = tileStatusFor(session, today);
                      const code = subjectShort(session.subjectId);

                      /*
                       * ★ TILE COUNT EQUALS WEIGHT.
                       *
                       * A 3-hour clinical posting logged as ONE class draws one
                       * tall tile. The same block counted as THREE draws three.
                       * The marking list below still shows a single row with a
                       * single tap — same session, two renderings.
                       *
                       * That asymmetry is the point: the student marks what they
                       * did (one posting), and sees what it costs (three classes).
                       */
                      const count = Math.max(1, Math.round(session.weight));
                      const isOffTimetable = session.origin === 'extra';

                      return Array.from({ length: count }, (_, i) => (
                        <div
                          key={`${session.id}-${i}`}
                          title={`${session.subjectName} · ${session.category} · ${session.start}–${session.end}${
                            count > 1 ? ` · counts as ${count}` : ''
                          }`}
                          className={`tile ${TILE_CLASS[status]} ${
                            isOffTimetable ? 'tile-offgrid' : ''
                          }`}
                          style={{
                            flex: '1 1 0',
                            minHeight: count > 1 ? '0.875rem' : '1.625rem',
                          }}
                        >
                          {/* Label once per session, on the first tile, so a
                              3-tile block reads as one class rather than three
                              repetitions of the same code. */}
                          {i === 0 ? code : ''}
                        </div>
                      ));
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ---- legend ----
          Small, permanent, and worth the space. The grey scale is the one part
          of this design a student will not guess correctly on first sight. */}
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


function LegendDot(props: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`tile ${props.className}`}
        style={{ width: '0.75rem', height: '0.75rem', borderRadius: '0.1875rem' }}
        aria-hidden
      />
      {props.label}
    </span>
  );
}

/** "22–27 Sept". Only shown when viewing a week other than the current one. */
function formatRange(start: ISODate, end: ISODate): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const month = e.toLocaleDateString(undefined, { month: 'short' });

  return s.getMonth() === e.getMonth()
    ? `${s.getDate()}–${e.getDate()} ${month}`
    : `${s.getDate()} ${s.toLocaleDateString(undefined, { month: 'short' })} – ${e.getDate()} ${month}`;
}
