// =============================================================================
// app/attendance/calculate.ts
// -----------------------------------------------------------------------------
// The calculator. Sessions in, numbers out.
//
// REBUILD v4 — see ATTENDANCE_REBUILD_SPEC.txt
// PATCHED 25 Sep 2026 — SECTION 6 (Bug 2) and SECTION 4 (targetUnreachable).
//
// ═════════════════════════════════════════════════════════════════════════════
//  THE FIVE RULES THIS FILE EXISTS TO ENFORCE
// ═════════════════════════════════════════════════════════════════════════════
//
//  1. EXACT RATIO FOR EVERY DECISION.
//     v3 rounded to one decimal FIRST, then compared. A student on 74.96%
//     became 75.0, scored "safe", and was told they needed zero more classes.
//     They were below the line and the college register does not round.
//     Here: `ratio` is the unrounded fraction and is the only thing compared.
//     `percentDisplay` exists solely to be printed.
//
//  2. NO POOLED NUMBERS.
//     There is no overall percentage, no subject percentage, no year
//     percentage. Theory and practical are judged separately at different
//     thresholds. A pooled 78% can read green while Pathology practical sits
//     at 68% and the student is debarred.
//
//  3. TWO THRESHOLDS, RESOLVED PER SUBJECT PER TYPE.
//     Defaults 75% theory / 80% practical and clinical, overridable per
//     subject per type. Passed IN — this file never reads storage to find one.
//
//  4. PURE CORE.
//     Everything in SECTIONS 1–6 is a pure function. No localStorage, no
//     Date.now() in any comparison path, no hidden state. Sections 7–8 are the
//     thin storage-backed layer the UI actually calls, and they are the ONLY
//     part that touches the store.
//
//  5. ONE PASS.
//     v3 walked the session list once per category, per subject, per year.
//     Here the list is bucketed by subject+category in a single traversal,
//     then each bucket is reduced. Results memoise on DataVersion.
//
// ═════════════════════════════════════════════════════════════════════════════
//
// THE MARKING MODEL (universal, not configurable):
//   present        → attended += weight,  conducted += weight
//   absent         → attended += 0,       conducted += weight
//   not-conducted  → nothing. Leaves both sides. ("Cancelled" in the UI.)
//   unmarked       → nothing. Counted only for the "N unmarked" nag.
// =============================================================================

import {
  DEFAULT_THRESHOLDS,
  SAFETY_THRESHOLDS,
  type AcademicYear,
  type AttendanceResult,
  type CategoryResult,
  type ClassCategory,
  type DataVersion,
  type ExtrasBreakdown,
  type Id,
  type ISODate,
  type SafetyBand,
  type Session,
  type SubjectId,
  type SubjectResult,
  type ThresholdPercent,
  type YearResult,
} from './types';

import {
  categoriesForSubject,
  effectiveExamSubjects,
  subjectName as curriculumSubjectName,
  subjectShort,
} from '@/lib/attendance/curriculum';

import { todayISO } from '@/lib/attendance/datetime';


// -----------------------------------------------------------------------------
// SECTION 1 — Pure arithmetic primitives
//
// Small, boring, and individually testable. Every number in the app comes out
// of one of these five functions.
// -----------------------------------------------------------------------------

/**
 * THE EXACT FRACTION. 0–1. Never rounded.
 * This is what every comparison in this file uses. See RULE 1.
 */
export function exactRatio(attended: number, conducted: number): number {
  if (conducted <= 0) return 0;
  return attended / conducted;
}

/**
 * DISPLAY ONLY. One decimal place.
 *
 * ⚠ If you ever find yourself writing `if (percentDisplay >= threshold)`,
 *   stop. That is the v3 bug, reintroduced. Compare `ratio * 100` instead.
 */
export function toDisplayPercent(ratio: number): number {
  return Math.round(ratio * 1000) / 10;
}

/**
 * Where does this sit relative to its own threshold?
 *
 * Margins are relative, not absolute, so a 50% ophthalmology theory threshold
 * gets the same band shape as an 80% practical one.
 */
