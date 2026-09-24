'use client';

// =============================================================================
// app/attendance/page.tsx
// -----------------------------------------------------------------------------
// THE REAL PAGE. Replaces the temporary stopgap entirely.
//
// Three children, assembled in the order a student actually uses them:
//
//   1. WeekStrip  — "have I logged everything?"   read-only
//   2. MarkList   — the ten-second daily habit    the only marking surface
//   3. RingGrid   — "am I safe?"                  resting view, no numbers
//
// This file owns almost nothing itself. It holds ONE piece of state and wires
// three components together. That is deliberate: every screen in this module
// has exactly one place where a bug can live, and for the page it is
// `selectedDate`.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ WHY selectedDate LIVES HERE AND NOWHERE ELSE
// ═════════════════════════════════════════════════════════════════════════════
// The week strip and the marking list must always agree on which day is in
// focus. Tap Thursday in the strip, the list jumps to Thursday. Pick Thursday
// from the list's dropdown, the strip highlights Thursday.
//
// If either component owned that state, the other would need to be told about
// changes, and the two would drift the first time someone added a third entry
// point (the calendar jump, which the list already has). One owner, two
// consumers, no synchronisation code.
//
// The strip receives it as `anchorDate` (which week to show) AND as
// `selectedDate` (which column to highlight) — same value, two jobs, because
// selecting a day in another week should move the whole strip.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ THE MOUNT GATE — READ BEFORE REMOVING IT
// ═════════════════════════════════════════════════════════════════════════════
// Every store read touches localStorage. On the server that does not exist, so
// store.ts correctly returns defaults: no timetable, no sessions, no marks. The
// server renders an empty state; the client hydrates with real data; React
// finds a different tree and throws a hydration mismatch.
//
// Nothing is wrong with the store — isBrowser() is doing its job. The rule is:
// a component whose output depends on browser-only state must not attempt to
// render that output on the server.
//
// So the first client render matches the server EXACTLY (both produce the
// skeleton), and real data appears on the second pass. One extra frame, zero
// mismatch.
//
// ★ THE GATE LIVES HERE, IN THE PARENT. WeekStrip, MarkList and RingGrid all
//   read the store during render and all three would need their own flag
//   otherwise. Gating once keeps them dumb.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ★ MIGRATIONS RUN HERE, BEFORE THE FIRST STORE READ
// ═════════════════════════════════════════════════════════════════════════════
// runMigrations() converts v2 → v3 → v4 storage. It was written, correct, and
// called by nothing for several build steps — meaning any student upgrading
// from an older build would silently land on defaults: 75% everywhere, extra
// classes reverting to the old global policy, custom targets gone.
//
// THREE RULES:
//   1. IT RUNS BEFORE setMounted(true). Rendering against pre-migration data
//      would show wrong figures for one frame, then correct them — which reads
//      as a glitch and undermines every number on the screen.
//   2. IT RUNS IN A TOP-LEVEL EFFECT. Both migrations are flag-guarded and
//      idempotent, so a repeat is harmless, but a component that remounts on
//      every navigation would pointlessly re-read storage forever.
//   3. STRICTMODE FIRES EFFECTS TWICE IN DEV. The ref guard makes that a no-op
//      and stops the notes banner flickering.
//
// ⚠ STILL OUTSTANDING: a student whose first stop is /settings or /attendance/
//   setup reads pre-migration data there. The proper home is a client effect in
//   the root layout. Logged in MEMORY.md; not fixed here because layout.tsx has
//   its own unrelated font issue and deserves one deliberate pass.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import WeekStrip from './components/WeekStrip';
import MarkList from './components/MarkList';
import RingGrid from './components/RingGrid';

import { getSettings, runMigrations, subscribe } from './store';
import { getYearResult, getUnmarkedCount } from './calculate';
import { todayISO } from '@/lib/attendance/datetime';
import type { ISODate } from './types';


