'use client';

// =============================================================================
// app/attendance/setup/DataPanel.tsx
// -----------------------------------------------------------------------------
// Three jobs:
//
//   1. PICK UP WHERE YOU LEFT OFF — opening balances for a mid-year start
//   2. EXPORT — a JSON backup of everything
//   3. IMPORT — the same file back
//
// WHY OPENING BALANCE RATHER THAN FAKE SESSIONS
//   The obvious implementation generates 50 past sessions and marks 34 present.
//   That is wrong: those sessions never existed, they would appear in history,
//   and editing the timetable would silently reshuffle them. An opening balance
//   is two integers added at calculation time. It cannot drift.
//
// ⚠ TRAP 2 — an excluded subject's opening balance is ignored along with its
//   sessions. That rule lives in calculate.ts and is not duplicated here.
//
// REBUILD v4 — three changes from the previous version:
//
//   1. TRANSFER NOW USES THE STORE'S OWN BACKUP FUNCTIONS.
//      The old bundle re-created every timetable row through addTimetableEntry(),
//      which mints FRESH ids. Marks are keyed by session id, which derives from
//      the parent entry id — so a student could import their own backup and
//      watch a year of attendance detach itself. exportBackup/importBackup write
//      the stores verbatim, ids intact, and marks survive.
//
//   2. NO DEPENDENCY ON calculate.ts. Display rounding is local. This file must
//      not care how the calculator works, and must not break while it is rewritten.
//
//   3. THRESHOLDS ARE PER SUBJECT PER TYPE. The balance preview shows the
//      threshold that actually applies, not a single global target.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  AcademicYear,
  ClassCategory,
  SubjectId,
} from '../types';

import {
  ACADEMIC_YEARS,
  categoriesForSubject,
  selectableSubjectsFor,
  subjectName,
} from '@/lib/attendance/curriculum';

import {
  exportBackupJSON,
  getEntOphthaInFinalYear,
  getMarks,
  getOpeningBalance,
  getPostings,
  getThreshold,
  getTimetableStore,
  hasCustomThreshold,
  importBackup,
  setOpeningBalance,
} from '../store';


const CATEGORY_LABEL: Record<ClassCategory, string> = {
  theory: 'Theory',
  practical: 'Practical',
  clinical: 'Clinical',
};

/**
 * DISPLAY ONLY. One decimal, for eyeballs.
 *
 * ⚠ Never feed this into a comparison. v3 rounded first, so 74.96% became 75.0,
 *   scored "safe", and told a student below the line they needed zero classes.
 *   Decisions use the exact ratio; this exists purely to be read.
 */
function displayPercent(attended: number, conducted: number): string {
  if (conducted <= 0) return '—';
  return (Math.round((attended / conducted) * 1000) / 10).toFixed(1);
}

interface Balance {
  conducted: number;
  attended: number;
}


export default function DataPanel(props: {
  year: AcademicYear;
  revision: number;
  onSheetChange?: (open: boolean) => void;
}) {
  const { year, revision, onSheetChange } = props;
  const [sheet, setSheet] = useState<'balance' | 'transfer' | null>(null);

  useEffect(() => {
    onSheetChange?.(sheet !== null);
  }, [sheet, onSheetChange]);

  const balanceCount = useMemo(() => {
    void revision; // recount whenever the store changes
    let n = 0;
    for (const s of selectableSubjectsFor(year, undefined, getEntOphthaInFinalYear())) {
      for (const c of categoriesForSubject(s.id)) {
        const b = getOpeningBalance(year, s.id, c);
        if (b && b.conducted > 0) n += 1;
      }
    }
    return n;
  }, [year, revision]);

  return (
    <section className="mt-8">
      <h2 className="eyebrow mb-3">Your data</h2>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <button
          onClick={() => setSheet('balance')}
          className="card card-interactive flex items-start gap-3 p-4 text-left"
        >
          <span className="chip chip-brand mt-0.5 shrink-0">↩</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[--color-ink]">
              Pick up where you left off
            </span>
            <span className="mt-0.5 block text-sm text-[--color-ink-muted]">
              {balanceCount === 0
                ? 'Already part-way through the year? Enter your current figures.'
                : `${balanceCount} ${balanceCount === 1 ? 'entry' : 'entries'} carried forward`}
            </span>
          </span>
        </button>

        <button
          onClick={() => setSheet('transfer')}
          className="card card-interactive flex items-start gap-3 p-4 text-left"
        >
          <span className="chip chip-neutral mt-0.5 shrink-0">⇄</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[--color-ink]">
              Export &amp; import
            </span>
            <span className="mt-0.5 block text-sm text-[--color-ink-muted]">
              Back up everything, or move it to another device.
            </span>
          </span>
        </button>
      </div>

      {sheet === 'balance' && (
        <OpeningBalanceSheet year={year} onClose={() => setSheet(null)} />
      )}
      {sheet === 'transfer' && <TransferSheet onClose={() => setSheet(null)} />}
    </section>
  );
}


