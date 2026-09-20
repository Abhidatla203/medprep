// lib/attendance/curriculum.ts
// -----------------------------------------------------------------------------
// MedPrep — MBBS curriculum catalogue (NMC / CBME aligned, Indian MBBS)
//
// DESIGN RULES (do not "helpfully" expand these):
//  1. Only THREE class types exist: Theory, Practical, Clinical posting.
//     Foundation Course, AETCOM, SGD, Seminar, Self-directed learning are
//     deliberately ABSENT. They are noise and attendance for them is not tracked.
//  2. Subjects are filtered by the student's year, which comes from the PROFILE
//     (Settings), never from a picker inside the timetable setup screen.
//  3. A student sees only their current year's subjects by default. An opt-in
//     "include earlier years" escape hatch exists for edge cases (supplementary
//     exams, repeat batches) but is NOT the default path.
// -----------------------------------------------------------------------------

export type YearKey = "1" | "2" | "3" | "4";

export type ClassType = "theory" | "practical" | "clinical";

export interface YearMeta {
  key: YearKey;
  label: string;
  short: string;
}

export const YEARS: YearMeta[] = [
  { key: "1", label: "First MBBS", short: "1st year" },
  { key: "2", label: "Second MBBS", short: "2nd year" },
  { key: "3", label: "Third MBBS Part I", short: "3rd year" },
  { key: "4", label: "Final MBBS Part II", short: "Final year" },
];

export interface SubjectMeta {
  id: string;
  name: string;
  /** Compact label for narrow tiles and the week grid. */
  short: string;
  /** Years in which this subject is actively taught. */
  years: YearKey[];
  /** Which of the three class types this subject can legitimately have. */
  types: ClassType[];
}

// -----------------------------------------------------------------------------
// The catalogue.
// -----------------------------------------------------------------------------

export const SUBJECTS: SubjectMeta[] = [
  // ---- First MBBS -----------------------------------------------------------
  { id: "anatomy",    name: "Anatomy",      short: "Anat",   years: ["1"], types: ["theory", "practical"] },
  { id: "physiology", name: "Physiology",   short: "Physio", years: ["1"], types: ["theory", "practical"] },
  { id: "biochem",    name: "Biochemistry", short: "Biochem",years: ["1"], types: ["theory", "practical"] },

  // ---- Second MBBS ----------------------------------------------------------
  { id: "pathology",    name: "Pathology",         short: "Path",   years: ["2"], types: ["theory", "practical"] },
  { id: "pharmacology", name: "Pharmacology",      short: "Pharma", years: ["2"], types: ["theory", "practical"] },
  { id: "microbiology", name: "Microbiology",      short: "Micro",  years: ["2"], types: ["theory", "practical"] },
  { id: "fmt",          name: "Forensic Medicine", short: "FMT",    years: ["2", "3"], types: ["theory", "practical"] },

  // ---- Third MBBS Part I ----------------------------------------------------
  { id: "community", name: "Community Medicine", short: "CM",   years: ["2", "3"], types: ["theory", "practical", "clinical"] },
  { id: "ent",       name: "ENT",                short: "ENT",  years: ["3"], types: ["theory", "clinical"] },
  { id: "ophthal",   name: "Ophthalmology",      short: "Ophth",years: ["3"], types: ["theory", "clinical"] },

  // ---- Clinical subjects: postings begin in 2nd year, theory peaks in Final --
  { id: "medicine",  name: "General Medicine",       short: "Med",    years: ["2", "3", "4"], types: ["theory", "clinical"] },
  { id: "surgery",   name: "General Surgery",        short: "Surg",   years: ["2", "3", "4"], types: ["theory", "clinical"] },
  { id: "obg",       name: "Obstetrics & Gynaecology", short: "OBG",  years: ["3", "4"], types: ["theory", "clinical"] },
  { id: "paeds",     name: "Paediatrics",            short: "Paeds",  years: ["3", "4"], types: ["theory", "clinical"] },
  { id: "ortho",     name: "Orthopaedics",           short: "Ortho",  years: ["3", "4"], types: ["theory", "clinical"] },
  { id: "psychiatry",name: "Psychiatry",             short: "Psych",  years: ["3", "4"], types: ["theory", "clinical"] },
  { id: "derma",     name: "Dermatology",            short: "Derm",   years: ["3", "4"], types: ["theory", "clinical"] },
  { id: "anaesthesia", name: "Anaesthesiology",      short: "Anaes",  years: ["4"], types: ["theory", "clinical"] },
  { id: "radiology", name: "Radiodiagnosis",         short: "Radio",  years: ["4"], types: ["theory", "clinical"] },
  { id: "respiratory", name: "Respiratory Medicine", short: "Resp",   years: ["4"], types: ["theory", "clinical"] },
];