export function bandFor(
  ratio: number,
  threshold: ThresholdPercent,
): SafetyBand {
  const pct = ratio * 100;
  if (pct >= threshold) return 'safe';
  if (pct >= threshold - SAFETY_THRESHOLDS.warningMargin) return 'warning';
  if (pct >= threshold - SAFETY_THRESHOLDS.dangerMargin) return 'danger';
  return 'critical';
}

/**
 * How many consecutive classes must be attended to reach the threshold?
 *
 * ⚠ THE DENOMINATOR GROWS WITH THE NUMERATOR. Tomorrow's class is 1/1, not
 *   1/0. Naively computing (needed − attended) understates this badly.
 *
 *     (attended + x) / (conducted + x) >= t
 *   → x >= (t·conducted − attended) / (1 − t)
 *
 * At t = 0.80 the divisor is 0.2, so every skipped class costs FIVE attended
 * ones to undo. At 0.75 it costs four. Students find this genuinely shocking,
 * which is exactly why the number is worth showing.
 *
 * Returns 0 when already at or above the threshold.
 */
export function classesNeeded(
  attended: number,
  conducted: number,
  threshold: ThresholdPercent,
): number {
  const t = threshold / 100;
  if (t >= 1) return Number.POSITIVE_INFINITY; // 100% — one absence is fatal
  if (exactRatio(attended, conducted) >= t) return 0;

  const x = (t * conducted - attended) / (1 - t);
  return Math.max(0, Math.ceil(x - 1e-9)); // epsilon guards float dust
}

/**
 * How many more can be skipped while staying at or above the threshold?
 *
 *     attended / (conducted + x) >= t
 *   → x <= attended/t − conducted
 *
 * Returns 0 when already below — you cannot afford to miss a class you are
 * already failing.
 */
export function classesSkippable(
  attended: number,
  conducted: number,
  threshold: ThresholdPercent,
): number {
  const t = threshold / 100;
  if (t <= 0) return Number.POSITIVE_INFINITY;
  if (exactRatio(attended, conducted) < t) return 0;

  return Math.max(0, Math.floor(attended / t - conducted + 1e-9));
}

/**
 * Is the threshold still mathematically reachable?
 *
 * Best case: every remaining class is attended. If even that falls short,
 * the target is gone and the UI should say so rather than print a number the
 * student cannot act on.
 *
 * ⚠ This function answers ONLY the arithmetic question. Whether there IS any
 *   runway is a separate question, handled by the caller — see the
 *   targetUnreachable note in SECTION 4.
 */
export function isUnreachable(
  attended: number,
  conducted: number,
  remainingWeight: number,
  threshold: ThresholdPercent,
): boolean {
  const best = exactRatio(attended + remainingWeight, conducted + remainingWeight);
  return best * 100 < threshold;
}


// -----------------------------------------------------------------------------
// SECTION 2 — Bucketing
//
// ONE traversal of the session list. See RULE 5.
//
// The key is `subjectId::category`. Everything downstream is a map lookup.
// -----------------------------------------------------------------------------

export type BucketKey = string;

export function bucketKey(subjectId: SubjectId, category: ClassCategory): BucketKey {
  return `${subjectId}::${category}`;
}

export interface Bucket {
  subjectId: SubjectId;
  category: ClassCategory;
  subjectName: string;
  sessions: Session[];
}

/** Single pass. O(n) in sessions, regardless of how many subjects exist. */
export function bucketSessions(sessions: Session[]): Map<BucketKey, Bucket> {
  const buckets = new Map<BucketKey, Bucket>();

  for (const s of sessions) {
    const key = bucketKey(s.subjectId, s.category);
    let bucket = buckets.get(key);

    if (!bucket) {
      bucket = {
        subjectId: s.subjectId,
        category: s.category,
        subjectName: s.subjectName || curriculumSubjectName(s.subjectId),
        sessions: [],
      };
      buckets.set(key, bucket);
    }
    bucket.sessions.push(s);
  }
  return buckets;
}


