// =============================================================================
// app/attendance/calculate.ts
// -----------------------------------------------------------------------------
// Sessions in, percentages out. The last pure-logic file in the stack.
//
//     Session[]  ─→  exclusions  ─→  opening balance  ─→  policy  ─→  Result
//
// Nothing here writes to storage. Nothing here touches React.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ TRAP 5 — NOTHING IS CACHED. EVER.
// ═════════════════════════════════════════════════════════════════════════════
// There is no memoisation in this file. No module-level result store, no
// WeakMap keyed on inputs, no "only recompute if dirty" flag.
//
// Why: the spec requires that toggling an exclusion, editing an extra class's
// countsToward, or importing an opening balance updates every percentage
// INSTANTLY. A cache is a promise to return a stale answer under conditions
// you did not fully enumerate. On a dataset this size — a few thousand
// sessions at most — full recomputation costs under a millisecond.
//
// If profiling ever says otherwise, memoise in the React layer where the
// invalidation key is explicit. Never here.
// ═════════════════════════════════════════════════════════════════════════════
//
// OTHER TRAPS ENFORCED HERE:
//   TRAP 2 — an excluded subject's OPENING BALANCE is ignored too. Skipping
//            the sessions but keeping the carried-forward figures is the
//            subtlest bug in the whole system, because the number still looks
//            plausible. See categoryResult().
//   TRAP 8 — the exam-subject lock is REPORTED here (isExamSubject on the
//            result) so the UI can grey the toggle. The rule itself lives in
//            curriculum.ts and is not reimplemented.
//   TRAP 9 — only subjects that actually appear in the student's own data are
//            returned. The curriculum lists what is POSSIBLE; this returns
//            what is REAL. No "ENT — 0%" for someone who never studied ENT.
// =============================================================================

import type {
  AcademicYear,
  CategoryResult,
  ClassCategory,
  OverallResult,
  SafetyBand,
  Session,
  SubjectId,
  SubjectResult,
  YearResult,
} from './types';

import { SAFETY_THRESHOLDS } from './types';

import {
  ACADEMIC_YEARS,
  categoriesForSubject,
  compareSubjects,
  isExamSubject,
  subjectName,
} from '@/lib/attendance/curriculum';

import {
  getEntOphthaInFinalYear,
  getExclusion,
  getOpeningBalance,
  getSettings,
  isExcluded,
} from './store';

import { generateForYear } from './generate';


// -----------------------------------------------------------------------------
// SECTION 1 — Primitives
//
// Every number in the app funnels through these three functions, so rounding
// is identical everywhere. Two screens disagreeing by 0.1% reads as a bug even
// when both are individually defensible.
// -----------------------------------------------------------------------------

/**
 * attended / conducted as a percentage, one decimal place.
 * Zero conducted returns 0 — callers must check `isEmpty` to distinguish
 * "nothing happened yet" from "you attended nothing".
 */
export function percentOf(attended: number, conducted: number): number {
  if (conducted <= 0) return 0;
  return Math.round((attended / conducted) * 1000) / 10;
}

/**
 * Which colour band? Bands are relative to the student's target, not to a
 * hardcoded 75 — a department demanding 80% should shade differently.
 *
 *   at or above target                 → safe
 *   within warningMargin below         → warning
 *   within dangerMargin below          → danger
 *   further below                      → critical
 */
export function bandFor(percent: number, target: number): SafetyBand {
  if (percent >= target) return 'safe';
  const deficit = target - percent;
  if (deficit <= SAFETY_THRESHOLDS.warningMargin) return 'warning';
  if (deficit <= SAFETY_THRESHOLDS.dangerMargin) return 'danger';
  return 'critical';
}

/**
 * How many more classes must be attended, in a row, to reach target?
 *
 *     (attended + n) / (conducted + n) >= target/100
 *
 * Solving for n:
 *
 *     n >= (target*conducted - 100*attended) / (100 - target)
 *
 * Returns 0 when already at target. Returns Infinity when target is 100 and
 * the student has any absence at all — mathematically true and worth saying
 * plainly rather than hiding behind a large finite number.
 */
