'use client';

// =============================================================================
// app/attendance/setup/page.tsx
// -----------------------------------------------------------------------------
// The timetable BUILDER. Four sections, in the order a student needs them:
//
//   1. COLLEGE HOURS   — set once, shapes every time picker afterwards
//   2. WEEKLY CLASSES  — the recurring grid
//   3. POSTINGS        — clinical rotations as date ranges
//   4. YOUR DATA       — carry-forward figures, export, import
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ SETUP vs SETTINGS — THE BOUNDARY. Hold this line.
// ═════════════════════════════════════════════════════════════════════════════
// SETUP describes WHAT YOUR COLLEGE DOES.         → facts. Lives here.
// SETTINGS describes WHAT YOU WANT THE APP TO DO. → preferences. Lives in /settings.
//
// So: hours, working days, the weekly grid, postings, term dates, backups → HERE.
// Thresholds, unmarked policy, extra-class defaults, alerts, theme  → SETTINGS.
//
// This boundary is why the two screens are NOT merged. A builder needs a canvas;
// a preference needs a row in a list. Collapsing either into the other makes
// both worse. MEMORY §3 rule 3, §7 and §14 #4 all flagged this drift.
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠ WHY THERE IS NO PAGE-LEVEL SAVE BUTTON
// Every mutation writes to localStorage synchronously and calls notify(). There
// is no draft state held in memory. A "Save changes" button here would call a
// function with an empty body.
//
// What was actually missing was CONFIRMATION — silent success is
// indistinguishable from silent failure. SaveBar fixes that: it flashes a
// timestamped "Saved" on every write, states the resting truth otherwise, and
// offers Done as the real primary action.
//
// ⚠ THE SHEET LAYOUT FIX
// The class sheet once used `max-h-[85vh] overflow-y-auto` with a
// `sticky bottom-0` footer INSIDE it. Sticky positions against its scroll
// container, so once content grew the footer travelled out of the viewport —
// and the sheet was already at max height, leaving nothing to scroll toward.
// It now uses .sheet from globals.css: flex column, footer as a SIBLING of the
// scroll area. A sibling cannot scroll away with content it does not contain.
//
// ⚠ TAILWIND v4 — THE CLASS THAT WASN'T THERE
// This file was once written almost entirely in `bg-[--color-surface-sunk]`
// style. In Tailwind v4 that arbitrary-value form resolves to NOTHING — no rule
// is generated, the element simply inherits. Every one is now a real theme
// utility (`bg-surface-sunk`, `text-ink-muted`, `border-line`, `rounded-card`),
// matching /attendance/page.tsx. MEMORY §2, and the original cause of the blank
// Present buttons.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ NO setState INSIDE useEffect. ANYWHERE. (SM-4)
// ═════════════════════════════════════════════════════════════════════════════
// React 19's react-hooks/set-state-in-effect rule caught five instances in this
// file. They fell into three groups, each with a different correct answer:
//
//   1. MOUNT GATE and STORE SUBSCRIPTION  → useSyncExternalStore.
//      localStorage is an external store. This hook exists for external stores.
//      It also fixes hydration properly, via a separate server snapshot.
//
//   2. ONE-SHOT MIGRATION  → a module-level function with its own guard.
//      Module scope outlives StrictMode's double invoke, remounts and fast
//      refresh, which is exactly the lifetime a once-per-load job needs.
//
//   3. THE THREE DROPDOWN RESYNCS  → deleted outright; the values are DERIVED.
//      This was the interesting one. The old code stored `start`, `end` and
//      `category` in state, then used an effect to snap them back into range
//      whenever the options list changed. That renders ONCE WITH AN INVALID
//      VALUE and corrects on the next pass — for one frame the Ends dropdown
//      really is showing a time that clashes with another class.
//
//      A value that can always be computed from other values is not state. The
//      pattern now is: keep the student's raw CHOICE in state, and compute the
//      EFFECTIVE value during render by validating that choice against the
//      current options. Correct on the first paint, no effect, no flash, and
//      one fewer way for the picker to disagree with itself.
// ═════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';

import type {
  AcademicYear,
  ClassCategory,
  DayIndex,
  TimeHHMM,
  TimetableEntry,
} from '../types';

import { DAY_NAMES, DAY_NAMES_SHORT } from '../types';

import {
  formatDuration,
  formatTime12h,
  formatTimeRange,
  generateEndTimes,
  generateStartTimes,
  isWithinCollegeHours,
  timeRangesOverlap,
} from '@/lib/attendance/datetime';

