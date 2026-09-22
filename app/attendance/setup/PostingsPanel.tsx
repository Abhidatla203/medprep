'use client';

// =============================================================================
// app/attendance/setup/PostingsPanel.tsx
// -----------------------------------------------------------------------------
// Clinical postings. A posting is a DATE RANGE — "Surgery, 1 Oct to 28 Oct,
// 9am to 1pm, Mon-Sat" — not a weekly timetable slot.
//
// The posting record is the SINGLE SOURCE OF TRUTH. Sessions derive from it on
// demand and are never stored. Change the end date and every derived session
// updates for free — no backfill, no orphaned marks.
//
// Conflicts are REPORTED, not blocked. A posting overlapping a lecture happens
// constantly in a real medical college; the student decides what took place.
//
// ⚠ onSheetChange
//   Raised while this panel's sheet is open so the page can stand SaveBar down.
//   Two pinned footers on screen at once reads as a bug.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';

import type { AcademicYear, DayIndex, Posting, TimeHHMM } from '../types';
import { DAY_NAMES_SHORT } from '../types';

import {
  eachDateInRangeOnDays,
  formatDateDMY,
  formatTimeRange,
  isISODate,
  todayISO,
} from '@/lib/attendance/datetime';

import { SUBJECTS, subjectName } from '@/lib/attendance/curriculum';

import { addPosting, deletePosting, getPostings, updatePosting } from '../store';
import { findPostingConflicts } from '../generate';


const ALL_DAYS: DayIndex[] = [0, 1, 2, 3, 4, 5, 6];

/** Only clinical subjects can have postings. Anatomy has no ward round. */
const CLINICAL_SUBJECTS = SUBJECTS.filter((s) => s.kind === 'clinical');