// =============================================================================
// Opening balance
// =============================================================================

function OpeningBalanceSheet(props: { year: AcademicYear; onClose: () => void }) {
  const { year, onClose } = props;

  const subjects = useMemo(
    () => selectableSubjectsFor(year, undefined, getEntOphthaInFinalYear()),
    [year],
  );

  const [subjectId, setSubjectId] = useState<SubjectId>(subjects[0]?.id ?? '');
  const [category, setCategory] = useState<ClassCategory>('theory');
  const [mode, setMode] = useState<'counts' | 'percent'>('counts');

  const [conducted, setConducted] = useState('');
  const [attended, setAttended] = useState('');
  const [percent, setPercent] = useState('');

  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cats = useMemo(
    () => (subjectId ? categoriesForSubject(subjectId) : (['theory'] as ClassCategory[])),
    [subjectId],
  );

  // Keep the selected category legal when the subject changes. A clinical
  // subject has no practical, and a stale selection would silently write a
  // balance into a category that will never be displayed.
  useEffect(() => {
    if (cats.length > 0 && !cats.includes(category)) setCategory(cats[0]);
  }, [cats, category]);

  const existing: Balance | null = useMemo(
    () => (subjectId ? getOpeningBalance(year, subjectId, category) : null),
    [year, subjectId, category, saved],
  );

  /** The threshold that actually applies here — resolved override or default. */
  const threshold = useMemo(
    () => (subjectId ? getThreshold(year, subjectId, category) : 75),
    [year, subjectId, category],
  );

  const isCustom = useMemo(
    () => (subjectId ? hasCustomThreshold(year, subjectId, category) : false),
    [year, subjectId, category],
  );

  /**
   * Percent mode derives attended from a percentage, rounded to a whole class —
   * you cannot have attended 34.4 lectures. The derived figure is shown back so
   * the student can sanity-check it before committing.
   */
  const derived = useMemo(() => {
    const total = Number(conducted);
    if (mode === 'counts') {
      const att = Number(attended);
      if (!Number.isFinite(total) || !Number.isFinite(att) || total <= 0) return null;
      return {
        conducted: Math.floor(total),
        attended: Math.floor(att),
        isEstimate: false,
      };
    }
    const pct = Number(percent);
    if (!Number.isFinite(total) || !Number.isFinite(pct) || total <= 0) return null;
    return {
      conducted: Math.floor(total),
      attended: Math.round((Math.min(100, Math.max(0, pct)) / 100) * Math.floor(total)),
      isEstimate: true,
    };
  }, [mode, conducted, attended, percent]);

  const handleSave = () => {
    setError(null);
    setSaved(null);

    if (!subjectId) return setError('Choose a subject.');
    if (!derived) return setError('Enter how many classes were conducted.');
    if (derived.conducted <= 0) return setError('Classes conducted must be more than zero.');
    if (derived.attended < 0) return setError('Attended cannot be negative.');
    if (derived.attended > derived.conducted) {
      return setError('Attended cannot be more than conducted.');
    }

    // ⚠ TRAP 10 — this REPLACES the figures for this exact
    //   year + subject + category. It never adds to them.
    setOpeningBalance(year, subjectId, category, {
      conducted: derived.conducted,
      attended: derived.attended,
      isEstimate: derived.isEstimate,
    });

    setSaved(
      `${subjectName(subjectId)} ${CATEGORY_LABEL[category]} — ${derived.attended}/${derived.conducted} (${displayPercent(derived.attended, derived.conducted)}%)`,
    );
    setConducted('');
    setAttended('');
    setPercent('');
  };

  return (
    <Sheet
      title="Pick up where you left off"
      onClose={onClose}
      onSave={handleSave}
      saveLabel="Add balance"
    >
      <p className="rounded-[--radius-field] border border-[--color-brand-line] bg-[--color-brand-soft] px-4 py-3 text-sm text-[--color-brand-ink]">
        Enter what your college register says today. Everything you mark from now
        on is added on top — nothing you type here appears as a fake class.
      </p>

      <L label="Subject">
        <select
          className="field field-select"
          value={subjectId}
          onChange={(e) => { setSubjectId(e.target.value); setSaved(null); }}
        >
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </L>

      <L label="Type">
        <div className="flex gap-2">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => { setCategory(c); setSaved(null); }}
              aria-pressed={category === c}
              className={`seg ${category === c ? 'seg-on' : ''}`}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </L>

      {existing && existing.conducted > 0 && (
        <div className="flex items-center justify-between rounded-[--radius-field] border border-[--color-line] bg-[--color-surface-sunk] px-4 py-3">
          <span className="text-sm text-[--color-ink-soft]">
            Already carried forward:{' '}
            <span className="tnum font-semibold text-[--color-ink]">
              {existing.attended}/{existing.conducted}
            </span>
          </span>
          <button
            onClick={() => {
              setOpeningBalance(year, subjectId, category, { conducted: 0, attended: 0 });
              setSaved(`Cleared ${subjectName(subjectId)} ${CATEGORY_LABEL[category]}.`);
            }}
            className="btn btn-quiet min-h-9 px-2 text-sm"
          >
            Clear
          </button>
        </div>
      )}

      <L label="Enter as">
        <div className="flex gap-2">
          <button
            onClick={() => setMode('counts')}
            aria-pressed={mode === 'counts'}
            className={`seg ${mode === 'counts' ? 'seg-on' : ''}`}
          >
            Class counts
          </button>
          <button
            onClick={() => setMode('percent')}
            aria-pressed={mode === 'percent'}
            className={`seg ${mode === 'percent' ? 'seg-on' : ''}`}
          >
            Percentage
          </button>
        </div>
      </L>

      <div className="grid grid-cols-2 gap-3">
        <L label="Classes conducted">
          <input
            type="number" min={0} inputMode="numeric" placeholder="50"
            className="field tnum" value={conducted}
            onChange={(e) => setConducted(e.target.value)}
          />
        </L>
        {mode === 'counts' ? (
          <L label="Classes attended">
            <input
              type="number" min={0} inputMode="numeric" placeholder="34"
              className="field tnum" value={attended}
              onChange={(e) => setAttended(e.target.value)}
            />
          </L>
        ) : (
          <L label="Current percentage">
            <input
              type="number" min={0} max={100} inputMode="decimal" placeholder="68"
              className="field tnum" value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </L>
        )}
      </div>

      {derived && derived.conducted > 0 && (
        <div className="rounded-[--radius-field] border border-[--color-line] bg-[--color-surface-sunk] px-4 py-3 text-sm text-[--color-ink-soft]">
          <p>
            Recording{' '}
            <span className="tnum font-semibold text-[--color-ink]">
              {derived.attended} of {derived.conducted}
            </span>{' '}
            — {displayPercent(derived.attended, derived.conducted)}%
          </p>
          <p className="mt-1 text-[--color-ink-muted]">
            {CATEGORY_LABEL[category]} needs {threshold}%
            {isCustom ? ' (your setting)' : ' (default)'}.
          </p>
        </div>
      )}

      {saved && (
        <p className="rounded-[--radius-field] border border-[--color-safe-line] bg-[--color-safe-soft] px-4 py-3 text-sm text-[--color-safe]">
          ✓ {saved}
        </p>
      )}
      {error && (
        <p className="rounded-[--radius-field] border border-[--color-critical-line] bg-[--color-critical-soft] px-4 py-3 text-sm text-[--color-critical]">
          {error}
        </p>
      )}
    </Sheet>
  );
}


