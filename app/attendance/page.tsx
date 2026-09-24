'use client';

// =============================================================================
// app/attendance/page.tsx — TEMPORARY STOPGAP
// -----------------------------------------------------------------------------
// This is NOT the rebuilt page. It exists so the dev server compiles while
// WeekStrip / MarkList / RingGrid are being written.
//
// It uses only the v4 API, so it doubles as a smoke test: if the numbers here
// look right, types + store + calculate + generate are wired correctly.
//
// Styling is plain Tailwind on purpose. No design tokens are invented here —
// the real page will use globals.css.
// =============================================================================

import { useEffect, useState } from 'react';

import { getSettings, setMark, subscribe } from './store';
import { generateForDate } from './generate';
import { getYearResult, statusLine } from './calculate';
import { todayISO } from '@/lib/attendance/datetime';
import type { SafetyBand, Session, SessionStatus } from './types';

const BAND_TEXT: Record<SafetyBand, string> = {
  safe: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-orange-600',
  critical: 'text-red-600',
};

export default function AttendancePage() {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), []);

  const settings = getSettings();
  const year = settings.currentYear;
  const today = todayISO();

  const result = getYearResult(year);
  const todaysClasses = generateForDate(year, today);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Temporary page. The week strip, marking list and ring grid are not built
        yet — this is here to verify the new calculator.
      </p>

      <h1 className="text-xl font-semibold">{year}</h1>

      {/* ---- Today's classes ---- */}
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

      {/* ---- Per subject, per type. No pooled numbers anywhere. ---- */}
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
                <span className={`font-semibold ${BAND_TEXT[subject.worstBand]}`}>
                  {subject.subjectName}
                </span>
                {subject.isExamSubject && (
                  <span className="text-xs text-slate-400">exam subject</span>
                )}
              </div>

              {subject.categories.map((c) => (
                <div key={c.category} className="mt-3 border-t border-slate-100 pt-3">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="capitalize text-slate-600">{c.category}</span>
                    <span className="tabular-nums">
                      {c.isEmpty ? '—' : `${c.attended}/${c.conducted}`}
                      <span className={`ml-2 font-semibold ${BAND_TEXT[c.band]}`}>
                        {c.isEmpty ? '' : `${c.percentDisplay}%`}
                      </span>
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
  const mark = (status: SessionStatus) =>
    setMark(session.id, session.status === status ? 'unmarked' : status);

  const btn = (status: SessionStatus, label: string, on: string) =>
    `rounded-md px-3 py-1.5 text-sm font-medium border ${
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
        <button onClick={() => mark('present')} className={btn('present', 'P', 'border-emerald-500 bg-emerald-500 text-white')}>
          P
        </button>
        <button onClick={() => mark('absent')} className={btn('absent', 'A', 'border-red-500 bg-red-500 text-white')}>
          A
        </button>
        <button
          onClick={() => mark('not-conducted')}
          className={`rounded-md px-2 py-1 text-xs font-medium border ${
            session.status === 'not-conducted'
              ? 'border-slate-400 bg-slate-400 text-white'
              : 'border-slate-200 text-slate-400'
          }`}
        >
          C
        </button>
      </div>
    </div>
  );
}
