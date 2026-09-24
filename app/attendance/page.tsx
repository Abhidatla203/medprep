'use client';

// =============================================================================
// app/attendance/page.tsx — TEMPORARY STOPGAP
// -----------------------------------------------------------------------------
// This is NOT the rebuilt page. It exists so the dev server compiles and so the
// v4 logic layer can be smoke-tested while RingGrid is being written.
//
// It uses only the v4 API, so if the numbers here look right, then types +
// store + calculate + generate are wired correctly.
//
// Styling is plain Tailwind ON PURPOSE. No design tokens are invented here —
// the real page will use globals.css.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ WHY THE MOUNT GATE EXISTS — READ BEFORE REMOVING IT
// ═════════════════════════════════════════════════════════════════════════════
// Every read in this file — getSettings(), generateForDate(), getYearResult() —
// ultimately touches localStorage. On the server localStorage does not exist,
// so store.ts correctly hands back defaults: no timetable, no sessions, no
// marks. The server therefore renders "No classes scheduled today."
//
// The client then hydrates, localStorage IS there, and React finds a <div> full
// of class rows where the server left a <p>. That is the hydration mismatch.
//
// Nothing is wrong with the store. isBrowser() is doing precisely its job. The
// rule is simply: a component whose output depends on browser-only state must
// not attempt to render that output on the server.
//
// So the first client render deliberately matches the server EXACTLY — both
// produce the skeleton below — and real data appears on the second pass, after
// useEffect has run. One extra frame, zero mismatch.
//
// ★ THE SAME GATE IS REQUIRED FOR WeekStrip AND MarkList. Both read generated
//   sessions during render. Gate them HERE, in the parent, rather than adding
//   a mounted flag to each component — one place to get right, and the children
//   stay dumb.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ★ MIGRATIONS RUN HERE, AND ONLY HERE
// ═════════════════════════════════════════════════════════════════════════════
// runMigrations() converts v2 → v3 → v4 storage. Until this call existed it was
// written, correct, and invoked by nothing — meaning any student upgrading from
// an older build would silently land on defaults: 75% everywhere, extra classes
// reverting to the old global policy, custom targets gone.
//
// THREE RULES ABOUT THIS CALL:
//
//   1. IT MUST RUN BEFORE THE FIRST STORE READ.
//      That is why setMounted(true) comes AFTER it. Rendering content against
//      pre-migration data would show a student the wrong figures for one frame,
//      then correct them — which reads as a glitch and destroys confidence in
//      every number on the screen.
//
//   2. IT MUST RUN IN A TOP-LEVEL EFFECT, NOT A COMPONENT THAT REMOUNTS.
//      Both migrations are flag-guarded and idempotent, so a second run is
//      harmless — but a page that remounts on every navigation would re-read
//      and re-write storage endlessly for no reason.
//
//   3. STRICTMODE FIRES EFFECTS TWICE IN DEV.
//      The ref guard below makes that a no-op. The migration's own localStorage
//      flags would catch it anyway; the ref just avoids the pointless second
//      pass and keeps the report from flickering.
//
// When this page is replaced by the real one, THIS BLOCK MOVES WITH IT. Losing
// it is invisible in testing — a fresh browser has nothing to migrate — and
// catastrophic for the one group it matters to.
// ═════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';

import { getSettings, runMigrations, setMark, subscribe } from './store';
import { generateForDate } from './generate';
import { getYearResult, statusLine } from './calculate';
import { todayISO } from '@/lib/attendance/datetime';
import type { SafetyBand, Session, SessionStatus } from './types';


/**
 * ⚠ BAND NAME MAPPING.
 *
 * types.ts uses:    safe | warning | danger | critical
 * globals.css uses: safe | watch   | risk   | critical
 *
 * Both vocabularies are reasonable, and renaming either would churn every
 * file, so the translation lives in ONE place — here.
 *
 * Never write `chip-${band}` directly. It silently produces `chip-warning`,
 * which does not exist, and the element renders unstyled with no error.
 */
const BAND_TEXT: Record<SafetyBand, string> = {
  safe: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-orange-600',
  critical: 'text-red-600',
};


export default function AttendancePage() {
  // False on the server AND on the first client render. That equality is the
  // entire hydration fix.
  const [mounted, setMounted] = useState(false);

  // Anything the migration wants the student to know. Empty in the overwhelming
  // majority of cases — a fresh install has nothing to convert.
  const [migrationNotes, setMigrationNotes] = useState<string[]>([]);

  // Re-render on any store write.
  const [, force] = useState(0);

  // StrictMode double-invokes effects in development. Migrations are
  // idempotent and flag-guarded, so this is belt-and-braces rather than
  // load-bearing — but it stops the notes banner appearing twice.
  const migrationsRun = useRef(false);

  useEffect(() => {
    // ---- 1. MIGRATE FIRST. Nothing may read the store before this returns. --
    if (!migrationsRun.current) {
      migrationsRun.current = true;

      try {
        const { v3, v4 } = runMigrations();
        const notes = [...v3.notes, ...v4.notes];
        if (notes.length > 0) setMigrationNotes(notes);
      } catch {
        // A failed migration must never white-screen the app. The student's
        // v2/v3 data is READ, never deleted, so a failure here leaves them on
        // defaults with their old data still recoverable — bad, but survivable.
        // Every other path in store.ts already returns a valid default.
      }
    }

    // ---- 2. Only now is it safe to render real data. -----------------------
    setMounted(true);

    // ---- 3. Subscribe to store changes. ------------------------------------
    return subscribe(() => force((n) => n + 1));
  }, []);

  if (!mounted) return <Skeleton />;

  return (
    <AttendanceContent
      migrationNotes={migrationNotes}
      onDismissNotes={() => setMigrationNotes([])}
    />
  );
}