import {
  ACADEMIC_YEARS,
  categoriesForSubject,
  selectableSubjectsFor,
  subjectName,
} from '@/lib/attendance/curriculum';

import {
  addTimetableEntry,
  deleteTimetableEntry,
  getEntOphthaInFinalYear,
  getSettings,
  getTimetableStore,
  migrateV2toV3,
  subscribe,
  updateSettings,
  updateTimetableEntry,
} from '../store';

import { occupiedRanges, suggestedStartFor, validateEntry } from '../generate';

import PostingsPanel from './PostingsPanel';
import DataPanel from './DataPanel';
import SaveBar from './SaveBar';


// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** The widened window unlocked by the after-hours escape hatch. */
const AFTER_HOURS_START: TimeHHMM = '06:00';
const AFTER_HOURS_END: TimeHHMM = '23:00';

const ALL_DAYS: DayIndex[] = [0, 1, 2, 3, 4, 5, 6];

const DEFAULT_YEAR: AcademicYear = '3rd MBBS Part 2';

/**
 * CATEGORY IDENTITY — one accent each, as a 3px rail plus a tinted chip.
 *
 * ⚠ WHY HEX AND NOT TOKENS. Two reasons, both learned the hard way:
 *
 *   1. `--color-practical` is THE SAME GREEN as `--color-safe` (#0f9b6c).
 *      The old practical chip therefore read as "this is fine" purely by being
 *      a practical. Colour must mean ONE thing per screen. (MEMORY §8)
 *
 *   2. These three hues already have a canonical definition — they are the ring
 *      arc colours. Setup and the ring grid must agree, or the student learns
 *      two colour languages for the same three words.
 *
 *        theory    #7c3aed  violet
 *        practical #ea580c  orange
 *        clinical  #0891b2  cyan
 *
 * Inline style, not a class, so no build step can silently drop it.
 */
const CAT: Record<
  ClassCategory,
  { hue: string; soft: string; line: string; label: string }
> = {
  theory:    { hue: '#7c3aed', soft: '#f1ecfd', line: '#e0d5fb', label: 'Theory' },
  practical: { hue: '#ea580c', soft: '#fef0e7', line: '#fbd9c2', label: 'Practical' },
  clinical:  { hue: '#0891b2', soft: '#e6f6fa', line: '#c6e9f1', label: 'Clinical' },
};


// -----------------------------------------------------------------------------
// Module-level plumbing
//
// Everything here is deliberately OUTSIDE the components. Module scope survives
// remounts, StrictMode's double-invoke and fast refresh — exactly the lifetime
// a one-shot migration and a store counter need.
// -----------------------------------------------------------------------------

/**
 * Bumped once per store write. useSyncExternalStore compares what getSnapshot
 * returns against the previous value; a change means re-render.
 *
 * ⚠ MUST live out here. As component state it would reset on every remount and
 *   the hook would lose track of what it had already seen.
 */
let setupRevision = 0;

/**
 * ⚠ MUST be a stable reference. Defined inside a component it would be a brand
 *   new function every render, and React would dutifully unsubscribe and
 *   resubscribe each time.
 */
function subscribeToStore(onStoreChange: () => void): () => void {
  return subscribe(() => {
    setupRevision += 1;
    onStoreChange();
  });
}

const getSetupRevision = (): number => setupRevision;

/** The server has no store, so it is forever at revision zero. */
const getServerRevision = (): number => 0;

/**
 * The mount gate, expressed as a store that can never change.
 *
 * A no-op subscribe is correct here, not lazy: this "store" has exactly two
 * states — rendering on the server, rendering on the client — and once mounted
 * it can never transition again. There is nothing to notify anyone about.
 */
const subscribeToNothing = (): (() => void) => () => {};
const getIsClient = (): boolean => true;
const getIsServer = (): boolean => false;

type V2Result = { note: string | null; targetYear: AcademicYear | null };

/**
 * v2 → v3 timetable migration result. `null` means "not attempted yet".
 */
let v2Migration: V2Result | null = null;

/**
 * Runs the v2 → v3 migration at most once per page load, and returns what the
 * student should be told about it.
 *
 * ⚠ SAFE TO CALL DURING RENDER, and that is the whole point — it must happen
 *   before the first getTimetableStore() read, and "the line above it" is the
 *   only ordering guarantee that cannot be accidentally reshuffled. The module
 *   guard means the second and every later call is a property read, never a
 *   storage write.
 */