export default function AttendancePage() {
  // False on the server AND on the first client render. That equality is the
  // entire hydration fix.
  const [mounted, setMounted] = useState(false);

  // Anything the migration wants the student to know. Empty for the
  // overwhelming majority — a fresh install has nothing to convert.
  const [migrationNotes, setMigrationNotes] = useState<string[]>([]);

  // Bumped on every store write. Passed down so children recompute; they are
  // otherwise pure functions of (date, store), which React cannot see.
  const [revision, setRevision] = useState(0);

  const migrationsRun = useRef(false);

  useEffect(() => {
    // ---- 1. MIGRATE. Nothing may read the store before this returns. -------
    if (!migrationsRun.current) {
      migrationsRun.current = true;

      try {
        const { v3, v4 } = runMigrations();
        const notes = [...v3.notes, ...v4.notes];
        if (notes.length > 0) setMigrationNotes(notes);
      } catch {
        // A failed migration must never white-screen the app. v2/v3 data is
        // READ, never deleted, so a failure leaves the student on defaults with
        // their old data still recoverable — bad, but survivable.
      }
    }

    // ---- 2. Only now is it safe to render real data. -----------------------
    setMounted(true);

    // ---- 3. Repaint on any store change. -----------------------------------
    return subscribe(() => setRevision((n) => n + 1));
  }, []);

  if (!mounted) return <Skeleton />;

  return (
    <AttendanceContent
      revision={revision}
      migrationNotes={migrationNotes}
      onDismissNotes={() => setMigrationNotes([])}
    />
  );
}


/**
 * Rendered by the server and by the first client pass.
 *
 * ⚠ MUST CONTAIN NO STORE READS. If one value here came from localStorage the
 *   mismatch would simply move rather than disappear. The shapes roughly match
 *   the real layout so the transition does not jump.
 */
function Skeleton() {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-4">
      <div className="h-6 w-40 animate-pulse rounded bg-[--color-surface-sunk]" />
      <div className="mt-4 h-44 animate-pulse rounded-[--radius-card] bg-[--color-surface-sunk]" />
      <div className="mt-5 h-7 w-56 animate-pulse rounded bg-[--color-surface-sunk]" />
      <div className="mt-3 space-y-2">
        <div className="h-24 animate-pulse rounded-[--radius-card] bg-[--color-surface-sunk]" />
        <div className="h-24 animate-pulse rounded-[--radius-card] bg-[--color-surface-sunk]" />
      </div>
    </main>
  );
}


/**
 * Client-only. Everything below may read the store freely: it never renders on
 * the server, and never runs before migration.
 */
