// =============================================================================
// lib/attendance/curriculum.ts
// -----------------------------------------------------------------------------
// The subject registry and the exam-subject rules.
//
// Two jobs, and only two:
//   1. Know every subject, its stable id, its display name, and which
//      categories it can legally have.
//   2. Answer "is this subject an exam subject for this year?" — which is the
//      question the exclusion lock depends on.
//
// ⚠ TRAP 8 — THE EXCLUSION LOCK
//   A subject that is an exam subject for a given year CANNOT be excluded in
//   that year. The lock releases only when the user removes it from that
//   year's exam subject list. Earlier years are always unlockable.
//
// ⚠ TRAP 9 — SHOW ONLY WHAT EXISTS
//   Nothing in this file decides what appears in the summary. The registry
//   lists what is POSSIBLE; the timetable decides what is REAL. A first-year
//   who never entered ENT must never see "ENT — 0%".
//
// CATEGORY RULE
//   Clinical subjects have theory + clinical. They do NOT have practicals.
//   Pre/para-clinical subjects have theory + practical. They do NOT have
//   clinical postings. This is why the exclusion screen shows two toggles,
//   not three — and which two depends on the subject.
// =============================================================================

import type {
  AcademicYear,
  ClassCategory,
  SubjectId,
} from '@/app/attendance/types';


// -----------------------------------------------------------------------------
// SECTION 1 — Academic years
// -----------------------------------------------------------------------------

/** Ordered earliest to latest. Order matters for carry-forward and summaries. */
export const ACADEMIC_YEARS: readonly AcademicYear[] = Object.freeze([
  '1st MBBS',
  '2nd MBBS',
  '3rd MBBS Part 1',
  '3rd MBBS Part 2',
]);

export function isAcademicYear(value: unknown): value is AcademicYear {
  return (
    typeof value === 'string' &&
    (ACADEMIC_YEARS as readonly string[]).includes(value)
  );
}

/** Position in the sequence. -1 when unknown. */
export function yearOrder(year: AcademicYear): number {
  return ACADEMIC_YEARS.indexOf(year);
}

/** Every year strictly before the given one. Used by the summary page. */
export function yearsBefore(year: AcademicYear): AcademicYear[] {
  const i = yearOrder(year);
  return i <= 0 ? [] : ACADEMIC_YEARS.slice(0, i);
}

/** The given year plus every year before it. Used for cumulative totals. */
export function yearsUpToAndIncluding(year: AcademicYear): AcademicYear[] {
  const i = yearOrder(year);
  return i < 0 ? [] : ACADEMIC_YEARS.slice(0, i + 1);
}


// -----------------------------------------------------------------------------
// SECTION 2 — Subject definition
// -----------------------------------------------------------------------------

export type SubjectKind = 'preclinical' | 'paraclinical' | 'clinical';

export interface SubjectDef {
  /** Stable key. Lowercase, no spaces. NEVER change these — storage uses them. */
  id: SubjectId;
  /** Display name. Safe to change; nothing matches on it. */
  name: string;
  /** Short form for narrow columns and chips. */
  short: string;
  kind: SubjectKind;
  /** The only categories this subject may have. Enforced by the add form. */
  categories: ClassCategory[];
}

/**
 * ⚠ The `id` values below are load-bearing. They appear in saved timetables,
 * marks, exclusions and opening balances. Renaming one orphans a user's data.
 * Add freely; rename never.
 */
