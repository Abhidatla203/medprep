// =============================================================================
// app/attendance/types.ts
// -----------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH for every attendance data shape.
// No logic lives here. No imports. Nothing runs.
//
// ⚠ TRAP 4 — DAY INDEXING
// The ONLY legal day index in this codebase is:
//     0 = Monday, 1 = Tuesday, 2 = Wednesday, 3 = Thursday,
//     4 = Friday,  5 = Saturday, 6 = Sunday
// This is NOT the same as JavaScript's Date.getDay() (0 = Sunday).
// Never pass a raw Date.getDay() anywhere. Convert it first with
// dateToDayIndex() in lib/attendance/datetime.ts.
// =============================================================================


// -----------------------------------------------------------------------------
// SECTION 1 — Primitive aliases
// These exist so a wrong value is caught by the compiler, not by you at 2am.
// -----------------------------------------------------------------------------

/** "YYYY-MM-DD". Always local calendar date, never a UTC timestamp. */
export type ISODate = string;

/** "HH:MM" in 24-hour form, e.g. "09:00", "14:30". Always zero-padded. */
export type TimeHHMM = string;

/** 0 = Monday … 6 = Sunday. See TRAP 4 above. */
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Stable unique id, e.g. "cls_1790096625212_iazir". */
export type Id = string;

/** Academic year key. Must match a key in the curriculum definition. */
export type AcademicYear =
  | '1st MBBS'
  | '2nd MBBS'
  | '3rd MBBS Part 1'
  | '3rd MBBS Part 2';

/** Stable subject key, e.g. "surgery", "obg", "ent". Lowercase, no spaces. */
export type SubjectId = string;


// -----------------------------------------------------------------------------
// SECTION 2 — Class categories
//
// ⚠ TRAP 1 — ATTENDANCE TYPE MISMATCH
// A session's category is decided by WHAT IS IN THE SLOT, never by what used
// to be there. If a clinical posting is replaced by a theory class, that
// session's category is 'theory'. Full stop.
// -----------------------------------------------------------------------------

export type ClassCategory = 'theory' | 'practical' | 'clinical';

/** How a session came to exist. Affects counting rules, not category. */
export type SessionOrigin = 'regular' | 'posting' | 'extra';

const CLASS_CATEGORY_LIST: ClassCategory[] = ['theory', 'practical', 'clinical'];
export const CLASS_CATEGORIES: readonly ClassCategory[] =
  Object.freeze(CLASS_CATEGORY_LIST);

const DAY_NAME_LIST: string[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
export const DAY_NAMES: readonly string[] = Object.freeze(DAY_NAME_LIST);

const DAY_NAME_SHORT_LIST: string[] = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
];
export const DAY_NAMES_SHORT: readonly string[] =
  Object.freeze(DAY_NAME_SHORT_LIST);


// -----------------------------------------------------------------------------
// SECTION 3 — Timetable
//
// Stored DAY-GROUPED, not as a flat array. Looking up "everything on Tuesday"
// must be a single key access, because the add-class form does that on every
// keystroke to work out which time slots to hide.
// -----------------------------------------------------------------------------

export interface TimetableEntry {
  id: Id;
  subjectId: SubjectId;
  /** Display name at time of creation. Never used for matching — display only. */
  subjectName: string;
  category: ClassCategory;
  start: TimeHHMM;
  end: TimeHHMM;
  /**
   * How many classes this single slot counts as.
   * A 3-hour clinical block the college logs as 3 classes → weight 3.
   * Default 1.
   */
  weight: number;
  /** True if this sits outside the configured college hours. */
  isAfterHours: boolean;
  /** Epoch ms. Used to break ties when two entries collide. */
  createdAt: number;
}

/**
 * Day-grouped timetable for ONE academic year.
 * Key is DayIndex as a string, because object keys are always strings in JS.
 * Missing key = no classes that day. Treat as [].
 */
export type TimetableByDay = Partial<Record<`${DayIndex}`, TimetableEntry[]>>;

/** Full timetable store: one day-grouped table per academic year. */
export type TimetableStore = Partial<Record<AcademicYear, TimetableByDay>>;


// -----------------------------------------------------------------------------
// SECTION 4 — Clinical postings
//
// A posting is a DATE RANGE, not a weekly slot. It is the single source of
// truth — the sessions it implies are generated on demand, never stored twice.
// Editing the posting's dates or name updates every derived session for free.
// -----------------------------------------------------------------------------

