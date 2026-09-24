'use client';

// =============================================================================
// app/attendance/components/WeekStrip.tsx
// -----------------------------------------------------------------------------
// The top-of-screen weekly preview.
//
// ITS JOB IS "HAVE I LOGGED EVERYTHING?" — nothing else.
// The rings answer "am I safe?". Keeping those two questions in separate
// objects is what stops this screen becoming a wall of numbers.
//
// THREE HARD RULES:
//   1. READ-ONLY. It renders sessions and computes nothing. Marking happens in
//      the list below. A preview that can be edited is not a preview.
//   2. NO PERCENTAGES. Ever. The moment a number appears here someone reads it
//      as their standing, and we are back to the pooled-average problem.
//   3. NO CATEGORY COLOUR. --color-practical is the same green as
//      --color-safe. Colour means STATUS here and nothing else.
//
// WHAT THE STUDENT SEES:
//   One column per working day. A non-working day is ABSENT from the grid, not
//   shown empty. Today gets a spine. Inferred breaks collapse to a hairline.
//   Tile count equals weight, so a posting counted as 3 draws 3 tiles.
// =============================================================================

import { useMemo } from 'react';

import type { DayIndex, ISODate, Session, WeekTileStatus } from '../types';
import { DAY_NAMES_SHORT } from '../types';
import { generateForWeek } from '../generate';
import { getSettings } from '../store';
import { todayISO } from '@/lib/attendance/datetime';
import { subjectShort } from '@/lib/attendance/curriculum';