// -----------------------------------------------------------------------------
// SECTION 3 — Extra-class denominator policy
//
// ★ THE SEPARATION THAT MAKES v4 SAFE
//
//   In v3 this was ONE GLOBAL SETTING. Flipping it swept through regular
//   classes as well as extras — the trap that prompted this rebuild.
//
//   In v4 the flag lives on each ExtraClass. Regular and posting sessions
//   have NO such field, so recalculating extras is structurally incapable of
//   reaching them. The type system enforces it; nobody has to remember.
//
// ⚠ KNOWN GAP, TEMPORARY
//   generate.ts does not yet copy the flag onto the sessions it emits, so
//   extra sessions currently arrive with countsTowardDenominator === undefined.
//   Until that is fixed (build step 4), callers pass `extraPolicy` — a map of
//   extraClassId → boolean — and this function falls back to it.
//
//   Order of precedence, deliberately:
//     1. the session's own flag, once generate.ts sets it
//     2. the caller's lookup
//     3. true, matching the old 'add' default, so nobody's totals shift
//        silently under them during the transition
// -----------------------------------------------------------------------------

export type ExtraPolicyLookup = Readonly<Record<Id, boolean>>;

export function extraCountsTowardDenominator(
  session: Session,
  lookup?: ExtraPolicyLookup,
): boolean {
  if (session.origin !== 'extra') {
    // Not an extra. This question does not apply, and a regular class ALWAYS
    // counts. Returning true here is not a policy decision — it is the
    // definition of a scheduled class.
    return true;
  }
  if (typeof session.countsTowardDenominator === 'boolean') {
    return session.countsTowardDenominator;
  }
  if (lookup && session.extraClassId && session.extraClassId in lookup) {
    return lookup[session.extraClassId];
  }
  return true;
}


// -----------------------------------------------------------------------------
// SECTION 4 — Category result: the single unit of truth
//
// Every number a student sees is one of these. Subjects and years are just
// collections of them — they carry no arithmetic of their own. See RULE 2.
// -----------------------------------------------------------------------------

export interface CategoryInput {
  category: ClassCategory;
  sessions: Session[];
  /** Resolved threshold. Already merged: override if set, otherwise default. */
  threshold: ThresholdPercent;
  /** True when the student overrode the default for this exact key. */
  isCustomThreshold: boolean;
  /** Carried-forward figures. Null when none. ⚠ TRAP 2: ignored when excluded. */
  openingBalance: { conducted: number; attended: number } | null;
  isExcluded: boolean;
  /** Anything dated after this is "future" and cannot be overdue. */
  today: ISODate;
  extraPolicy?: ExtraPolicyLookup;
}

