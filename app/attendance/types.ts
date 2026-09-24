// =============================================================================
// app/attendance/types.ts
// -----------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH for every attendance data shape.
// No logic lives here. No imports. Nothing runs.
//
// REBUILD v4 — see ATTENDANCE_REBUILD_SPEC.txt
//
// ⚠ TRAP 4 — DAY INDEXING
// The ONLY legal day index in this codebase is:
//     0 = Monday, 1 = Tuesday, 2 = Wednesday, 3 = Thursday,
//     4 = Friday,  5 = Saturday, 6 = Sunday
// This is NOT JavaScript's Date.getDay() (0 = Sunday).
// Always convert with dateToDayIndex() in lib/attendance/datetime.ts.
// =============================================================================


// -----------------------------------------------------------------------------
// SECTION 1 — Primitive aliases
// -----------------------------------------------------------------------------

/** "YYYY-MM-DD". Always local calendar date, never a UTC timestamp. */
export type ISODate = string;

/** "HH:MM" 24-hour, zero-padded. e.g. "09:00", "14:30". */
export type TimeHHMM = string;

/** 0 = Monday … 6 = Sunday. See TRAP 4 above. */
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Stable unique id, e.g. "cls_1790096625212_iazir". */
export type Id = string;

export type AcademicYear =
  | '1st MBBS'
  | '2nd MBBS'
  | '3rd MBBS Part 1'
  | '3rd MBBS Part 2';

/** Stable subject key, e.g. "surgery", "obg". Lowercase, no spaces. */
export type SubjectId = string;

/**
 * Monotonic counter, bumped on ANY write that can change a number:
 * a mark, a threshold edit, an exclusion toggle, a timetable change.
 * Used as the memo key in calculate.ts. Never persisted.
 */
export type DataVersion = number;


// -----------------------------------------------------------------------------
// SECTION 2 — Class categories
//
// ⚠ TRAP 1 — a session's category is decided by WHAT IS IN THE SLOT, never by
// what used to be there. Posting replaced by a theory class → category is
// 'theory'. Full stop.
// -----------------------------------------------------------------------------

export type ClassCategory = 'theory' | 'practical' | 'clinical';

/** How a session came to exist. Affects counting rules, not category. */
export type SessionOrigin = 'regular' | 'posting' | 'extra';

const CLASS_CATEGORY_LIST: ClassCategory[] = ['theory', 'practical', 'clinical'];
export const CLASS_CATEGORIES: readonly ClassCategory[] =
  Object.freeze(CLASS_CATEGORY_LIST);

const DAY_NAME_LIST: string[] = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];
export const DAY_NAMES: readonly string[] = Object.freeze(DAY_NAME_LIST);

const DAY_NAME_SHORT_LIST: string[] = [
  'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
];
export const DAY_NAMES_SHORT: readonly string[] =
  Object.freeze(DAY_NAME_SHORT_LIST);


// -----------------------------------------------------------------------------
// SECTION 3 — Thresholds   ★ NEW IN v4
//
// Replaces TermConfig.targetPercent, which was a single number and could not
// express "75% theory, 80% practical".
//
// Resolution order, most specific wins:
//   1. thresholds[year][subjectId][category]
//   2. DEFAULT_THRESHOLDS[category]
//
// Editable in SETTINGS ONLY — never in setup. Always show the default beside
// the field so an edited value is visibly an edit.
// -----------------------------------------------------------------------------

/** Percentage 0–100. A whole number; halves are not a real college rule. */
export type ThresholdPercent = number;

const DEFAULT_THRESHOLDS_BASE: Record<ClassCategory, ThresholdPercent> = {
  theory: 75,
  practical: 80,
  clinical: 80,
};

export const DEFAULT_THRESHOLDS: Readonly<Record<ClassCategory, ThresholdPercent>> =
  Object.freeze(DEFAULT_THRESHOLDS_BASE);

/**
 * year → subjectId → category → percent.
 * SPARSE. A missing key means "use the default" — it does NOT mean zero.
 * Never write a value here just because it equals the default; an absent key
 * is what makes "reset to default" work.
 */