/** What to do on a day where a posting and something else both want the slot. */
export type ConflictResolution =
  /** New entry wins; the posting does not run that day. */
  | 'replace'
  /** Both run. Both count. Exceptions only — never offered in normal setup. */
  | 'alongside';

export interface PostingException {
  id: Id;
  date: ISODate;
  resolution: ConflictResolution;
  /**
   * The class that takes the slot on this date.
   * Null means "posting simply did not run" (e.g. department closed).
   *
   * ⚠ TRAP 1 — if this is set, the generated session takes ITS category,
   * not the posting's.
   */
  replacement: {
    subjectId: SubjectId;
    subjectName: string;
    category: ClassCategory;
    start: TimeHHMM;
    end: TimeHHMM;
    weight: number;
  } | null;
  /** Free text for the user's own reference. Never read by any calculation. */
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
  /** Which weekdays the posting actually runs. Default Mon–Fri = [0,1,2,3,4]. */
  workingDays: DayIndex[];
  /** Classes this posting counts as per day. Default 1. */
  weight: number;
  /** Per-date overrides. Sparse — most postings have none. */
  exceptions: PostingException[];
  createdAt: number;
}

export type PostingStore = Partial<Record<AcademicYear, Posting[]>>;


// -----------------------------------------------------------------------------
// SECTION 5 — Extra classes
//
// Makeup classes for students short on attendance. Hidden behind a settings
// toggle — a normal user never sees any of this.
//
// ⚠ TRAP 3 — "BOTH" COUNTING
// countsToward: 'both' means ONE session that satisfies TWO requirements.
// It adds its weight to theory's denominator AND to practical's denominator.
// It does NOT add 2 to a single combined total. There is no combined total.
// -----------------------------------------------------------------------------

export type ExtraCountsToward = 'theory' | 'practical' | 'clinical' | 'both';

/** 'both' resolves to exactly these two categories. Nothing else. */
const BOTH_LIST: ClassCategory[] = ['theory', 'practical'];
export const BOTH_RESOLVES_TO: readonly ClassCategory[] = Object.freeze(BOTH_LIST);

export type ExtraRepeat = 'once' | 'daily' | 'weekly';

export interface ExtraClass {
  id: Id;
  subjectId: SubjectId;
  subjectName: string;
  /**
   * Which category's denominator(s) this feeds.
   * ⚠ Editable AFTER marking. Changing it must retroactively move the
   * attendance to the other category and refresh every percentage.
   */
  countsToward: ExtraCountsToward;
  startDate: ISODate;
  /** Equal to startDate when repeat is 'once'. */
  endDate: ISODate;
  repeat: ExtraRepeat;
  /** Only meaningful when repeat is 'weekly'. Empty otherwise. */
  weekdays: DayIndex[];
  start: TimeHHMM;
  end: TimeHHMM;
  weight: number;
  createdAt: number;
}

export type ExtraClassStore = Partial<Record<AcademicYear, ExtraClass[]>>;


// -----------------------------------------------------------------------------
// SECTION 6 — Blockouts
//
// Date ranges where no class runs: exam weeks, holidays, sick leave.
// Everything inside becomes 'not-conducted' — removed from the denominator,
// not counted as an absence.
//
// ⚠ TRAP 7 — STACKING
// Overlapping blockouts must mark a date once. A date covered by both an exam
// block and a sick-leave block is ONE not-conducted day, not two.
// -----------------------------------------------------------------------------

export type BlockoutKind = 'exam' | 'holiday' | 'custom';

export interface Blockout {
  id: Id;
  kind: BlockoutKind;
  startDate: ISODate;
  endDate: ISODate;
  /** User's own note. Display only. Never affects any number. */
  reason: string;
  /** Null = applies to every subject. Otherwise limited to these subjects. */
  subjectIds: SubjectId[] | null;
  createdAt: number;
}

export type BlockoutStore = Partial<Record<AcademicYear, Blockout[]>>;


// -----------------------------------------------------------------------------
// SECTION 7 — Sessions
//
// One concrete class on one concrete date. Generated from the timetable,
// postings and extra classes — then marked by the user.
//
// ⚠ The category here is AUTHORITATIVE. Every calculation reads this field
//   and never infers a category from origin, posting or history. (TRAP 1)
// -----------------------------------------------------------------------------