export function computeCategory(input: CategoryInput): CategoryResult {
  const { category, sessions, threshold, isExcluded, today } = input;

  // Regular + extras, clubbed. This is the DEFAULT view the student sees.
  let conducted = 0;
  let attended = 0;

  // Extras alone, for the semi-hidden breakdown. Never the default view.
  let extraConducted = 0;
  let extraAttended = 0;
  let sawExtra = false;

  // Weight of classes still to come — the RUNWAY. Drives targetUnreachable.
  let remainingWeight = 0;

  // Past sessions with no mark. Drives the "N unmarked" nag.
  let unmarkedCount = 0;

  for (const s of sessions) {
    const w = s.weight > 0 ? s.weight : 1;
    const isExtra = s.origin === 'extra';
    if (isExtra) sawExtra = true;

    switch (s.status) {
      case 'present': {
        // ★ An extra with countsTowardDenominator === false raises the
        //   numerator only. That is the whole point: a makeup class that
        //   earns credit without inflating the total.
        const countsDenominator = extraCountsTowardDenominator(s, input.extraPolicy);
        attended += w;
        if (countsDenominator) conducted += w;

        if (isExtra) {
          extraAttended += w;
          if (countsDenominator) extraConducted += w;
        }
        break;
      }

      case 'absent': {
        const countsDenominator = extraCountsTowardDenominator(s, input.extraPolicy);
        if (countsDenominator) conducted += w;
        if (isExtra && countsDenominator) extraConducted += w;
        break;
      }

      case 'not-conducted':
        // 0/0. Vanishes from both sides. Cancelled classes and blocked exam
        // weeks must never damage a percentage.
        break;

      case 'unmarked':
      default:
        if (s.date > today) remainingWeight += w;
        else unmarkedCount += 1;
        break;
    }
  }

  // ⚠ TRAP 2 — an excluded category's opening balance is excluded too.
  //   Half-applying an exclusion is worse than not applying it at all.
  if (input.openingBalance && !isExcluded) {
    conducted += Math.max(0, input.openingBalance.conducted);
    attended += Math.max(0, Math.min(input.openingBalance.attended, input.openingBalance.conducted));
  }

  // Defensive: a corrupt import could make attended exceed conducted, which
  // would render as 104% and destroy trust in every other number on screen.
  if (attended > conducted) attended = conducted;

  const isEmpty = conducted <= 0;
  const ratio = exactRatio(attended, conducted);

  const extrasOnly: ExtrasBreakdown | null = sawExtra
    ? {
        conducted: extraConducted,
        attended: Math.min(extraAttended, Math.max(extraConducted, extraAttended)),
        ratio: exactRatio(extraAttended, extraConducted),
        isEmpty: extraConducted <= 0,
      }
    : null;

  return {
    category,
    threshold,
    isCustomThreshold: input.isCustomThreshold,
    conducted,
    attended,
    ratio,
    percentDisplay: toDisplayPercent(ratio),
    isEmpty,
    band: isEmpty ? 'safe' : bandFor(ratio, threshold),
    mustAttend: isEmpty ? 0 : classesNeeded(attended, conducted, threshold),
    canSkip: isEmpty ? 0 : classesSkippable(attended, conducted, threshold),

    // ═══════════════════════════════════════════════════════════════════════
    //  ⚠ "UNREACHABLE" REQUIRES RUNWAY — FIXED 25 Sep 2026
    // ═══════════════════════════════════════════════════════════════════════
    //  Surgery clinical read "Critical" at 3/5 against an 80% threshold. The
    //  maths was flawless: isUnreachable(3, 5, 0, 80) → best case 60% → true.
    //
    //  But remainingWeight was 0 only because the surgery POSTING BLOCK had
    //  ended. A finished posting is not a finished term — it almost always
    //  means the NEXT block has not been entered into the app yet.
    //
    //  Two situations were being conflated:
    //    runway exists, and using all of it still falls short → genuinely lost
    //    no runway because nothing more is SCHEDULED yet     → simply unknown
    //
    //  Declaring the second one Critical punishes a data gap. With no runway
    //  the band alone carries the severity ("Well behind" in RingGrid), which
    //  is honest and leaves the student somewhere to go.
    //
    //  ⚠ SIDE EFFECT, ACCEPTED: at genuine term end every category has
    //    remainingWeight 0, so nothing says Critical on the final day. If an
    //    end-of-term "finalised / below requirement" state is wanted later,
    //    add an explicit isFinalised flag driven by settings.term.endDate.
    //    Do NOT revert this line to get it.
    // ═══════════════════════════════════════════════════════════════════════
    targetUnreachable: isEmpty
      ? false
      : remainingWeight > 0 &&
        isUnreachable(attended, conducted, remainingWeight, threshold),

    extrasOnly,
    isExcluded,
    unmarkedCount,
  };
}


// -----------------------------------------------------------------------------
// SECTION 5 — Subject result
//
// A named bag of CategoryResults plus the worst band, which colours the LABEL.
//
// ⚠ NO conducted, attended, percent or band on the subject itself. Those four
//   fields existed in v3 and each one was a pooled number. See RULE 2.
// -----------------------------------------------------------------------------

