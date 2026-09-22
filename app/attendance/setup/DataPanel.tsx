'use client';

// =============================================================================
// app/attendance/setup/DataPanel.tsx
// -----------------------------------------------------------------------------
// Three jobs the app could not previously do:
//
//   1. PICK UP WHERE YOU LEFT OFF — opening balances for a mid-year start
//   2. EXPORT — a JSON backup of everything
//   3. IMPORT — the same file back, additively
//
// WHY OPENING BALANCE RATHER THAN FAKE SESSIONS
//   The obvious implementation generates 50 past sessions and marks 34 present.
//   That is wrong: those sessions never existed, they would appear in history,
//   and editing the timetable would silently reshuffle them. An opening balance
//   is two integers added at calculation time. It cannot drift.
//
// ⚠ TRAP 2 — an excluded subject's opening balance is ignored along with its
//   sessions. That rule lives in categoryResult() and is not duplicated here.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  AcademicYear,
  ClassCategory,
  OpeningBalance,
  SessionStatus,
  SubjectId,
} from '../types';

import {
  ACADEMIC_YEARS,
  categoriesForSubject,
  selectableSubjectsFor,
  subjectName,
} from '@/lib/attendance/curriculum';

import {
  addPosting,
  addTimetableEntry,
  getEntOphthaInFinalYear,
  getMarks,
  getOpeningBalance,
  getPostings,
  getSettings,
  getTimetableStore,
  setMark,
  setOpeningBalance,
  updateSettings,
} from '../store';

import { percentOf } from '../calculate';


const CATEGORY_LABEL: Record<ClassCategory, string> = {
  theory: 'Theory',
  practical: 'Practical',
  clinical: 'Clinical',
};