function ensureV2MigrationHasRun(): V2Result {
  if (v2Migration !== null) return v2Migration;

  // Belt and braces: never touch storage during SSR.
  if (typeof window === 'undefined') return { note: null, targetYear: null };

  try {
    const r = migrateV2toV3();
    v2Migration = {
      note:
        r.ran && r.entriesMigrated > 0
          ? `Imported ${r.entriesMigrated} ${r.entriesMigrated === 1 ? 'class' : 'classes'} from your previous timetable. Day assignments have been corrected.`
          : null,
      targetYear: r.targetYear ?? null,
    };
  } catch {
    // A failed migration must never white-screen the builder. Old data is READ,
    // never deleted, so the student lands on defaults with their data intact.
    v2Migration = { note: null, targetYear: null };
  }

  return v2Migration;
}

/**
 * Minutes between two HH:MM strings, floored at zero.
 *
 * Was written out twice — once for the weekly total, once per day card. Two
 * copies of the same arithmetic is two places for it to drift.
 */
function minutesBetween(start: TimeHHMM, end: TimeHHMM): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

/**
 * Pick the effective value from a list of valid options.
 *
 * This tiny function is what replaced three useEffect blocks. If the student's
 * choice is still valid, honour it; otherwise fall back to the first option.
 * Evaluated during render, so the value shown is ALWAYS legal — there is no
 * intermediate frame holding a stale one.
 */
function resolveChoice<T>(choice: T | null, options: readonly T[], fallback: T): T {
  if (choice !== null && options.includes(choice)) return choice;
  return options[0] ?? fallback;
}


// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------

/**
 * Re-renders on every store write.
 *
 * Nothing caches a derived value — the page re-reads storage on every change,
 * which is what makes a toggle feel instant. (TRAP 5)
 */
function useStoreRevision(): number {
  return useSyncExternalStore(subscribeToStore, getSetupRevision, getServerRevision);
}

/**
 * Guards hydration mismatch: localStorage does not exist on the server.
 *
 * Returns false for the server render AND the first client render — identical
 * markup, so no mismatch — then true from adoption onward, with no extra pass.
 */
function useMounted(): boolean {
  return useSyncExternalStore(subscribeToNothing, getIsClient, getIsServer);
}

/**
 * Locks page scroll while any sheet is open.
 *
 * On a phone, dragging inside an open sheet used to scroll the PAGE behind it —
 * so closing the sheet dumped you somewhere else entirely. globals.css already
 * watches `body[data-modal-open="true"]`; this just raises the flag.
 *
 * ✅ This effect is legitimate: it writes to an external system (the DOM) and
 *    calls no setState. The cleanup removes the attribute unconditionally, so a
 *    component unmounting mid-sheet — a route change, a fast refresh — can
 *    never leave the page permanently frozen.
 */
function useScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    document.body.dataset.modalOpen = 'true';
    return () => {
      delete document.body.dataset.modalOpen;
    };
  }, [locked]);
}


// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

