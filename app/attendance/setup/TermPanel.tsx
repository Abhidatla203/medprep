'use client';

// =============================================================================
// app/attendance/setup/TermPanel.tsx
// -----------------------------------------------------------------------------
// Term start and end dates.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ WHY THIS FILE EXISTS — THE MOST EXPENSIVE BUG OF THE REBUILD
// ═════════════════════════════════════════════════════════════════════════════
//  A grep of app/ and lib/ on 25 Sep 2026 found that NOTHING in the entire
//  application ever wrote settings.term. Every single reference was a read, a
//  default, or a legacy migration:
//
//      store.ts:278, 307-308   default BOTH dates to todayISO()
//      generate.ts:686         builds the year window from term.startDate/endDate
//      generate.ts:699, 727    gates week generation on the same range
//
//  So the only term value that had ever existed on a real device was
//  today → today. A ONE-DAY TERM.
//
//  What that did, in order:
//    1. generateForYear() produced sessions for a single date.
//    2. generateForWeek() still produced the full week, because it generates
//       independently when the week falls outside the term.
//    3. The student marked classes. WeekStrip showed them. MarkList showed them.
//    4. getYearResult() never saw 20 of the 24 sessions.
//    5. The rings reported one attended class out of a week of marks.
//    6. OBG vanished from the grid entirely — no in-term session, no subject.
//
//  Every one of those looked like a rendering bug. None of them were. Months
//  went into rewriting RingGrid chasing a defect that lived in a date field
//  with no input attached to it.
//
//  ★ THE LESSON, WRITTEN DOWN SO IT IS NOT RELEARNED:
//    A required setting with a plausible-looking default and no UI is worse
//    than one with no default at all. A missing value announces itself. A
//    default of `today` silently poisons every downstream calculation while
//    looking, in the debugger, entirely reasonable.
//
//  This panel is therefore deliberately LOUD. It warns when the term is
//  implausibly short, when today falls outside it, and when the range runs
//  backwards. Those three states are not edge cases — they are the exact
//  states that produced the bug.
// ═════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ISODate } from '../types';
import { getSettings, updateSettings } from '../store';
import { formatDateDMY, isISODate, todayISO } from '@/lib/attendance/datetime';


// -----------------------------------------------------------------------------
// Thresholds for the warnings
//
// Not arbitrary. A single MBBS term is months long; anything under two weeks is
// almost certainly an unconfigured default rather than a real academic term.
// -----------------------------------------------------------------------------

const SUSPICIOUSLY_SHORT_DAYS = 14;

/** Whole days between two ISO dates, inclusive of both ends. */
function daysBetween(from: ISODate, to: ISODate): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

type Severity = 'error' | 'warn' | 'ok';

interface Diagnosis {
  severity: Severity;
  message: string;
}

/**
 * ★ The whole point of this panel.
 *
 * Silence here means the term is usable. Anything else names the exact
 * downstream consequence, because "invalid date range" teaches nobody
 * anything about why their rings are empty.
 */
function diagnose(start: string, end: string, today: ISODate): Diagnosis {
  if (!isISODate(start) || !isISODate(end)) {
    return { severity: 'error', message: 'Both dates are needed before attendance can be calculated.' };
  }

  if (end < start) {
    return { severity: 'error', message: 'The end date is before the start date. No classes will be generated.' };
  }

  const span = daysBetween(start, end);

  if (span <= 1) {
    return {
      severity: 'error',
      message:
        'A one-day term. Your rings will only count classes on this single date — everything else you mark will be ignored.',
    };
  }

  if (span < SUSPICIOUSLY_SHORT_DAYS) {
    return {
      severity: 'warn',
      message: `Only ${span} days. Anything you mark outside this range will not reach your rings.`,
    };
  }

  if (today < start) {
    return {
      severity: 'warn',
      message: `Your term has not started yet. Until ${formatDateDMY(start)}, nothing you mark will count.`,
    };
  }

  if (today > end) {
    return {
      severity: 'warn',
      message: `Your term ended on ${formatDateDMY(end)}. Classes marked after that date will not count.`,
    };
  }

  return { severity: 'ok', message: '' };
}


// -----------------------------------------------------------------------------