const BAND_SEVERITY: Record<SafetyBand, number> = {
  safe: 0,
  warning: 1,
  danger: 2,
  critical: 3,
};

export function worstBandOf(categories: CategoryResult[]): SafetyBand {
  let worst: SafetyBand = 'safe';
  for (const c of categories) {
    // An excluded or empty category cannot drag the label down — there is
    // nothing to be failing. This is what keeps a seeded 0/0 clinical ring
    // from painting the whole subject Critical.
    if (c.isExcluded || c.isEmpty) continue;
    if (BAND_SEVERITY[c.band] > BAND_SEVERITY[worst]) worst = c.band;
  }
  return worst;
}

export interface SubjectInput {
  subjectId: SubjectId;
  academicYear: AcademicYear;
  categories: CategoryResult[];
  isExamSubject: boolean;
}

export function computeSubject(input: SubjectInput): SubjectResult {
  const { subjectId, academicYear, categories, isExamSubject } = input;

  return {
    subjectId,
    subjectName: curriculumSubjectName(subjectId),
    shortCode: subjectShort(subjectId),
    academicYear,
    categories,
    worstBand: worstBandOf(categories),
    isExcluded: categories.length > 0 && categories.every((c) => c.isExcluded),
    isExamSubject,
  };
}


// -----------------------------------------------------------------------------
// SECTION 6 — Year result (pure)
//
// The pure entry point. Everything it needs is passed in; it reads nothing.
// This is the function to unit-test — no store, no fixtures, no mocking.
//
// ═════════════════════════════════════════════════════════════════════════════
//  BUG 2 FIX — 25 Sep 2026. READ BEFORE CHANGING ANYTHING BELOW.
// ═════════════════════════════════════════════════════════════════════════════
//
//  WHAT WAS WRONG
//    This function built its subject and category list by iterating the
//    session buckets. A category with zero scheduled sessions therefore had
//    no bucket, so it produced no CategoryResult, so it simply VANISHED from
//    the output object.
//
//    Diagnostic evidence (debug page, section 2 and 5, after the term fix):
//      medicine     legal: theory, clinical → returned: theory only
//      paediatrics  legal: theory, clinical → returned: theory only
//      obg          clinical had 13 future sessions → returned fine as 0/0
//
//    The OBG contrast is the proof: a category survived only if at least one
//    session existed somewhere in the term.
//
//  WHY IT MATTERED
//    The rings are concentric — outer theory, inner practical/clinical. With
//    no clinical CategoryResult, the inner ring read `undefined`. Months were
//    spent rewriting RingGrid.tsx chasing a bug that was never in RingGrid.
//
//  THE FIX
//    The CURRICULUM decides which categories exist, not the timetable.
//    Buckets are computed first (so nothing is computed twice), then every
//    EXAM subject's remaining legal categories are filled with a real,
//    honest 0/0 result.
//
//  ⚠ TRAP 9, NARROWED — NOT DELETED
//    The old rule was "only categories with real data appear", to stop a
//    student seeing "ENT Practical — 0%" for a practical they never had.
//    That rule still holds for NON-EXAM subjects, which are tracked quietly
//    in the background. It is deliberately suspended for EXAM subjects,
//    because those own a fixed two-ring slot on the main page and a missing
//    inner ring is worse than an empty one.
//
//  ⚠ AN EMPTY CATEGORY IS NOT 0%
//    conducted === 0 sets isEmpty === true, which forces band 'safe',
//    mustAttend 0, canSkip 0, targetUnreachable false, and makes
//    worstBandOf() skip it entirely. statusLine() says "No classes recorded
//    yet." and shortStatus() returns "—". Nothing-scheduled and zero-percent
//    are different facts and the UI must never conflate them.
// ═════════════════════════════════════════════════════════════════════════════
// -----------------------------------------------------------------------------