export type SessionStatus =
  /** Generated but the user hasn't said anything yet. */
  | 'unmarked'
  /** Counts in numerator and denominator. */
  | 'present'
  /** Counts in denominator only. */
  | 'absent'
  /** Counts in neither. Cancelled, blocked out, public holiday. */
  | 'not-conducted';

export interface Session {
  id: Id;
  date: ISODate;
  academicYear: AcademicYear;
  subjectId: SubjectId;
  subjectName: string;
  /** ⚠ TRAP 1 — authoritative. Reflects what is actually in the slot now. */
  category: ClassCategory;
  origin: SessionOrigin;
  start: TimeHHMM;
  end: TimeHHMM;
  weight: number;
  status: SessionStatus;
  /** Set when origin is 'posting'. Lets us re-derive if the posting changes. */
  postingId?: Id;
  /** Set when origin is 'extra'. */
  extraClassId?: Id;
  /** Set when origin is 'regular'. Points back at the TimetableEntry. */
  timetableEntryId?: Id;
  /**
   * Only for extra classes with countsToward 'both'.
   * Generation emits ONE session per category, each tagged here, so the two
   * denominators increment independently and neither is double counted.
   */
  bothPairKey?: Id;
}

/** Marks are stored separately from generated sessions, keyed by session id. */
export type SessionMarks = Record<Id, SessionStatus>;


// -----------------------------------------------------------------------------
// SECTION 8 — Opening balance
//
// For students who start mid-year, or who are carrying figures forward.
// Imported from a file or typed in by hand.
//
// ⚠ TRAP 10 — an import for a given year+subject+category REPLACES any
// existing balance for that exact key. It never adds to it.
// -----------------------------------------------------------------------------