/** Bumped when the bundle shape changes, so imports can refuse politely. */
const BUNDLE_VERSION = 3;


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
    void revision;
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

  const existing: OpeningBalance | null = useMemo(
    () => (subjectId ? getOpeningBalance(year, subjectId, category) ?? null : null),
    [year, subjectId, category, saved],
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
      return { conducted: Math.floor(total), attended: Math.floor(att) };
    }
    const pct = Number(percent);
    if (!Number.isFinite(total) || !Number.isFinite(pct) || total <= 0) return null;
    return {
      conducted: Math.floor(total),
      attended: Math.round((Math.min(100, Math.max(0, pct)) / 100) * Math.floor(total)),
    };
  }, [mode, conducted, attended, percent]);

  const handleSave = () => {
    setError(null);
    setSaved(null);

    if (!subjectId) return setError('Choose a subject.');
    if (!derived) return setError('Enter how many classes were conducted.');
    if (derived.conducted <= 0) return setError('Classes conducted must be more than zero.');
    if (derived.attended > derived.conducted) {
      return setError('Attended cannot be more than conducted.');
    }
    if (derived.attended < 0) return setError('Attended cannot be negative.');

    setOpeningBalance(year, subjectId, category, {
      conducted: derived.conducted,
      attended: derived.attended,
    });

    setSaved(
      `${subjectName(subjectId)} ${CATEGORY_LABEL[category]} — ${derived.attended}/${derived.conducted} (${percentOf(derived.attended, derived.conducted)}%)`,
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
          <button onClick={() => setMode('counts')} className={`seg ${mode === 'counts' ? 'seg-on' : ''}`}>
            Class counts
          </button>
          <button onClick={() => setMode('percent')} className={`seg ${mode === 'percent' ? 'seg-on' : ''}`}>
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
        <p className="rounded-[--radius-field] border border-[--color-line] bg-[--color-surface-sunk] px-4 py-3 text-sm text-[--color-ink-soft]">
          Recording{' '}
          <span className="tnum font-semibold text-[--color-ink]">
            {derived.attended} of {derived.conducted}
          </span>{' '}
          — {percentOf(derived.attended, derived.conducted)}%
        </p>
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
// ⚠ MARKS AND IDENTITY
//   Marks are keyed by deterministic session id, which derives from the parent
//   timetable entry's id plus the date. Import creates entries through
//   addTimetableEntry(), which mints FRESH ids — so restored marks reattach
//   only when the entries they belong to still exist under the same ids.
//
//   In practice: restoring into the same browser works; restoring onto a clean
//   device recovers the timetable, postings, settings and carried-forward
//   figures, but day-by-day marks may not reattach. Rather than silently drop
//   them, they are exported and the sheet says so plainly.
// =============================================================================

interface Bundle {
  app: 'medprep';
  kind: 'attendance';
  version: number;
  exportedAt: string;
  settings: unknown;
  timetable: Record<string, unknown>;
  postings: Record<string, unknown>;
  marks: Record<string, SessionStatus>;
  openingBalances: Array<{
    year: AcademicYear;
    subjectId: SubjectId;
    category: ClassCategory;
    conducted: number;
    attended: number;
  }>;
}

function buildBundle(): Bundle {
  const balances: Bundle['openingBalances'] = [];
  const postings: Record<string, unknown> = {};

  for (const y of ACADEMIC_YEARS) {
    postings[y] = getPostings(y);
    for (const s of selectableSubjectsFor(y, undefined, getEntOphthaInFinalYear())) {
      for (const c of categoriesForSubject(s.id)) {
        const b = getOpeningBalance(y, s.id, c);
        if (b && b.conducted > 0) {
          balances.push({ year: y, subjectId: s.id, category: c, ...b });
        }
      }
    }
  }

  return {
    app: 'medprep',
    kind: 'attendance',
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    timetable: getTimetableStore() as Record<string, unknown>,
    postings,
    marks: getMarks() as Record<string, SessionStatus>,
    openingBalances: balances,
  };
}

function TransferSheet(props: { onClose: () => void }) {
  const { onClose } = props;
  const fileRef = useRef<HTMLInputElement>(null);

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
      const blob = new Blob([JSON.stringify(buildBundle(), null, 2)], {
        type: 'application/json',
      });
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

    let data: Bundle;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return setError('That file is not readable JSON.');
    }

    if (data?.app !== 'medprep' || data?.kind !== 'attendance') {
      return setError('That is not a medprep attendance export.');
    }
    if (typeof data.version !== 'number' || data.version > BUNDLE_VERSION) {
      return setError('That file was made by a newer version of the app.');
    }

    let entries = 0;
    let posts = 0;
    let balances = 0;
    let marks = 0;

    // Settings first — target percent and college hours shape everything else.
    if (data.settings && typeof data.settings === 'object') {
      updateSettings(data.settings as Parameters<typeof updateSettings>[0]);
    }

    // Timetable goes through the public API so every imported row faces the
    // same overlap validation a hand-typed one would. Slower than a bulk write,
    // and worth it: an import can never introduce a conflict the UI refuses.
    for (const [y, byDay] of Object.entries(data.timetable ?? {})) {
      for (const [day, list] of Object.entries((byDay ?? {}) as Record<string, unknown[]>)) {
        for (const raw of list ?? []) {
          const e = raw as Record<string, unknown>;
          try {
            addTimetableEntry(y as AcademicYear, Number(day) as 0, {
              subjectId: String(e.subjectId),
              subjectName: String(e.subjectName ?? subjectName(String(e.subjectId))),
              category: e.category as ClassCategory,
              start: String(e.start),
              end: String(e.end),
              weight: Number(e.weight) || 1,
              isAfterHours: e.isAfterHours === true,
            });
            entries += 1;
          } catch {
            /* One bad row must not abort the whole import. */
          }
        }
      }
    }

    for (const [y, list] of Object.entries(data.postings ?? {})) {
      for (const raw of (list ?? []) as unknown[]) {
        const p = raw as Record<string, unknown>;
        try {
          addPosting(y as AcademicYear, {
            subjectId: String(p.subjectId),
            subjectName: String(p.subjectName ?? subjectName(String(p.subjectId))),
            startDate: String(p.startDate),
            endDate: String(p.endDate),
            start: String(p.start),
            end: String(p.end),
            workingDays: (p.workingDays as number[]) ?? [0, 1, 2, 3, 4, 5],
            weight: Number(p.weight) || 1,
          } as Parameters<typeof addPosting>[1]);
          posts += 1;
        } catch {
          /* skip */
        }
      }
    }

    for (const b of data.openingBalances ?? []) {
      try {
        setOpeningBalance(b.year, b.subjectId, b.category, {
          conducted: b.conducted,
          attended: b.attended,
        });
        balances += 1;
      } catch {
        /* skip */
      }
    }

    // Marks restored verbatim by session id. Harmless when an id no longer
    // resolves — an orphaned mark is simply never read.
    for (const [id, status] of Object.entries(data.marks ?? {})) {
      try {
        setMark(id, status);
        marks += 1;
      } catch {
        /* skip */
      }
    }

    setReport(
      `Imported ${entries} ${entries === 1 ? 'class' : 'classes'}, ` +
        `${posts} ${posts === 1 ? 'posting' : 'postings'}, ` +
        `${balances} carried-forward ${balances === 1 ? 'figure' : 'figures'}, ` +
        `${marks} ${marks === 1 ? 'mark' : 'marks'}.`,
    );
  };

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
            Imports are added to what you already have.
          </span>{' '}
          Anything clashing with an existing class is skipped rather than
          overwriting it. Restoring onto a fresh device recovers your timetable,
          postings and carried-forward figures; individual day marks may not
          reattach, since they are tied to the classes they belong to.
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