export type ThresholdStore = Partial<
  Record<
    AcademicYear,
    Partial<Record<SubjectId, Partial<Record<ClassCategory, ThresholdPercent>>>>
  >
>;


// -----------------------------------------------------------------------------
// SECTION 4 — Timetable
//
// Stored DAY-GROUPED, not flat. "Everything on Tuesday" must be one key
// access — the add-class form does it on every keystroke.
// -----------------------------------------------------------------------------

export interface TimetableEntry {
  id: Id;
  subjectId: SubjectId;
  /** Display name at creation time. Never used for matching. */
  subjectName: string;
  category: ClassCategory;
  start: TimeHHMM;
  end: TimeHHMM;
  /**
   * How many classes this one slot counts as. Default 1.
   *
   * ⚠ THREE DIFFERENT RENDERINGS OF THE SAME NUMBER:
   *   storage       → ONE session, weight N
   *   marking list  → ONE row, one tap, logs N
   *   week strip    → N tiles, because it counts as N classes
   */
  weight: number;
  /** True if this sits outside configured college hours. */
  isAfterHours: boolean;
  createdAt: number;
}

/**
 * Day-grouped timetable for ONE academic year.
 * Key is DayIndex as a string. Missing key = no classes that day.
 */
export type TimetableByDay = Partial<Record<`${DayIndex}`, TimetableEntry[]>>;

export type TimetableStore = Partial<Record<AcademicYear, TimetableByDay>>;


// -----------------------------------------------------------------------------
// SECTION 5 — Clinical postings
//
// A posting is a DATE RANGE, not a weekly slot. Single source of truth; the
// sessions it implies are generated on demand, never stored twice.
// -----------------------------------------------------------------------------

export type ConflictResolution =
  /** New entry wins; the posting does not run that day. */
  | 'replace'
  /** Both run, both count. Exceptions only. */
  | 'alongside';

export interface PostingException {
  id: Id;
  date: ISODate;
  resolution: ConflictResolution;
  /**
   * The class taking the slot on this date.
   * Null = posting simply did not run.
   * ⚠ TRAP 1 — if set, the generated session takes ITS category.
   */
  replacement: {
    subjectId: SubjectId;
    subjectName: string;
    category: ClassCategory;
    start: TimeHHMM;
    end: TimeHHMM;
    weight: number;
  } | null;
  /** User's own note. Never read by any calculation. */
  note?: string;
}

export interface Posting {
  id: Id;
  subjectId: SubjectId;
  subjectName: string;
  startDate: ISODate;
  endDate: ISODate;
  start: TimeHHMM;
  end: TimeHHMM;
  /** Which weekdays it runs. Should inherit CollegeConfig.workingDays. */
  workingDays: DayIndex[];
  /** Classes per day. Default 1 — postings usually count as one. */
  weight: number;
  exceptions: PostingException[];
  createdAt: number;
}

export type PostingStore = Partial<Record<AcademicYear, Posting[]>>;


// -----------------------------------------------------------------------------
// SECTION 6 — Extra classes   ★ RESHAPED IN v4
//
// Makeup classes. Hidden behind AttendanceSettings.extraClassesEnabled — a
// normal student never sees any of this.
//
// ★ THE FIX: countsTowardDenominator now lives ON EACH ENTRY. It used to be
//   one global AttendanceSettings.extraClassPolicy, which meant flipping it
//   swept through regular classes too.
//
//   Regular and posting sessions HAVE NO SUCH FIELD. Recalculating extras is
//   therefore structurally incapable of touching them. That is the separation,
//   enforced by the type system rather than by carefulness.
//
// ⚠ TRAP 3 — countsToward 'both' means ONE session satisfying TWO
//   requirements. It adds its weight to theory's denominator AND practical's.
//   It does NOT add 2 to a combined total. There is no combined total.
// -----------------------------------------------------------------------------

export type ExtraCountsToward = 'theory' | 'practical' | 'clinical' | 'both';

/** 'both' resolves to exactly these two. Nothing else. */
const BOTH_LIST: ClassCategory[] = ['theory', 'practical'];
export const BOTH_RESOLVES_TO: readonly ClassCategory[] = Object.freeze(BOTH_LIST);