export interface YearInput {
  academicYear: AcademicYear;
  sessions: Session[];
  /** Resolve a threshold. Wire to store.getThreshold, or a literal in tests. */
  resolveThreshold: (
    subjectId: SubjectId,
    category: ClassCategory,
  ) => ThresholdPercent;
  /** Has the student overridden this one? Purely cosmetic — "(your setting)". */
  isCustomThreshold?: (
    subjectId: SubjectId,
    category: ClassCategory,
  ) => boolean;
  resolveOpeningBalance?: (
    subjectId: SubjectId,
    category: ClassCategory,
  ) => { conducted: number; attended: number } | null;
  resolveExcluded?: (subjectId: SubjectId, category: ClassCategory) => boolean;
  /** Exam subjects for this year. Drives what the main page shows. */
  examSubjectIds?: readonly SubjectId[];
  extraPolicy?: ExtraPolicyLookup;
  /** Injectable so tests are not hostage to the system clock. */
  today?: ISODate;
}

export function computeYear(input: YearInput): YearResult {
  const {
    academicYear,
    sessions,
    resolveThreshold,
    isCustomThreshold,
    resolveOpeningBalance,
    resolveExcluded,
    examSubjectIds,
    extraPolicy,
  } = input;

  const today = input.today ?? todayISO();
  const buckets = bucketSessions(sessions);
  const examIds = examSubjectIds ?? [];
  const examSet = new Set(examIds);

  // ★ Nested map, keyed by category rather than a plain array.
  //   This is what makes "compute once" structurally guaranteed: a category
  //   that already has an entry can be detected with a single has() check,
  //   so the gap-filling pass below can never recompute a populated bucket.
  const bySubject = new Map<SubjectId, Map<ClassCategory, CategoryResult>>();

  /** Local helper. Keeps the three passes below honest and identical. */
  function put(
    subjectId: SubjectId,
    category: ClassCategory,
    categorySessions: Session[],
  ): void {
    let categories = bySubject.get(subjectId);
    if (!categories) {
      categories = new Map<ClassCategory, CategoryResult>();
      bySubject.set(subjectId, categories);
    }

    // Guard against double computation. Should be impossible given the pass
    // order, but this is cheaper than trusting future edits to preserve it.
    if (categories.has(category)) return;

    categories.set(
      category,
      computeCategory({
        category,
        sessions: categorySessions,
        threshold: resolveThreshold(subjectId, category),
        isCustomThreshold: isCustomThreshold?.(subjectId, category) ?? false,
        openingBalance: resolveOpeningBalance?.(subjectId, category) ?? null,
        isExcluded: resolveExcluded?.(subjectId, category) ?? false,
        today,
        extraPolicy,
      }),
    );
  }

  // ---- PASS 1 — real sessions ------------------------------------------
  // Everything that actually happened. Computed first so passes 2 and 3 can
  // only ever ADD to the picture, never overwrite a real number with a zero.
  for (const bucket of buckets.values()) {
    const { subjectId, category } = bucket;

    // ⚠ Drop a category the curriculum says this subject cannot have. A
    //   clinical subject has no practicals; data claiming otherwise is
    //   corrupt, and rendering it would confuse more than it informs.
    if (!categoriesForSubject(subjectId).includes(category)) continue;

    put(subjectId, category, bucket.sessions);
  }

  // ---- PASS 2 — complete every EXAM subject -----------------------------
  // THE BUG 2 FIX. An exam subject owns a fixed outer/inner ring pair on the
  // main page, so both legal categories must exist even with nothing in them.
  // A subject with no sessions at all is created here from scratch — which is
  // why a configured exam subject can no longer disappear entirely.
  for (const subjectId of examIds) {
    for (const category of categoriesForSubject(subjectId)) {
      // put() no-ops if pass 1 already filled this. Empty array → honest 0/0,
      // with any opening balance still applied inside computeCategory().
      put(subjectId, category, []);
    }
  }

  // ---- PASS 3 — opening balances on NON-EXAM subjects -------------------
  // A student who transferred mid-year may have carried-forward figures for a
  // subject they have not scheduled yet. Exam subjects are already complete
  // after pass 2, so this only reaches the quietly-tracked ones.
  //
  // TRAP 9 still applies here: no balance, no row. A non-exam subject must
  // not sprout an empty category just because the curriculum permits one.
  if (resolveOpeningBalance) {
    for (const subjectId of [...bySubject.keys()]) {
      if (examSet.has(subjectId)) continue;

      for (const category of categoriesForSubject(subjectId)) {
        if (bySubject.get(subjectId)!.has(category)) continue;

        const ob = resolveOpeningBalance(subjectId, category);
        if (!ob || ob.conducted <= 0) continue;

        put(subjectId, category, []);
      }
    }
  }

  // Stable display order: theory always before practical/clinical, matching
  // the outer/inner ring pairing. RingGrid relies on index 0 being theory.
  const ORDER: ClassCategory[] = ['theory', 'practical', 'clinical'];

  const subjects: SubjectResult[] = [...bySubject.entries()]
    .map(([subjectId, categories]) =>
      computeSubject({
        subjectId,
        academicYear,
        categories: [...categories.values()].sort(
          (a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category),
        ),
        isExamSubject: examSet.has(subjectId),
      }),
    )
    .sort((a, b) => {
      // Exam subjects first, then worst band, then name. The student's eye
      // should land on what can actually hurt them.
      if (a.isExamSubject !== b.isExamSubject) return a.isExamSubject ? -1 : 1;
      const bandDiff = BAND_SEVERITY[b.worstBand] - BAND_SEVERITY[a.worstBand];
      if (bandDiff !== 0) return bandDiff;
      return a.subjectName.localeCompare(b.subjectName);
    });

  // ⚠ No conducted, no attended, no percent, no band. Deliberately.
  return { academicYear, subjects };
}