const SUBJECT_INDEX: Record<string, SubjectMeta> = SUBJECTS.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<string, SubjectMeta>
);

export function getSubject(id: string): SubjectMeta | undefined {
  return SUBJECT_INDEX[id];
}

export function subjectName(id: string): string {
  return SUBJECT_INDEX[id]?.name ?? id;
}

/**
 * Subjects a student should see.
 *
 * @param year            current year from the profile
 * @param includeEarlier  escape hatch — surfaces prior years' subjects too
 */
export function subjectsForYear(year: YearKey, includeEarlier = false): SubjectMeta[] {
  const current = Number(year);
  return SUBJECTS.filter((s) => {
    if (s.years.includes(year)) return true;
    if (!includeEarlier) return false;
    return s.years.some((y) => Number(y) < current);
  });
}

/** Subjects from strictly earlier years — used to label the escape-hatch toggle. */
export function earlierYearSubjectCount(year: YearKey): number {
  const current = Number(year);
  return SUBJECTS.filter(
    (s) => !s.years.includes(year) && s.years.some((y) => Number(y) < current)
  ).length;
}

// -----------------------------------------------------------------------------
// Class types — the single colour-coded dimension in the UI.
//
// COLOUR CONTRACT (see WeekGrid.tsx / ClassTile):
//   The TILE is colour-coded by TYPE. Only by type. Never by subject as well.
//   The SUBJECT is conveyed by large bold text — the loudest element on the tile.
//   Result: type is read by colour, subject is read by text. One glance, both facts.
// -----------------------------------------------------------------------------

export interface ClassTypeMeta {
  key: ClassType;
  label: string;
  /** Two-letter badge for very narrow tiles. */
  badge: string;
  /** Tailwind classes. Kept as literal strings so the JIT compiler sees them. */
  tile: string;
  border: string;
  text: string;
  dot: string;
  chipActive: string;
}

export const CLASS_TYPES: ClassTypeMeta[] = [
  {
    key: "theory",
    label: "Theory",
    badge: "TH",
    tile: "bg-sky-500/12 hover:bg-sky-500/20",
    border: "border-l-sky-400",
    text: "text-sky-300",
    dot: "bg-sky-400",
    chipActive: "bg-sky-500/20 border-sky-400 text-sky-200",
  },
  {
    key: "practical",
    label: "Practical",
    badge: "PR",
    tile: "bg-amber-500/12 hover:bg-amber-500/20",
    border: "border-l-amber-400",
    text: "text-amber-300",
    dot: "bg-amber-400",
    chipActive: "bg-amber-500/20 border-amber-400 text-amber-200",
  },
  {
    key: "clinical",
    label: "Clinical posting",
    badge: "CP",
    tile: "bg-violet-500/12 hover:bg-violet-500/20",
    border: "border-l-violet-400",
    text: "text-violet-300",
    dot: "bg-violet-400",
    chipActive: "bg-violet-500/20 border-violet-400 text-violet-200",
  },
];

const TYPE_INDEX: Record<ClassType, ClassTypeMeta> = CLASS_TYPES.reduce(
  (acc, t) => {
    acc[t.key] = t;
    return acc;
  },
  {} as Record<ClassType, ClassTypeMeta>
);

export function typeMeta(t: ClassType): ClassTypeMeta {
  return TYPE_INDEX[t] ?? TYPE_INDEX.theory;
}

// -----------------------------------------------------------------------------
// Attendance weighting.
//
// BUG FIX (reported 2026-09-20): selecting Practical or Clinical posting silently
// forced the multiplier to 2x. That was wrong. A class counts as ONE session
// unless the student's own college says otherwise, and the student must opt in
// to that explicitly. DEFAULT_WEIGHT is 1 for every type, with no exceptions.
// -----------------------------------------------------------------------------

export const DEFAULT_WEIGHT = 1;

/** Deliberately ignores `type`. Present so call sites read clearly. */
export function defaultWeightFor(_type: ClassType): number {
  return DEFAULT_WEIGHT;
}

export const DAYS = [
  { index: 1, label: "Monday", short: "Mon" },
  { index: 2, label: "Tuesday", short: "Tue" },
  { index: 3, label: "Wednesday", short: "Wed" },
  { index: 4, label: "Thursday", short: "Thu" },
  { index: 5, label: "Friday", short: "Fri" },
  { index: 6, label: "Saturday", short: "Sat" },
  { index: 0, label: "Sunday", short: "Sun" },
];