export function classesNeeded(
  attended: number,
  conducted: number,
  target: number,
): number {
  if (conducted <= 0) return 0;
  if (percentOf(attended, conducted) >= target) return 0;
  if (target >= 100) return attended >= conducted ? 0 : Infinity;

  const n = (target * conducted - 100 * attended) / (100 - target);
  return Math.max(0, Math.ceil(n));
}

/**
 * How many upcoming classes can be missed before dropping below target?
 *
 *     attended / (conducted + n) >= target/100
 *     n <= (100*attended / target) - conducted
 *
 * Returns 0 when already below target — the honest answer to "how many can I
 * skip?" when you are already short is "none, and you owe some".
 */
export function classesSkippable(
  attended: number,
  conducted: number,
  target: number,
): number {
  if (conducted <= 0) return 0;
  if (target <= 0) return Infinity;
  if (percentOf(attended, conducted) < target) return 0;

  const n = (100 * attended) / target - conducted;
  return Math.max(0, Math.floor(n));
}


// -----------------------------------------------------------------------------
// SECTION 2 — Counting one category
//
// The weighting rule: a session contributes its WEIGHT, not 1. A three-hour
// clinical block the college logs as three classes has weight 3, and both
// numerator and denominator move by 3.
//
// Status semantics:
//   present        → numerator + denominator
//   absent         → denominator only
//   not-conducted  → neither. Removed from existence, not counted as a miss.
//   unmarked       → neither. It has not happened yet, or the student has not
//                    said. Counting it either way would be a guess.
// -----------------------------------------------------------------------------

interface RawCount {
  conducted: number;
  attended: number;
  /** Sessions that exist but are still unmarked. Drives the "N to mark" nudge. */
  unmarked: number;
}

const EMPTY_COUNT: RawCount = { conducted: 0, attended: 0, unmarked: 0 };

function countSessions(sessions: Session[]): RawCount {
  let conducted = 0;
  let attended = 0;
  let unmarked = 0;

  for (const s of sessions) {
    const w = s.weight > 0 ? s.weight : 1;

    switch (s.status) {
      case 'present':
        conducted += w;
        attended += w;
        break;
      case 'absent':
        conducted += w;
        break;
      case 'unmarked':
        unmarked += w;
        break;
      case 'not-conducted':
      default:
        break;
    }
  }
  return { conducted, attended, unmarked };
}

/**
 * Splits a category's sessions by whether they came from an extra class.
 *
 * Needed because extraClassPolicy decides whether extras touch the
 * DENOMINATOR, and that decision cannot be made while counting — the two
 * groups have to be tallied separately first.
 */
function splitExtras(sessions: Session[]): {
  regular: Session[];
  extra: Session[];
} {
  const regular: Session[] = [];
  const extra: Session[] = [];
  for (const s of sessions) {
    if (s.origin === 'extra') extra.push(s);
    else regular.push(s);
  }
  return { regular, extra };
}


// -----------------------------------------------------------------------------
// SECTION 3 — One category result
//
// ⚠ TRAP 2 LIVES HERE.
//   When a subject/category is excluded, BOTH its sessions AND its opening
//   balance are skipped. Dropping only the sessions leaves the carried-forward
//   figures silently inflating the total — and because the resulting number is
//   still plausible, nobody notices until an exam board disagrees.
//
// ⚠ EXTRA CLASS POLICY.
//   'add'    → extras behave exactly like regular classes. Both numerator and
//              denominator move. The percentage can go down if you skip one.
//   'ignore' → extras add to the NUMERATOR only. The denominator is untouched.
//              This is the "makeup classes repair your percentage without
//              changing how many were conducted" model some departments use.
//              The result is clamped to 100, because 34/30 is not a percentage
//              anyone can put on a form.
// -----------------------------------------------------------------------------

export interface CategoryOptions {
  year: AcademicYear;
  subjectId: SubjectId;
  category: ClassCategory;
  target: number;
  extraPolicy: 'add' | 'ignore';
  /** Pre-filtered to this year/subject/category by the caller. */
  sessions: Session[];
}