export type ExtraRepeat = 'once' | 'daily' | 'weekly';

export interface ExtraClass {
  id: Id;
  subjectId: SubjectId;
  subjectName: string;
  /**
   * Which category's denominator(s) this feeds.
   * ⚠ Editable AFTER marking. Changing it retroactively moves the attendance
   *   to the other category. Safe, because nothing derived is stored.
   */
  countsToward: ExtraCountsToward;
  /**
   * ★ NEW — per-entry denominator policy.
   *   true  → this extra class raises conducted AND attended
   *   false → raises attended only; denominator untouched
   *
   * Student-editable at any time. Recalculation is automatic and cannot
   * reach regular sessions.
   *
   * UI label: avoid the word "denominator". Suggested wording —
   *   "Does your college count this class in the total?"  Yes / No
   */
  countsTowardDenominator: boolean;
  startDate: ISODate;
  /** Equal to startDate when repeat is 'once'. */
  endDate: ISODate;
  repeat: ExtraRepeat;
  /** Only meaningful when repeat is 'weekly'. */
  weekdays: DayIndex[];
  start: TimeHHMM;
  end: TimeHHMM;
  weight: number;
  createdAt: number;
}

export type ExtraClassStore = Partial<Record<AcademicYear, ExtraClass[]>>;


// -----------------------------------------------------------------------------
// SECTION 7 — Blockouts
//
// Date ranges where no class runs: exam weeks, holidays, sick leave.
// Everything inside becomes 'not-conducted' (0/0).
//
// ⚠ TRAP 7 — overlapping blockouts mark a date ONCE. A date covered by both
//   an exam block and sick leave is ONE not-conducted day, not two.
// -----------------------------------------------------------------------------

export type BlockoutKind = 'exam' | 'holiday' | 'custom';

export interface Blockout {
  id: Id;
  kind: BlockoutKind;
  startDate: ISODate;
  endDate: ISODate;
  /** Display only. Never affects any number. */
  reason: string;
  /** Null = every subject. Otherwise limited to these. */
  subjectIds: SubjectId[] | null;
  createdAt: number;
}

export type BlockoutStore = Partial<Record<AcademicYear, Blockout[]>>;


// -----------------------------------------------------------------------------
// SECTION 8 — Sessions
//
// One concrete class on one concrete date. Generated from timetable, postings
// and extras — then marked by the student.
//
// ⚠ Session ids MUST be deterministic: s_reg_{entryId}_{date}. No Date.now(),
//   no counters. Marks are keyed by session id, so non-deterministic ids would
//   orphan every mark on the next timetable edit. Verified good in generate.ts.
// -----------------------------------------------------------------------------

/**
 * THE MARKING MODEL — universal, not configurable, no student override.
 *   present        → 1 / 1
 *   absent         → 0 / 1
 *   not-conducted  → 0 / 0   (displayed to the student as "Cancelled")
 *   unmarked       → 0 / 0   never auto-filled, flagged for review
 *
 * NOTE ON THE NAME: the student-facing label is "Cancelled". The stored value
 * stays 'not-conducted' because renaming it would orphan every existing mark
 * for zero benefit. Label in the UI, never in storage.
 */
export type SessionStatus =
  | 'unmarked'
  | 'present'
  | 'absent'
  | 'not-conducted';

export interface Session {
  id: Id;
  date: ISODate;
  academicYear: AcademicYear;
  subjectId: SubjectId;
  subjectName: string;
  /** ⚠ TRAP 1 — authoritative. Reflects what is in the slot NOW. */
  category: ClassCategory;
  origin: SessionOrigin;
  start: TimeHHMM;
  end: TimeHHMM;
  weight: number;
  status: SessionStatus;
  /**
   * ★ Copied from ExtraClass.countsTowardDenominator at generation time.
   *   PRESENT ONLY when origin === 'extra'.
   *   undefined on regular and posting sessions — and that absence is the
   *   safety mechanism. calculate.ts must never default this to anything.
   */
  countsTowardDenominator?: boolean;
  /** Set when origin is 'posting'. */
  postingId?: Id;
  /** Set when origin is 'extra'. */
  extraClassId?: Id;
  /** Set when origin is 'regular'. Points back at the TimetableEntry. */
  timetableEntryId?: Id;
  /**
   * Only for extras with countsToward 'both'. Generation emits ONE session
   * per category, each tagged here, so the two denominators increment
   * independently and neither is double counted.
   */
  bothPairKey?: Id;
}