export default function AttendanceSetupPage() {
  const mounted = useMounted();
  const rev = useStoreRevision();

  // ★ Forced to completion before any store read below. On the server this is
  //   a no-op returning nulls; on the client it runs exactly once.
  const migration = ensureV2MigrationHasRun();

  // Lazy initialiser — runs once, and the migration above has already settled,
  // so its targetYear is available immediately.
  const [year, setYear] = useState<AcademicYear>(
    () => ensureV2MigrationHasRun().targetYear ?? DEFAULT_YEAR,
  );

  const [hoursOpen, setHoursOpen] = useState(false);

  // The migration note shows until dismissed. Dismissal is a user action, so
  // this setState lives in an event handler, where setState belongs.
  const [noteDismissed, setNoteDismissed] = useState(false);
  const note = !noteDismissed ? migration.note : null;

  const [addForDay, setAddForDay] = useState<DayIndex | null>(null);
  const [editing, setEditing] = useState<{ entry: TimetableEntry; day: DayIndex } | null>(null);
  const [actionsFor, setActionsFor] = useState<{ entry: TimetableEntry; day: DayIndex } | null>(null);

  // Child panels raise this while their own sheets are open, so SaveBar can
  // stand down. Two pinned footers on screen at once looks like a bug.
  const [childSheetOpen, setChildSheetOpen] = useState(false);

  const ownSheetOpen = addForDay !== null || editing !== null || actionsFor !== null;

  // ⚠ Hooks must run in the same order on every render, so this sits ABOVE the
  //   skeleton's early return, never below it.
  useScrollLock(ownSheetOpen || childSheetOpen);

  const settings = useMemo(() => {
    void rev;
    return mounted ? getSettings() : null;
  }, [mounted, rev]);

  const byDay = useMemo(() => {
    void rev;
    return mounted ? getTimetableStore()[year] ?? {} : {};
  }, [mounted, rev, year]);

  const visibleDays = useMemo(() => {
    if (!settings) return ALL_DAYS.slice(0, 6);
    const wd = [...settings.college.workingDays].sort((a, b) => a - b);
    return wd.length > 0 ? wd : ALL_DAYS.slice(0, 6);
  }, [settings]);

  const totals = useMemo(() => {
    let classes = 0;
    let minutes = 0;
    for (const list of Object.values(byDay)) {
      for (const e of list ?? []) {
        classes += 1;
        minutes += minutesBetween(e.start, e.end);
      }
    }
    return { classes, minutes };
  }, [byDay]);

  const closeSheets = useCallback(() => {
    setAddForDay(null);
    setEditing(null);
    setActionsFor(null);
  }, []);

  // ✅ Legitimate effect: subscribes to an external system (the keyboard) and
  //    only ever calls setState from inside the callback, never in the body.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheets();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeSheets]);

  if (!mounted || !settings) {
    return (
      <div className="space-y-4 py-4">
        <div className="h-10 w-56 animate-pulse rounded-xl bg-surface-sunk" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-card bg-surface-sunk" />
        ))}
      </div>
    );
  }

  return (
    <div className="animate-rise pb-24 md:pb-20">
      {/* ------------------------------- Hero ------------------------------- */}
      <header className="aurora mb-8 pt-2">
        <Link
          href="/attendance"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink"
        >
          ← Attendance
        </Link>

        <h1 className="display text-4xl md:text-5xl">Build your timetable</h1>
        <p className="mt-2 max-w-md text-[15px] text-ink-muted">
          Add each class once. Everything after that is a single tap a day.
        </p>

        {totals.classes > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="chip chip-brand">
              <span className="tnum">{totals.classes}</span>{' '}
              {totals.classes === 1 ? 'class' : 'classes'} a week
            </span>
            <span className="chip chip-neutral">
              {formatDuration(totals.minutes)} of contact time
            </span>
          </div>
        )}
      </header>

      {note && (
        <div
          role="status"
          aria-live="polite"
          className="mb-6 flex items-start gap-3 rounded-card border border-safe-line bg-safe-soft p-4"
        >
          <span className="text-safe" aria-hidden>✓</span>
          <p className="flex-1 text-sm text-safe">{note}</p>
          <button
            onClick={() => setNoteDismissed(true)}
            className="-m-1.5 rounded-lg p-1.5 text-safe transition hover:bg-white/60"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* ---------------------------- Year picker --------------------------- */}
      <div className="mb-4">
        <label className="eyebrow mb-2 block" htmlFor="setup-year">
          Academic year
        </label>
        <select
          id="setup-year"
          value={year}
          onChange={(e) => setYear(e.target.value as AcademicYear)}
          className="field field-select font-medium"
        >
          {ACADEMIC_YEARS.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* --------------------------- College hours -------------------------- */}
      <HoursCard
        open={hoursOpen}
        onToggle={() => setHoursOpen((v) => !v)}
        cfg={settings.college}
        onChange={(patch) => updateSettings({ college: { ...settings.college, ...patch } })}
      />

      {/* --------------------------- Weekly classes ------------------------- */}
      <div className="mb-3 mt-8 flex items-baseline justify-between">
        <h2 className="eyebrow">Weekly classes</h2>
        <span className="text-sm text-ink-faint">
          {totals.classes === 0 ? 'Nothing yet' : `${totals.classes} total`}
        </span>
      </div>

      <div className="space-y-2.5">
        {visibleDays.map((day) => (
          <DayCard
            key={day}
            day={day}
            entries={byDay[`${day}`] ?? []}
            onAdd={() => { closeSheets(); setAddForDay(day); }}
            onSelect={(entry) => { closeSheets(); setActionsFor({ entry, day }); }}
          />
        ))}
      </div>

      <PostingsPanel year={year} revision={rev} onSheetChange={setChildSheetOpen} />
      <DataPanel year={year} revision={rev} onSheetChange={setChildSheetOpen} />

      {/* ------------------------ Pointer to settings -----------------------
          The boundary made visible. A student who came here hunting for "75%"
          should find out where it actually lives, not conclude the app cannot
          do it. This single line is what stops setup slowly absorbing
          preferences all over again. */}
      <p className="mt-8 text-center text-sm text-ink-faint">
        Looking for attendance targets?{' '}
        <Link href="/settings" className="font-medium text-ink-muted underline underline-offset-2">
          They live in Settings
        </Link>
        .
      </p>

      {/* --------------------------- Save status bar ------------------------ */}
      <SaveBar revision={rev} hidden={ownSheetOpen || childSheetOpen} />

      {/* ------------------------------ Sheets ------------------------------ */}
      {actionsFor && (
        <ActionSheet
          entry={actionsFor.entry}
          day={actionsFor.day}
          onEdit={() => { const t = actionsFor; setActionsFor(null); setEditing(t); }}
          onDelete={() => { deleteTimetableEntry(year, actionsFor.entry.id); setActionsFor(null); }}
          onClose={() => setActionsFor(null)}
        />
      )}

      {(addForDay !== null || editing !== null) && (
        <ClassSheet
          // ★ key: forces a fresh component per class, so every piece of state
          //   inside starts from the right entry. Without it, opening Edit on
          //   one class straight after another would reuse the previous values
          //   — the classic "the form remembered the last thing" bug.
          key={editing ? `edit-${editing.entry.id}` : `add-${addForDay}`}
          year={year}
          day={editing ? editing.day : (addForDay as DayIndex)}
          existing={editing?.entry ?? null}
          onClose={closeSheets}
        />
      )}
    </div>
  );
}


