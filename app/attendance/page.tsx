'use client';

// =============================================================================
// app/attendance/page.tsx
// -----------------------------------------------------------------------------
// The marking page. What a student opens every morning.
//
//   · Today's classes, tappable to mark present / absent / not conducted
//   · Overall ring at the top
//   · Per-subject rings below, expandable to per-category and per-year
//   · A quiet route back into setup
//
// SELF-CONTAINED. No imports from components/attendance/.
//
// WHAT THE LAYERS BELOW GUARANTEE:
//   · generateForDate() returns today's sessions with marks already applied.
//   · Marks are stored by deterministic session id, so editing the timetable
//     never orphans them.
//   · calculate.ts recomputes on every render. Nothing here caches a
//     percentage. (TRAP 5)
//   · Only subjects the student actually scheduled appear. (TRAP 9)
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import type {
  CategoryResult,
  SafetyBand,
  Session,
  SessionStatus,
  SubjectResult,
} from './types';

import {
  formatDateRelative,
  formatTimeRange,
  todayISO,
} from '@/lib/attendance/datetime';

import { getSettings, setMark, subscribe } from './store';
import { generateForDate } from './generate';
import {
  BAND_LABEL,
  formatFraction,
  overallResult,
  statusLine,
  yearResult,
} from './calculate';


// -----------------------------------------------------------------------------
// Palette
//
// Bands are relative to the student's own target, so the colours mean the same
// thing whether the requirement is 75% or 80%.
// -----------------------------------------------------------------------------

const BAND_COLOR: Record<SafetyBand, { ring: string; text: string; bg: string }> = {
  safe:     { ring: '#10b981', text: 'text-emerald-600', bg: 'bg-emerald-50' },
  warning:  { ring: '#f59e0b', text: 'text-amber-600',   bg: 'bg-amber-50' },
  danger:   { ring: '#f97316', text: 'text-orange-600',  bg: 'bg-orange-50' },
  critical: { ring: '#ef4444', text: 'text-red-600',     bg: 'bg-red-50' },
};

const CATEGORY_LABEL: Record<string, string> = {
  theory: 'Theory',
  practical: 'Practical',
  clinical: 'Clinical',
};


// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------

function useStoreRevision(): number {
  const [rev, setRev] = useState(0);
  useEffect(() => subscribe(() => setRev((n) => n + 1)), []);
  return rev;
}

function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}


// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

