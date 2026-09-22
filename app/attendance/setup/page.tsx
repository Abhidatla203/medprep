'use client';

// =============================================================================
// app/attendance/setup/page.tsx
// -----------------------------------------------------------------------------
// The timetable builder. Four sections, in the order a student needs them:
//
//   1. COLLEGE HOURS   — set once, shapes every time picker afterwards
//   2. WEEKLY CLASSES  — the recurring grid
//   3. POSTINGS        — clinical rotations as date ranges
//   4. YOUR DATA       — carry-forward figures, export, import
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ WHY THERE IS NO PAGE-LEVEL SAVE BUTTON
// ═════════════════════════════════════════════════════════════════════════════
// Every mutation writes to localStorage synchronously and calls notify(). There
// is no draft state held in memory. A "Save changes" button here would call a
// function with an empty body.
//
// What was actually missing was CONFIRMATION — silent success is
// indistinguishable from silent failure. SaveBar fixes that: it flashes a
// timestamped "Saved" on every write, states the resting truth otherwise, and
// offers Done as the real primary action.
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠ THE SHEET LAYOUT FIX
// The class sheet once used `max-h-[85vh] overflow-y-auto` with a
// `sticky bottom-0` footer INSIDE it. Sticky positions against its scroll
// container, so once content grew the footer travelled out of the viewport —
// and the sheet was already at max height, leaving nothing to scroll toward.
// It now uses .sheet from globals.css: flex column, footer as a SIBLING of the
// scroll area. A sibling cannot scroll away with content it does not contain.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
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

/**
 * Category identity. One accent each, as a 3px rail on the row plus a tinted
 * chip. Enough to scan a day at a glance without turning the list into a paint
 * chart.
 */
const CAT: Record<ClassCategory, { rail: string; chip: string; label: string }> = {
  theory: {
    rail: 'bg-[--color-theory]',
    chip: 'bg-[#eef1fe] text-[#3b52c9] border-[#d7ddfb]',
    label: 'Theory',
  },
  practical: {
    rail: 'bg-[--color-practical]',
    chip: 'bg-[--color-safe-soft] text-[--color-safe] border-[--color-safe-line]',
    label: 'Practical',
  },
  clinical: {
    rail: 'bg-[--color-clinical]',
    chip: 'bg-[#f6ebfe] text-[#7c26c9] border-[#e7d2fa]',
    label: 'Clinical',
  },
};


// -----------------------------------------------------------------------------
// Hooks
//
// Every mutation in store.ts calls notify(). useStoreRevision turns that into a
// re-render. Nothing caches a derived value — the page re-reads storage on every
// change, which is what makes a toggle feel instant. (TRAP 5)
// -----------------------------------------------------------------------------

function useStoreRevision(): number {
  const [rev, setRev] = useState(0);
  useEffect(() => subscribe(() => setRev((n) => n + 1)), []);
  return rev;
}

/** Guards hydration mismatch: localStorage does not exist on the server. */
function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}


// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