// -----------------------------------------------------------------------------
// College hours
// -----------------------------------------------------------------------------

type HoursConfig = {
  dayStart: TimeHHMM;
  dayEnd: TimeHHMM;
  workingDays: DayIndex[];
  slotMinutes: 15 | 30 | 60;
  allowAfterHours: boolean;
};

function HoursCard(props: {
  open: boolean;
  onToggle: () => void;
  cfg: HoursConfig;
  onChange: (patch: Partial<HoursConfig>) => void;
}) {
  const { open, onToggle, cfg, onChange } = props;

  const toggleDay = (day: DayIndex) => {
    const next = cfg.workingDays.includes(day)
      ? cfg.workingDays.filter((d) => d !== day)
      : [...cfg.workingDays, day].sort((a, b) => a - b);
    // Never allow zero working days — the grid would vanish with no way back.
    if (next.length === 0) return;
    onChange({ workingDays: next });
  };

  return (
    <section className="card overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-surface-sunk"
      >
        <span>
          <span className="block text-sm font-semibold text-ink">College hours</span>
          <span className="mt-0.5 block text-sm text-ink-muted">
            {formatTimeRange(cfg.dayStart, cfg.dayEnd)} · {cfg.workingDays.length} days a week
          </span>
        </span>
        <span
          className={`text-ink-faint transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        >▾</span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-line px-5 py-5">
          <div className="grid grid-cols-2 gap-3">
            <L label="Day starts">
              <input
                type="time"
                className="field tnum"
                value={cfg.dayStart}
                onChange={(e) => onChange({ dayStart: e.target.value as TimeHHMM })}
              />
            </L>
            <L label="Day ends">
              <input
                type="time"
                className="field tnum"
                value={cfg.dayEnd}
                onChange={(e) => onChange({ dayEnd: e.target.value as TimeHHMM })}
              />
            </L>
          </div>

          <L label="Working days">
            <div className="flex flex-wrap gap-2">
              {ALL_DAYS.map((d) => (
                <button
                  key={d}
                  onClick={() => toggleDay(d)}
                  aria-pressed={cfg.workingDays.includes(d)}
                  className={`seg min-w-12 flex-none px-3 ${cfg.workingDays.includes(d) ? 'seg-on' : ''}`}
                >
                  {DAY_NAMES_SHORT[d]}
                </button>
              ))}
            </div>
          </L>

          <L label="Time steps">
            <div className="flex gap-2">
              {([15, 30, 60] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onChange({ slotMinutes: m })}
                  aria-pressed={cfg.slotMinutes === m}
                  className={`seg ${cfg.slotMinutes === m ? 'seg-on' : ''}`}
                >
                  {m} min
                </button>
              ))}
            </div>
          </L>

          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium text-ink">
                Allow after-hours classes
              </span>
              <span className="mt-0.5 block text-sm text-ink-muted">
                An escape hatch for the occasional evening session.
              </span>
            </span>
            <input
              type="checkbox"
              checked={cfg.allowAfterHours}
              onChange={(e) => onChange({ allowAfterHours: e.target.checked })}
              className="mt-0.5 h-6 w-6 shrink-0 rounded-md accent-brand"
            />
          </label>
        </div>
      )}
    </section>
  );
}


// -----------------------------------------------------------------------------
// One day
// -----------------------------------------------------------------------------

function DayCard(props: {
  day: DayIndex;
  entries: TimetableEntry[];
  onAdd: () => void;
  onSelect: (e: TimetableEntry) => void;
}) {
  const { day, entries, onAdd, onSelect } = props;

  const minutes = entries.reduce((sum, e) => sum + minutesBetween(e.start, e.end), 0);

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <div className="flex items-baseline gap-2.5">
          <h3 className="text-[15px] font-semibold text-ink">{DAY_NAMES[day]}</h3>
          {entries.length > 0 && (
            <span className="text-sm text-ink-faint">{formatDuration(minutes)}</span>
          )}
        </div>
        <button
          onClick={onAdd}
          className="btn btn-quiet -mr-2 min-h-10 px-3 text-sm"
          aria-label={`Add a class to ${DAY_NAMES[day]}`}
        >
          + Add
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-ink-faint">No classes</p>
      ) : (
        <ul className="divide-y divide-line">
          {entries.map((e) => {
            const cat = CAT[e.category];
            return (
              <li key={e.id}>
                <button
                  onClick={() => onSelect(e)}
                  className="flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition hover:bg-surface-sunk"
                >
                  {/* Category rail. Inline hex so no build step can drop it.
                      ⚠ w-0.75 is 3px only while the spacing scale stays on a
                        4px base — if that ever changes, these rails silently
                        change width. Logged as SM-5. */}
                  <span
                    className="h-10 w-0.75 shrink-0 rounded-full"
                    style={{ backgroundColor: cat.hue }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {e.subjectName || subjectName(e.subjectId)}
                      </span>
                      {e.isAfterHours && (
                        <span className="shrink-0 text-xs text-watch" title="After hours">◷</span>
                      )}
                    </span>
                    <span className="tnum mt-0.5 block text-sm text-ink-muted">
                      {formatTimeRange(e.start, e.end)}
                      {e.weight > 1 && (
                        <span className="text-ink-faint"> · counts as {e.weight}</span>
                      )}
                    </span>
                  </span>
                  <span
                    className="chip shrink-0 border"
                    style={{
                      backgroundColor: cat.soft,
                      borderColor: cat.line,
                      color: cat.hue,
                    }}
                  >
                    {cat.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}


// -----------------------------------------------------------------------------
// Action sheet
// -----------------------------------------------------------------------------

function ActionSheet(props: {
  entry: TimetableEntry;
  day: DayIndex;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { entry, day, onEdit, onDelete, onClose } = props;
  const [confirming, setConfirming] = useState(false);

  const title = entry.subjectName || subjectName(entry.subjectId);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-2xl px-3 pb-3">
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-label={`Options for ${title}`}
        >
          <div className="sheet-head px-5 pb-4 pt-4">
            <div className="sheet-grip mb-4" aria-hidden />
            <p className="display text-xl">{title}</p>
            <p className="tnum mt-1 text-sm text-ink-muted">
              {DAY_NAMES[day]} · {formatTimeRange(entry.start, entry.end)} · {CAT[entry.category].label}
            </p>
          </div>

          <div className="sheet-body p-3">
            {confirming ? (
              <>
                <p className="px-2 py-3 text-center text-sm text-ink-soft">
                  Remove this class from every week?
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirming(false)} className="btn btn-ghost flex-1">Keep</button>
                  <button onClick={onDelete} className="btn btn-danger flex-1">Remove</button>
                </div>
              </>
            ) : (
              <>
                <button
                  onClick={onEdit}
                  className="btn btn-quiet w-full justify-start px-4 text-[15px] text-ink"
                >
                  Edit class
                </button>
                <button
                  onClick={() => setConfirming(true)}
                  className="btn btn-quiet w-full justify-start px-4 text-[15px] text-critical"
                >
                  Remove
                </button>
              </>
            )}
          </div>

          <div className="sheet-foot p-3">
            <button onClick={onClose} className="btn btn-ghost w-full">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}


// -----------------------------------------------------------------------------
// Add / edit class sheet
//
// ★ THE DERIVED-VALUE PATTERN. Read this before changing anything below.
//
// Four things the student picks — subject, type, start, end — are not four
// independent choices. They form a chain:
//
//     subject  →  which types are allowed
//     day+hours →  which starts are free
//     start     →  which ends are legal
//
// Change a link and everything downstream may become invalid. The old code held
// all four in state and used effects to repair them after the fact. That is a
// render with bad data followed by a correction.
//
// Now: state holds the student's RAW CHOICE (which may be stale, and may be
// null meaning "hasn't chosen"). The EFFECTIVE value is computed on every
// render by checking that choice against the current options. Nothing can ever
// paint an invalid time, because an invalid time never becomes a value.
// -----------------------------------------------------------------------------

function ClassSheet(props: {
  year: AcademicYear;
  day: DayIndex;
  existing: TimetableEntry | null;
  onClose: () => void;
}) {
  const { year, day, existing, onClose } = props;
  const isEdit = existing !== null;

  const settings = getSettings();
  const slot = settings.college.slotMinutes;

  const [afterHours, setAfterHours] = useState(existing?.isAfterHours ?? false);
  const [subjectId, setSubjectId] = useState(existing?.subjectId ?? '');
  const [weight, setWeight] = useState(existing?.weight ?? 1);
  const [error, setError] = useState<string | null>(null);

  // ---- Raw choices. `null` means "the student has not overridden this". ----
  const [startChoice, setStartChoice] = useState<TimeHHMM | null>(existing?.start ?? null);
  const [endChoice, setEndChoice] = useState<TimeHHMM | null>(existing?.end ?? null);
  const [categoryChoice, setCategoryChoice] = useState<ClassCategory | null>(
    existing?.category ?? null,
  );

  const subjects = useMemo(
    () => selectableSubjectsFor(year, settings.examSubjectsByYear, getEntOphthaInFinalYear()),
    [year, settings.examSubjectsByYear],
  );

  const occupied = useMemo(
    () => occupiedRanges(getTimetableStore()[year] ?? {}, day, existing?.id),
    [year, day, existing?.id],
  );

  const windowStart = afterHours ? AFTER_HOURS_START : settings.college.dayStart;
  const windowEnd = afterHours ? AFTER_HOURS_END : settings.college.dayEnd;

  /** Occupied starts are removed entirely — invisible, not disabled. */
  const startOptions = useMemo(() => {
    return generateStartTimes(windowStart, windowEnd, slot).filter((t) => {
      const probe = generateEndTimes(t, windowEnd, slot, [])[0];
      if (!probe) return false;
      return !occupied.some((o) => timeRangesOverlap(t, probe, o.start, o.end));
    });
  }, [windowStart, windowEnd, slot, occupied]);

  /**
   * The suggested start is only a default — it applies when the student has
   * made no choice of their own and there is no existing entry.
   */
  const suggested = useMemo(
    () => suggestedStartFor(year, day) ?? settings.college.dayStart,
    [year, day, settings.college.dayStart],
  );

  // ---- DERIVED. Valid by construction, on the very first render. ----
  const start = resolveChoice(startChoice ?? suggested, startOptions, settings.college.dayStart);

  const endOptions = useMemo(
    () => generateEndTimes(start, windowEnd, slot, occupied),
    [start, windowEnd, slot, occupied],
  );

  const end = resolveChoice(endChoice, endOptions, '' as TimeHHMM);

  const allowedCats = useMemo(
    () => (subjectId ? categoriesForSubject(subjectId) : (['theory'] as ClassCategory[])),
    [subjectId],
  );

  const category = resolveChoice(categoryChoice, allowedCats, 'theory');

  const dayFull = startOptions.length === 0 && !isEdit;

  const handleSave = () => {
    setError(null);
    if (!subjectId) return setError('Choose a subject.');
    if (!start || !end) return setError('Choose a start and end time.');

    const outside = !isWithinCollegeHours(
      start, end, settings.college.dayStart, settings.college.dayEnd,
    );

    const report = validateEntry(year, day, {
      subjectId, category, start, end,
      isAfterHours: outside,
      excludeEntryId: existing?.id,
    });

    if (report.hasConflict) {
      setError(report.message);
      // ⚠ Only takes effect if the suggestion is itself a free slot — which is
      //   the only kind validateEntry ever returns. If that ever changes, the
      //   derived resolver falls back to the first free start rather than
      //   showing something impossible.
      if (report.suggestedStart) setStartChoice(report.suggestedStart);
      return;
    }

    const payload = {
      subjectId,
      subjectName: subjectName(subjectId),
      category, start, end,
      weight: weight > 0 ? weight : 1,
      isAfterHours: outside,
    };

    if (isEdit && existing) updateTimetableEntry(year, existing.id, payload, day);
    else addTimetableEntry(year, day, payload);

    onClose();
  };

  const heading = isEdit ? 'Edit class' : `Add to ${DAY_NAMES[day]}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-2xl px-3 pb-3">
        <div className="sheet" role="dialog" aria-modal="true" aria-label={heading}>
          {/* ---- Header: fixed ---- */}
          <div className="sheet-head px-5 pb-4 pt-4">
            <div className="sheet-grip mb-4" aria-hidden />
            <p className="display text-xl">{heading}</p>
          </div>

          {/* ---- Body: the ONLY scrolling region ---- */}
          <div className="sheet-body space-y-5 px-5 py-5">
            {dayFull && (
              <p className="rounded-field border border-watch-line bg-watch-soft px-4 py-3 text-sm text-watch">
                {DAY_NAMES[day]} is full within college hours. Extend your hours, or
                switch on after-hours below.
              </p>
            )}

            <L label="Subject">
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="field field-select"
              >
                <option value="">Choose a subject…</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </L>

            {subjectId && (
              <L label="Type">
                <div className="flex gap-2">
                  {allowedCats.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCategoryChoice(c)}
                      aria-pressed={category === c}
                      className={`seg ${category === c ? 'seg-on' : ''}`}
                    >
                      {CAT[c].label}
                    </button>
                  ))}
                </div>
              </L>
            )}

            {/* ⚠ These two selects are CONTROLLED BY DERIVED VALUES, not by
                state. `value={start}` is the resolved, always-legal time;
                onChange records the raw choice. If the options list shifts
                underneath — because the student toggled after-hours, or the
                start moved — the resolver silently drops an invalid pick on
                the very next render. No effect, no flash of a clashing time. */}
            <div className="grid grid-cols-2 gap-3">
              <L label="Starts">
                <select
                  value={start}
                  onChange={(e) => setStartChoice(e.target.value as TimeHHMM)}
                  className="field field-select tnum"
                >
                  {startOptions.map((t) => (
                    <option key={t} value={t}>{formatTime12h(t)}</option>
                  ))}
                </select>
              </L>
              <L label="Ends">
                <select
                  value={end}
                  onChange={(e) => setEndChoice(e.target.value as TimeHHMM)}
                  className="field field-select tnum"
                >
                  {endOptions.map((t) => (
                    <option key={t} value={t}>{formatTime12h(t)}</option>
                  ))}
                </select>
              </L>
            </div>

            <L label="Counts as">
              <div className="flex items-center gap-3">
                <input
                  type="number" min={1} max={12} inputMode="numeric"
                  value={weight}
                  onChange={(e) => setWeight(Math.max(1, Number(e.target.value) || 1))}
                  className="field tnum w-24"
                  aria-label="How many classes this counts as in the register"
                />
                <span className="text-sm text-ink-muted">
                  {weight === 1 ? 'one class' : `${weight} classes in the register`}
                </span>
              </div>
            </L>

            {settings.college.allowAfterHours && (
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-field border border-line bg-surface-sunk px-4 py-3">
                <span className="text-sm font-medium text-ink-soft">
                  Show times outside college hours
                </span>
                <input
                  type="checkbox"
                  checked={afterHours}
                  onChange={(e) => setAfterHours(e.target.checked)}
                  className="h-6 w-6 shrink-0 rounded-md accent-brand"
                />
              </label>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-field border border-critical-line bg-critical-soft px-4 py-3 text-sm text-critical"
              >
                {error}
              </p>
            )}
          </div>

          {/* ---- Footer: SIBLING of the scroll area. Cannot scroll away. ---- */}
          <div className="sheet-foot flex gap-2 p-3">
            <button onClick={onClose} className="btn btn-ghost flex-1">Cancel</button>
            <button
              onClick={handleSave}
              disabled={!subjectId || !start || !end}
              className="btn btn-primary flex-2"
            >
              {isEdit ? 'Save changes' : 'Add class'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// -----------------------------------------------------------------------------
// Shared label
// -----------------------------------------------------------------------------

function L(props: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="eyebrow mb-2 block">{props.label}</span>
      {props.children}
    </div>
  );
}