export default function PostingsPanel(props: {
  year: AcademicYear;
  /** Bumped by the parent's store subscription so this re-reads on change. */
  revision: number;
  onSheetChange?: (open: boolean) => void;
}) {
  const { year, revision, onSheetChange } = props;
  const [sheet, setSheet] = useState<{ posting: Posting | null } | null>(null);

  useEffect(() => {
    onSheetChange?.(sheet !== null);
  }, [sheet, onSheetChange]);

  const postings = useMemo(() => {
    void revision;
    return [...getPostings(year)].sort((a, b) =>
      a.startDate.localeCompare(b.startDate),
    );
  }, [year, revision]);

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="eyebrow">Clinical postings</h2>
        <button
          onClick={() => setSheet({ posting: null })}
          className="btn btn-quiet -mr-2 min-h-10 px-3 text-sm"
        >
          + Add posting
        </button>
      </div>

      {postings.length === 0 ? (
        <div className="card p-5">
          <p className="text-sm text-[--color-ink-muted]">
            No postings yet. Add one when you start a ward rotation — every day
            between the start and end dates is generated automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {postings.map((p) => (
            <PostingRow
              key={p.id}
              posting={p}
              onSelect={() => setSheet({ posting: p })}
            />
          ))}
        </div>
      )}

      {sheet && (
        <PostingSheet
          year={year}
          existing={sheet.posting}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  );
}


// -----------------------------------------------------------------------------
// One posting in the list
// -----------------------------------------------------------------------------

function PostingRow(props: { posting: Posting; onSelect: () => void }) {
  const { posting, onSelect } = props;

  const dayCount = eachDateInRangeOnDays(
    posting.startDate,
    posting.endDate,
    posting.workingDays,
  ).length;

  const today = todayISO();
  const ended = posting.endDate < today;
  const active = posting.startDate <= today && posting.endDate >= today;

  return (
    <button
      onClick={onSelect}
      className={`card card-interactive flex w-full items-center gap-3.5 px-5 py-4 text-left ${
        ended ? 'opacity-55' : ''
      }`}
    >
      <span
        className="h-11 w-[3px] shrink-0 rounded-full bg-[--color-clinical]"
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-[--color-ink]">
            {posting.subjectName || subjectName(posting.subjectId)}
          </span>
          {active && <span className="chip chip-safe shrink-0">Running now</span>}
        </span>
        <span className="tnum mt-0.5 block text-sm text-[--color-ink-soft]">
          {formatDateDMY(posting.startDate)} – {formatDateDMY(posting.endDate)}
        </span>
        <span className="tnum mt-0.5 block text-sm text-[--color-ink-faint]">
          {formatTimeRange(posting.start, posting.end)} · {dayCount}{' '}
          {dayCount === 1 ? 'day' : 'days'}
          {posting.weight > 1 && ` · counts as ${posting.weight} each`}
        </span>
      </span>
      {ended && <span className="chip chip-neutral shrink-0">Ended</span>}
    </button>
  );
}


// -----------------------------------------------------------------------------
// Add / edit sheet
// -----------------------------------------------------------------------------

function PostingSheet(props: {
  year: AcademicYear;
  existing: Posting | null;
  onClose: () => void;
}) {
  const { year, existing, onClose } = props;
  const isEdit = existing !== null;

  const [subjectId, setSubjectId] = useState(existing?.subjectId ?? '');
  const [startDate, setStartDate] = useState(existing?.startDate ?? todayISO());
  const [endDate, setEndDate] = useState(existing?.endDate ?? todayISO());
  const [start, setStart] = useState<TimeHHMM>(existing?.start ?? '09:00');
  const [end, setEnd] = useState<TimeHHMM>(existing?.end ?? '13:00');
  const [workingDays, setWorkingDays] = useState<DayIndex[]>(
    existing?.workingDays ?? [0, 1, 2, 3, 4, 5],
  );
  const [weight, setWeight] = useState(existing?.weight ?? 1);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dayCount = useMemo(() => {
    if (!isISODate(startDate) || !isISODate(endDate) || endDate < startDate) {
      return 0;
    }
    return eachDateInRangeOnDays(startDate, endDate, workingDays).length;
  }, [startDate, endDate, workingDays]);

  /**
   * Live conflict check, WARNING only. A posting clashing with a lecture is a
   * real situation — the student resolves it by marking what actually happened,
   * not by being blocked here.
   */
  const conflicts = useMemo(() => {
    if (!subjectId || dayCount === 0) return [];
    const draft: Posting = {
      id: existing?.id ?? 'draft',
      subjectId,
      subjectName: subjectName(subjectId),
      startDate,
      endDate,
      start,
      end,
      workingDays,
      weight,
      exceptions: [],
      createdAt: 0,
    };
    return findPostingConflicts(year, draft);
  }, [
    year, subjectId, startDate, endDate, start, end,
    workingDays, weight, dayCount, existing?.id,
  ]);

  const toggleDay = (day: DayIndex) => {
    setWorkingDays((cur) => {
      const next = cur.includes(day)
        ? cur.filter((d) => d !== day)
        : [...cur, day].sort((a, b) => a - b);
      return next.length === 0 ? cur : next;
    });
  };

  const handleSave = () => {
    setError(null);

    if (!subjectId) return setError('Choose a department.');
    if (!isISODate(startDate) || !isISODate(endDate)) {
      return setError('Enter valid start and end dates.');
    }
    if (endDate < startDate) {
      return setError('The end date must be on or after the start date.');
    }
    if (start >= end) {
      return setError('The end time must be after the start time.');
    }
    if (dayCount === 0) {
      return setError('That range contains none of the selected days.');
    }

    const payload = {
      subjectId,
      subjectName: subjectName(subjectId),
      startDate,
      endDate,
      start,
      end,
      workingDays,
      weight: weight > 0 ? weight : 1,
    };

    if (isEdit && existing) updatePosting(year, existing.id, payload);
    else addPosting(year, payload);

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
              {isEdit ? 'Edit posting' : 'Add clinical posting'}
            </p>
          </div>

          {/* ---- Body: the ONLY scrolling region ---- */}
          <div className="sheet-body space-y-5 px-5 py-5">
            <L label="Department">
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="field field-select"
              >
                <option value="">Choose a department…</option>
                {CLINICAL_SUBJECTS.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </L>

            <div className="grid grid-cols-2 gap-3">
              <L label="Starts">
                <input
                  type="date" className="field tnum" value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </L>
              <L label="Ends">
                <input
                  type="date" className="field tnum" value={endDate} min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </L>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <L label="From">
                <input
                  type="time" className="field tnum" value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </L>
              <L label="To">
                <input
                  type="time" className="field tnum" value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </L>
            </div>

            <L label="Runs on">
              <div className="flex flex-wrap gap-2">
                {ALL_DAYS.map((d) => (
                  <button
                    key={d}
                    onClick={() => toggleDay(d)}
                    aria-pressed={workingDays.includes(d)}
                    className={`seg min-w-[3rem] flex-none px-3 ${
                      workingDays.includes(d) ? 'seg-on' : ''
                    }`}
                  >
                    {DAY_NAMES_SHORT[d]}
                  </button>
                ))}
              </div>
            </L>

            <L label="Each day counts as">
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

            {dayCount > 0 && (
              <p className="rounded-[--radius-field] border border-[--color-line] bg-[--color-surface-sunk] px-4 py-3 text-sm text-[--color-ink-soft]">
                Generates{' '}
                <span className="tnum font-semibold text-[--color-ink]">{dayCount}</span>{' '}
                {dayCount === 1 ? 'session' : 'sessions'}
                {weight > 1 && ` — ${dayCount * weight} classes in the register`}.
              </p>
            )}

            {conflicts.length > 0 && (
              <div className="rounded-[--radius-field] border border-[--color-watch-line] bg-[--color-watch-soft] px-4 py-3">
                <p className="text-sm font-semibold text-[--color-watch]">
                  Clashes on {conflicts.length}{' '}
                  {conflicts.length === 1 ? 'day' : 'days'}
                </p>
                <p className="mt-1 text-sm text-[--color-watch]">
                  This overlaps existing classes. Still fine to save — mark
                  whichever actually happened on the day.
                </p>
              </div>
            )}

            {error && (
              <p className="rounded-[--radius-field] border border-[--color-critical-line] bg-[--color-critical-soft] px-4 py-3 text-sm text-[--color-critical]">
                {error}
              </p>
            )}

            {isEdit && (
              <div className="border-t border-[--color-line] pt-4">
                {confirming ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirming(false)}
                      className="btn btn-ghost flex-1"
                    >
                      Keep
                    </button>
                    <button
                      onClick={() => {
                        deletePosting(year, existing!.id);
                        onClose();
                      }}
                      className="btn btn-danger flex-1"
                    >
                      Delete posting
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirming(true)}
                    className="btn btn-quiet w-full text-[--color-critical]"
                  >
                    Delete this posting
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ---- Footer: SIBLING of the scroll area. Cannot scroll away. ---- */}
          <div className="sheet-foot flex gap-2 p-3">
            <button onClick={onClose} className="btn btn-ghost flex-1">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!subjectId}
              className="btn btn-primary flex-[2]"
            >
              {isEdit ? 'Save changes' : 'Add posting'}
            </button>
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