export function categoryResult(options: CategoryOptions): CategoryResult {
  const { year, subjectId, category, target, extraPolicy, sessions } = options;

  const excluded = isExcluded(year, subjectId, category);

  // ---- Excluded: zeroed out entirely, opening balance included. TRAP 2. ----
  if (excluded) {
    return {
      category,
      conducted: 0,
      attended: 0,
      percent: 0,
      isEmpty: true,
      band: 'safe',
      canSkip: 0,
      mustAttend: 0,
      targetUnreachable: false,
    };
  }

  const { regular, extra } = splitExtras(sessions);
  const regularCount = countSessions(regular);
  const extraCount = extra.length > 0 ? countSessions(extra) : EMPTY_COUNT;

  // ---- Opening balance. Only reached when NOT excluded. ----
  const opening = getOpeningBalance(year, subjectId, category);

  let conducted = regularCount.conducted + (opening?.conducted ?? 0);
  let attended = regularCount.attended + (opening?.attended ?? 0);

  if (extraPolicy === 'add') {
    conducted += extraCount.conducted;
    attended += extraCount.attended;
  } else {
    // 'ignore' — numerator only, denominator untouched.
    attended += extraCount.attended;
  }

  // Under 'ignore', enough makeup classes can push attended past conducted.
  // Clamp rather than report a percentage above 100.
  if (attended > conducted) attended = conducted;

  const isEmpty = conducted === 0;
  const percent = percentOf(attended, conducted);

  const mustAttendRaw = classesNeeded(attended, conducted, target);
  const unreachable = !Number.isFinite(mustAttendRaw);

  return {
    category,
    conducted,
    attended,
    percent,
    isEmpty,
    band: isEmpty ? 'safe' : bandFor(percent, target),
    canSkip: isEmpty ? 0 : classesSkippable(attended, conducted, target),
    mustAttend: unreachable ? 0 : mustAttendRaw,
    targetUnreachable: unreachable,
  };
}


// -----------------------------------------------------------------------------
// SECTION 4 — One subject result
//
// ⚠ TRAP 9 — only categories that actually have data are returned. A subject
//   with theory sessions and no practicals returns ONE category, not two with
//   a fake 0%.
//
// The subject-level total is the SUM of its categories, not the average of
// their percentages. Averaging 90% of 10 classes with 50% of 100 classes gives
// 70%, which is wrong by a wide margin — the real figure is 53.6%.
// -----------------------------------------------------------------------------

export interface SubjectOptions {
  year: AcademicYear;
  subjectId: SubjectId;
  target: number;
  extraPolicy: 'add' | 'ignore';
  /** Pre-filtered to this year and subject. */
  sessions: Session[];
  examOverrides: Partial<Record<AcademicYear, SubjectId[]>> | undefined;
  entOphthaInFinalYear: boolean;
}

export function subjectResult(options: SubjectOptions): SubjectResult {
  const {
    year,
    subjectId,
    target,
    extraPolicy,
    sessions,
    examOverrides,
    entOphthaInFinalYear,
  } = options;

  // Which categories does this subject legally have, and of those, which
  // actually appear in the student's data? Intersection of the two.
  const legal = categoriesForSubject(subjectId);
  const present = new Set(sessions.map((s) => s.category));
  const active = legal.filter((c) => present.has(c));

  const categories: CategoryResult[] = active.map((category) =>
    categoryResult({
      year,
      subjectId,
      category,
      target,
      extraPolicy,
      sessions: sessions.filter((s) => s.category === category),
    }),
  );

  // Sum, never average. See the note above.
  const conducted = categories.reduce((n, c) => n + c.conducted, 0);
  const attended = categories.reduce((n, c) => n + c.attended, 0);
  const percent = percentOf(attended, conducted);

  const exclusion = getExclusion(year, subjectId);
  const fullyExcluded =
    exclusion.whole === true ||
    (active.length > 0 && active.every((c) => isExcluded(year, subjectId, c)));

  return {
    subjectId,
    subjectName: subjectName(subjectId),
    academicYear: year,
    categories,
    conducted,
    attended,
    percent,
    band: conducted === 0 ? 'safe' : bandFor(percent, target),
    isExcluded: fullyExcluded,
    // ⚠ TRAP 8 — reported, not enforced. curriculum.ts owns the rule; the UI
    // calls getExclusionLock() before rendering a toggle.
    isExamSubject: isExamSubject(
      subjectId,
      year,
      examOverrides,
      entOphthaInFinalYear,
    ),
  };
}