export default function AttendanceSetupPage() {
  const mounted = useMounted();
  const rev = useStoreRevision();

  const [year, setYear] = useState<AcademicYear>('3rd MBBS Part 2');
  const [hoursOpen, setHoursOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [addForDay, setAddForDay] = useState<DayIndex | null>(null);
  const [editing, setEditing] = useState<{ entry: TimetableEntry; day: DayIndex } | null>(null);
  const [actionsFor, setActionsFor] = useState<{ entry: TimetableEntry; day: DayIndex } | null>(null);

  // Child panels raise this while their own sheets are open, so SaveBar can
  // stand down. Two pinned footers on screen at once looks like a bug.
  const [childSheetOpen, setChildSheetOpen] = useState(false);

  // ---- One-time v2 → v3 migration. Fixes the legacy day index. ----
  useEffect(() => {
    if (!mounted) return;
    const r = migrateV2toV3();
    if (r.ran && r.entriesMigrated > 0) {
      setNote(
        `Imported ${r.entriesMigrated} ${r.entriesMigrated === 1 ? 'class' : 'classes'} from your previous timetable. Day assignments have been corrected.`,
      );
    }
    if (r.targetYear) setYear(r.targetYear);
  }, [mounted]);

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
        const [sh, sm] = e.start.split(':').map(Number);
        const [eh, em] = e.end.split(':').map(Number);
        minutes += Math.max(0, eh * 60 + em - (sh * 60 + sm));
      }
    }
    return { classes, minutes };
  }, [byDay]);

  const closeSheets = useCallback(() => {
    setAddForDay(null);
    setEditing(null);
    setActionsFor(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeSheets();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeSheets]);

  if (!mounted || !settings) {
    return (
      <div className="space-y-4 py-4">
        <div className="h-10 w-56 animate-pulse rounded-xl bg-[--color-surface-sunk]" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-[--radius-card] bg-[--color-surface-sunk]" />
        ))}
      </div>
    );
  }

  const ownSheetOpen = addForDay !== null || editing !== null || actionsFor !== null;

  return (
    <div className="animate-rise pb-24 md:pb-20">
      {/* ------------------------------- Hero ------------------------------- */}
      <header className="aurora mb-8 pt-2">
        <Link
          href="/attendance"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-[--color-ink-muted] transition hover:text-[--color-ink]"
        >
          ← Attendance
        </Link>

        <h1 className="display text-4xl md:text-5xl">Build your timetable</h1>
        <p className="mt-2 max-w-md text-[15px] text-[--color-ink-muted]">
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
        <div className="mb-6 flex items-start gap-3 rounded-[--radius-card] border border-[--color-safe-line] bg-[--color-safe-soft] p-4">
          <span className="text-[--color-safe]" aria-hidden>✓</span>
          <p className="flex-1 text-sm text-[--color-safe]">{note}</p>
          <button
            onClick={() => setNote(null)}
            className="-m-1.5 rounded-lg p-1.5 text-[--color-safe] transition hover:bg-white/60"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* ---------------------------- Year picker --------------------------- */}
      <div className="mb-4">
        <span className="eyebrow mb-2 block">Academic year</span>
        <select
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
        <span className="text-sm text-[--color-ink-faint]">
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
        className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-[--color-surface-sunk]"
      >
        <span>
          <span className="block text-sm font-semibold text-[--color-ink]">College hours</span>
          <span className="mt-0.5 block text-sm text-[--color-ink-muted]">
            {formatTimeRange(cfg.dayStart, cfg.dayEnd)} · {cfg.workingDays.length} days a week
          </span>
        </span>
        <span
          className={`text-[--color-ink-faint] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        >▾</span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-[--color-line] px-5 py-5">
          <div className="grid grid-cols-2 gap-3">
            <L label="Day starts">
              <input
                type="time" className="field tnum" value={cfg.dayStart}
                onChange={(e) => onChange({ dayStart: e.target.value })}
              />
            </L>
            <L label="Day ends">
              <input
                type="time" className="field tnum" value={cfg.dayEnd}
                onChange={(e) => onChange({ dayEnd: e.target.value })}
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
                  className={`seg min-w-[3rem] flex-none px-3 ${cfg.workingDays.includes(d) ? 'seg-on' : ''}`}
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
              <span className="block text-sm font-medium text-[--color-ink]">
                Allow after-hours classes
              </span>
              <span className="mt-0.5 block text-sm text-[--color-ink-muted]">
                An escape hatch for the occasional evening session.
              </span>
            </span>
            <input
              type="checkbox"
              checked={cfg.allowAfterHours}
              onChange={(e) => onChange({ allowAfterHours: e.target.checked })}
              className="mt-0.5 h-6 w-6 shrink-0 rounded-md accent-[--color-brand]"
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

  const minutes = entries.reduce((sum, e) => {
    const [sh, sm] = e.start.split(':').map(Number);
    const [eh, em] = e.end.split(':').map(Number);
    return sum + Math.max(0, eh * 60 + em - (sh * 60 + sm));
  }, 0);

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <div className="flex items-baseline gap-2.5">
          <h3 className="text-[15px] font-semibold text-[--color-ink]">{DAY_NAMES[day]}</h3>
          {entries.length > 0 && (
            <span className="text-sm text-[--color-ink-faint]">{formatDuration(minutes)}</span>
          )}
        </div>
        <button onClick={onAdd} className="btn btn-quiet -mr-2 min-h-10 px-3 text-sm">
          + Add
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-[--color-ink-faint]">No classes</p>
      ) : (
        <ul className="divide-y divide-[--color-line]">
          {entries.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => onSelect(e)}
                className="flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition hover:bg-[--color-surface-sunk]"
              >
                <span className={`h-10 w-[3px] shrink-0 rounded-full ${CAT[e.category].rail}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-[--color-ink]">
                      {e.subjectName || subjectName(e.subjectId)}
                    </span>
                    {e.isAfterHours && (
                      <span className="shrink-0 text-xs text-[--color-watch]" title="After hours">◷</span>
                    )}
                  </span>
                  <span className="tnum mt-0.5 block text-sm text-[--color-ink-muted]">
                    {formatTimeRange(e.start, e.end)}
                    {e.weight > 1 && (
                      <span className="text-[--color-ink-faint]"> · counts as {e.weight}</span>
                    )}
                  </span>
                </span>
                <span className={`chip shrink-0 border ${CAT[e.category].chip}`}>
                  {CAT[e.category].label}
                </span>
              </button>
            </li>
          ))}
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-2xl px-3 pb-3">
        <div className="sheet">
          <div className="sheet-head px-5 pb-4 pt-4">
            <div className="sheet-grip mb-4" aria-hidden />
            <p className="display text-xl">{entry.subjectName || subjectName(entry.subjectId)}</p>
            <p className="tnum mt-1 text-sm text-[--color-ink-muted]">
              {DAY_NAMES[day]} · {formatTimeRange(entry.start, entry.end)} · {CAT[entry.category].label}
            </p>
          </div>

          <div className="sheet-body p-3">
            {confirming ? (
              <>
                <p className="px-2 py-3 text-center text-sm text-[--color-ink-soft]">
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
                  className="btn btn-quiet w-full justify-start px-4 text-[15px] text-[--color-ink]"
                >
                  Edit class
                </button>
                <button
                  onClick={() => setConfirming(true)}
                  className="btn btn-quiet w-full justify-start px-4 text-[15px] text-[--color-critical]"
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
  const [category, setCategory] = useState<ClassCategory>(existing?.category ?? 'theory');
  const [weight, setWeight] = useState(existing?.weight ?? 1);
  const [error, setError] = useState<string | null>(null);

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

  const [start, setStart] = useState<TimeHHMM>(
    () => existing?.start ?? suggestedStartFor(year, day) ?? settings.college.dayStart,
  );

  useEffect(() => {
    if (startOptions.length > 0 && !startOptions.includes(start)) setStart(startOptions[0]);
  }, [startOptions, start]);

  const endOptions = useMemo(
    () => generateEndTimes(start, windowEnd, slot, occupied),
    [start, windowEnd, slot, occupied],
  );

  const [end, setEnd] = useState<TimeHHMM>(existing?.end ?? '');

  useEffect(() => {
    if (endOptions.length > 0 && !endOptions.includes(end)) setEnd(endOptions[0]);
  }, [endOptions, end]);

  const allowedCats = useMemo(
    () => (subjectId ? categoriesForSubject(subjectId) : (['theory'] as ClassCategory[])),
    [subjectId],
  );

  useEffect(() => {
    if (subjectId && !allowedCats.includes(category)) setCategory(allowedCats[0]);
  }, [subjectId, allowedCats, category]);

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
      if (report.suggestedStart) setStart(report.suggestedStart);
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-2xl px-3 pb-3">
        <div className="sheet">
          {/* ---- Header: fixed ---- */}
          <div className="sheet-head px-5 pb-4 pt-4">
            <div className="sheet-grip mb-4" aria-hidden />
            <p className="display text-xl">
              {isEdit ? 'Edit class' : `Add to ${DAY_NAMES[day]}`}
            </p>
          </div>

          {/* ---- Body: the ONLY scrolling region ---- */}
          <div className="sheet-body space-y-5 px-5 py-5">
            {dayFull && (
              <p className="rounded-[--radius-field] border border-[--color-watch-line] bg-[--color-watch-soft] px-4 py-3 text-sm text-[--color-watch]">
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
                      onClick={() => setCategory(c)}
                      aria-pressed={category === c}
                      className={`seg ${category === c ? 'seg-on' : ''}`}
                    >
                      {CAT[c].label}
                    </button>
                  ))}
                </div>
              </L>
            )}

            <div className="grid grid-cols-2 gap-3">
              <L label="Starts">
                <select
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
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
                  onChange={(e) => setEnd(e.target.value)}
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
                />
                <span className="text-sm text-[--color-ink-muted]">
                  {weight === 1 ? 'one class' : `${weight} classes in the register`}
                </span>
              </div>
            </L>

            {settings.college.allowAfterHours && (
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-[--radius-field] border border-[--color-line] bg-[--color-surface-sunk] px-4 py-3">
                <span className="text-sm font-medium text-[--color-ink-soft]">
                  Show times outside college hours
                </span>
                <input
                  type="checkbox"
                  checked={afterHours}
                  onChange={(e) => setAfterHours(e.target.checked)}
                  className="h-6 w-6 shrink-0 rounded-md accent-[--color-brand]"
                />
              </label>
            )}

            {error && (
              <p className="rounded-[--radius-field] border border-[--color-critical-line] bg-[--color-critical-soft] px-4 py-3 text-sm text-[--color-critical]">
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
              className="btn btn-primary flex-[2]"
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

function L(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="eyebrow mb-2 block">{props.label}</span>
      {props.children}
    </div>
  );
}