export interface OpeningBalanceEntry {
  conducted: number;
  attended: number;
  /** True when the user typed a percentage rather than real counts. */
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
// SECTION 9 — Exclusions
//
// Per year, per subject, per category. Toggling one recalculates instantly.
//
// ⚠ TRAP 2 — an excluded subject's opening balance is ignored too.
// ⚠ TRAP 8 — a subject listed as an exam subject for a year CANNOT be
//   excluded in that year. The lock is released only by removing it from
//   that year's exam subject list first. Earlier years are always unlockable.
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
// SECTION 10 — College configuration
//
// ⚠ TRAP 6 — hours are enforced in the data layer, not just hidden in the UI.
// A slot outside college hours is only valid when isAfterHours is true on the
// entry AND allowAfterHours is true in config.
// -----------------------------------------------------------------------------

export interface CollegeConfig {
  /** Earliest selectable time in the add-class form. */
  dayStart: TimeHHMM;
  /** Latest selectable time. */
  dayEnd: TimeHHMM;
  /** Days the college actually operates. Default Mon–Sat = [0,1,2,3,4,5]. */
  workingDays: DayIndex[];
  /** Granularity of the time picker, in minutes. */
  slotMinutes: 15 | 30 | 60;
  /** Unlocks the after-hours escape hatch in the UI. */
  allowAfterHours: boolean;
}

export interface TermConfig {
  startDate: ISODate;
  endDate: ISODate;
  /** The percentage the student must reach. Usually 75. */
  targetPercent: number;
}

/**
 * Whether extra classes inflate the denominator.
 * Varies by department and HOD, so the student chooses.
 *   'add'    → extra classes increase conducted AND attended.
 *   'ignore' → extra classes increase attended only. Denominator unchanged.
 */
export type ExtraClassPolicy = 'add' | 'ignore';

export interface AttendanceSettings {
  college: CollegeConfig;
  term: TermConfig;
  /** Master switch. False hides every extra-class control in the app. */
  extraClassesEnabled: boolean;
  extraClassPolicy: ExtraClassPolicy;
  /** Per-year exam subjects. Overrides the university default. (TRAP 8) */
  examSubjectsByYear: Partial<Record<AcademicYear, SubjectId[]>>;
  /** The year the student is currently in. Drives every default view. */
  currentYear: AcademicYear;
}


// -----------------------------------------------------------------------------
// SECTION 11 — Calculation results
//
// Read-only outputs. Nothing writes these back to storage.
// -----------------------------------------------------------------------------

export type SafetyBand = 'safe' | 'warning' | 'danger' | 'critical';

export interface CategoryResult {
  category: ClassCategory;
  conducted: number;
  attended: number;
  /** 0–100, rounded to one decimal. Zero when conducted is 0. */
  percent: number;
  /** True when conducted is 0 — show a dash, not "0%". */
  isEmpty: boolean;
  band: SafetyBand;
  /** Classes skippable in a row before dropping below target. */
  canSkip: number;
  /** Classes needed to reach target. 0 when already there. */
  mustAttend: number;
  /** True when target is mathematically out of reach this term. */
  targetUnreachable: boolean;
}

export interface SubjectResult {
  subjectId: SubjectId;
  subjectName: string;
  academicYear: AcademicYear;
  /** Only the categories that actually have data. (TRAP 9) */
  categories: CategoryResult[];
  /** Combined across this subject's categories. */
  conducted: number;
  attended: number;
  percent: number;
  band: SafetyBand;
  /** True when this subject is excluded for this year. Shown greyed. */
  isExcluded: boolean;
  /** True when this subject is an exam subject for this year. Locked. */
  isExamSubject: boolean;
}

export interface YearResult {
  academicYear: AcademicYear;
  /** Subjects present in the timetable for this year only. (TRAP 9) */
  subjects: SubjectResult[];
  conducted: number;
  attended: number;
  percent: number;
  band: SafetyBand;
}

export interface OverallResult {
  years: YearResult[];
  conducted: number;
  attended: number;
  percent: number;
  band: SafetyBand;
  /** Recomputed on every call. Never cached. (TRAP 5) */
  computedAt: number;
}


// -----------------------------------------------------------------------------
// SECTION 12 — Conflict reporting
//
// Returned by the validator when the user tries to add an overlapping class.
// Zero overlap tolerance: touching edges are fine, one shared minute is not.
// -----------------------------------------------------------------------------

export interface ConflictReport {
  hasConflict: boolean;
  /** Existing entries the proposed slot collides with. */
  collidesWith: TimetableEntry[];
  /** Human-readable, ready to drop straight into the UI. */
  message: string;
  /** Earliest free start time at or after the proposed one. Null if none. */
  suggestedStart: TimeHHMM | null;
}


// -----------------------------------------------------------------------------
// SECTION 13 — Storage keys
//
// Every localStorage key in one place. Bump the version suffix on a breaking
// shape change so old data is never silently misread.
// -----------------------------------------------------------------------------

export const STORAGE_KEYS = Object.freeze({
  timetable: 'medprep.attendance.timetable.v3',
  postings: 'medprep.attendance.postings.v3',
  extraClasses: 'medprep.attendance.extra.v3',
  blockouts: 'medprep.attendance.blockouts.v3',
  marks: 'medprep.attendance.marks.v3',
  openingBalance: 'medprep.attendance.opening.v3',
  exclusions: 'medprep.attendance.exclusions.v3',
  settings: 'medprep.attendance.settings.v3',
} as const);

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];


// -----------------------------------------------------------------------------
// SECTION 14 — Defaults
//
// Used on first run and by the "reset" action.
//
// NOTE ON THE DECLARATION STYLE BELOW:
// Writing Object.freeze({ workingDays: [0,1,2,3,4,5] }) makes TypeScript infer
// number[] and widen slotMinutes to number, neither of which satisfies
// CollegeConfig. Annotating the plain object FIRST gives the literal its
// contextual type, and freezing afterwards preserves it.
// -----------------------------------------------------------------------------

const DEFAULT_COLLEGE_CONFIG_BASE: CollegeConfig = {
  dayStart: '09:00',
  dayEnd: '16:00',
  workingDays: [0, 1, 2, 3, 4, 5],
  slotMinutes: 30,
  allowAfterHours: false,
};

export const DEFAULT_COLLEGE_CONFIG: CollegeConfig = Object.freeze(
  DEFAULT_COLLEGE_CONFIG_BASE,
);

export const SAFETY_THRESHOLDS = Object.freeze({
  /** At or above target → safe. */
  safe: 0,
  /** Within this many points below target → warning. */
  warningMargin: 5,
  /** Within this many points below target → danger. Below that → critical. */
  dangerMargin: 15,
});