export default function TermPanel(props: { revision: number }) {
  const { revision } = props;

  const [open, setOpen] = useState(false);

  // Local draft state, unlike the rest of setup.
  //
  // ⚠ DELIBERATE EXCEPTION to the page's write-immediately rule. A date input
  //   emits a change on every keystroke, so typing "2027" passes through
  //   0002, 0020, 0202 — each of which would be written to storage, bump
  //   DataVersion, invalidate the calculation cache and regenerate the whole
  //   term. Four full recalculations to type one year. The draft is committed
  //   on blur instead.
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');

  const today = todayISO();

  const stored = useMemo(() => {
    void revision;
    return getSettings().term;
  }, [revision]);

  // Re-sync the draft whenever storage changes underneath us — an import, a
  // reset, or another tab. Without this the panel would show stale text.
  useEffect(() => {
    setDraftStart(stored.startDate ?? '');
    setDraftEnd(stored.endDate ?? '');
  }, [stored.startDate, stored.endDate]);

  const commit = useCallback(
    (next: { startDate?: string; endDate?: string }) => {
      const startDate = next.startDate ?? draftStart;
      const endDate = next.endDate ?? draftEnd;

      // Never write a half-formed date. An invalid ISO string in settings is
      // exactly the kind of quiet corruption this panel exists to prevent.
      if (!isISODate(startDate) || !isISODate(endDate)) return;
      if (startDate === stored.startDate && endDate === stored.endDate) return;

      updateSettings({ term: { startDate, endDate } });
    },
    [draftStart, draftEnd, stored.startDate, stored.endDate],
  );

  const diagnosis = diagnose(draftStart, draftEnd, today);
  const span =
    isISODate(draftStart) && isISODate(draftEnd) && draftEnd >= draftStart
      ? daysBetween(draftStart, draftEnd)
      : 0;

  // The collapsed summary carries the warning too. A student who never opens
  // this card still needs to see that their term is broken.
  const summary =
    diagnosis.severity === 'error'
      ? 'Needs attention'
      : span > 0
        ? `${formatDateDMY(draftStart)} – ${formatDateDMY(draftEnd)}`
        : 'Not set';

  return (
    <section className="card mt-4 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-[--color-surface-sunk]"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[--color-ink]">Term dates</span>
            {diagnosis.severity === 'error' && (
              <span className="chip chip-critical shrink-0">Check this</span>
            )}
            {diagnosis.severity === 'warn' && (
              <span className="chip chip-watch shrink-0">Check this</span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-sm text-[--color-ink-muted]">
            {summary}
            {span >= SUSPICIOUSLY_SHORT_DAYS && diagnosis.severity === 'ok' && (
              <span className="text-[--color-ink-faint]"> · {span} days</span>
            )}
          </span>
        </span>
        <span
          className={`shrink-0 text-[--color-ink-faint] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-[--color-line] px-5 py-5">
          <p className="text-sm leading-relaxed text-[--color-ink-muted]">
            Attendance is only counted between these two dates. Anything you mark
            outside them is stored, but will not reach your rings.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="eyebrow mb-1.5 block">Term starts</span>
              <input
                type="date"
                className="field tnum w-full"
                value={draftStart}
                onChange={(e) => setDraftStart(e.target.value)}
                onBlur={() => commit({ startDate: draftStart })}
              />
            </label>

            <label className="block">
              <span className="eyebrow mb-1.5 block">Term ends</span>
              <input
                type="date"
                className="field tnum w-full"
                value={draftEnd}
                min={isISODate(draftStart) ? draftStart : undefined}
                onChange={(e) => setDraftEnd(e.target.value)}
                onBlur={() => commit({ endDate: draftEnd })}
              />
            </label>
          </div>

          {/* ★ The warning. Names the CONSEQUENCE, not the rule — "invalid
              range" teaches nobody why their rings are empty. */}
          {diagnosis.severity !== 'ok' && (
            <p
              className={
                diagnosis.severity === 'error'
                  ? 'rounded-[--radius-field] border border-[--color-critical-line] bg-[--color-critical-soft] px-4 py-3 text-sm leading-relaxed text-[--color-critical]'
                  : 'rounded-[--radius-field] border border-[--color-watch-line] bg-[--color-watch-soft] px-4 py-3 text-sm leading-relaxed text-[--color-watch]'
              }
            >
              {diagnosis.message}
            </p>
          )}

          {diagnosis.severity === 'ok' && (
            <p className="tnum text-sm text-[--color-ink-faint]">
              {span} days · today is inside your term
            </p>
          )}
        </div>
      )}
    </section>
  );
}