export const SUBJECTS: readonly SubjectDef[] = Object.freeze([
  // --- Pre-clinical (1st MBBS) ---
  { id: 'anatomy',      name: 'Anatomy',                short: 'Anat',   kind: 'preclinical',  categories: ['theory', 'practical'] },
  { id: 'physiology',   name: 'Physiology',             short: 'Physio', kind: 'preclinical',  categories: ['theory', 'practical'] },
  { id: 'biochemistry', name: 'Biochemistry',           short: 'Biochem',kind: 'preclinical',  categories: ['theory', 'practical'] },

  // --- Para-clinical (2nd MBBS) ---
  { id: 'pathology',    name: 'Pathology',              short: 'Path',   kind: 'paraclinical', categories: ['theory', 'practical'] },
  { id: 'pharmacology', name: 'Pharmacology',           short: 'Pharma', kind: 'paraclinical', categories: ['theory', 'practical'] },
  { id: 'microbiology', name: 'Microbiology',           short: 'Micro',  kind: 'paraclinical', categories: ['theory', 'practical'] },
  { id: 'forensic',     name: 'Forensic Medicine',      short: 'FMT',    kind: 'paraclinical', categories: ['theory', 'practical'] },

  // --- Clinical ---
  { id: 'medicine',     name: 'General Medicine',       short: 'Med',    kind: 'clinical',     categories: ['theory', 'clinical'] },
  { id: 'surgery',      name: 'General Surgery',        short: 'Surg',   kind: 'clinical',     categories: ['theory', 'clinical'] },
  { id: 'obg',          name: 'Obstetrics & Gynaecology',short:'OBG',    kind: 'clinical',     categories: ['theory', 'clinical'] },
  { id: 'paediatrics',  name: 'Paediatrics',            short: 'Paeds',  kind: 'clinical',     categories: ['theory', 'clinical'] },
  { id: 'orthopaedics', name: 'Orthopaedics',           short: 'Ortho',  kind: 'clinical',     categories: ['theory', 'clinical'] },
  { id: 'ent',          name: 'ENT',                    short: 'ENT',    kind: 'clinical',     categories: ['theory', 'clinical'] },
  { id: 'ophthalmology',name: 'Ophthalmology',          short: 'Ophtha', kind: 'clinical',     categories: ['theory', 'clinical'] },
  { id: 'community',    name: 'Community Medicine',     short: 'CM',     kind: 'clinical',     categories: ['theory', 'clinical'] },
  { id: 'psychiatry',   name: 'Psychiatry',             short: 'Psych',  kind: 'clinical',     categories: ['theory', 'clinical'] },
  { id: 'dermatology',  name: 'Dermatology',            short: 'Derm',   kind: 'clinical',     categories: ['theory', 'clinical'] },
  { id: 'anaesthesia',  name: 'Anaesthesiology',        short: 'Anaes',  kind: 'clinical',     categories: ['theory', 'clinical'] },
  { id: 'radiology',    name: 'Radiodiagnosis',         short: 'Radio',  kind: 'clinical',     categories: ['theory', 'clinical'] },
  { id: 'dentistry',    name: 'Dentistry',              short: 'Dental', kind: 'clinical',     categories: ['theory', 'clinical'] },
  { id: 'casualty',     name: 'Casualty / Emergency',   short: 'Cas',    kind: 'clinical',     categories: ['theory', 'clinical'] },
]);

/** Lookup index. Built once at module load, not on every call. */
const SUBJECT_BY_ID: ReadonlyMap<SubjectId, SubjectDef> = new Map(
  SUBJECTS.map((s) => [s.id, s]),
);

export function getSubject(id: SubjectId): SubjectDef | undefined {
  return SUBJECT_BY_ID.get(id);
}

/**
 * Display name for an id. Falls back to the id itself rather than "Unknown",
 * so a subject added in a future version still shows something meaningful
 * instead of vanishing from the user's own timetable.
 */
export function subjectName(id: SubjectId): string {
  return SUBJECT_BY_ID.get(id)?.name ?? id;
}

export function subjectShort(id: SubjectId): string {
  return SUBJECT_BY_ID.get(id)?.short ?? id;
}

export function isClinicalSubject(id: SubjectId): boolean {
  return SUBJECT_BY_ID.get(id)?.kind === 'clinical';
}

/**
 * Which categories this subject may legally have.
 * The add-class form reads this to decide whether to offer "Practical" or
 * "Clinical" — never both. Unknown subjects get all three rather than none,
 * because blocking the user is worse than offering one option too many.
 */
export function categoriesForSubject(id: SubjectId): ClassCategory[] {
  return SUBJECT_BY_ID.get(id)?.categories ?? ['theory', 'practical', 'clinical'];
}

/** Guard for the add form. Rejects "practical" on a clinical subject. */
export function isValidCategoryForSubject(
  id: SubjectId,
  category: ClassCategory,
): boolean {
  return categoriesForSubject(id).includes(category);
}


// -----------------------------------------------------------------------------
// SECTION 3 — Default exam subjects per year
//
// These are DEFAULTS ONLY — the NTRUHS pattern. The student overrides them in
// settings, and the override is what every rule actually reads. A deemed
// university that examines a different set is handled entirely by the
// override; nothing here needs editing.
// -----------------------------------------------------------------------------

export const DEFAULT_EXAM_SUBJECTS: Readonly<
  Record<AcademicYear, readonly SubjectId[]>
> = Object.freeze({
  '1st MBBS': Object.freeze([
    'anatomy',
    'physiology',
    'biochemistry',
  ]),
  '2nd MBBS': Object.freeze([
    'pathology',
    'pharmacology',
    'microbiology',
  ]),
  '3rd MBBS Part 1': Object.freeze([
    'forensic',
    'community',
    'ent',
    'ophthalmology',
  ]),
  '3rd MBBS Part 2': Object.freeze([
    'medicine',
    'surgery',
    'obg',
    'paediatrics',
  ]),
});

/**
 * ENT and Ophthalmology move to the final year at some colleges.
 * Your settings already carry an `entOphthaInFinalYear` flag, so this returns
 * the adjusted default list when that flag is on.
 */
