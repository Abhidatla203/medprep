'use client';

// =============================================================================
// app/attendance/components/MarkList.tsx
// -----------------------------------------------------------------------------
// The marking section. This is the daily habit — the thing a student opens for
// ten seconds after their last class and closes again.
//
// It sits BELOW the week strip and it is the only place marking happens. The
// strip above is a read-only preview; making it tappable would have given us
// two marking surfaces with two sets of edge cases and one shared bug.
//
// WHAT IT CONTAINS, top to bottom:
//   1. Day header      — "Monday, 22 September" + ▾ dropdown + calendar icon
//   2. Unmarked chip   — the only actionable nag, since the strip is read-only
//   3. Class rows      — one per session, P / A / C
//   4. Mark all cancelled — the holiday answer. Six taps becomes one.
//   5. Quick add       — a class that was not on the timetable
//
// ═════════════════════════════════════════════════════════════════════════════
//  FOUR RULES CARRIED IN FROM THE SPEC
// ═════════════════════════════════════════════════════════════════════════════
//
//  1. ONE ROW PER SESSION, WHATEVER THE WEIGHT.
//     A posting counted as 3 classes is ONE row and ONE tap. The weight lives
//     in the data; the student marks what they did, not what it costs. The
//     week strip renders the same session as three tiles. Same record, two
//     renderings — that asymmetry is deliberate and is the whole point of the
//     multiplier.
//
//  2. C IS SMALLER THAN P AND A.
//     Present and absent are the daily reality. Cancelled is occasional. Equal
//     visual weight would invite mis-taps on the one button that silently
//     removes a class from the denominator.
//
//  3. NO DEFAULT SELECTION. EVER.
//     An unmarked row stays visually open. Pre-selecting "present" would be
//     guessing on the student's behalf about the exact thing the app exists to
//     record — and a wrong guess here is invisible until debarment.
//
//  4. NO PERCENTAGES IN THIS COMPONENT.
//     Not one. Standing belongs to the rings. A figure here would be read as a
//     consequence of the tap just made, which is exactly the pooled-number
//     confusion the rebuild exists to remove.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  ClassCategory,
  ISODate,
  Session,
  SessionStatus,
  SubjectId,
} from '../types';
import { DAY_NAMES } from '../types';

import { generateForDate, extraSessionId } from '../generate';
import {
  addExtraClass,
  getEntOphthaInFinalYear,
  getSettings,
  setMark,
  setMarks,
} from '../store';

import { todayISO } from '@/lib/attendance/datetime';
import {
  categoriesForSubject,
  selectableSubjectsFor,
} from '@/lib/attendance/curriculum';


// -----------------------------------------------------------------------------
// SECTION 1 — Local helpers
// -----------------------------------------------------------------------------

const CATEGORY_LABEL: Record<ClassCategory, string> = {
  theory: 'Theory',
  practical: 'Practical',
  clinical: 'Clinical',
};

