// =============================================================================
// app/attendance/debug/page.tsx
// -----------------------------------------------------------------------------
// TEMPORARY DIAGNOSTIC ROUTE. Not part of the product. Delete once the
// attendance test matrix passes.
//
// WHY THIS EXISTS
//   Marks made in the UI are not reaching the rings. Three layers could be at
//   fault and guessing has already cost several RingGrid rewrites. This page
//   shows all of them side by side so the FIRST broken layer is visible,
//   instead of inferred.
//
// THE ONE COMPARISON THAT MATTERS
//   generateForWeek()  — what the week preview and marking list see
//   generateForYear()  — what getYearResult() and therefore the rings see
//   If a marked session appears in the first and not the second, the bug is
//   the term window, and nothing downstream should be touched.
//
// This page reads production functions only. It duplicates the calculator's
// arithmetic ONCE, deliberately, as an independent check. That duplicate is
// the point: if it agrees with calculate.ts, calculate.ts is exonerated.
// =============================================================================

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  CategoryResult,
  ClassCategory,
  ISODate,
  Session,
  SessionStatus,
  SubjectId,
} from '../types';

import {
  getDataVersion,
  getEntOphthaInFinalYear,
  getMarks,
  getOpeningBalance,
  getSettings,
  isExcluded as storeIsExcluded,
  runMigrations,
  setMark,
  subscribe,
} from '../store';

import { generateForWeek, generateForYear } from '../generate';
import { getYearResult } from '../calculate';

import {
  categoriesForSubject,
  effectiveExamSubjects,
} from '@/lib/attendance/curriculum';

import {
  addDays,
  endOfWeek,
  startOfWeek,
  todayISO,
} from '@/lib/attendance/datetime';


// -----------------------------------------------------------------------------
// Independent tally — deliberately a SECOND implementation
//
// If this and calculate.ts disagree on the same session list, the calculator
// is wrong. If they agree but the rings are still wrong, the calculator is
// innocent and the fault is upstream (window) or downstream (rendering).
// -----------------------------------------------------------------------------

interface Tally {
  present: number;
  absent: number;
  cancelled: number;
  pastUnmarked: number;
  futureUnmarked: number;
  attended: number;
  conducted: number;
}

function emptyTally(): Tally {
  return {
    present: 0,
    absent: 0,
    cancelled: 0,
    pastUnmarked: 0,
    futureUnmarked: 0,
    attended: 0,
    conducted: 0,
  };
}

/** Mirrors computeCategory's marking model. Nothing clever. */
function tallyOf(sessions: Session[], today: ISODate): Tally {
  const t = emptyTally();

  for (const s of sessions) {
    const w = s.weight > 0 ? s.weight : 1;

    // Only an EXTRA may opt out of the denominator. A regular class never can.
    const countsDenominator =
      s.origin === 'extra' ? s.countsTowardDenominator !== false : true;

    switch (s.status) {
      case 'present':
        t.present += w;
        t.attended += w;
        if (countsDenominator) t.conducted += w;
        break;
      case 'absent':
        t.absent += w;
        if (countsDenominator) t.conducted += w;
        break;
      case 'not-conducted':
        t.cancelled += w;
        break;
      default:
        if (s.date > today) t.futureUnmarked += w;
        else t.pastUnmarked += 1;
        break;
    }
  }
  return t;
}

function keyOf(subjectId: SubjectId, category: ClassCategory): string {
  return `${subjectId}::${category}`;
}


// -----------------------------------------------------------------------------
// Tiny presentational helpers. No Tailwind tokens — this page must render even
// if the theme is broken, because a broken theme is one of the suspects.
// -----------------------------------------------------------------------------

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
};

const cell: React.CSSProperties = {
  ...mono,
  border: '1px solid #d4d4d4',
  padding: '3px 6px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const headCell: React.CSSProperties = {
  ...cell,
  background: '#efefef',
  fontWeight: 700,
};

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2
        style={{
          font: '700 14px/1.4 system-ui, sans-serif',
          margin: '0 0 8px',
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        }}
      >
        {props.title}
      </h2>
      <div style={{ overflowX: 'auto' }}>{props.children}</div>
    </section>
  );
}