// -----------------------------------------------------------------------------
// SECTION 5 — One year result
//
// ⚠ TRAP 9 — the subject list is derived from the SESSIONS, not from the
//   curriculum. If the student never scheduled it, it does not appear.
// -----------------------------------------------------------------------------

export interface YearOptions {
  year: AcademicYear;
  /** Omit to generate from storage. Pass explicitly in tests. */
  sessions?: Session[];
}

export function yearResult(options: YearOptions): YearResult {
  const { year } = options;
  const settings = getSettings();
  const target = settings.term.targetPercent;
  const extraPolicy = settings.extraClassPolicy;

  // Lives in the PROFILE store, not attendance settings. Read via the bridge
  // in store.ts so the cross-store read happens in exactly one place.
  const entOphtha = getEntOphthaInFinalYear();

  const sessions = options.sessions ?? generateForYear(year);

  // TRAP 9: subjects come from real data only.
  const subjectIds = [...new Set(sessions.map((s) => s.subjectId))].sort(
    compareSubjects,
  );

  const subjects = subjectIds.map((subjectId) =>
    subjectResult({
      year,
      subjectId,
      target,
      extraPolicy,
      sessions: sessions.filter((s) => s.subjectId === subjectId),
      examOverrides: settings.examSubjectsByYear,
      entOphthaInFinalYear: entOphtha,
    }),
  );

  // Excluded subjects contribute nothing. Their categoryResult already
  // returned zeros, so this sum is correct without a second filter — but the
  // filter is kept explicit so the intent survives a future refactor.
  const counted = subjects.filter((s) => !s.isExcluded);

  const conducted = counted.reduce((n, s) => n + s.conducted, 0);
  const attended = counted.reduce((n, s) => n + s.attended, 0);
  const percent = percentOf(attended, conducted);

  return {
    academicYear: year,
    subjects,
    conducted,
    attended,
    percent,
    band: conducted === 0 ? 'safe' : bandFor(percent, target),
  };
}


// -----------------------------------------------------------------------------
// SECTION 6 — Overall result
//
// Every year the student has data for, plus a cumulative total.
//
// ⚠ TRAP 9 again — a year with no sessions at all is omitted entirely. A
//   third-year does not want to scroll past three empty year cards.
// -----------------------------------------------------------------------------

export function overallResult(): OverallResult {
  const settings = getSettings();
  const target = settings.term.targetPercent;

  const years: YearResult[] = [];

  for (const year of ACADEMIC_YEARS) {
    const sessions = generateForYear(year);
    if (sessions.length === 0) continue; // TRAP 9
    years.push(yearResult({ year, sessions }));
  }

  const conducted = years.reduce((n, y) => n + y.conducted, 0);
  const attended = years.reduce((n, y) => n + y.attended, 0);
  const percent = percentOf(attended, conducted);

  return {
    years,
    conducted,
    attended,
    percent,
    band: conducted === 0 ? 'safe' : bandFor(percent, target),
    // Stamped so the UI can prove freshness during debugging. Not a cache key.
    computedAt: Date.now(),
  };
}


// -----------------------------------------------------------------------------
// SECTION 7 — Projections
//
// "How many extra classes do I need to attend to reach 75%?"
//
// The answer depends on extraClassPolicy, and the two answers are very
// different — which is exactly why the student sets the policy once and never
// thinks about it again.
//
//   'add'    → an extra class moves numerator AND denominator. Repairing a
//              shortfall is slow, because each attended class also raises the
//              bar. Same arithmetic as classesNeeded().
//
//   'ignore' → an extra class moves the numerator only. Each one is worth far
//              more, and the requirement is simply the gap to target.
// -----------------------------------------------------------------------------

export interface Projection {
  /** Current figures the projection was computed from. */
  conducted: number;
  attended: number;
  percent: number;
  target: number;
  /** Extra classes required to reach target. 0 when already there. */
  extraNeeded: number;
  /** True when target cannot be reached by attending extras. */
  impossible: boolean;
  /** Ready-to-render sentence. */
  message: string;
}