/** Local calendar date. Never toISOString() — that shifts the day in IST. */
function toISO(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(iso: ISODate, n: number): ISODate {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** ⚠ TRAP 4 — Monday is 0 here, not Sunday. */
function isoToDayIndex(iso: ISODate): number {
  return (new Date(`${iso}T00:00:00`).getDay() + 6) % 7;
}

function weekStartFor(iso: ISODate): ISODate {
  return addDays(iso, -isoToDayIndex(iso));
}

/** "Monday, 22 September". Long form — this is the section's anchor. */
function formatDayHeading(iso: ISODate): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${DAY_NAMES[isoToDayIndex(iso)]}, ${d.getDate()} ${d.toLocaleDateString(
    undefined,
    { month: 'long' },
  )}`;
}

/** "9:00 – 10:00". 12-hour, because nobody says "fourteen thirty" out loud. */
function formatRange(start: string, end: string): string {
  const fmt = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const suffix = h < 12 ? 'am' : 'pm';
    return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}


// -----------------------------------------------------------------------------
// SECTION 2 — Component
// -----------------------------------------------------------------------------

export interface MarkListProps {
  /** The day being marked. Owned by the parent so the strip can drive it. */
  selectedDate: ISODate;
  onSelectDate: (date: ISODate) => void;
  /** Store revision. Changing it forces regeneration. */
  revision?: number;
}

export default function MarkList(props: MarkListProps) {
  const { selectedDate, onSelectDate, revision } = props;

  const today = todayISO();
  const settings = getSettings();
  const year = settings.currentYear;

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const sessions = useMemo(() => {
    void revision;
    return generateForDate(year, selectedDate).sort((a, b) =>
      a.start.localeCompare(b.start),
    );
  }, [year, selectedDate, revision]);

  const unmarkedCount = useMemo(
    () =>
      selectedDate <= today
        ? sessions.filter((s) => s.status === 'unmarked').length
        : 0,
    [sessions, selectedDate, today],
  );

  // Days available in the dropdown — this week's working days only.
  const weekDays = useMemo(() => {
    const start = weekStartFor(selectedDate);
    return [...settings.college.workingDays]
      .sort((a, b) => a - b)
      .map((dayIndex) => ({ dayIndex, date: addDays(start, dayIndex) }));
  }, [selectedDate, settings.college.workingDays]);

  const isFuture = selectedDate > today;

  /**
   * ★ THE HOLIDAY ANSWER.
   *
   * College shut on Tuesday. Without this, that costs six taps and the app
   * nags all evening about classes that never ran. One bulk write, one
   * notification, one undo.
   *
   * Only offered for days that have already happened — you cannot know a
   * future day was cancelled, and offering it would invite pre-emptive taps
   * that quietly shrink the denominator.
   */
  const markAllCancelled = () => {
    const updates: Record<string, SessionStatus> = {};
    sessions.forEach((s) => {
      updates[s.id] = 'not-conducted';
    });
    setMarks(updates);
  };

  const clearDay = () => {
    const updates: Record<string, SessionStatus> = {};
    sessions.forEach((s) => {
      updates[s.id] = 'unmarked';
    });
    setMarks(updates);
  };

  const allCancelled =
    sessions.length > 0 && sessions.every((s) => s.status === 'not-conducted');

  return (
    <section className="mt-4">
      {/* ------------------------------------------------ day header ------- */}
      <div className="mb-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="display truncate text-lg">
            {formatDayHeading(selectedDate)}
          </h2>
          {selectedDate === today && (
            <span className="text-xs text-[--color-ink-faint]">Today</span>
          )}
        </div>

        {/* ▾ jump to another day this week */}
        <div className="relative">
          <select
            aria-label="Jump to day"
            value={selectedDate}
            onChange={(e) => onSelectDate(e.target.value)}
            className="field field-select min-h-[2.375rem] w-[7.5rem] py-1.5 pl-3 text-sm"
          >
            {weekDays.map((d) => (
              <option key={d.date} value={d.date}>
                {DAY_NAMES[d.dayIndex].slice(0, 3)} {Number(d.date.slice(8, 10))}
              </option>
            ))}
          </select>
        </div>

        {/* 📅 jump to any date.
            A native date input, deliberately — it is keyboard accessible, it is
            localised for free, and on mobile it opens the OS picker the student
            already knows how to use. */}
        <button
          type="button"
          aria-label="Jump to date"
          onClick={() => dateInputRef.current?.showPicker?.()}
          className="btn btn-ghost min-h-[2.375rem] w-[2.625rem] px-0 text-base"
        >
          <span aria-hidden>📅</span>
          <input
            ref={dateInputRef}
            type="date"
            value={selectedDate}
            onChange={(e) => e.target.value && onSelectDate(e.target.value)}
            className="pointer-events-none absolute h-0 w-0 opacity-0"
            tabIndex={-1}
          />
        </button>
      </div>

      {/* --------------------------------------------- unmarked nag -------- */}
      {unmarkedCount > 0 && (
        <div className="mb-2.5 flex items-center justify-between gap-2 rounded-[--radius-field] border border-[--color-watch-line] bg-[--color-watch-soft] px-3.5 py-2.5">
          <span className="text-sm text-[--color-watch]">
            {unmarkedCount} {unmarkedCount === 1 ? 'class' : 'classes'} not marked
          </span>
        </div>
      )}

      {/* ------------------------------------------------- class rows ------ */}
      {sessions.length === 0 ? (
        <div className="card p-5 text-center">
          <p className="text-sm text-[--color-ink-muted]">
            No classes scheduled.
          </p>
          <button
            onClick={() => setQuickAddOpen(true)}
            className="btn btn-quiet mt-2 text-sm"
          >
            + Add one anyway
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <MarkRow key={session.id} session={session} isFuture={isFuture} />
          ))}
        </div>
      )}

      {/* ------------------------------------------- day-level actions ----- */}
      {sessions.length > 0 && !isFuture && (
        <div className="mt-2.5 flex gap-2">
          {allCancelled ? (
            <button onClick={clearDay} className="btn btn-quiet flex-1 text-sm">
              Undo — unmark this day
            </button>
          ) : (
            <button
              onClick={markAllCancelled}
              className="btn btn-quiet flex-1 text-sm"
            >
              Mark all cancelled
            </button>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- quick add ---- */}
      {sessions.length > 0 && (
        <button
          onClick={() => setQuickAddOpen(true)}
          className="btn btn-ghost mt-2.5 w-full border-dashed text-sm"
        >
          + Class not on my timetable
        </button>
      )}

      {quickAddOpen && (
        <QuickAddSheet
          date={selectedDate}
          onClose={() => setQuickAddOpen(false)}
        />
      )}
    </section>
  );
}


// -----------------------------------------------------------------------------
// SECTION 3 — One class row
//
// ⚠ Tapping the SAME button again unmarks. No separate clear control, no long
//   press, no confirmation. Mis-taps are frequent and the cost of an undiscovered
//   wrong mark is high, so undo has to be the most obvious gesture available.
// -----------------------------------------------------------------------------

function MarkRow(props: { session: Session; isFuture: boolean }) {
  const { session, isFuture } = props;

  const mark = (status: SessionStatus) =>
    setMark(session.id, session.status === status ? 'unmarked' : status);

  const weight = Math.max(1, Math.round(session.weight));

  return (
    <div
      className={`card p-3 ${
        session.status === 'not-conducted' ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-sm font-semibold text-[--color-ink] ${
              session.status === 'not-conducted' ? 'line-through' : ''
            }`}
          >
            {session.subjectName}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="chip chip-neutral">
              {CATEGORY_LABEL[session.category]}
            </span>
            <span className="text-xs text-[--color-ink-muted]">
              {formatRange(session.start, session.end)}
            </span>

            {/*
              ★ Shown ONLY when weight > 1.
              Without it, one tap moves the total by three and the student has
              no idea why. With it, the multiplier is self-explanatory at the
              exact moment it matters.
            */}
            {weight > 1 && (
              <span className="chip chip-brand">counts as {weight}</span>
            )}

            {session.origin === 'extra' && (
              <span className="chip chip-neutral">extra</span>
            )}
          </div>
        </div>
      </div>

      {/* ---- P / A / C ----
          P and A are full size and equal. C is deliberately smaller and quieter:
          it is the occasional case, and it is the one button that removes a
          class from the denominator. */}
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => mark('present')}
          aria-pressed={session.status === 'present'}
          className={`seg ${
            session.status === 'present'
              ? 'border-[--color-safe] bg-[--color-safe] text-white'
              : ''
          }`}
        >
          Present
        </button>

        <button
          type="button"
          onClick={() => mark('absent')}
          aria-pressed={session.status === 'absent'}
          className={`seg ${
            session.status === 'absent'
              ? 'border-[--color-critical] bg-[--color-critical] text-white'
              : ''
          }`}
        >
          Absent
        </button>

        <button
          type="button"
          onClick={() => mark('not-conducted')}
          aria-pressed={session.status === 'not-conducted'}
          aria-label="Cancelled"
          title="Class was cancelled — counts as 0 of 0"
          className={`shrink-0 rounded-[--radius-field] border px-3 text-xs font-medium transition-colors ${
            session.status === 'not-conducted'
              ? 'border-[--color-ink-muted] bg-[--color-ink-muted] text-white'
              : 'border-[--color-line] text-[--color-ink-faint] hover:border-[--color-line-strong]'
          }`}
          style={{ minHeight: '2.75rem' }}
        >
          Cancelled
        </button>
      </div>

      {isFuture && session.status === 'unmarked' && (
        <p className="mt-1.5 text-center text-[0.6875rem] text-[--color-ink-faint]">
          Hasn&apos;t happened yet — mark it after the class
        </p>
      )}
    </div>
  );
}


// -----------------------------------------------------------------------------
// SECTION 4 — Quick add
//
// For a class that was not on the timetable: a guest lecture, a surprise
// tutorial, a rescheduled practical.
//
// DELIBERATELY NARROW:
//   • subject → type → present or absent → done
//   • NO cancelled option. A class that did not happen and was never scheduled
//     is not an event; recording it as 0/0 is recording nothing.
//   • NO timetable edit. This adds ONE class on ONE day. Anything recurring
//     belongs in setup, where it can be reviewed and removed.
//
// ★ IT STORES AS A ONE-OFF EXTRA CLASS with countsTowardDenominator: true.
//   A class the student actually attended counts both ways — that is a normal
//   class that happened to be unscheduled, not a policy question. The
//   denominator toggle exists for planned makeup classes, and those are created
//   in setup where there is room to explain the choice.
// -----------------------------------------------------------------------------

function QuickAddSheet(props: { date: ISODate; onClose: () => void }) {
  const { date, onClose } = props;

  const settings = getSettings();
  const year = settings.currentYear;

  const subjects = useMemo(
    () => selectableSubjectsFor(year, undefined, getEntOphthaInFinalYear()),
    [year],
  );

  const [subjectId, setSubjectId] = useState<SubjectId>(subjects[0]?.id ?? '');
  const [category, setCategory] = useState<ClassCategory>('theory');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cats = useMemo(
    () =>
      subjectId
        ? categoriesForSubject(subjectId)
        : (['theory'] as ClassCategory[]),
    [subjectId],
  );

  // Keep the type legal when the subject changes — a clinical subject has no
  // practical, and a stale selection would file the class under a category the
  // student will never see again.
  useEffect(() => {
    if (cats.length > 0 && !cats.includes(category)) setCategory(cats[0]);
  }, [cats, category]);

  const save = (status: 'present' | 'absent') => {
    setError(null);
    if (!subjectId) return setError('Choose a subject.');
    if (start >= end) return setError('The end time must be after the start.');

    const subject = subjects.find((s) => s.id === subjectId);

    const extra = addExtraClass(year, {
      subjectId,
      subjectName: subject?.name ?? subjectId,
      countsToward: category,
      // ★ An unscheduled class the student attended is a normal class.
      countsTowardDenominator: true,
      startDate: date,
      endDate: date,
      repeat: 'once',
      weekdays: [],
      start,
      end,
      weight: 1,
    });

    // The session id is a pure function of the extra's id, the date and the
    // category — so we can mark it immediately, without waiting for a
    // regeneration round-trip.
    setMark(extraSessionId(extra.id, date, category), status);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-2xl px-3 pb-3">
        <div className="sheet">
          <div className="sheet-head px-5 pb-4 pt-4">
            <div className="sheet-grip mb-4" aria-hidden />
            <p className="display text-xl">Add a class</p>
            <p className="mt-1 text-sm text-[--color-ink-muted]">
              One class, on this day only. Your timetable is unchanged.
            </p>
          </div>

          <div className="sheet-body space-y-5 px-5 py-5">
            <div>
              <span className="eyebrow mb-2 block">Subject</span>
              <select
                className="field field-select"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="eyebrow mb-2 block">Type</span>
              <div className="flex gap-2">
                {cats.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    aria-pressed={category === c}
                    className={`seg ${category === c ? 'seg-on' : ''}`}
                  >
                    {CATEGORY_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="eyebrow mb-2 block">Start</span>
                <input
                  type="time"
                  className="field tnum"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div>
                <span className="eyebrow mb-2 block">End</span>
                <input
                  type="time"
                  className="field tnum"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <p className="rounded-[--radius-field] border border-[--color-critical-line] bg-[--color-critical-soft] px-4 py-3 text-sm text-[--color-critical]">
                {error}
              </p>
            )}
          </div>

          {/* Save and mark in one action. There is no "add unmarked" — if you
              are adding a class that was not on your timetable, you were there
              or you were not, and you know which. */}
          <div className="sheet-foot flex gap-2 p-3">
            <button onClick={onClose} className="btn btn-ghost flex-1">
              Cancel
            </button>
            <button
              onClick={() => save('absent')}
              className="btn btn-ghost flex-1 border-[--color-critical-line] text-[--color-critical]"
            >
              Was absent
            </button>
            <button
              onClick={() => save('present')}
              className="btn btn-primary flex-1"
            >
              Was present
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