/** Marks stored separately from generated sessions, keyed by session id. */
export type SessionMarks = Record<Id, SessionStatus>;


// -----------------------------------------------------------------------------
// SECTION 9 — Opening balance
//
// "I started using this app in March; before today I'd attended 40 of 50."
// Typed once at setup, under "pick up where you left off".
//
// ⚠ TRAP 10 — an import for a given year+subject+category REPLACES the
//   existing balance for that exact key. It never adds to it.
// -----------------------------------------------------------------------------

export interface OpeningBalanceEntry {
  conducted: number;
  attended: number;
  /** True when the student typed a percentage rather than real counts. */
  isEstimate: boolean;
  updatedAt: number;
}

/** year → subjectId → category → figures. */
export type OpeningBalanceStore = Partial<
  Record<
    AcademicYear,
    Partial<Record<SubjectId, Partial<Record<ClassCategory, OpeningBalanceEntry>>>>
  >
>;


// -----------------------------------------------------------------------------
// SECTION 10 — Exclusions   ★ LOCK REMOVED IN v4
//
// "Don't count this — but keep the data."
//
// The v3 TRAP 8 lock (an exam subject could not be excluded) IS GONE. It was
// guarding against a deletion, but exclusion deletes nothing and reverses
// instantly. The student's own example is the spec:
//
//   2nd year Gen Med logged → told only final year counts → settings →
//   subject → Medicine → 2nd year OFF → professor changes their mind →
//   toggle back ON → the 2nd-year data is still there, untouched.
//
// ⚠ TRAP 2 — an excluded subject's opening balance is excluded too.
// -----------------------------------------------------------------------------

export interface SubjectExclusion {
  theory?: boolean;
  practical?: boolean;
  clinical?: boolean;
  /** True excludes every category regardless of the individual flags. */
  whole?: boolean;
}

/** year → subjectId → which categories are excluded. */
export type ExclusionStore = Partial<
  Record<AcademicYear, Partial<Record<SubjectId, SubjectExclusion>>>
>;


// -----------------------------------------------------------------------------
// SECTION 11 — College configuration
//
// ⚠ TRAP 6 — hours are enforced in the data layer, not just hidden in the UI.
//   A slot outside college hours is valid only when isAfterHours is true on
//   the entry AND allowAfterHours is true in config.
// -----------------------------------------------------------------------------

export interface CollegeConfig {
  /** Earliest selectable time. Inferred from the timetable, manually overridable. */
  dayStart: TimeHHMM;
  /** Latest selectable time. Same. */
  dayEnd: TimeHHMM;
  /**
   * ★ Chosen by the student at setup, editable in settings.
   * Drives three things: which columns the week strip renders, which days
   * generate sessions, and break inference.
   * A non-working day is NOT a break — it is absent from the grid entirely.
   */
  workingDays: DayIndex[];
  slotMinutes: 15 | 30 | 60;
  allowAfterHours: boolean;
  /**
   * ★ True once the student has manually edited dayStart/dayEnd.
   * While false, both are re-inferred from the timetable on every change.
   * Once true, inference stops and never silently overrides them again.
   */
  hoursManuallySet: boolean;
}

export interface TermConfig {
  startDate: ISODate;
  endDate: ISODate;
  // ⚠ targetPercent: REMOVED IN v4.
  // A single number cannot express 75% theory / 80% practical.
  // See SECTION 3 — ThresholdStore.
}

export interface AttendanceSettings {
  college: CollegeConfig;
  term: TermConfig;
  /** Master switch. False hides every extra-class control in the app. */
  extraClassesEnabled: boolean;
  // ⚠ extraClassPolicy: REMOVED IN v4.
  // Now per-entry: ExtraClass.countsTowardDenominator. See SECTION 6.
  /** Per-year exam subjects. Drives what appears on the main attendance page. */
  examSubjectsByYear: Partial<Record<AcademicYear, SubjectId[]>>;
  /** The year the student is currently in. Drives every default view. */
  currentYear: AcademicYear;
}


