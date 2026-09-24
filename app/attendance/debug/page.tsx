'use client';

// =============================================================================
// app/attendance/debug/page.tsx
// -----------------------------------------------------------------------------
// TEMPORARY. Delete once the calculator is trusted.
//
// Prints the raw output of getYearResult() beside the raw sessions that fed it.
// No formatting, no rounding, no interpretation — the point is to see the
// numbers the display layer is being handed.
//
// ★ WHY THIS EXISTS: three rounds of ring fixes chased a rendering bug that was
//   never in the renderer. The rings now draw attended/conducted faithfully, so
//   a full circle means attended === conducted. If that is wrong, it is wrong
//   upstream. This page makes upstream visible.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';

import { getSettings, runMigrations, subscribe } from '../store';
import { getYearResult } from '../calculate';
import { generateForWeek } from '../generate';
import { todayISO } from '@/lib/attendance/datetime';
import type { ISODate } from '../types';

function toISO(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(iso: ISODate, n: number): ISODate {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export default function DebugPage() {
  const [mounted, setMounted] = useState(false);
  const [revision, setRevision] = useState(0);
  const ran = useRef(false);

  useEffect(() => {
    if (!ran.current) {
      ran.current = true;
      try {
        runMigrations();
      } catch {
        /* ignore */
      }
    }
    setMounted(true);
    return subscribe(() => setRevision((n) => n + 1));
  }, []);

  const data = useMemo(() => {
    if (!mounted) return null;
    void revision;

    const settings = getSettings();
    const year = settings.currentYear;
    const today = todayISO();

    // A generous window, so nothing is missed because of week boundaries.
    const sessions = generateForWeek(year, addDays(today, -28), addDays(today, 7));

    // Independent tally straight off the sessions. If this disagrees with
    // getYearResult below, the bug is inside calculate.ts and nowhere else.
    const tally: Record<string, { present: number; absent: number; cancelled: number; unmarked: number }> = {};

    for (const s of sessions) {
      const key = `${s.subjectName} · ${s.category}`;
      tally[key] ??= { present: 0, absent: 0, cancelled: 0, unmarked: 0 };
      const w = Math.max(1, Math.round(s.weight ?? 1));

      if (s.status === 'present') tally[key].present += w;
      else if (s.status === 'absent') tally[key].absent += w;
      else if (s.status === 'not-conducted') tally[key].cancelled += w;
      else tally[key].unmarked += w;
    }

    return {
      year,
      sessionCount: sessions.length,
      tally,
      result: getYearResult(year),
    };
  }, [mounted, revision]);

  if (!data) return <main className="p-6 text-sm">Loading…</main>;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 pb-24">
      <h1 className="text-xl font-semibold">Calculator debug — {data.year}</h1>

      {/* ---- what the sessions actually say ---- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">
          Independent tally from {data.sessionCount} sessions
        </h2>
        <p className="mb-2 text-xs text-gray-500">
          Counted here, in this file, with no help from calculate.ts.
          conducted should equal present + absent. Cancelled is excluded.
          Unmarked is excluded.
        </p>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1 pr-2">subject · category</th>
              <th className="py-1 pr-2">present</th>
              <th className="py-1 pr-2">absent</th>
              <th className="py-1 pr-2">cancelled</th>
              <th className="py-1 pr-2">unmarked</th>
              <th className="py-1 pr-2">expected</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.tally).map(([key, t]) => {
              const conducted = t.present + t.absent;
              const pct = conducted > 0 ? ((t.present / conducted) * 100).toFixed(1) : '—';
              return (
                <tr key={key} className="border-b">
                  <td className="py-1 pr-2">{key}</td>
                  <td className="py-1 pr-2">{t.present}</td>
                  <td className="py-1 pr-2">{t.absent}</td>
                  <td className="py-1 pr-2">{t.cancelled}</td>
                  <td className="py-1 pr-2">{t.unmarked}</td>
                  <td className="py-1 pr-2 font-semibold">
                    {t.present}/{conducted} = {pct}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ---- what calculate.ts says ---- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">What getYearResult() returns</h2>
        <p className="mb-2 text-xs text-gray-500">
          Compare attended/conducted against the table above. Check whether
          `ratio` is 0–1 or 0–100, and whether `threshold` is 75 or 0.75.
        </p>
        <pre className="overflow-x-auto rounded bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">
          {JSON.stringify(data.result, null, 2)}
        </pre>
      </section>
    </main>
  );
}