// -----------------------------------------------------------------------------
// SECTION 7 — Memoisation
//
// RULE 5, the performance half.
//
// Computing on every read is only cheap if it is done once per change. The
// cache is keyed by DataVersion, which store.ts bumps on every mutating write
// — a mark, a threshold edit, an exclusion toggle, a timetable change.
//
// ★ IN MEMORY ONLY. Nothing derived is ever written to storage. That is what
//   makes a stale number impossible: there is nowhere for one to survive.
//   Reload the page and the cache is simply gone, which is correct.
// -----------------------------------------------------------------------------

interface CacheEntry {
  version: DataVersion;
  result: YearResult;
}

const yearCache = new Map<AcademicYear, CacheEntry>();

export function invalidateCalculationCache(): void {
  yearCache.clear();
}

/** Diagnostics for the dev panel. Never shown to a student. */
export function cacheStats(): { entries: number; years: AcademicYear[] } {
  return { entries: yearCache.size, years: [...yearCache.keys()] };
}


// -----------------------------------------------------------------------------
// SECTION 8 — Storage-backed convenience layer
//
// THE ONLY PART OF THIS FILE THAT TOUCHES THE STORE.
//
// Imports are deliberately at the bottom of the dependency graph: the pure
// core above has no idea these exist, so it stays testable in isolation.
// -----------------------------------------------------------------------------

import {
  getDataVersion,
  getExtraClasses,
  getOpeningBalance,
  getSettings,
  getThreshold,
  hasCustomThreshold,
  isExcluded as storeIsExcluded,
} from './store';

import { generateForYear } from './generate';
import { getEntOphthaInFinalYear } from './store';

/** extraClassId → countsTowardDenominator, until generate.ts carries the flag. */
function extraPolicyFor(year: AcademicYear): ExtraPolicyLookup {
  const out: Record<Id, boolean> = {};
  for (const x of getExtraClasses(year)) {
    out[x.id] = x.countsTowardDenominator;
  }
  return out;
}

/**
 * The function the UI calls. Memoised on DataVersion, so repeated reads within
 * one render pass cost a map lookup.
 */