// -----------------------------------------------------------------------------
// SECTION 12 — Calculation results   ★ HEAVILY RESHAPED IN v4
//
// Read-only. Nothing writes these back to storage. Recomputed from raw
// sessions on every read, memoised in memory by DataVersion.
//
// ★ THE POOLED-NUMBER PURGE:
//   OverallResult          — DELETED. There is no meaningful overall figure.
//   SubjectResult.percent  — DELETED. Theory and practical are judged apart,
//                            at different thresholds.
//   YearResult.percent     — DELETED. Same reason.
//
//   A pooled 78% can read green while Pathology practical sits at 68% and the
//   student is debarred. That number is not merely useless, it is dangerous.
//
// ★ THE ROUNDING FIX:
//   `ratio` is the exact fraction and is the ONLY thing any decision reads.
//   `percentDisplay` is rounded and is for eyeballs only.
//   v3 rounded FIRST, so 74.96% became 75.0, scored 'safe', and reported
//   0 classes needed — to a student who was in fact below the line.
//   Never compare percentDisplay to a threshold. Not once.
// -----------------------------------------------------------------------------

export type SafetyBand = 'safe' | 'warning' | 'danger' | 'critical';

/** The extras-only figure, shown behind a button. Never the default view. */
export interface ExtrasBreakdown {
  conducted: number;
  attended: number;
  /** Exact fraction 0–1. */
  ratio: number;
  isEmpty: boolean;
}

export interface CategoryResult {
  category: ClassCategory;
  /** The threshold actually applied — resolved default or student override. */
  threshold: ThresholdPercent;
  /** True when the student has overridden the default for this key. */
  isCustomThreshold: boolean;

  /** Weight-aware totals. Default view: regular + extras clubbed together. */
  conducted: number;
  attended: number;

  /**
   * ★ EXACT fraction, 0–1, unrounded. Every comparison uses THIS.
   * 0 when conducted is 0.
   */
  ratio: number;
  /** Rounded to one decimal. DISPLAY ONLY. Never compare this to anything. */
  percentDisplay: number;

  /** True when conducted is 0 — show a dash, not "0%". */
  isEmpty: boolean;
  band: SafetyBand;

  /**
   * Classes needed to reach threshold. 0 when already there.
   * Denominator grows with numerator:
   *   x = ceil((t * conducted - attended) / (1 - t))   where t = threshold/100
   */
  mustAttend: number;
  /**
   * Classes skippable before dropping below threshold.
   *   floor(attended / t - conducted)
   */
  canSkip: number;
  /** True when the threshold is mathematically out of reach this term. */
  targetUnreachable: boolean;

  /** Extras-only figures, for the semi-hidden toggle. Null when no extras. */
  extrasOnly: ExtrasBreakdown | null;
  /** True when this category is excluded for this year. Shown greyed. */
  isExcluded: boolean;
  /** Unmarked past sessions in this category. Drives the "N unmarked" chip. */
  unmarkedCount: number;
}

export interface SubjectResult {
  subjectId: SubjectId;
  subjectName: string;
  /** 2–3 letter code from the curriculum, for dense tiles. Never student-typed. */
  shortCode: string;
  academicYear: AcademicYear;
  /** Only categories that actually have data. (TRAP 9) */
  categories: CategoryResult[];
  // ⚠ conducted / attended / percent / band: DELETED IN v4. Pooled = dangerous.
  /**
   * The worst band across this subject's categories.
   * For the SUBJECT LABEL COLOUR ONLY — the rings stay purple/orange by type.
   * Ring = identity. Label = safety.
   */
  worstBand: SafetyBand;
  /** True when every category is excluded for this year. */
  isExcluded: boolean;
  /** True when this is an exam subject for this year → appears on main page. */
  isExamSubject: boolean;
}