export function defaultExamSubjectsFor(
  year: AcademicYear,
  entOphthaInFinalYear = false,
): SubjectId[] {
  const base = [...(DEFAULT_EXAM_SUBJECTS[year] ?? [])];
  if (!entOphthaInFinalYear) return base;

  if (year === '3rd MBBS Part 1') {
    return base.filter((id) => id !== 'ent' && id !== 'ophthalmology');
  }
  if (year === '3rd MBBS Part 2') {
    return [...base, 'ent', 'ophthalmology'];
  }
  return base;
}


// -----------------------------------------------------------------------------
// SECTION 4 — Effective exam subjects
//
// "Effective" means: the user's override if they set one, otherwise the
// default. Every rule in the app reads THIS, never DEFAULT_EXAM_SUBJECTS
// directly. That single indirection is what makes the whole thing editable.
// -----------------------------------------------------------------------------

/**
 * @param year                  the year being asked about
 * @param overridesByYear       settings.examSubjectsByYear
 * @param entOphthaInFinalYear  the college-variant flag
 */
export function effectiveExamSubjects(
  year: AcademicYear,
  overridesByYear: Partial<Record<AcademicYear, SubjectId[]>> | undefined,
  entOphthaInFinalYear = false,
): SubjectId[] {
  const override = overridesByYear?.[year];
  // An explicitly empty array is a real choice — "this year examines nothing" —
  // and must not silently fall through to the defaults.
  if (Array.isArray(override)) return [...override];
  return defaultExamSubjectsFor(year, entOphthaInFinalYear);
}

export function isExamSubject(
  subjectId: SubjectId,
  year: AcademicYear,
  overridesByYear: Partial<Record<AcademicYear, SubjectId[]>> | undefined,
  entOphthaInFinalYear = false,
): boolean {
  return effectiveExamSubjects(year, overridesByYear, entOphthaInFinalYear)
    .includes(subjectId);
}


// -----------------------------------------------------------------------------
// SECTION 5 — The exclusion lock  ⚠ TRAP 8
//
// This is the single function the Subject Preferences screen must call before
// rendering a toggle. If it returns locked, the toggle is disabled and the
// reason is shown. Nothing else in the app is allowed to reimplement this
// rule — one definition, one behaviour.
// -----------------------------------------------------------------------------

export interface ExclusionLock {
  locked: boolean;
  /** Empty string when unlocked. Ready to render as-is. */
  reason: string;
}

/**
 * Can this subject be excluded from this year?
 *
 * Locked when the subject is an exam subject for that year — regardless of
 * whether it is the current year or a past one. The user's escape hatch is to
 * remove it from that year's exam subject list first, which is a deliberate
 * two-step so nobody wipes an examinable subject by fat-fingering a toggle.
 */
export function getExclusionLock(
  subjectId: SubjectId,
  year: AcademicYear,
  overridesByYear: Partial<Record<AcademicYear, SubjectId[]>> | undefined,
  entOphthaInFinalYear = false,
): ExclusionLock {
  const isExam = isExamSubject(
    subjectId,
    year,
    overridesByYear,
    entOphthaInFinalYear,
  );

  if (!isExam) return { locked: false, reason: '' };

  return {
    locked: true,
    reason: `${subjectName(subjectId)} is an exam subject for ${year}. Remove it from this year's exam subjects to exclude it.`,
  };
}


// -----------------------------------------------------------------------------
// SECTION 6 — Sorting and grouping
//
// Used by every picker so subject order is identical everywhere. Inconsistent
// ordering between two screens reads as a bug even when the data is right.
// -----------------------------------------------------------------------------

/** Registry order first, then alphabetical for anything unregistered. */
export function compareSubjects(a: SubjectId, b: SubjectId): number {
  const ia = SUBJECTS.findIndex((s) => s.id === a);
  const ib = SUBJECTS.findIndex((s) => s.id === b);
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

export function sortSubjectIds(ids: SubjectId[]): SubjectId[] {
  return [...ids].sort(compareSubjects);
}

/**
 * Subjects offered to the add-class picker for a year.
 *
 * Deliberately generous: exam subjects for that year come first, then
 * everything else. A second-year doing a General Medicine posting must be
 * able to find General Medicine, even though it is examined in the final
 * year — that scenario is precisely why the exclusion system exists.
 */
export function selectableSubjectsFor(
  year: AcademicYear,
  overridesByYear: Partial<Record<AcademicYear, SubjectId[]>> | undefined,
  entOphthaInFinalYear = false,
): SubjectDef[] {
  const exam = new Set(
    effectiveExamSubjects(year, overridesByYear, entOphthaInFinalYear),
  );
  const examFirst = SUBJECTS.filter((s) => exam.has(s.id));
  const rest = SUBJECTS.filter((s) => !exam.has(s.id));
  return [...examFirst, ...rest];
}