// =============================================================================
// Export / import
//
// ⚠ THE BUG THIS VERSION FIXES
//   The old importer rebuilt every timetable row through addTimetableEntry(),
//   which mints a fresh id each time. Session ids derive from the parent entry
//   id, and marks are keyed by session id — so importing your own backup
//   detached every mark you had ever made. It looked like data loss because it
//   was data loss.
//
//   exportBackup/importBackup in store.ts write the stores verbatim. Ids are
//   preserved, so marks reattach on any device.
//
// ⚠ IMPORT REPLACES, IT DOES NOT MERGE. There is no undo, so the student
//   confirms first and is offered a safety export on the way.
// =============================================================================

function TransferSheet(props: { onClose: () => void }) {
  const { onClose } = props;
  const fileRef = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stats = useMemo(() => {
    const t = getTimetableStore();
    let entries = 0;
    for (const byDay of Object.values(t)) {
      for (const list of Object.values(byDay ?? {})) entries += list?.length ?? 0;
    }
    const posts = ACADEMIC_YEARS.reduce((n, y) => n + getPostings(y).length, 0);
    const marks = Object.keys(getMarks() ?? {}).length;
    return { entries, posts, marks };
  }, []);

  const handleExport = () => {
    setError(null);
    try {
      const blob = new Blob([exportBackupJSON()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `medprep-attendance-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setReport('Exported. Keep the file somewhere you will find it again.');
    } catch {
      setError('Could not create the file. Try a different browser.');
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    setReport(null);
    try {
      setPending(await file.text());
    } catch {
      setError('Could not read that file.');
    }
  };

  const confirmImport = () => {
    if (pending === null) return;
    const result = importBackup(pending);
    setPending(null);

    if (!result.ok) {
      setError(result.error ?? 'That file could not be imported.');
      return;
    }
    setReport(
      ['Imported. Your timetable, postings, marks and carried-forward figures are restored.',
        ...result.notes].join(' '),
    );
  };

  // ---- Confirmation step: destructive, so it gets its own screen ----
  if (pending !== null) {
    return (
      <Sheet
        title="Replace everything?"
        onClose={() => setPending(null)}
        onSave={confirmImport}
        saveLabel="Replace my data"
      >
        <p className="rounded-[--radius-field] border border-[--color-critical-line] bg-[--color-critical-soft] px-4 py-3 text-sm text-[--color-critical]">
          Importing <span className="font-semibold">replaces</span> your current
          attendance data. It is not merged, and it cannot be undone.
        </p>

        <div className="rounded-[--radius-field] border border-[--color-line] bg-[--color-surface-sunk] px-4 py-3 text-sm text-[--color-ink-soft]">
          About to be replaced:{' '}
          <span className="tnum font-semibold text-[--color-ink]">{stats.entries}</span>{' '}
          weekly {stats.entries === 1 ? 'class' : 'classes'},{' '}
          <span className="tnum font-semibold text-[--color-ink]">{stats.posts}</span>{' '}
          {stats.posts === 1 ? 'posting' : 'postings'},{' '}
          <span className="tnum font-semibold text-[--color-ink]">{stats.marks}</span>{' '}
          {stats.marks === 1 ? 'mark' : 'marks'}.
        </div>

        <button onClick={handleExport} className="btn btn-ghost w-full">
          ↓ Export what I have first
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet title="Export & import" onClose={onClose}>
      <div className="rounded-[--radius-field] border border-[--color-line] bg-[--color-surface-sunk] px-4 py-3 text-sm text-[--color-ink-soft]">
        Currently stored:{' '}
        <span className="tnum font-semibold text-[--color-ink]">{stats.entries}</span>{' '}
        weekly {stats.entries === 1 ? 'class' : 'classes'},{' '}
        <span className="tnum font-semibold text-[--color-ink]">{stats.posts}</span>{' '}
        {stats.posts === 1 ? 'posting' : 'postings'},{' '}
        <span className="tnum font-semibold text-[--color-ink]">{stats.marks}</span>{' '}
        {stats.marks === 1 ? 'mark' : 'marks'}.
      </div>

      <button onClick={handleExport} className="btn btn-ghost w-full">
        ↓ Export to a file
      </button>

      <div className="border-t border-[--color-line] pt-5">
        <L label="Import a file">
          <button
            onClick={() => fileRef.current?.click()}
            className="btn btn-ghost w-full border-dashed"
          >
            ↑ Choose a medprep export
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = '';
            }}
          />
        </L>

        <p className="mt-3 text-sm text-[--color-ink-muted]">
          <span className="font-medium text-[--color-ink-soft]">
            Importing replaces what you have.
          </span>{' '}
          You will be asked to confirm first. Class ids are preserved, so your
          day-by-day marks reattach correctly — including on a new device.
        </p>
      </div>

      {report && (
        <p className="rounded-[--radius-field] border border-[--color-safe-line] bg-[--color-safe-soft] px-4 py-3 text-sm text-[--color-safe]">
          ✓ {report}
        </p>
      )}
      {error && (
        <p className="rounded-[--radius-field] border border-[--color-critical-line] bg-[--color-critical-soft] px-4 py-3 text-sm text-[--color-critical]">
          {error}
        </p>
      )}
    </Sheet>
  );
}


// =============================================================================
// Shared sheet shell
//
// Uses .sheet / .sheet-head / .sheet-body / .sheet-foot from globals.css: flex
// column, footer as a SIBLING of the scroll area. That structure is what keeps
// the save button on screen however tall the content grows.
// =============================================================================

function Sheet(props: {
  title: string;
  onClose: () => void;
  onSave?: () => void;
  saveLabel?: string;
  children: React.ReactNode;
}) {
  const { title, onClose, onSave, saveLabel, children } = props;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-2xl px-3 pb-3">
        <div className="sheet">
          <div className="sheet-head px-5 pb-4 pt-4">
            <div className="sheet-grip mb-4" aria-hidden />
            <p className="display text-xl">{title}</p>
          </div>

          <div className="sheet-body space-y-5 px-5 py-5">{children}</div>

          <div className="sheet-foot flex gap-2 p-3">
            <button onClick={onClose} className="btn btn-ghost flex-1">
              {onSave ? 'Cancel' : 'Done'}
            </button>
            {onSave && (
              <button onClick={onSave} className="btn btn-primary flex-[2]">
                {saveLabel ?? 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function L(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="eyebrow mb-2 block">{props.label}</span>
      {props.children}
    </div>
  );
}