export interface YearResult {
  academicYear: AcademicYear;
  /** Subjects present in the timetable for this year only. (TRAP 9) */
  subjects: SubjectResult[];
  // ⚠ conducted / attended / percent / band: DELETED IN v4.
}

/**
 * Top-level calculation output. A LIST OF YEARS, deliberately with no totals.
 * If you ever feel tempted to add a percent here, re-read SECTION 12.
 */
export interface AttendanceResult {
  years: YearResult[];
  /** The DataVersion this was computed from. Memo key. */
  version: DataVersion;
  computedAt: number;
}


// -----------------------------------------------------------------------------
// SECTION 13 — Week strip view model   ★ NEW IN v4
//
// The top-of-screen weekly preview. READ-ONLY: it renders raw sessions,
// computes nothing, stores nothing, and shows NO percentages ever.
// Marking happens in the list below it, never here.
// -----------------------------------------------------------------------------

/**
 * Tile appearance. Fill vs outline does the work, so it survives colour
 * blindness and bright sunlight.
 *   present   → solid green
 *   absent    → solid red
 *   unmarked  → LIGHT grey, SOLID       ← eye should land here first
 *   future    → PALEST grey, OUTLINE    ← nothing owed yet
 *   cancelled → DARK grey, struck through ← settled, closed
 */
export type WeekTileStatus =
  | 'present'
  | 'absent'
  | 'unmarked'
  | 'future'
  | 'cancelled';

export interface WeekTile {
  sessionId: Id;
  subjectShortCode: string;
  subjectName: string;
  category: ClassCategory;
  status: WeekTileStatus;
  /**
   * How many tiles this session renders as — equals Session.weight.
   * A posting counted as 3 classes draws 3 tiles; counted as 1 draws 1 tall tile.
   */
  tileCount: number;
  /** Duration in minutes. Drives tile height so columns stay aligned. */
  durationMinutes: number;
  /** True for extra / quick-added classes → dashed border, so it isn't a surprise. */
  isOffTimetable: boolean;
}

/** A collapsed gap. Inferred: no working day has a class in this slot. */
export interface BreakRow {
  kind: 'break';
  start: TimeHHMM;
  end: TimeHHMM;
  /** True when two or more consecutive breaks were merged into one row. */
  isMerged: boolean;
}

export interface ClassRow {
  kind: 'class';
  start: TimeHHMM;
  end: TimeHHMM;
}

export type TimeRow = ClassRow | BreakRow;

export interface DayColumn {
  dayIndex: DayIndex;
  date: ISODate;
  /** True for today → gets the vertical spine highlight. */
  isToday: boolean;
  /** Tiles in time order. May be empty (a partial gap, not a break). */
  tiles: WeekTile[];
}

export interface WeekStripModel {
  /** Only working days. A non-working day is absent, not empty. */
  days: DayColumn[];
  /** Shared row skeleton so every column aligns. */
  rows: TimeRow[];
  weekStart: ISODate;
  weekEnd: ISODate;
  /** False when viewing history → show the "Back to this week" button. */
  isCurrentWeek: boolean;
  /** Unmarked past sessions this week. Surfaced in the marking list below. */
  unmarkedCount: number;
}


// -----------------------------------------------------------------------------
// SECTION 14 — Ring grid layout   ★ NEW IN v4
//
// Two concentric rings per subject.
//   OUTER = theory      → deep violet  #6D28D9
//   INNER = practical / clinical → warm orange #F97316
//   TRACK = #E5E7EB, so a 5% ring still reads as a ring
//
// Ring colour = IDENTITY, always. Safety lives on the subject label.
// A tick mark sits on each track at the threshold position.
//
// ⚠ The outer ring is physically longer, so 75% outside draws a longer arc
//   than 75% inside. Keep the radii close, start both arcs at 12 o'clock, and
//   let the tick marks carry the comparison.
// -----------------------------------------------------------------------------

/** Never shrink rings to fit. Change arrangement, or scroll. */
export type RingGridArrangement =
  | 'single'    // 1–2 subjects, large
  | 'row-3'     // 3
  | 'grid-2x2'  // 4
  | 'grid-3x2'  // 5–6
  | 'scroll-3'; // 7+, three per row, scrolls