export function getYearResult(year: AcademicYear): YearResult {
  const version = getDataVersion();
  const cached = yearCache.get(year);
  if (cached && cached.version === version) return cached.result;

  const settings = getSettings();

  const result = computeYear({
    academicYear: year,
    sessions: generateForYear(year),
    resolveThreshold: (subjectId, category) =>
      getThreshold(year, subjectId, category),
    isCustomThreshold: (subjectId, category) =>
      hasCustomThreshold(year, subjectId, category),
    resolveOpeningBalance: (subjectId, category) =>
      getOpeningBalance(year, subjectId, category),
    resolveExcluded: (subjectId, category) =>
      storeIsExcluded(year, subjectId, category),
    examSubjectIds: effectiveExamSubjects(
      year,
      settings.examSubjectsByYear,
      getEntOphthaInFinalYear(),
    ),
    extraPolicy: extraPolicyFor(year),
  });

  yearCache.set(year, { version, result });
  return result;
}

/**
 * Every year the student has data for.
 *
 * ⚠ Returns a LIST, with no totals attached. If you are ever tempted to add a
 *   percentage to AttendanceResult, re-read RULE 2 at the top of this file.
 */
export function getAttendanceResult(years: readonly AcademicYear[]): AttendanceResult {
  return {
    years: years.map(getYearResult),
    version: getDataVersion(),
    computedAt: Date.now(),
  };
}

/** Exam-year subjects only — what the main attendance page renders. */
export function getExamSubjects(year: AcademicYear): SubjectResult[] {
  return getYearResult(year).subjects.filter((s) => s.isExamSubject && !s.isExcluded);
}

/** Everything else. Tracked silently, shown on the subject page and settings. */
export function getNonExamSubjects(year: AcademicYear): SubjectResult[] {
  return getYearResult(year).subjects.filter((s) => !s.isExamSubject || s.isExcluded);
}

/** Total unmarked past sessions for a year. Drives the "N unmarked" chip. */
export function getUnmarkedCount(year: AcademicYear): number {
  return getYearResult(year).subjects.reduce(
    (n, s) => n + s.categories.reduce((m, c) => m + c.unmarkedCount, 0),
    0,
  );
}


// -----------------------------------------------------------------------------
// SECTION 9 — Status text
//
// ⚠ REVEALED ON RING TAP ONLY. Never on the resting screen.
//   The resting view is rings and colour; numbers appear when asked for.
// -----------------------------------------------------------------------------

export function statusLine(result: CategoryResult): string {
  const { percentDisplay, threshold, mustAttend, canSkip } = result;

  if (result.isEmpty) return 'No classes recorded yet.';
  if (result.isExcluded) return 'Excluded from your calculations.';

  if (result.band === 'safe') {
    if (canSkip === 0) {
      return `At ${percentDisplay}%. Attend the next one to stay above ${threshold}%.`;
    }
    return `At ${percentDisplay}%. You can miss ${canSkip} more and stay above ${threshold}%.`;
  }

  if (result.targetUnreachable) {
    return `At ${percentDisplay}%. ${threshold}% is no longer reachable this term.`;
  }

  return `At ${percentDisplay}%. Attend ${mustAttend} in a row to reach ${threshold}%.`;
}

/** Short form for the expanded ring: "34/50 · need 6". */
export function shortStatus(result: CategoryResult): string {
  if (result.isEmpty) return '—';
  const base = `${result.attended}/${result.conducted}`;
  if (result.mustAttend > 0) return `${base} · need ${result.mustAttend}`;
  if (result.canSkip > 0) return `${base} · ${result.canSkip} spare`;
  return base;
}


// =============================================================================
// NEXT FILE — generate.ts
//   1. Copy countsTowardDenominator onto extra sessions, so SECTION 3's
//      lookup fallback becomes dead code and can be deleted.
//   2. Filter regular sessions by settings.college.workingDays — a 6-day
//      college currently generates Sunday classes.
//   3. Cache the term expansion; generateForYear() rebuilds it on every call.
// =============================================================================