export function projectExtraClassesNeeded(
  attended: number,
  conducted: number,
  target: number,
  policy: 'add' | 'ignore',
): Projection {
  const percent = percentOf(attended, conducted);

  const base: Omit<Projection, 'extraNeeded' | 'impossible' | 'message'> = {
    conducted,
    attended,
    percent,
    target,
  };

  if (conducted === 0) {
    return {
      ...base,
      extraNeeded: 0,
      impossible: false,
      message: 'No classes recorded yet.',
    };
  }

  if (percent >= target) {
    return {
      ...base,
      extraNeeded: 0,
      impossible: false,
      message: `You are at ${percent}% — already above the ${target}% requirement.`,
    };
  }

  if (policy === 'ignore') {
    // Denominator frozen. Need attended >= target% of the existing conducted.
    const required = Math.ceil((target / 100) * conducted);
    const needed = Math.max(0, required - attended);
    const reachable = required <= conducted;

    return {
      ...base,
      extraNeeded: reachable ? needed : 0,
      impossible: !reachable,
      message: reachable
        ? `Attend ${needed} extra ${needed === 1 ? 'class' : 'classes'} to reach ${target}%.`
        : `${target}% cannot be reached — it would need more attendance than classes conducted.`,
    };
  }

  // 'add' — each extra raises the bar as well as the score.
  const needed = classesNeeded(attended, conducted, target);

  if (!Number.isFinite(needed)) {
    return {
      ...base,
      extraNeeded: 0,
      impossible: true,
      message: `${target}% cannot be reached by attending extra classes.`,
    };
  }

  return {
    ...base,
    extraNeeded: needed,
    impossible: false,
    message: `Attend ${needed} extra ${needed === 1 ? 'class' : 'classes'} in a row to reach ${target}%.`,
  };
}

/** Projection for one subject/category, read straight from current data. */
export function projectForCategory(
  year: AcademicYear,
  subjectId: SubjectId,
  category: ClassCategory,
): Projection {
  const settings = getSettings();
  const sessions = generateForYear(year).filter(
    (s) => s.subjectId === subjectId && s.category === category,
  );

  const result = categoryResult({
    year,
    subjectId,
    category,
    target: settings.term.targetPercent,
    extraPolicy: settings.extraClassPolicy,
    sessions,
  });

  return projectExtraClassesNeeded(
    result.attended,
    result.conducted,
    settings.term.targetPercent,
    settings.extraClassPolicy,
  );
}


// -----------------------------------------------------------------------------
// SECTION 8 — Display helpers
//
// Kept here so the marking page, the summary page and any future widget all
// phrase the same number identically.
// -----------------------------------------------------------------------------

/** "92.5%" — or "—" when nothing has been conducted. Never "0%" for empty. */
export function formatPercent(result: {
  percent: number;
  isEmpty?: boolean;
  conducted: number;
}): string {
  if (result.isEmpty || result.conducted === 0) return '—';
  return `${result.percent}%`;
}

/** "45 / 50". */
export function formatFraction(attended: number, conducted: number): string {
  return `${attended} / ${conducted}`;
}

/** Tailwind-friendly tokens. Kept as plain strings so the UI owns the palette. */
export const BAND_LABEL: Readonly<Record<SafetyBand, string>> = Object.freeze({
  safe: 'Safe',
  warning: 'Watch',
  danger: 'At risk',
  critical: 'Critical',
});

/**
 * The one-line status a student actually wants to read.
 * Phrased around what they can do, not around what the number is.
 */
export function statusLine(result: CategoryResult, target: number): string {
  if (result.isEmpty) return 'No classes recorded yet.';

  if (result.percent >= target) {
    if (result.canSkip === 0) {
      return `At ${result.percent}%. Attend the next one to stay above ${target}%.`;
    }
    return `At ${result.percent}%. You can miss ${result.canSkip} more and stay above ${target}%.`;
  }

  if (result.targetUnreachable) {
    return `At ${result.percent}%. ${target}% is no longer reachable this term.`;
  }

  return `At ${result.percent}%. Attend ${result.mustAttend} in a row to reach ${target}%.`;
}