export default function AttendancePage() {
  const mounted = useMounted();
  const rev = useStoreRevision();
  const [expanded, setExpanded] = useState<string | null>(null);

  const settings = useMemo(() => {
    void rev;
    return mounted ? getSettings() : null;
  }, [mounted, rev]);

  const today = todayISO();

  const todaySessions = useMemo(() => {
    void rev;
    if (!mounted || !settings) return [];
    return generateForDate(settings.currentYear, today);
  }, [mounted, rev, settings, today]);

  const year = useMemo(() => {
    void rev;
    if (!mounted || !settings) return null;
    return yearResult({ year: settings.currentYear });
  }, [mounted, rev, settings]);

  const overall = useMemo(() => {
    void rev;
    return mounted ? overallResult() : null;
  }, [mounted, rev]);

  const mark = useCallback((id: string, status: SessionStatus) => {
    setMark(id, status);
  }, []);

  if (!mounted || !settings || !year || !overall) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-8">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-slate-200" />
        <div className="mt-6 h-48 animate-pulse rounded-3xl bg-slate-100" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      </main>
    );
  }

  const target = settings.term.targetPercent;
  const hasAnyData = year.subjects.length > 0;

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-24 pt-6">
      {/* ------------------------------ Header ------------------------------ */}
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Attendance
          </h1>
          <p className="mt-1 text-sm text-slate-500">{settings.currentYear}</p>
        </div>
        <Link
          href="/attendance/setup"
          className="-mr-2 flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-slate-600 transition active:bg-slate-100"
        >
          Edit timetable
        </Link>
      </header>

      {!hasAnyData ? (
        <EmptyState />
      ) : (
        <>
          {/* ---------------------------- Overall ---------------------------- */}
          <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-6">
              <Ring
                percent={year.percent}
                band={year.band}
                size={132}
                stroke={11}
                empty={year.conducted === 0}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  This year
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {formatFraction(year.attended, year.conducted)}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">classes attended</p>
                <span
                  className={`mt-3 inline-block rounded-lg px-2.5 py-1 text-xs font-medium ${
                    BAND_COLOR[year.band].bg
                  } ${BAND_COLOR[year.band].text}`}
                >
                  {BAND_LABEL[year.band]} · target {target}%
                </span>
              </div>
            </div>

            {overall.years.length > 1 && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="text-sm text-slate-500">
                  Across all years:{' '}
                  <span className="font-medium text-slate-900">
                    {overall.conducted === 0 ? '—' : `${overall.percent}%`}
                  </span>{' '}
                  <span className="text-slate-400">
                    ({formatFraction(overall.attended, overall.conducted)})
                  </span>
                </p>
              </div>
            )}
          </section>

          {/* ----------------------------- Today ----------------------------- */}
          <section className="mb-6">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                {formatDateRelative(today)}
              </h2>
              {todaySessions.length > 0 && (
                <span className="text-sm text-slate-400">
                  {todaySessions.filter((s) => s.status === 'unmarked').length} to mark
                </span>
              )}
            </div>

            {todaySessions.length === 0 ? (
              <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
                <p className="text-sm text-slate-500">No classes scheduled today.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {todaySessions.map((s) => (
                  <SessionRow key={s.id} session={s} onMark={mark} />
                ))}
              </div>
            )}
          </section>

          {/* ---------------------------- Subjects --------------------------- */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              By subject
            </h2>
            <div className="space-y-2.5">
              {year.subjects.map((subject) => (
                <SubjectCard
                  key={subject.subjectId}
                  subject={subject}
                  target={target}
                  open={expanded === subject.subjectId}
                  onToggle={() =>
                    setExpanded((cur) =>
                      cur === subject.subjectId ? null : subject.subjectId,
                    )
                  }
                />
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}


// -----------------------------------------------------------------------------
// Ring
//
// Green arc on grey, percentage in the middle. An SVG circle with a dash
// offset — no chart library, no layout shift, scales to any size.
// -----------------------------------------------------------------------------

function Ring(props: {
  percent: number;
  band: SafetyBand;
  size: number;
  stroke: number;
  empty?: boolean;
}) {
  const { percent, band, size, stroke, empty } = props;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={empty ? 'No data' : `${percent} percent`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={stroke}
        />
        {!empty && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={BAND_COLOR[band].ring}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 420ms ease-out' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="font-semibold tabular-nums text-slate-900"
          style={{ fontSize: size * 0.24 }}
        >
          {empty ? '—' : `${Math.round(percent)}%`}
        </span>
      </div>
    </div>
  );
}


// -----------------------------------------------------------------------------
// One session, with its three marking buttons
//
// Tapping the active button clears it back to unmarked — a mis-tap costs one
// more tap, not a trip into an edit screen.
// -----------------------------------------------------------------------------

function SessionRow(props: {
  session: Session;
  onMark: (id: string, status: SessionStatus) => void;
}) {
  const { session, onMark } = props;

  const toggle = (next: SessionStatus) => {
    onMark(session.id, session.status === next ? 'unmarked' : next);
  };

  const dimmed = session.status === 'not-conducted';

  return (
    <div
      className={`rounded-2xl bg-white p-4 shadow-sm ring-1 transition ${
        dimmed ? 'opacity-55 ring-slate-200' : 'ring-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">
            {session.subjectName}
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            {formatTimeRange(session.start, session.end)} ·{' '}
            {CATEGORY_LABEL[session.category] ?? session.category}
            {session.weight > 1 && (
              <span className="text-slate-400"> · counts as {session.weight}</span>
            )}
          </p>
        </div>
        {session.origin === 'extra' && (
          <span className="shrink-0 rounded-lg bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-600">
            Extra
          </span>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <MarkButton
          label="Present"
          active={session.status === 'present'}
          activeClass="bg-emerald-600 text-white"
          onClick={() => toggle('present')}
        />
        <MarkButton
          label="Absent"
          active={session.status === 'absent'}
          activeClass="bg-red-600 text-white"
          onClick={() => toggle('absent')}
        />
        <MarkButton
          label="Cancelled"
          active={session.status === 'not-conducted'}
          activeClass="bg-slate-700 text-white"
          onClick={() => toggle('not-conducted')}
        />
      </div>
    </div>
  );
}

function MarkButton(props: {
  label: string;
  active: boolean;
  activeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={props.onClick}
      aria-pressed={props.active}
      className={`min-h-12 flex-1 rounded-xl text-sm font-medium transition ${
        props.active
          ? props.activeClass
          : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200 active:bg-slate-100'
      }`}
    >
      {props.label}
    </button>
  );
}


// -----------------------------------------------------------------------------
// Subject card
//
// Collapsed: name, colour-coded percentage, fraction.
// Expanded: one ring per category, plus the plain-English status line.
// -----------------------------------------------------------------------------

function SubjectCard(props: {
  subject: SubjectResult;
  target: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { subject, target, open, onToggle } = props;
  const empty = subject.conducted === 0;

  return (
    <section
      className={`overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 ${
        subject.isExcluded ? 'opacity-60' : ''
      }`}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-4 text-left transition active:bg-slate-50"
      >
        <span
          className="h-10 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: empty ? '#e2e8f0' : BAND_COLOR[subject.band].ring }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-900">
              {subject.subjectName}
            </span>
            {subject.isExamSubject && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400"
                title="Exam subject"
                aria-label="Exam subject"
              />
            )}
          </span>
          <span className="mt-0.5 block text-sm text-slate-500">
            {empty ? 'No classes yet' : formatFraction(subject.attended, subject.conducted)}
            {subject.isExcluded && ' · excluded'}
          </span>
        </span>
        <span
          className={`shrink-0 text-lg font-semibold tabular-nums ${
            empty ? 'text-slate-300' : BAND_COLOR[subject.band].text
          }`}
        >
          {empty ? '—' : `${Math.round(subject.percent)}%`}
        </span>
        <span
          className={`shrink-0 text-slate-300 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-5">
          {subject.categories.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing recorded yet.</p>
          ) : (
            <div className="space-y-5">
              {subject.categories.map((c) => (
                <CategoryBlock key={c.category} result={c} target={target} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CategoryBlock(props: { result: CategoryResult; target: number }) {
  const { result, target } = props;

  return (
    <div className="flex items-center gap-4">
      <Ring
        percent={result.percent}
        band={result.band}
        size={78}
        stroke={7}
        empty={result.isEmpty}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">
          {CATEGORY_LABEL[result.category] ?? result.category}
        </p>
        <p className="mt-0.5 text-sm text-slate-500">
          {result.isEmpty ? '—' : formatFraction(result.attended, result.conducted)}
        </p>
        <p className="mt-1.5 text-sm text-slate-600">{statusLine(result, target)}</p>
      </div>
    </div>
  );
}


// -----------------------------------------------------------------------------
// Empty state
// -----------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
      <p className="text-base font-medium text-slate-900">No timetable yet</p>
      <p className="mx-auto mt-2 max-w-xs text-sm text-slate-500">
        Add your weekly classes once, and this page tracks everything from there.
      </p>
      <Link
        href="/attendance/setup"
        className="mt-6 inline-flex min-h-12 items-center rounded-2xl bg-slate-900 px-6 text-sm font-medium text-white transition active:bg-slate-800"
      >
        Set up timetable
      </Link>
    </div>
  );
}