function Verdict(props: { ok: boolean; text?: string }) {
  return (
    <span
      style={{
        ...mono,
        fontWeight: 700,
        color: props.ok ? '#15803d' : '#b91c1c',
      }}
    >
      {props.text ?? (props.ok ? 'PASS' : 'FAIL')}
    </span>
  );
}


// -----------------------------------------------------------------------------
// The page
// -----------------------------------------------------------------------------

export default function AttendanceDebugPage() {
  // Hydration gate: the store reads localStorage, which does not exist on the
  // server. First client render must match the server's, so nothing real is
  // read until after mount.
  const [mounted, setMounted] = useState(false);

  // Bumped by the store on every mutating write. Forces a full recompute.
  const [revision, setRevision] = useState(0);

  const [selectedDate, setSelectedDate] = useState<ISODate>(todayISO());
  const [log, setLog] = useState<string[]>([]);

  const migrated = useRef(false);

  useEffect(() => {
    // StrictMode mounts effects twice in development. Migrations must not run
    // twice, so guard with a ref rather than trusting the effect to fire once.
    if (!migrated.current) {
      migrated.current = true;
      runMigrations();
    }
    setMounted(true);
    return subscribe(() => setRevision((n) => n + 1));
  }, []);

  const addLog = useCallback((line: string) => {
    setLog((prev) => [line, ...prev].slice(0, 40));
  }, []);

  // ---- Everything below recomputes whenever the store changes -------------
  const snapshot = useMemo(() => {
    if (!mounted) return null;

    // `revision` is read so this memo is genuinely keyed to store writes.
    void revision;

    const settings = getSettings();
    const year = settings.currentYear;
    const today = todayISO();

    const weekStart = startOfWeek(selectedDate);
    const weekEnd = endOfWeek(selectedDate);

    const marks = getMarks();
    const version = getDataVersion();

    const weekSessions = generateForWeek(year, weekStart, weekEnd);
    const yearSessions = generateForYear(year);
    const yearInWeek = yearSessions.filter(
      (s) => s.date >= weekStart && s.date <= weekEnd,
    );

    const yearIds = new Set(yearInWeek.map((s) => s.id));
    const weekIds = new Set(weekSessions.map((s) => s.id));

    const examIds = effectiveExamSubjects(
      year,
      settings.examSubjectsByYear,
      getEntOphthaInFinalYear(),
    );

    const result = getYearResult(year);

    // ---- Independent full-term tally, bucketed exactly like calculate.ts --
    const tallies = new Map<string, Tally>();
    for (const s of yearSessions) {
      const k = keyOf(s.subjectId, s.category);
      const existing = tallies.get(k) ?? emptyTally();
      tallies.set(k, existing);
    }
    for (const [k] of tallies) {
      const [subjectId, category] = k.split('::');
      const subset = yearSessions.filter(
        (s) => s.subjectId === subjectId && s.category === category,
      );
      tallies.set(k, tallyOf(subset, today));
    }

    // ---- Compare each effective exam subject's legal category pair --------
    interface Row {
      subjectId: SubjectId;
      category: ClassCategory;
      tally: Tally;
      opening: { conducted: number; attended: number } | null;
      excluded: boolean;
      expectedAttended: number;
      expectedConducted: number;
      actual: CategoryResult | null;
      subjectPresent: boolean;
      pass: boolean;
    }

    const rows: Row[] = [];

    for (const subjectId of examIds) {
      const subjectResult =
        result.subjects.find((s) => s.subjectId === subjectId) ?? null;

      for (const category of categoriesForSubject(subjectId)) {
        const tally = tallies.get(keyOf(subjectId, category)) ?? emptyTally();
        const excluded = storeIsExcluded(year, subjectId, category);
        const opening = getOpeningBalance(year, subjectId, category);

        // Opening balance is ignored entirely when the category is excluded.
        let expectedAttended = tally.attended;
        let expectedConducted = tally.conducted;
        if (opening && !excluded) {
          expectedConducted += Math.max(0, opening.conducted);
          expectedAttended += Math.max(
            0,
            Math.min(opening.attended, opening.conducted),
          );
        }
        if (expectedAttended > expectedConducted) {
          expectedAttended = expectedConducted;
        }

        const actual =
          subjectResult?.categories.find((c) => c.category === category) ?? null;

        const pass =
          actual !== null &&
          actual.attended === expectedAttended &&
          actual.conducted === expectedConducted;

        rows.push({
          subjectId,
          category,
          tally,
          opening,
          excluded,
          expectedAttended,
          expectedConducted,
          actual,
          subjectPresent: subjectResult !== null,
          pass,
        });
      }
    }

    return {
      settings,
      year,
      today,
      weekStart,
      weekEnd,
      marks,
      version,
      weekSessions,
      yearSessions,
      yearInWeek,
      yearIds,
      weekIds,
      examIds,
      result,
      rows,
    };
  }, [mounted, revision, selectedDate]);

  // ---- Mark actions, fully instrumented ----------------------------------
  const applyMark = useCallback(
    (session: Session, status: SessionStatus) => {
      const before = getDataVersion();
      const previous = getMarks()[session.id] ?? 'unmarked';

      setMark(session.id, status);

      const after = getDataVersion();
      const rawAfter = getMarks()[session.id] ?? 'unmarked';

      // Regenerate to see what the pipeline now believes about this session.
      const regenerated = generateForYear(getSettings().currentYear).find(
        (s) => s.id === session.id,
      );

      addLog(
        [
          `id=${session.id}`,
          `prev=${previous}`,
          `set=${status}`,
          `rawAfter=${rawAfter}`,
          `version ${before}->${after}`,
          `yearStatus=${regenerated ? regenerated.status : 'NOT IN YEAR DATASET'}`,
        ].join('  |  '),
      );
    },
    [addLog],
  );

  if (!mounted || !snapshot) {
    return (
      <main style={{ padding: 16, ...mono }}>
        Loading diagnostic…
      </main>
    );
  }

  const {
    settings,
    year,
    today,
    weekStart,
    weekEnd,
    marks,
    version,
    weekSessions,
    yearSessions,
    yearInWeek,
    yearIds,
    weekIds,
    examIds,
    result,
    rows,
  } = snapshot;

  const daySessions = weekSessions.filter((s) => s.date === selectedDate);
  const termCoversWeek =
    weekStart >= settings.term.startDate && weekEnd <= settings.term.endDate;

  const orphanCount = weekSessions.filter((s) => !yearIds.has(s.id)).length;

  return (
    <main style={{ padding: 16, maxWidth: '100%', background: '#fff' }}>
      <h1 style={{ font: '700 18px/1.3 system-ui, sans-serif', margin: '0 0 4px' }}>
        Attendance diagnostic
      </h1>
      <p style={{ ...mono, color: '#666', margin: '0 0 20px' }}>
        Temporary route. Delete after the test matrix passes.
      </p>

      {/* ------------------------------------------------------------------ */}
      <Section title="1 · Environment">
        <table style={{ borderCollapse: 'collapse' }}>
          <tbody>
            <tr><td style={headCell}>Academic year</td><td style={cell}>{year}</td></tr>
            <tr><td style={headCell}>Today</td><td style={cell}>{today}</td></tr>
            <tr><td style={headCell}>Term start</td><td style={cell}>{settings.term.startDate}</td></tr>
            <tr><td style={headCell}>Term end</td><td style={cell}>{settings.term.endDate}</td></tr>
            <tr>
              <td style={headCell}>Term length (days)</td>
              <td style={cell}>
                {settings.term.startDate === settings.term.endDate ? (
                  <Verdict ok={false} text="1 DAY — term never configured. PRIME SUSPECT." />
                ) : (
                  'more than one day'
                )}
              </td>
            </tr>
            <tr><td style={headCell}>DataVersion</td><td style={cell}>{version}</td></tr>
            <tr><td style={headCell}>Working days (0=Mon)</td><td style={cell}>{settings.college.workingDays.join(', ')}</td></tr>
            <tr><td style={headCell}>Extras enabled</td><td style={cell}>{String(settings.extraClassesEnabled)}</td></tr>
            <tr><td style={headCell}>Viewing week</td><td style={cell}>{weekStart} → {weekEnd}</td></tr>
            <tr>
              <td style={headCell}>Term covers this week</td>
              <td style={cell}><Verdict ok={termCoversWeek} text={termCoversWeek ? 'YES' : 'NO — week generated outside the term'} /></td>
            </tr>
            <tr><td style={headCell}>Sessions: week dataset</td><td style={cell}>{weekSessions.length}</td></tr>
            <tr><td style={headCell}>Sessions: year dataset (whole term)</td><td style={cell}>{yearSessions.length}</td></tr>
            <tr><td style={headCell}>Year dataset inside this week</td><td style={cell}>{yearInWeek.length}</td></tr>
            <tr>
              <td style={headCell}>Week sessions missing from year dataset</td>
              <td style={cell}>
                <Verdict ok={orphanCount === 0} text={orphanCount === 0 ? '0 — window contract OK' : `${orphanCount} — WINDOW MISMATCH CONFIRMED`} />
              </td>
            </tr>
            <tr><td style={headCell}>Raw marks stored</td><td style={cell}>{Object.keys(marks).length}</td></tr>
          </tbody>
        </table>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="2 · Effective exam subjects">
        <p style={{ ...mono, margin: '0 0 6px' }}>
          Override for this year:{' '}
          {JSON.stringify(settings.examSubjectsByYear[year] ?? null)}
        </p>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={headCell}>subjectId</th>
              <th style={headCell}>in effective list</th>
              <th style={headCell}>in getYearResult()</th>
              <th style={headCell}>categories returned</th>
              <th style={headCell}>legal categories</th>
            </tr>
          </thead>
          <tbody>
            {examIds.map((id) => {
              const sub = result.subjects.find((s) => s.subjectId === id);
              return (
                <tr key={id}>
                  <td style={cell}>{id}</td>
                  <td style={cell}>yes</td>
                  <td style={cell}><Verdict ok={Boolean(sub)} text={sub ? 'yes' : 'MISSING'} /></td>
                  <td style={cell}>{sub ? sub.categories.map((c) => c.category).join(', ') || '(none)' : '—'}</td>
                  <td style={cell}>{categoriesForSubject(id).join(', ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="3 · Selected day — mark trace">
        <div style={{ marginBottom: 8, ...mono }}>
          <button onClick={() => setSelectedDate(addDays(selectedDate, -7))} style={{ marginRight: 6 }}>
            ◀ week
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value as ISODate)}
          />
          <button onClick={() => setSelectedDate(addDays(selectedDate, 7))} style={{ marginLeft: 6 }}>
            week ▶
          </button>
          <button onClick={() => setSelectedDate(todayISO())} style={{ marginLeft: 6 }}>
            today
          </button>
        </div>

        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={headCell}>subject</th>
              <th style={headCell}>cat</th>
              <th style={headCell}>time</th>
              <th style={headCell}>w</th>
              <th style={headCell}>origin</th>
              <th style={headCell}>generated status</th>
              <th style={headCell}>raw mark</th>
              <th style={headCell}>match</th>
              <th style={headCell}>in year dataset</th>
              <th style={headCell}>actions</th>
              <th style={headCell}>session id</th>
            </tr>
          </thead>
          <tbody>
            {daySessions.length === 0 && (
              <tr><td style={cell} colSpan={11}>No sessions generated for this date.</td></tr>
            )}
            {daySessions.map((s) => {
              const raw = marks[s.id] ?? 'unmarked';
              const match = raw === s.status;
              const inYear = yearIds.has(s.id);
              return (
                <tr key={s.id}>
                  <td style={cell}>{s.subjectId}</td>
                  <td style={cell}>{s.category}</td>
                  <td style={cell}>{s.start}–{s.end}</td>
                  <td style={cell}>{s.weight}</td>
                  <td style={cell}>{s.origin}</td>
                  <td style={cell}>{s.status}</td>
                  <td style={cell}>{raw}</td>
                  <td style={cell}><Verdict ok={match} text={match ? 'ok' : 'DIFFERS'} /></td>
                  <td style={cell}><Verdict ok={inYear} text={inYear ? 'yes' : 'NO'} /></td>
                  <td style={cell}>
                    <button onClick={() => applyMark(s, 'present')}>P</button>{' '}
                    <button onClick={() => applyMark(s, 'absent')}>A</button>{' '}
                    <button onClick={() => applyMark(s, 'not-conducted')}>C</button>{' '}
                    <button onClick={() => applyMark(s, 'unmarked')}>U</button>
                  </td>
                  <td style={cell}>{s.id}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="4 · Week dataset vs year dataset (same week)">
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={headCell}>date</th>
              <th style={headCell}>subject</th>
              <th style={headCell}>cat</th>
              <th style={headCell}>status (week)</th>
              <th style={headCell}>status (year)</th>
              <th style={headCell}>raw mark</th>
              <th style={headCell}>in term</th>
              <th style={headCell}>in week set</th>
              <th style={headCell}>in year set</th>
            </tr>
          </thead>
          <tbody>
            {weekSessions.map((s) => {
              const fromYear = yearInWeek.find((y) => y.id === s.id);
              const inTerm =
                s.date >= settings.term.startDate && s.date <= settings.term.endDate;
              return (
                <tr key={s.id}>
                  <td style={cell}>{s.date}</td>
                  <td style={cell}>{s.subjectId}</td>
                  <td style={cell}>{s.category}</td>
                  <td style={cell}>{s.status}</td>
                  <td style={cell}>{fromYear ? fromYear.status : '—'}</td>
                  <td style={cell}>{marks[s.id] ?? 'unmarked'}</td>
                  <td style={cell}>{inTerm ? 'yes' : 'NO'}</td>
                  <td style={cell}>{weekIds.has(s.id) ? 'yes' : 'no'}</td>
                  <td style={cell}>
                    <Verdict ok={yearIds.has(s.id)} text={yearIds.has(s.id) ? 'yes' : 'NO'} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="5 · Independent full-term tally vs getYearResult()">
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={headCell}>subject</th>
              <th style={headCell}>cat</th>
              <th style={headCell}>P</th>
              <th style={headCell}>A</th>
              <th style={headCell}>C</th>
              <th style={headCell}>past unmarked</th>
              <th style={headCell}>future unmarked</th>
              <th style={headCell}>opening</th>
              <th style={headCell}>excluded</th>
              <th style={headCell}>expected</th>
              <th style={headCell}>actual</th>
              <th style={headCell}>%</th>
              <th style={headCell}>verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.subjectId}-${r.category}`}>
                <td style={cell}>{r.subjectId}</td>
                <td style={cell}>{r.category}</td>
                <td style={cell}>{r.tally.present}</td>
                <td style={cell}>{r.tally.absent}</td>
                <td style={cell}>{r.tally.cancelled}</td>
                <td style={cell}>{r.tally.pastUnmarked}</td>
                <td style={cell}>{r.tally.futureUnmarked}</td>
                <td style={cell}>
                  {r.opening ? `${r.opening.attended}/${r.opening.conducted}` : '—'}
                </td>
                <td style={cell}>{r.excluded ? 'yes' : 'no'}</td>
                <td style={cell}>{r.expectedAttended}/{r.expectedConducted}</td>
                <td style={cell}>
                  {r.actual ? `${r.actual.attended}/${r.actual.conducted}` : 'NO CATEGORY'}
                </td>
                <td style={cell}>{r.actual ? r.actual.percentDisplay : '—'}</td>
                <td style={cell}>
                  <Verdict
                    ok={r.pass}
                    text={
                      !r.subjectPresent
                        ? 'SUBJECT MISSING'
                        : !r.actual
                          ? 'CATEGORY MISSING'
                          : r.pass
                            ? 'PASS'
                            : 'MISMATCH'
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="6 · Action log (newest first)">
        <pre style={{ ...mono, background: '#f7f7f7', padding: 8, margin: 0 }}>
          {log.length === 0 ? 'No diagnostic marks made yet.' : log.join('\n')}
        </pre>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="7 · Raw marks">
        <pre style={{ ...mono, background: '#f7f7f7', padding: 8, margin: 0 }}>
          {JSON.stringify(marks, null, 2)}
        </pre>
      </Section>
    </main>
  );
}
