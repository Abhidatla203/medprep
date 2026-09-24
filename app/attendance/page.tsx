'use client';

// =============================================================================
// app/attendance/page.tsx
// -----------------------------------------------------------------------------
// Three children, in the order a student actually uses them:
//   1. WeekStrip — "have I logged everything?"   read-only
//   2. MarkList  — the ten-second daily habit    the only marking surface
//   3. RingGrid  — "am I safe?"                  resting view, no numbers
//
// ★ NO "OTHER SUBJECTS" DROPDOWN. Spec §4.4: every subject in THIS YEAR'S
//   schedule appears on the main page. Burying half of them behind a disclosure
//   triangle recreated the exact failure the ring grid exists to prevent — a
//   subject sliding toward debarment while the screen looks calm.
//
// ⚠ selectedDate LIVES HERE. The strip and the list must always agree on which
//   day is in focus. If either owned that state the other would need telling,
//   and they would drift the first time a third entry point appeared (the list
//   already has a calendar jump). One owner, two consumers, no sync code.
//
// ⚠ THE MOUNT GATE. Every store read touches localStorage, which does not exist
//   on the server — so the server renders an empty state and the client
//   hydrates with real data, and React throws a mismatch. The first client
//   render therefore matches the server EXACTLY (both produce the skeleton) and
//   real data lands on pass two. The gate lives HERE so all three children stay
//   free of hydration logic.
//
// ★ MIGRATIONS RUN BEFORE THE FIRST STORE READ. runMigrations() converts
//   v2 → v3 → v4 and was called by nothing for several build steps, meaning
//   anyone upgrading silently landed on defaults: 75% everywhere, extras
//   reverting to the old global policy, custom targets gone.
//     1. It runs BEFORE setMounted(true) — rendering against pre-migration data
//        would show wrong figures for one frame, which reads as a glitch and
//        undermines every number on screen.
//     2. It runs in a top-level effect — migrations are idempotent, but a
//        remounting component would re-read storage forever.
//     3. StrictMode fires effects twice in dev; the ref guard makes that a no-op.
//
//   ⚠ STILL OUTSTANDING: a student whose first stop is /settings reads
//     pre-migration data. Proper home is a root-layout effect. Logged in
//     MEMORY.md; layout.tsx has its own font issue and deserves one clean pass.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

  // Anything the migration wants the student to know. Empty for almost
  // everyone — a fresh install has nothing to convert.
  const [migrationNotes, setMigrationNotes] = useState<string[]>([]);

  // Bumped on every store write. Children are pure functions of (date, store),
  // which React cannot see on its own.
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
        // A failed migration must never white-screen the app. Old data is READ,
        // never deleted, so a failure leaves the student on defaults with their
        // data still recoverable — bad, but survivable.
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
 * ⚠ MUST CONTAIN NO STORE READS. One localStorage value here and the mismatch
 *   simply moves rather than disappearing.
 */
function Skeleton() {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-4">
      <div className="h-6 w-40 animate-pulse rounded bg-surface-sunk" />
      <div className="mt-4 h-52 animate-pulse rounded-card bg-surface-sunk" />
      <div className="mt-5 h-7 w-56 animate-pulse rounded bg-surface-sunk" />
      <div className="mt-3 space-y-2">
        <div className="h-24 animate-pulse rounded-card bg-surface-sunk" />
        <div className="h-24 animate-pulse rounded-card bg-surface-sunk" />
      </div>
    </main>
  );
}


/**
 * Client-only. May read the store freely: never renders on the server, never
 * runs before migration.
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

  // ★ THE ONE PIECE OF STATE THIS PAGE OWNS.
  const [selectedDate, setSelectedDate] = useState<ISODate>(today);

  const jumpToToday = useCallback(() => setSelectedDate(today), [today]);

  /**
   * ONE call. getYearResult is memoised on DataVersion, so after the first
   * render this costs a map lookup. Filtering exam subjects is a filter over
   * the result, never a second computation.
   */
  const { subjects, totalTracked, unmarked } = useMemo(() => {
    void revision; // recompute when the store changes

    const result = getYearResult(year);

    return {
      // Everything in this year's schedule. No dropdown, no second tier.
      subjects: result.subjects.filter((s) => s.isExamSubject),
      totalTracked: result.subjects.length,
      unmarked: getUnmarkedCount(year),
    };
  }, [year, revision]);

  const nothingSetUp = totalTracked === 0;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-4">
      {/* ------------------------------------------- migration report ------
          Shown once, only when there is something to report. A silent
          conversion is how trust dies: a student who set 80% and finds 75% next
          week will not think "the migration was imperfect", they will think the
          app is unreliable and go back to paper. */}
      {migrationNotes.length > 0 && (
        <div className="mb-4 rounded-field border border-brand-line bg-brand-soft px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-ink">
                Your attendance data was updated
              </p>
              <ul className="mt-1.5 space-y-1">
                {migrationNotes.map((note, i) => (
                  <li key={i} className="text-sm text-brand-ink">
                    - {note}
                  </li>
                ))}
              </ul>
            </div>
            <button onClick={onDismissNotes} aria-label="Dismiss" className="modal-close">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- header ------- */}
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h1 className="display truncate text-2xl">Attendance</h1>
          <span className="text-xs text-ink-faint">{year}</span>
        </div>
        <Link href="/attendance/setup" className="btn btn-ghost min-h-9 text-sm">
          Setup
        </Link>
      </header>

      {/* ------------------------------------------------- week strip ------
          Above the list on purpose: the first question on opening the app is
          "what have I missed?", not "what am I marking?". */}
      <WeekStrip
        anchorDate={selectedDate}
        selectedDate={selectedDate}
        onSelectDay={setSelectedDate}
        revision={revision}
      />

      {/* -------------------------------------------------- mark list ------ */}
      <MarkList
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        revision={revision}
      />

      {/* ------------------------------------------------------ rings ------ */}
      {!nothingSetUp && (
        <section className="mt-9">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="eyebrow">Where you stand</h2>

            {/* A count of OUTSTANDING ACTIONS, never a score. It can be driven
                to zero by doing something, which is the only kind of number
                worth putting in a header. */}
            {unmarked > 0 && (
              <button onClick={jumpToToday} className="chip chip-watch">
                {unmarked} unmarked
              </button>
            )}
          </div>

          <RingGrid subjects={subjects} revision={revision} />
        </section>
      )}

      {/* ----------------------------------------------- first-run state ---
          Not an error and not an empty box. A student who just installed the
          app needs a door, not a dash. */}
      {nothingSetUp && (
        <section className="card mt-6 p-6 text-center">
          <p className="display text-lg">Nothing tracked yet</p>
          <p className="mt-1.5 text-sm text-ink-muted">
            Add your timetable and we&apos;ll work out where you stand.
          </p>
          <Link href="/attendance/setup" className="btn btn-primary mt-4 inline-flex">
            Set up my timetable
          </Link>
        </section>
      )}
    </main>
  );
}