export const RING_MIN_DIAMETER_PX = 96;
export const RING_MIN_TAP_TARGET_PX = 44;


// -----------------------------------------------------------------------------
// SECTION 15 — Conflict reporting
//
// Zero overlap tolerance: touching edges fine, one shared minute is not.
// Warns, never blocks — real medical timetables are messier than any validator.
// -----------------------------------------------------------------------------

export interface ConflictReport {
  hasConflict: boolean;
  collidesWith: TimetableEntry[];
  /** Ready to drop straight into the UI. */
  message: string;
  /** Earliest free start at or after the proposed one. Null if none. */
  suggestedStart: TimeHHMM | null;
}


// -----------------------------------------------------------------------------
// SECTION 16 — Storage keys
//
// Bump the version suffix on a BREAKING shape change so old data is never
// silently misread.
//
// v4 bumps: extra (gained countsTowardDenominator),
//           settings (lost targetPercent and extraClassPolicy).
// v4 adds:  thresholds.
// Unchanged shapes keep v3 — no pointless migration.
//
// ⚠ store.ts owes a v3 → v4 migration. Nothing is lost: old data is read,
//   converted, rewritten.
// -----------------------------------------------------------------------------

export const STORAGE_KEYS = Object.freeze({
  timetable: 'medprep.attendance.timetable.v3',
  postings: 'medprep.attendance.postings.v3',
  extraClasses: 'medprep.attendance.extra.v4',
  blockouts: 'medprep.attendance.blockouts.v3',
  marks: 'medprep.attendance.marks.v3',
  openingBalance: 'medprep.attendance.opening.v3',
  exclusions: 'medprep.attendance.exclusions.v3',
  settings: 'medprep.attendance.settings.v4',
  thresholds: 'medprep.attendance.thresholds.v4',
} as const);

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** Old keys, read once during migration then removed. */
export const LEGACY_STORAGE_KEYS = Object.freeze({
  extraClassesV3: 'medprep.attendance.extra.v3',
  settingsV3: 'medprep.attendance.settings.v3',
} as const);


// -----------------------------------------------------------------------------
// SECTION 17 — Defaults
//
// NOTE ON STYLE: Object.freeze({ workingDays: [0,1,2,3,4,5] }) makes TS infer
// number[] and widen slotMinutes to number, neither of which satisfies
// CollegeConfig. Annotate the plain object FIRST, freeze afterwards.
// -----------------------------------------------------------------------------

const DEFAULT_COLLEGE_CONFIG_BASE: CollegeConfig = {
  dayStart: '09:00',
  dayEnd: '16:00',
  workingDays: [0, 1, 2, 3, 4, 5],
  slotMinutes: 30,
  allowAfterHours: false,
  hoursManuallySet: false,
};

export const DEFAULT_COLLEGE_CONFIG: CollegeConfig = Object.freeze(
  DEFAULT_COLLEGE_CONFIG_BASE,
);

/**
 * Band margins, in percentage points BELOW the applicable threshold.
 * Applied against the resolved per-category threshold, not a global target —
 * so a 50% ophthalmology theory threshold gets the same band shape as an
 * 80% practical one.
 *
 *   ratio*100 >= threshold                      → safe
 *   within warningMargin below                  → warning
 *   within dangerMargin below                   → danger
 *   further below than that                     → critical
 */
export const SAFETY_THRESHOLDS = Object.freeze({
  warningMargin: 5,
  dangerMargin: 15,
});

/** Ring palette. Mirror these in globals.css; do not let them drift apart. */
export const RING_COLORS = Object.freeze({
  theory: '#6D28D9',
  practical: '#F97316',
  clinical: '#F97316',
  track: '#E5E7EB',
});


// =============================================================================
// NEXT FILE — calculate.ts
//   • Pure. No storage reads. Sessions + resolved settings in, numbers out.
//   • ONE pass over the session list, bucketed by subject+category.
//   • Exact ratio for every decision; percentDisplay for eyeballs only.
//   • Memo keyed by getDataVersion(). Nothing derived is ever persisted.
//   • No OverallResult. No SubjectResult.percent. No YearResult.percent.
// =============================================================================