// -----------------------------------------------------------------------------
// Local time helpers
//
// Deliberately local rather than imported: these are layout arithmetic, not
// domain logic, and WeekStrip should not gain a dependency on datetime.ts for
// two lines of minute maths.
// -----------------------------------------------------------------------------

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** "09:00" → "9" ; "14:30" → "2:30". Compact enough for a 32px gutter. */
function shortLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, '0')}`;
}

/** Monday-anchored week start for any date. (TRAP 4: Monday is 0, not Sunday.) */
function weekStartFor(iso: ISODate): ISODate {
  const d = new Date(`${iso}T00:00:00`);
  const jsDay = d.getDay();               // 0 = Sunday
  const mondayIndex = (jsDay + 6) % 7;    // 0 = Monday
  d.setDate(d.getDate() - mondayIndex);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: ISODate, n: number): ISODate {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}


// -----------------------------------------------------------------------------
// Status mapping
//
// Session status is what was RECORDED. Tile status is what the student should
// SEE — and those differ for one case only: an unmarked class that has not
// happened yet is "future", not a missing action.
// -----------------------------------------------------------------------------

function tileStatusFor(session: Session, today: ISODate): WeekTileStatus {
  switch (session.status) {
    case 'present':       return 'present';
    case 'absent':        return 'absent';
    case 'not-conducted': return 'cancelled';
    default:              return session.date > today ? 'future' : 'unmarked';
  }
}

const TILE_CLASS: Record<WeekTileStatus, string> = {
  present:   'tile-present',
  absent:    'tile-absent',
  unmarked:  'tile-unmarked',
  future:    'tile-future',
  cancelled: 'tile-cancelled',
};


// -----------------------------------------------------------------------------
// Row skeleton + break inference
//
// Every column shares one row skeleton, which is what keeps the grid aligned.
//
// BREAK INFERENCE, as specified: a time slot where NO working day has a class
// is a break. Collapse it. A slot where only SOME days are free is a partial
// gap — the row stays and those days get an empty cell.
//
// Two guards on top of that:
//   • consecutive breaks merge into one row, so a sparse first-year timetable
//     doesn't render more break rows than class rows
//   • rows outside the observed span are never drawn, so college hours are
//     inferred from the timetable rather than padded with empty 8am slots
// -----------------------------------------------------------------------------

interface Row {
  kind: 'class' | 'break';
  start: string;
  end: string;
  isMerged: boolean;
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
  slots.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  const rows: Row[] = [];

  for (let i = 0; i < slots.length; i += 1) {
    rows.push({ kind: 'class', start: slots[i].start, end: slots[i].end, isMerged: false });

    const next = slots[i + 1];
    if (!next) continue;

    // A genuine gap between the end of this slot and the start of the next,
    // across every day. Anything under 20 minutes is a changeover, not a break.
    const gap = toMinutes(next.start) - toMinutes(slots[i].end);
    if (gap >= 20) {
      const last = rows[rows.length - 1];
      if (last.kind === 'break') {
        last.end = next.start;
        last.isMerged = true;
      } else {
        rows.push({ kind: 'break', start: slots[i].end, end: next.start, isMerged: false });
      }
    }
  }
  return rows;
}


// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export interface WeekStripProps {
  /** Any date inside the week to show. Defaults to today. */
  anchorDate?: ISODate;
  /** Fires when a day header is tapped, so the marking list can jump to it. */
  onSelectDay?: (date: ISODate) => void;
  /** Currently selected day in the marking list, highlighted here. */
  selectedDate?: ISODate;
  /** Version counter from the store; changing it forces a recompute. */
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
    void revision; // recompute when the store changes

    const weekStart = weekStartFor(anchor);
    const weekEnd = addDays(weekStart, 6);
    const sessions = generateForWeek(year, weekStart, weekEnd);

    // Only working days become columns. A non-working day is absent from the
    // grid entirely — it is not a break, and not an empty column.
    const days = [...workingDays]
      .sort((a, b) => a - b)
      .map((dayIndex) => {
        const date = addDays(weekStart, dayIndex);
        return {
          dayIndex,
          date,
          isToday: date === today,
          sessions: sessions
            .filter((s) => s.date === date)
            .sort((a, b) => a.start.localeCompare(b.start)),
        };
      });

    const visible = sessions.filter((s) =>
      workingDays.includes(((new Date(`${s.date}T00:00:00`).getDay() + 6) % 7) as DayIndex),
    );

    const unmarkedCount = visible.filter(
      (s) => s.status === 'unmarked' && s.date <= today,
    ).length;

    return {
      days,
      rows: buildRows(visible),
      weekStart,
      weekEnd,
      isCurrentWeek: weekStart === weekStartFor(today),
      unmarkedCount,
    };
  }, [anchor, year, workingDays, today, revision]);

  if (model.rows.length === 0) {
    return (
      <div className="card p-5 text-center">
        <p className="text-sm text-[--color-ink-muted]">
          No classes this week. Add your timetable in setup to see it here.
        </p>
      </div>
    );
  }

  return (
    <section className="card overflow-hidden p-3">
      {/* ---- header: date range, and the unmarked nag ---- */}
      <div className="mb-3 flex items-baseline justify-between px-1">
        <span className="eyebrow">
          {model.isCurrentWeek ? 'This week' : 'Week of ' + model.weekStart}
        </span>
        {model.unmarkedCount > 0 && (
          <span className="chip chip-watch">
            {model.unmarkedCount} unmarked
          </span>
        )}
      </div>

      {/* ---- day headers ---- */}
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `2rem repeat(${model.days.length}, 1fr)` }}
      >
        <div aria-hidden />
        {model.days.map((day) => (
          <button
            key={day.date}
            onClick={() => onSelectDay?.(day.date)}
            className={`rounded-md py-1 text-center transition-colors ${
              day.date === selectedDate ? 'bg-[--color-brand-soft]' : ''
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
        ))}
      </div>

      {/* ---- rows ---- */}
      <div className="mt-1 space-y-1">
        {model.rows.map((row) => {
          if (row.kind === 'break') {
            return (
              <div
                key={`break-${row.start}`}
                className="break-row flex items-center justify-center py-0.5"
              >
                Break
              </div>
            );
          }

          return (
            <div
              key={`row-${row.start}`}
              className="grid items-stretch gap-1"
              style={{ gridTemplateColumns: `2rem repeat(${model.days.length}, 1fr)` }}
            >
              <span className="tnum flex items-center justify-end pr-1 text-[0.625rem] text-[--color-ink-faint]">
                {shortLabel(row.start)}
              </span>

              {model.days.map((day) => {
                const inSlot = day.sessions.filter(
                  (s) => s.start === row.start && s.end === row.end,
                );

                return (
                  <div
                    key={`${day.date}-${row.start}`}
                    className={`flex flex-col gap-0.5 ${day.isToday ? 'day-today' : ''}`}
                  >
                    {inSlot.flatMap((session) => {
                      const status = tileStatusFor(session, today);
                      const code = subjectShort(session.subjectId);

                      // ★ Tile count equals weight. A 3-hour posting counted as
                      //   one class draws ONE tall tile; counted as 3, it draws
                      //   THREE. The marking list still shows a single row —
                      //   same session, two renderings, exactly as specified.
                      const count = Math.max(1, Math.round(session.weight));

                      return Array.from({ length: count }, (_, i) => (
                        <div
                          key={`${session.id}-${i}`}
                          title={`${session.subjectName} · ${session.category} · ${session.start}–${session.end}`}
                          className={`tile ${TILE_CLASS[status]} ${
                            session.origin === 'extra' ? 'tile-offgrid' : ''
                          }`}
                          style={{ minHeight: count > 1 ? '1.125rem' : '1.75rem' }}
                        >
                          {count === 1 || i === 0 ? code : ''}
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
    </section>
  );
}