function AttendanceContent(props: {
  revision: number;
  migrationNotes: string[];
  onDismissNotes: () => void;
}) {
  const { revision, migrationNotes, onDismissNotes } = props;

  const today = todayISO();
  const settings = getSettings();
  const year = settings.currentYear;

  // ★ THE ONE PIECE OF STATE THIS PAGE OWNS. See the header.
  const [selectedDate, setSelectedDate] = useState<ISODate>(today);

  // Non-exam subjects are tracked silently and shown on request. A first-year
  // does not need Community Medicine in their face when Anatomy is the one
  // that can debar them.
  const [showOthers, setShowOthers] = useState(false);

  /**
   * ONE call. getYearResult is memoised on DataVersion, so this costs a map
   * lookup on every render after the first — and splitting exam from non-exam
   * is a filter over the result, never a second computation.
   */
  const { examSubjects, otherSubjects, unmarked } = useMemo(() => {
    void revision; // recompute when the store changes

    const result = getYearResult(year);

    return {
      examSubjects: result.subjects.filter((s) => s.isExamSubject && !s.isExcluded),
      otherSubjects: result.subjects.filter((s) => !s.isExamSubject || s.isExcluded),
      unmarked: getUnmarkedCount(year),
    };
  }, [year, revision]);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-4">
      {/* ------------------------------------------- migration report ------
          Shown once, only when there is something to report.

          A silent conversion is how trust is lost: a student who set 80% and
          finds 75% next week will not conclude "the migration was imperfect" —
          they will conclude the app is unreliable and go back to paper. */}
      {migrationNotes.length > 0 && (
        <div className="mb-4 rounded-[--radius-field] border border-[--color-brand-line] bg-[--color-brand-soft] px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[--color-brand-ink]">
                Your attendance data was updated
              </p>
              <ul className="mt-1.5 space-y-1">
                {migrationNotes.map((note, i) => (
                  <li key={i} className="text-sm text-[--color-brand-ink]">
                    - {note}
                  </li>
                ))}
              </ul>
            </div>
            <button
              onClick={onDismissNotes}
              aria-label="Dismiss"
              className="btn btn-quiet min-h-8 shrink-0 px-2 text-sm"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- header ------- */}
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h1 className="display truncate text-2xl">Attendance</h1>
          <span className="text-xs text-[--color-ink-faint]">{year}</span>
        </div>

        <Link href="/attendance/setup" className="btn btn-ghost min-h-9 text-sm">
          Setup
        </Link>
      </header>

      {/* ------------------------------------------------- week strip ------
          Read-only. Tapping a day header moves the marking list below.
          It is deliberately ABOVE the list: the first question on opening the
          app is "what have I missed?", not "what am I marking?". */}
      <WeekStrip
        anchorDate={selectedDate}
        selectedDate={selectedDate}
        onSelectDay={setSelectedDate}
        revision={revision}
      />

      {/* -------------------------------------------------- mark list ------
          The only marking surface in the module. */}
      <MarkList
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        revision={revision}
      />

      {/* ------------------------------------------------------ rings ------ */}
      <section className="mt-8">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h2 className="eyebrow">Where you stand</h2>

          {/* A count of OUTSTANDING ACTIONS, never a score. The distinction
              matters: this number can be driven to zero by doing something,
              which is the only kind of number worth putting in a header. */}
          {unmarked > 0 && (
            <button
              onClick={() => setSelectedDate(today)}
              className="chip chip-watch"
            >
              {unmarked} unmarked
            </button>
          )}
        </div>

        <p className="mb-3 text-xs text-[--color-ink-faint]">
          Outer ring is theory, inner is practical or clinical. The notch on
          each ring is the mark you need. Tap a subject for the numbers.
        </p>

        <RingGrid subjects={examSubjects} revision={revision} />
      </section>

      {/* ---------------------------------------------- other subjects -----
          ⚠ TRAP 9 in practice. These are tracked, never discarded — but they
          are not what the student is examined on this year, so they do not get
          equal billing. Collapsed by default, one tap away, honest about the
          count. */}
      {otherSubjects.length > 0 && (
        <section className="mt-8">
          <button
            onClick={() => setShowOthers((v) => !v)}
            aria-expanded={showOthers}
            className="btn btn-ghost w-full justify-between text-sm"
          >
            <span>
              Other subjects{' '}
              <span className="text-[--color-ink-faint]">
                ({otherSubjects.length})
              </span>
            </span>
            <span aria-hidden>{showOthers ? '▲' : '▼'}</span>
          </button>

          {showOthers && (
            <div className="animate-rise mt-3">
              <p className="mb-3 text-xs text-[--color-ink-faint]">
                Still tracked, just not part of this year&apos;s exams.
              </p>
              <RingGrid subjects={otherSubjects} revision={revision} />
            </div>
          )}
        </section>
      )}

      {/* ----------------------------------------------- first-run state ---
          Not an error, and not an empty box. A student who has just installed
          the app needs a door, not a dash. */}
      {examSubjects.length === 0 && otherSubjects.length === 0 && (
        <section className="card mt-4 p-6 text-center">
          <p className="display text-lg">Nothing tracked yet</p>
          <p className="mt-1.5 text-sm text-[--color-ink-muted]">
            Add your timetable and we&apos;ll work out where you stand.
          </p>
          <Link
            href="/attendance/setup"
            className="btn btn-primary mt-4 inline-flex"
          >
            Set up my timetable
          </Link>
        </section>
      )}
    </main>
  );
}