/**
 * Rendered by the server and by the first client pass. Must contain NO store
 * reads whatsoever — if a single value here came from localStorage, the
 * mismatch would simply move rather than disappear.
 */
function Skeleton() {
  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
      <div className="mt-6 space-y-2">
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
      </div>
    </main>
  );
}


/**
 * Client-only. Everything below this point may read the store freely, because
 * it never renders on the server and never runs before migration.
 */
function AttendanceContent(props: {
  migrationNotes: string[];
  onDismissNotes: () => void;
}) {
  const { migrationNotes, onDismissNotes } = props;

  const settings = getSettings();
  const year = settings.currentYear;
  const today = todayISO();

  const result = getYearResult(year);
  const todaysClasses = generateForDate(year, today);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      {/* ------------------------------------------- migration report ------
          Shown ONCE, when there is something to report.

          A silent conversion is how you lose someone's trust: a student who
          set 80% and finds 75% next week will not conclude "the app migrated
          my data imperfectly" — they will conclude the app is unreliable and
          go back to counting on paper. */}
      {migrationNotes.length > 0 && (
        <div className="mb-4 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-indigo-900">
                Your attendance data was updated
              </p>
              <ul className="mt-1.5 space-y-1">
                {migrationNotes.map((note, i) => (
                  <li key={i} className="text-sm text-indigo-800">
                    - {note}
                  </li>
                ))}
              </ul>
            </div>
            <button
              onClick={onDismissNotes}
              aria-label="Dismiss"
              className="shrink-0 rounded px-2 py-1 text-sm text-indigo-700 hover:bg-indigo-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Temporary page. The week strip, marking list and ring grid are not wired
        in yet — this exists to verify the new calculator.
      </p>

      <h1 className="text-xl font-semibold">{year}</h1>

      {/* ---------------------------------------------- today's classes ---- */}
      <h2 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Today · {today}
      </h2>

      {todaysClasses.length === 0 ? (
        <p className="text-sm text-slate-500">No classes scheduled today.</p>
      ) : (
        <div className="space-y-2">
          {todaysClasses.map((s) => (
            <MarkRow key={s.id} session={s} />
          ))}
        </div>
      )}

      {/* ---- per subject, per type. No pooled numbers anywhere. ---- */}
      <h2 className="mt-8 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Subjects
      </h2>

      {result.subjects.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nothing tracked yet. Add classes in setup.
        </p>
      ) : (
        <div className="space-y-3">
          {result.subjects.map((subject) => (
            <div
              key={subject.subjectId}
              className="rounded-xl border border-slate-200 p-4"
            >
              <div className="flex items-baseline justify-between">
                {/* Ring colour is identity; the LABEL carries safety. */}
                <span className={`font-semibold ${BAND_TEXT[subject.worstBand]}`}>
                  {subject.subjectName}
                </span>
                {subject.isExamSubject && (
                  <span className="text-xs text-slate-400">exam subject</span>
                )}
              </div>

              {subject.categories.map((c) => (
                <div
                  key={c.category}
                  className="mt-3 border-t border-slate-100 pt-3"
                >
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="capitalize text-slate-600">{c.category}</span>
                    <span className="tabular-nums">
                      {c.isEmpty ? '—' : `${c.attended}/${c.conducted}`}
                      {!c.isEmpty && (
                        <span className={`ml-2 font-semibold ${BAND_TEXT[c.band]}`}>
                          {c.percentDisplay}%
                        </span>
                      )}
                      <span className="ml-2 text-xs text-slate-400">
                        needs {c.threshold}%
                        {c.isCustomThreshold ? ' (yours)' : ''}
                      </span>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{statusLine(c)}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}


function MarkRow({ session }: { session: Session }) {
  // Tapping the same button again unmarks. No separate clear control — mis-taps
  // are frequent, so undo must be the most obvious gesture available.
  const mark = (status: SessionStatus) =>
    setMark(session.id, session.status === status ? 'unmarked' : status);

  const btn = (status: SessionStatus, on: string) =>
    `rounded-md border px-3 py-1.5 text-sm font-medium ${
      session.status === status ? on : 'border-slate-200 text-slate-500'
    }`;

  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{session.subjectName}</p>
        <p className="text-xs text-slate-500">
          {session.category} · {session.start}–{session.end}
          {session.weight > 1 && ` · counts as ${session.weight}`}
        </p>
      </div>

      <div className="flex shrink-0 gap-1.5">
        <button
          onClick={() => mark('present')}
          className={btn('present', 'border-emerald-500 bg-emerald-500 text-white')}
        >
          P
        </button>
        <button
          onClick={() => mark('absent')}
          className={btn('absent', 'border-red-500 bg-red-500 text-white')}
        >
          A
        </button>
        <button
          onClick={() => mark('not-conducted')}
          className={`rounded-md border px-2 py-1 text-xs font-medium ${
            session.status === 'not-conducted'
              ? 'border-slate-400 bg-slate-400 text-white'
              : 'border-slate-200 text-slate-400'
          }`}
          title="Cancelled — counts as 0 of 0"
        >
          C
        </button>
      </div>
    </div>
  );
}
