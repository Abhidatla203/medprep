// =============================================================================
// app/attendance/store.ts
// -----------------------------------------------------------------------------
// The ONLY file in the codebase that touches localStorage for attendance.
//
// THREE GUARANTEES:
//   1. NEVER THROWS. Corrupt JSON, quota exceeded, storage disabled — every
//      path returns a valid default. Losing a setting is recoverable; a white
//      screen is not.
//   2. SSR-SAFE. Every access guarded by isBrowser().
//   3. NON-DESTRUCTIVE MIGRATION. Old data is READ, never deleted.
//
// REBUILD v4 — see ATTENDANCE_REBUILD_SPEC.txt
//   • settings lost targetPercent (→ ThresholdStore) and extraClassPolicy
//     (→ per ExtraClass.countsTowardDenominator)
//   • thresholds are a new store, sparse, per year/subject/category
//
// ⚠ TRAP 4 — v2→v3 corrected the day index (Monday=1 → Monday=0).
// =============================================================================

import {
  STORAGE_KEYS,
  LEGACY_STORAGE_KEYS,
  DEFAULT_COLLEGE_CONFIG,
  DEFAULT_THRESHOLDS,
  type AcademicYear,
  type AttendanceSettings,
  type Blockout,
  type BlockoutStore,
  type ClassCategory,
  type DataVersion,
  type DayIndex,
  type ExclusionStore,
  type ExtraClass,
  type ExtraClassStore,
  type ExtraCountsToward,
  type Id,
  type OpeningBalanceStore,
  type Posting,
  type PostingStore,
  type SessionMarks,
  type SessionStatus,
  type SubjectExclusion,
  type SubjectId,
  type ThresholdPercent,
  type ThresholdStore,
  type TimetableByDay,
  type TimetableEntry,
  type TimetableStore,
} from './types';

import { legacyDayToDayIndex, isTimeHHMM, todayISO } from '@/lib/attendance/datetime';
import { isAcademicYear, subjectName } from '@/lib/attendance/curriculum';


// -----------------------------------------------------------------------------
// SECTION 1 — Environment guards
// -----------------------------------------------------------------------------

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readJSON<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null || raw === '') return fallback;
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    // Corrupt entry. Leave it in place for forensics; hand back the default.
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeKey(key: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}


// -----------------------------------------------------------------------------
// SECTION 2 — Id generation
// -----------------------------------------------------------------------------

export function makeId(prefix: string): Id {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}


// -----------------------------------------------------------------------------
// SECTION 3 — Change notification / DataVersion
//
// Any mutation bumps the counter and notifies subscribers.
//
// ★ v4 — this counter IS the DataVersion from types.ts. calculate.ts uses it
//   as its memo key: same version, serve the cached figure; version changed,
//   recompute. Nothing derived is ever written to storage, so a stale value
//   cannot outlive the toggle that should have killed it.
// -----------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
let revision: DataVersion = 0;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getRevision(): DataVersion {
  return revision;
}

/** Preferred name. Identical to getRevision(); reads better at the call site. */
export function getDataVersion(): DataVersion {
  return revision;
}

function notify(): void {
  revision += 1;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // A broken subscriber must not stop the others from updating.
    }
  });
}


// -----------------------------------------------------------------------------
// SECTION 4 — Validation helpers
//
// Everything out of localStorage is untrusted: older builds, devtools edits,
// half-written records from a tab that died mid-save.
// -----------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asDayIndex(v: unknown): DayIndex | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6
    ? (v as DayIndex)
    : null;
}

function asCategory(v: unknown): ClassCategory | null {
  return v === 'theory' || v === 'practical' || v === 'clinical' ? v : null;
}

function asStatus(v: unknown): SessionStatus | null {
  return v === 'unmarked' || v === 'present' || v === 'absent' || v === 'not-conducted'
    ? v
    : null;
}

function asPositiveWeight(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
}

/** Whole number 1–100. Anything else is not a real college rule. */
function asThresholdPercent(v: unknown): ThresholdPercent | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= 1 && n <= 100 ? n : null;
}

function asCountsToward(v: unknown): ExtraCountsToward {
  return v === 'theory' || v === 'practical' || v === 'clinical' || v === 'both'
    ? v
    : 'theory';
}

function sanitiseEntry(raw: unknown): TimetableEntry | null {
  if (!isPlainObject(raw)) return null;

  const subjectId = typeof raw.subjectId === 'string' ? raw.subjectId : null;
  const start = isTimeHHMM(raw.start) ? raw.start : null;
  const end = isTimeHHMM(raw.end) ? raw.end : null;
  const category = asCategory(raw.category ?? raw.type);

  if (!subjectId || !start || !end || !category) return null;
  if (start >= end) return null; // zero-length or inverted

  return {
    id: typeof raw.id === 'string' ? raw.id : makeId('cls'),
    subjectId,
    subjectName:
      typeof raw.subjectName === 'string' && raw.subjectName
        ? raw.subjectName
        : subjectName(subjectId),
    category,
    start,
    end,
    weight: asPositiveWeight(raw.weight),
    isAfterHours: raw.isAfterHours === true,
    createdAt:
      typeof raw.createdAt === 'number' && raw.createdAt > 0
        ? raw.createdAt
        : Date.now(),
  };
}

/**
 * ★ v4 — every extra read from storage is guaranteed to carry
 * countsTowardDenominator. A v3 record that predates the field defaults to
 * TRUE, matching the old global default of 'add'. The proper conversion runs
 * in migrateV3toV4; this is the belt to that braces.
 */
function sanitiseExtra(raw: unknown): ExtraClass | null {
  if (!isPlainObject(raw)) return null;

  const subjectId = typeof raw.subjectId === 'string' ? raw.subjectId : null;
  const startDate = typeof raw.startDate === 'string' ? raw.startDate : null;
  if (!subjectId || !startDate) return null;

  const repeat =
    raw.repeat === 'daily' || raw.repeat === 'weekly' || raw.repeat === 'once'
      ? raw.repeat
      : 'once';

  return {
    id: typeof raw.id === 'string' ? raw.id : makeId('extra'),
    subjectId,
    subjectName:
      typeof raw.subjectName === 'string' && raw.subjectName
        ? raw.subjectName
        : subjectName(subjectId),
    countsToward: asCountsToward(raw.countsToward),
    countsTowardDenominator: raw.countsTowardDenominator !== false,
    startDate,
    endDate: typeof raw.endDate === 'string' ? raw.endDate : startDate,
    repeat,
    weekdays: Array.isArray(raw.weekdays)
      ? raw.weekdays.map(asDayIndex).filter((d): d is DayIndex => d !== null)
      : [],
    start: isTimeHHMM(raw.start) ? raw.start : '09:00',
    end: isTimeHHMM(raw.end) ? raw.end : '10:00',
    weight: asPositiveWeight(raw.weight),
    createdAt:
      typeof raw.createdAt === 'number' && raw.createdAt > 0
        ? raw.createdAt
        : Date.now(),
  };
}


// -----------------------------------------------------------------------------
// SECTION 5 — Settings
//
// ★ v4 — targetPercent and extraClassPolicy are GONE. Do not reintroduce them.
//   Thresholds: SECTION 13. Extra-class denominator policy: per entry.
// -----------------------------------------------------------------------------

export const DEFAULT_SETTINGS: AttendanceSettings = {
  college: { ...DEFAULT_COLLEGE_CONFIG },
  term: {
    startDate: todayISO(),
    endDate: todayISO(),
  },
  extraClassesEnabled: false,
  examSubjectsByYear: {},
  currentYear: '3rd MBBS Part 2',
};

export function getSettings(): AttendanceSettings {
  const raw = readJSON<Record<string, unknown>>(STORAGE_KEYS.settings, {});

  const rawCollege = isPlainObject(raw.college) ? raw.college : {};
  const college = { ...DEFAULT_COLLEGE_CONFIG, ...rawCollege };

  // Working days must be a clean DayIndex array or the picker misbehaves.
  const wd = Array.isArray(college.workingDays)
    ? college.workingDays.map(asDayIndex).filter((d): d is DayIndex => d !== null)
    : [];
  college.workingDays = wd.length > 0 ? wd : [...DEFAULT_COLLEGE_CONFIG.workingDays];

  if (!isTimeHHMM(college.dayStart)) college.dayStart = DEFAULT_COLLEGE_CONFIG.dayStart;
  if (!isTimeHHMM(college.dayEnd)) college.dayEnd = DEFAULT_COLLEGE_CONFIG.dayEnd;
  if (![15, 30, 60].includes(college.slotMinutes)) college.slotMinutes = 30;
  college.allowAfterHours = rawCollege.allowAfterHours === true;
  college.hoursManuallySet = rawCollege.hoursManuallySet === true;

  const rawTerm = isPlainObject(raw.term) ? raw.term : {};
  const term = {
    startDate:
      typeof rawTerm.startDate === 'string' ? rawTerm.startDate : todayISO(),
    endDate: typeof rawTerm.endDate === 'string' ? rawTerm.endDate : todayISO(),
  };

  return {
    college,
    term,
    extraClassesEnabled: raw.extraClassesEnabled === true,
    examSubjectsByYear: isPlainObject(raw.examSubjectsByYear)
      ? (raw.examSubjectsByYear as AttendanceSettings['examSubjectsByYear'])
      : {},
    currentYear: isAcademicYear(raw.currentYear)
      ? raw.currentYear
      : DEFAULT_SETTINGS.currentYear,
  };
}

export function saveSettings(next: AttendanceSettings): void {
  writeJSON(STORAGE_KEYS.settings, next);
  notify();
}

export function updateSettings(patch: Partial<AttendanceSettings>): AttendanceSettings {
  const merged = { ...getSettings(), ...patch };
  saveSettings(merged);
  return merged;
}


// -----------------------------------------------------------------------------
// SECTION 6 — Timetable
// -----------------------------------------------------------------------------

export function getTimetableStore(): TimetableStore {
  const raw = readJSON<unknown>(STORAGE_KEYS.timetable, {});
  if (!isPlainObject(raw)) return {};

  const out: TimetableStore = {};

  for (const [year, byDay] of Object.entries(raw)) {
    if (!isAcademicYear(year) || !isPlainObject(byDay)) continue;

    const cleanDays: TimetableByDay = {};
    for (const [dayKey, entries] of Object.entries(byDay)) {
      const day = asDayIndex(Number(dayKey));
      if (day === null || !Array.isArray(entries)) continue;

      const clean = entries
        .map(sanitiseEntry)
        .filter((e): e is TimetableEntry => e !== null)
        .sort((a, b) => a.start.localeCompare(b.start));

      if (clean.length > 0) cleanDays[`${day}`] = clean;
    }
    out[year] = cleanDays;
  }
  return out;
}

export function saveTimetableStore(store: TimetableStore): void {
  writeJSON(STORAGE_KEYS.timetable, store);
  notify();
}

export function getDayEntries(year: AcademicYear, day: DayIndex): TimetableEntry[] {
  return getTimetableStore()[year]?.[`${day}`] ?? [];
}

export function getYearEntries(
  year: AcademicYear,
): Array<TimetableEntry & { day: DayIndex }> {
  const byDay = getTimetableStore()[year] ?? {};
  const out: Array<TimetableEntry & { day: DayIndex }> = [];

  for (const [dayKey, entries] of Object.entries(byDay)) {
    const day = asDayIndex(Number(dayKey));
    if (day === null || !entries) continue;
    entries.forEach((e) => out.push({ ...e, day }));
  }
  return out.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
}

export function addTimetableEntry(
  year: AcademicYear,
  day: DayIndex,
  entry: Omit<TimetableEntry, 'id' | 'createdAt'>,
): TimetableEntry {
  const store = getTimetableStore();
  const byDay = store[year] ?? {};
  const existing = byDay[`${day}`] ?? [];

  const created: TimetableEntry = {
    ...entry,
    id: makeId('cls'),
    createdAt: Date.now(),
  };

  byDay[`${day}`] = [...existing, created].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  store[year] = byDay;
  saveTimetableStore(store);
  return created;
}

export function updateTimetableEntry(
  year: AcademicYear,
  entryId: Id,
  patch: Partial<Omit<TimetableEntry, 'id' | 'createdAt'>>,
  newDay?: DayIndex,
): boolean {
  const store = getTimetableStore();
  const byDay = store[year];
  if (!byDay) return false;

  let found: TimetableEntry | null = null;
  let oldDay: DayIndex | null = null;

  for (const [dayKey, entries] of Object.entries(byDay)) {
    const d = asDayIndex(Number(dayKey));
    if (d === null || !entries) continue;
    const hit = entries.find((e) => e.id === entryId);
    if (hit) {
      found = hit;
      oldDay = d;
      break;
    }
  }
  if (!found || oldDay === null) return false;

  const updated: TimetableEntry = { ...found, ...patch };
  const targetDay = newDay ?? oldDay;

  byDay[`${oldDay}`] = (byDay[`${oldDay}`] ?? []).filter((e) => e.id !== entryId);
  if (byDay[`${oldDay}`]!.length === 0) delete byDay[`${oldDay}`];

  const dest = byDay[`${targetDay}`] ?? [];
  byDay[`${targetDay}`] = [...dest, updated].sort((a, b) =>
    a.start.localeCompare(b.start),
  );

  store[year] = byDay;
  saveTimetableStore(store);
  return true;
}

export function deleteTimetableEntry(year: AcademicYear, entryId: Id): boolean {
  const store = getTimetableStore();
  const byDay = store[year];
  if (!byDay) return false;

  let removed = false;
  for (const [dayKey, entries] of Object.entries(byDay)) {
    if (!entries) continue;
    const next = entries.filter((e) => e.id !== entryId);
    if (next.length !== entries.length) {
      removed = true;
      if (next.length === 0) delete byDay[dayKey as `${DayIndex}`];
      else byDay[dayKey as `${DayIndex}`] = next;
    }
  }
  if (!removed) return false;

  store[year] = byDay;
  saveTimetableStore(store);
  return true;
}

export function clearYearTimetable(year: AcademicYear): void {
  const store = getTimetableStore();
  delete store[year];
  saveTimetableStore(store);
}


// -----------------------------------------------------------------------------
// SECTION 7 — Postings
// -----------------------------------------------------------------------------

export function getPostingStore(): PostingStore {
  const store = readJSON<PostingStore>(STORAGE_KEYS.postings, {});
  return isPlainObject(store) ? store : {};
}

export function getPostings(year: AcademicYear): Posting[] {
  const list = getPostingStore()[year];
  return Array.isArray(list) ? list : [];
}

export function savePostings(year: AcademicYear, list: Posting[]): void {
  const store = getPostingStore();
  store[year] = list;
  writeJSON(STORAGE_KEYS.postings, store);
  notify();
}

export function addPosting(
  year: AcademicYear,
  posting: Omit<Posting, 'id' | 'createdAt' | 'exceptions'>,
): Posting {
  const created: Posting = {
    ...posting,
    id: makeId('post'),
    exceptions: [],
    createdAt: Date.now(),
  };
  savePostings(year, [...getPostings(year), created]);
  return created;
}

export function updatePosting(
  year: AcademicYear,
  postingId: Id,
  patch: Partial<Omit<Posting, 'id' | 'createdAt'>>,
): boolean {
  const list = getPostings(year);
  const i = list.findIndex((p) => p.id === postingId);
  if (i === -1) return false;

  list[i] = { ...list[i], ...patch };
  savePostings(year, list);
  return true;
}

export function deletePosting(year: AcademicYear, postingId: Id): boolean {
  const list = getPostings(year);
  const next = list.filter((p) => p.id !== postingId);
  if (next.length === list.length) return false;
  savePostings(year, next);
  return true;
}


// -----------------------------------------------------------------------------
// SECTION 8 — Extra classes
//
// ★ v4 — countsTowardDenominator lives ON THE ENTRY.
//
//   The old global settings.extraClassPolicy meant flipping one switch swept
//   through regular classes too. Now regular and posting sessions HAVE NO SUCH
//   FIELD, so recalculating extras is structurally incapable of reaching them.
//   The type system enforces the separation; nobody has to remember it.
// -----------------------------------------------------------------------------

export function getExtraClasses(year: AcademicYear): ExtraClass[] {
  const store = readJSON<unknown>(STORAGE_KEYS.extraClasses, {});
  if (!isPlainObject(store)) return [];
  const list = store[year];
  if (!Array.isArray(list)) return [];
  return list.map(sanitiseExtra).filter((x): x is ExtraClass => x !== null);
}

export function saveExtraClasses(year: AcademicYear, list: ExtraClass[]): void {
  const store = readJSON<ExtraClassStore>(STORAGE_KEYS.extraClasses, {});
  store[year] = list;
  writeJSON(STORAGE_KEYS.extraClasses, store);
  notify();
}

export function addExtraClass(
  year: AcademicYear,
  extra: Omit<ExtraClass, 'id' | 'createdAt'>,
): ExtraClass {
  const created: ExtraClass = { ...extra, id: makeId('extra'), createdAt: Date.now() };
  saveExtraClasses(year, [...getExtraClasses(year), created]);
  return created;
}

/**
 * ⚠ TRAP 3 — editing `countsToward` here is the retroactive move the spec
 *   demands. Sessions are GENERATED from this record, so changing
 *   theory → practical relocates every past mark to the other denominator the
 *   instant this returns. No backfill, no stale rows.
 *
 * ★ The same is true of countsTowardDenominator. Flipping it recalculates
 *   every extra session for this entry and CANNOT touch a regular class.
 */
export function updateExtraClass(
  year: AcademicYear,
  extraId: Id,
  patch: Partial<Omit<ExtraClass, 'id' | 'createdAt'>>,
): boolean {
  const list = getExtraClasses(year);
  const i = list.findIndex((x) => x.id === extraId);
  if (i === -1) return false;

  list[i] = { ...list[i], ...patch };
  saveExtraClasses(year, list);
  return true;
}

export function deleteExtraClass(year: AcademicYear, extraId: Id): boolean {
  const list = getExtraClasses(year);
  const next = list.filter((x) => x.id !== extraId);
  if (next.length === list.length) return false;
  saveExtraClasses(year, next);
  return true;
}


// -----------------------------------------------------------------------------
// SECTION 9 — Blockouts
// -----------------------------------------------------------------------------

export function getBlockouts(year: AcademicYear): Blockout[] {
  const store = readJSON<BlockoutStore>(STORAGE_KEYS.blockouts, {});
  const list = store[year];
  return Array.isArray(list) ? list : [];
}

export function saveBlockouts(year: AcademicYear, list: Blockout[]): void {
  const store = readJSON<BlockoutStore>(STORAGE_KEYS.blockouts, {});
  store[year] = list;
  writeJSON(STORAGE_KEYS.blockouts, store);
  notify();
}

export function addBlockout(
  year: AcademicYear,
  blockout: Omit<Blockout, 'id' | 'createdAt'>,
): Blockout {
  const created: Blockout = { ...blockout, id: makeId('block'), createdAt: Date.now() };
  saveBlockouts(year, [...getBlockouts(year), created]);
  return created;
}

export function updateBlockout(
  year: AcademicYear,
  blockoutId: Id,
  patch: Partial<Omit<Blockout, 'id' | 'createdAt'>>,
): boolean {
  const list = getBlockouts(year);
  const i = list.findIndex((b) => b.id === blockoutId);
  if (i === -1) return false;

  list[i] = { ...list[i], ...patch };
  saveBlockouts(year, list);
  return true;
}

export function deleteBlockout(year: AcademicYear, blockoutId: Id): boolean {
  const list = getBlockouts(year);
  const next = list.filter((b) => b.id !== blockoutId);
  if (next.length === list.length) return false;
  saveBlockouts(year, next);
  return true;
}


// -----------------------------------------------------------------------------
// SECTION 10 — Marks
//
// Kept SEPARATE from generated sessions, keyed by session id.
//
// This separation is the quiet hero of the design. Sessions are derived from
// the timetable, so they are thrown away and rebuilt on every change. If marks
// lived inside them, editing a class time would erase months of attendance.
// Here a mark is just an id → status pair that survives.
// -----------------------------------------------------------------------------

export function getMarks(): SessionMarks {
  const raw = readJSON<unknown>(STORAGE_KEYS.marks, {});
  if (!isPlainObject(raw)) return {};

  const out: SessionMarks = {};
  for (const [id, status] of Object.entries(raw)) {
    const s = asStatus(status);
    if (s) out[id] = s;
  }
  return out;
}

export function getMark(sessionId: Id): SessionStatus {
  return getMarks()[sessionId] ?? 'unmarked';
}

export function setMark(sessionId: Id, status: SessionStatus): void {
  const marks = getMarks();
  // 'unmarked' is the ABSENCE of a mark, so store nothing rather than a row.
  if (status === 'unmarked') delete marks[sessionId];
  else marks[sessionId] = status;

  writeJSON(STORAGE_KEYS.marks, marks);
  notify();
}

/** Bulk write. One storage hit and one notify for the whole batch. */
export function setMarks(updates: Record<Id, SessionStatus>): void {
  const marks = getMarks();
  for (const [id, status] of Object.entries(updates)) {
    if (status === 'unmarked') delete marks[id];
    else marks[id] = status;
  }
  writeJSON(STORAGE_KEYS.marks, marks);
  notify();
}

export function clearMarks(): void {
  writeJSON(STORAGE_KEYS.marks, {});
  notify();
}


// -----------------------------------------------------------------------------
// SECTION 11 — Opening balance
//
// "I started using this app in March; before today I'd attended 40 of 50."
//
// ⚠ TRAP 10 — a write REPLACES the figures for that exact
//   year + subject + category. It never adds. Importing the same file twice
//   must leave the same numbers, not double them.
//
// ★ v4 — setOpeningBalance now accepts EITHER positional numbers or a single
//   object. DataPanel already passes an object; rather than rewrite three call
//   sites to match the store, the store meets the caller where it is.
// -----------------------------------------------------------------------------

export interface OpeningBalanceInput {
  conducted: number;
  attended: number;
  isEstimate?: boolean;
}

export function getOpeningBalanceStore(): OpeningBalanceStore {
  const raw = readJSON<OpeningBalanceStore>(STORAGE_KEYS.openingBalance, {});
  return isPlainObject(raw) ? raw : {};
}

export function getOpeningBalance(
  year: AcademicYear,
  subjectId: SubjectId,
  category: ClassCategory,
): { conducted: number; attended: number } | null {
  const entry = getOpeningBalanceStore()[year]?.[subjectId]?.[category];
  if (!entry) return null;

  const conducted = Number.isFinite(entry.conducted) ? Math.max(0, entry.conducted) : 0;
  const attended = Number.isFinite(entry.attended) ? Math.max(0, entry.attended) : 0;
  // Attended can never exceed conducted, whatever was written.
  return { conducted, attended: Math.min(attended, conducted) };
}

export function setOpeningBalance(
  year: AcademicYear,
  subjectId: SubjectId,
  category: ClassCategory,
  input: OpeningBalanceInput,
): void;
export function setOpeningBalance(
  year: AcademicYear,
  subjectId: SubjectId,
  category: ClassCategory,
  conducted: number,
  attended: number,
  isEstimate?: boolean,
): void;
export function setOpeningBalance(
  year: AcademicYear,
  subjectId: SubjectId,
  category: ClassCategory,
  a: number | OpeningBalanceInput,
  b?: number,
  c = false,
): void {
  const conducted = typeof a === 'number' ? a : a.conducted;
  const attended = typeof a === 'number' ? (b ?? 0) : a.attended;
  const isEstimate = typeof a === 'number' ? c : a.isEstimate === true;

  const store = getOpeningBalanceStore();
  const forYear = store[year] ?? {};
  const forSubject = forYear[subjectId] ?? {};

  const safeConducted = Math.max(0, Math.round(conducted));
  const safeAttended = Math.min(Math.max(0, Math.round(attended)), safeConducted);

  forSubject[category] = {
    conducted: safeConducted,
    attended: safeAttended,
    isEstimate,
    updatedAt: Date.now(),
  };

  forYear[subjectId] = forSubject;
  store[year] = forYear;
  writeJSON(STORAGE_KEYS.openingBalance, store);
  notify();
}

/**
 * For the "I'm 68% through 50 classes" path. Attended is derived and rounded;
 * the flag records that the figure is an estimate, not a register reading.
 */
export function setOpeningBalanceFromPercent(
  year: AcademicYear,
  subjectId: SubjectId,
  category: ClassCategory,
  conducted: number,
  percent: number,
): void {
  const safeConducted = Math.max(0, Math.round(conducted));
  const clampedPct = Math.min(100, Math.max(0, percent));
  const attended = Math.round((clampedPct / 100) * safeConducted);
  setOpeningBalance(year, subjectId, category, safeConducted, attended, true);
}

export function deleteOpeningBalance(
  year: AcademicYear,
  subjectId: SubjectId,
  category: ClassCategory,
): void {
  const store = getOpeningBalanceStore();
  const forSubject = store[year]?.[subjectId];
  if (!forSubject) return;

  delete forSubject[category];
  writeJSON(STORAGE_KEYS.openingBalance, store);
  notify();
}


// -----------------------------------------------------------------------------
// SECTION 12 — Exclusions
//
// "Don't count this — but keep the data."
//
// ★ v4 — the TRAP 8 LOCK IS GONE. An exam subject can now be excluded
//   directly. The lock guarded against a deletion, but exclusion deletes
//   nothing and reverses instantly:
//
//     2nd year Gen Med logged → told only final year counts → toggle OFF →
//     professor changes their mind → toggle ON → data still there, untouched.
//
// ⚠ TRAP 2 — an excluded subject's OPENING BALANCE is excluded too.
// -----------------------------------------------------------------------------

export function getExclusionStore(): ExclusionStore {
  const raw = readJSON<ExclusionStore>(STORAGE_KEYS.exclusions, {});
  return isPlainObject(raw) ? raw : {};
}

export function getExclusion(
  year: AcademicYear,
  subjectId: SubjectId,
): SubjectExclusion {
  return getExclusionStore()[year]?.[subjectId] ?? {};
}

/**
 * The single question every calculation asks.
 * `whole: true` wins over the individual flags — that is what makes
 * "exclude entire subject" a genuine master toggle.
 */
export function isExcluded(
  year: AcademicYear,
  subjectId: SubjectId,
  category: ClassCategory,
): boolean {
  const ex = getExclusion(year, subjectId);
  if (ex.whole === true) return true;
  return ex[category] === true;
}

export function setExclusion(
  year: AcademicYear,
  subjectId: SubjectId,
  patch: SubjectExclusion,
): void {
  const store = getExclusionStore();
  const forYear = store[year] ?? {};
  forYear[subjectId] = { ...(forYear[subjectId] ?? {}), ...patch };
  store[year] = forYear;
  writeJSON(STORAGE_KEYS.exclusions, store);
  notify();
}

export function clearExclusion(year: AcademicYear, subjectId: SubjectId): void {
  const store = getExclusionStore();
  const forYear = store[year];
  if (!forYear) return;

  delete forYear[subjectId];
  writeJSON(STORAGE_KEYS.exclusions, store);
  notify();
}


// -----------------------------------------------------------------------------
// SECTION 13 — Thresholds   ★ NEW IN v4
//
// Replaces the single settings.term.targetPercent, which could not express
// "75% theory, 80% practical".
//
// RESOLUTION ORDER, most specific wins:
//   1. thresholds[year][subjectId][category]
//   2. DEFAULT_THRESHOLDS[category]      (theory 75, practical 80, clinical 80)
//
// THE STORE IS SPARSE ON PURPOSE. A missing key means "use the default" — it
// does NOT mean zero. Never write a value that merely equals the default: an
// ABSENT key is what makes "reset to default" work, and what lets us change a
// default later without silently overriding students who never edited it.
//
// Editable in SETTINGS ONLY, never in setup. Always show the default beside
// the field so an edited value is visibly an edit.
// -----------------------------------------------------------------------------

export function getThresholdStore(): ThresholdStore {
  const raw = readJSON<ThresholdStore>(STORAGE_KEYS.thresholds, {});
  return isPlainObject(raw) ? raw : {};
}

/** The threshold actually applied. Never returns null — always a usable number. */
export function getThreshold(
  year: AcademicYear,
  subjectId: SubjectId,
  category: ClassCategory,
): ThresholdPercent {
  const stored = getThresholdStore()[year]?.[subjectId]?.[category];
  return asThresholdPercent(stored) ?? DEFAULT_THRESHOLDS[category];
}

/** True when the student has overridden the default for this exact key. */
export function hasCustomThreshold(
  year: AcademicYear,
  subjectId: SubjectId,
  category: ClassCategory,
): boolean {
  return asThresholdPercent(getThresholdStore()[year]?.[subjectId]?.[category]) !== null;
}

/**
 * Writing a value EQUAL to the default clears the override instead of storing
 * it. Keeps the store sparse and makes "reset" and "typed the default back in"
 * behave identically — which is what a student expects.
 */
export function setThreshold(
  year: AcademicYear,
  subjectId: SubjectId,
  category: ClassCategory,
  percent: number,
): boolean {
  const safe = asThresholdPercent(percent);
  if (safe === null) return false;

  if (safe === DEFAULT_THRESHOLDS[category]) {
    resetThreshold(year, subjectId, category);
    return true;
  }

  const store = getThresholdStore();
  const forYear = store[year] ?? {};
  const forSubject = forYear[subjectId] ?? {};

  forSubject[category] = safe;
  forYear[subjectId] = forSubject;
  store[year] = forYear;

  writeJSON(STORAGE_KEYS.thresholds, store);
  notify();
  return true;
}

/** Removes the override so the default applies again. Prunes empty branches. */
export function resetThreshold(
  year: AcademicYear,
  subjectId: SubjectId,
  category: ClassCategory,
): void {
  const store = getThresholdStore();
  const forSubject = store[year]?.[subjectId];
  if (!forSubject) return;

  delete forSubject[category];

  if (Object.keys(forSubject).length === 0) delete store[year]![subjectId];
  if (Object.keys(store[year] ?? {}).length === 0) delete store[year];

  writeJSON(STORAGE_KEYS.thresholds, store);
  notify();
}

/** Clears every override for a subject — the "reset to default" button. */
export function resetSubjectThresholds(
  year: AcademicYear,
  subjectId: SubjectId,
): void {
  const store = getThresholdStore();
  if (!store[year]?.[subjectId]) return;

  delete store[year]![subjectId];
  if (Object.keys(store[year] ?? {}).length === 0) delete store[year];

  writeJSON(STORAGE_KEYS.thresholds, store);
  notify();
}


// -----------------------------------------------------------------------------
// SECTION 14 — v2 → v3 MIGRATION   ⚠ WHERE THE TUESDAY BUG DIES
//
// Runs at most once. Non-destructive: v2 keys are read and left in place.
//
// v2 stored a FLAT ARRAY with day: 2 meaning TUESDAY under a Monday=1 scheme.
// v3 is day-grouped with Monday=0, so 2 would mean Wednesday.
// legacyDayToDayIndex maps 2 → 1 and Tuesday lands on Tuesday.
//
// ★ v4 note: targetPercent is no longer a setting, so a legacy term target is
//   handed to migrateV3toV4 through the transfer key below rather than written
//   into settings.
// -----------------------------------------------------------------------------

const MIGRATION_FLAG = 'medprep.attendance.migrated.v3';
const MIGRATION_FLAG_V4 = 'medprep.attendance.migrated.v4';
/** Short-lived carrier for a legacy targetPercent between the two migrations. */
const LEGACY_TARGET_TRANSFER = 'medprep.attendance.legacyTarget.tmp';

const LEGACY_KEYS = Object.freeze({
  timetable: 'medprep.attendance.timetable.v2',
  postings: 'medprep.attendance.postings.v2',
  term: 'medprep.attendance.term.v2',
});

export interface MigrationReport {
  ran: boolean;
  entriesMigrated: number;
  entriesSkipped: number;
  postingsMigrated: number;
  targetYear: AcademicYear | null;
  notes: string[];
}

export function hasMigrated(): boolean {
  if (!isBrowser()) return true; // never migrate during SSR
  try {
    return window.localStorage.getItem(MIGRATION_FLAG) === 'done';
  } catch {
    return true;
  }
}

export function migrateV2toV3(force = false): MigrationReport {
  const report: MigrationReport = {
    ran: false,
    entriesMigrated: 0,
    entriesSkipped: 0,
    postingsMigrated: 0,
    targetYear: null,
    notes: [],
  };

  if (!isBrowser()) return report;
  if (hasMigrated() && !force) return report;

  const legacyTerm = readJSON<Record<string, unknown>>(LEGACY_KEYS.term, {});
  const settings = getSettings();
  const targetYear: AcademicYear = settings.currentYear;
  report.targetYear = targetYear;

  if (legacyTerm.startDate || legacyTerm.endDate) {
    const start = typeof legacyTerm.startDate === 'string' ? legacyTerm.startDate : null;
    const end = typeof legacyTerm.endDate === 'string' ? legacyTerm.endDate : null;

    if (start && end) {
      updateSettings({ term: { startDate: start, endDate: end } });
      report.notes.push(`Term dates carried over: ${start} → ${end}.`);
    }

    // ★ v4 — park any custom target so migrateV3toV4 can turn it into a
    //   proper theory threshold. Nobody silently loses a custom figure.
    const legacyTarget = asThresholdPercent(legacyTerm.targetPercent);
    if (legacyTarget !== null && legacyTarget !== DEFAULT_THRESHOLDS.theory) {
      writeJSON(LEGACY_TARGET_TRANSFER, legacyTarget);
    }
  }

  // ---- Timetable: flat array → day-grouped, day index corrected ----
  const legacyEntries = readJSON<unknown[]>(LEGACY_KEYS.timetable, []);

  if (Array.isArray(legacyEntries) && legacyEntries.length > 0) {
    const store = getTimetableStore();
    const byDay: TimetableByDay = store[targetYear] ?? {};

    for (const raw of legacyEntries) {
      if (!isPlainObject(raw)) {
        report.entriesSkipped += 1;
        continue;
      }

      const legacyDay = typeof raw.day === 'number' ? raw.day : null;
      if (legacyDay === null) {
        report.entriesSkipped += 1;
        continue;
      }

      // ⚠ THE FIX. v2 day 2 (Tuesday) → v3 day 1 (Tuesday).
      const day = legacyDayToDayIndex(legacyDay);

      const entry = sanitiseEntry({
        ...raw,
        category: raw.category ?? raw.type,
        isAfterHours: false,
      });

      if (!entry) {
        report.entriesSkipped += 1;
        continue;
      }

      const existing = byDay[`${day}`] ?? [];
      // Guard against a double run creating twins.
      const duplicate = existing.some(
        (e) =>
          e.subjectId === entry.subjectId &&
          e.start === entry.start &&
          e.end === entry.end &&
          e.category === entry.category,
      );
      if (duplicate) {
        report.entriesSkipped += 1;
        continue;
      }

      byDay[`${day}`] = [...existing, entry].sort((a, b) =>
        a.start.localeCompare(b.start),
      );
      report.entriesMigrated += 1;
    }

    store[targetYear] = byDay;
    writeJSON(STORAGE_KEYS.timetable, store);
  }
    // ---- Postings: v2 → v3, same day-index correction ----
  const legacyPostings = readJSON<unknown[]>(LEGACY_KEYS.postings, []);

  if (Array.isArray(legacyPostings) && legacyPostings.length > 0) {
    const existing = getPostings(targetYear);
    const added: Posting[] = [];

    for (const raw of legacyPostings) {
      if (!isPlainObject(raw)) continue;

      const subjectId = typeof raw.subjectId === 'string' ? raw.subjectId : null;
      const startDate = typeof raw.startDate === 'string' ? raw.startDate : null;
      const endDate = typeof raw.endDate === 'string' ? raw.endDate : null;
      if (!subjectId || !startDate || !endDate) continue;

      // ⚠ Same Tuesday bug, different store. v2 weekdays used Monday=1.
      const legacyDays = Array.isArray(raw.workingDays) ? raw.workingDays : [];
      const workingDays = legacyDays
        .filter((d): d is number => typeof d === 'number')
        .map(legacyDayToDayIndex);

      const duplicate = existing.some(
        (p) =>
          p.subjectId === subjectId &&
          p.startDate === startDate &&
          p.endDate === endDate,
      );
      if (duplicate) continue;

      added.push({
        id: makeId('post'),
        subjectId,
        subjectName:
          typeof raw.subjectName === 'string' && raw.subjectName
            ? raw.subjectName
            : subjectName(subjectId),
        startDate,
        endDate,
        start: isTimeHHMM(raw.start) ? raw.start : '09:00',
        end: isTimeHHMM(raw.end) ? raw.end : '13:00',
        workingDays:
          workingDays.length > 0
            ? workingDays
            : [...DEFAULT_COLLEGE_CONFIG.workingDays],
        weight: asPositiveWeight(raw.weight),
        exceptions: [],
        createdAt: Date.now(),
      });
    }

    if (added.length > 0) {
      savePostings(targetYear, [...existing, ...added]);
      report.postingsMigrated = added.length;
    }
  }

  if (report.entriesSkipped > 0) {
    report.notes.push(
      `${report.entriesSkipped} entr${report.entriesSkipped === 1 ? 'y was' : 'ies were'} skipped as unreadable or duplicate. The v2 data is still in storage.`,
    );
  }

  try {
    window.localStorage.setItem(MIGRATION_FLAG, 'done');
  } catch {
    /* flag failed to save; worst case the migration reruns and dedupes */
  }

  report.ran = true;
  notify();
  return report;
}


// -----------------------------------------------------------------------------
// SECTION 15 — v3 → v4 MIGRATION   ★ NEW
//
// Three shape changes, none of which may lose a student's data:
//
//   1. ExtraClass gains countsTowardDenominator.
//      Seeded from the OLD GLOBAL settings.extraClassPolicy:
//          'add'    → true   (extra classes raised the total)
//          'ignore' → false  (they did not)
//      Every existing extra therefore keeps behaving exactly as it did
//      yesterday — and from now on each can be changed independently.
//
//   2. settings loses targetPercent and extraClassPolicy.
//      A targetPercent that was ANYTHING other than 75 becomes a THEORY
//      threshold override for every subject in the current year. A student who
//      set 80% because their college demands it does not silently drop to 75.
//      Practical/clinical are left at the new 80% default, since the old single
//      number never meant practical in the first place.
//
//   3. thresholds store is created (possibly empty — empty is correct).
//
// Non-destructive: v3 keys are READ, then removed only after the v4 keys have
// been written successfully.
// -----------------------------------------------------------------------------

export interface MigrationV4Report {
  ran: boolean;
  extrasConverted: number;
  legacyPolicy: 'add' | 'ignore' | null;
  thresholdsSeeded: number;
  seededFromTarget: number | null;
  notes: string[];
}

export function hasMigratedV4(): boolean {
  if (!isBrowser()) return true;
  try {
    return window.localStorage.getItem(MIGRATION_FLAG_V4) === 'done';
  } catch {
    return true;
  }
}

export function migrateV3toV4(force = false): MigrationV4Report {
  const report: MigrationV4Report = {
    ran: false,
    extrasConverted: 0,
    legacyPolicy: null,
    thresholdsSeeded: 0,
    seededFromTarget: null,
    notes: [],
  };

  if (!isBrowser()) return report;
  if (hasMigratedV4() && !force) return report;

  // ---- 1. Read the old settings blob directly. getSettings() is v4-shaped
  //         and would have already dropped the two fields we need. ----
  const oldSettings = readJSON<Record<string, unknown>>(
    LEGACY_STORAGE_KEYS.settingsV3,
    {},
  );

  const legacyPolicy =
    oldSettings.extraClassPolicy === 'ignore'
      ? 'ignore'
      : oldSettings.extraClassPolicy === 'add'
        ? 'add'
        : null;
  report.legacyPolicy = legacyPolicy;

  // Default TRUE — matches the old 'add' default when nothing was ever set.
  const seedFlag = legacyPolicy !== 'ignore';

  // ---- 2. Convert extras, year by year ----
  const oldExtras = readJSON<Record<string, unknown>>(
    LEGACY_STORAGE_KEYS.extraClassesV3,
    {},
  );

  if (isPlainObject(oldExtras) && Object.keys(oldExtras).length > 0) {
    const nextStore: ExtraClassStore = readJSON<ExtraClassStore>(
      STORAGE_KEYS.extraClasses,
      {},
    );

    for (const [year, list] of Object.entries(oldExtras)) {
      if (!isAcademicYear(year) || !Array.isArray(list)) continue;

      const converted = list
        .map((raw) => {
          if (!isPlainObject(raw)) return null;
          // Honour an already-present flag; otherwise seed from the old policy.
          const flag =
            typeof raw.countsTowardDenominator === 'boolean'
              ? raw.countsTowardDenominator
              : seedFlag;
          return sanitiseExtra({ ...raw, countsTowardDenominator: flag });
        })
        .filter((x): x is ExtraClass => x !== null);

      if (converted.length > 0) {
        const already = nextStore[year] ?? [];
        const existingIds = new Set(already.map((x) => x.id));
        const fresh = converted.filter((x) => !existingIds.has(x.id));
        nextStore[year] = [...already, ...fresh];
        report.extrasConverted += fresh.length;
      }
    }

    if (report.extrasConverted > 0) {
      writeJSON(STORAGE_KEYS.extraClasses, nextStore);
      report.notes.push(
        `${report.extrasConverted} extra class${report.extrasConverted === 1 ? '' : 'es'} converted. Denominator setting seeded from your old "${legacyPolicy ?? 'add'}" policy and is now editable per class.`,
      );
    }
  }

  // ---- 3. Rescue a custom targetPercent into theory thresholds ----
  const parkedTarget = readJSON<number | null>(LEGACY_TARGET_TRANSFER, null);
  const oldTerm = isPlainObject(oldSettings.term) ? oldSettings.term : {};
  const legacyTarget =
    asThresholdPercent(oldTerm.targetPercent) ??
    asThresholdPercent(oldSettings.targetPercent) ??
    asThresholdPercent(parkedTarget);

  if (legacyTarget !== null && legacyTarget !== DEFAULT_THRESHOLDS.theory) {
    report.seededFromTarget = legacyTarget;

    const settings = getSettings();
    const year = settings.currentYear;
    const subjectIds = new Set<string>();

    // Every subject the student actually has classes for this year.
    getYearEntries(year).forEach((e) => subjectIds.add(e.subjectId));
    getPostings(year).forEach((p) => subjectIds.add(p.subjectId));

    const store = getThresholdStore();
    const forYear = store[year] ?? {};

    subjectIds.forEach((sid) => {
      const forSubject = forYear[sid] ?? {};
      if (forSubject.theory === undefined) {
        forSubject.theory = legacyTarget;
        report.thresholdsSeeded += 1;
      }
      forYear[sid] = forSubject;
    });

    if (report.thresholdsSeeded > 0) {
      store[year] = forYear;
      writeJSON(STORAGE_KEYS.thresholds, store);
      report.notes.push(
        `Your old ${legacyTarget}% target became a theory threshold on ${report.thresholdsSeeded} subject${report.thresholdsSeeded === 1 ? '' : 's'}. Practical and clinical now default to ${DEFAULT_THRESHOLDS.practical}%. Change either in Settings.`,
      );
    }
  }

  // ---- 4. Write v4 settings, minus the two dead fields ----
  if (Object.keys(oldSettings).length > 0) {
    const migrated = getSettings(); // already sanitised into v4 shape
    migrated.extraClassesEnabled = oldSettings.extraClassesEnabled === true;
    if (isAcademicYear(oldSettings.currentYear)) {
      migrated.currentYear = oldSettings.currentYear;
    }
    if (isPlainObject(oldSettings.examSubjectsByYear)) {
      migrated.examSubjectsByYear =
        oldSettings.examSubjectsByYear as AttendanceSettings['examSubjectsByYear'];
    }
    if (isPlainObject(oldSettings.college)) {
      migrated.college = { ...migrated.college, ...oldSettings.college };
      migrated.college.hoursManuallySet =
        (oldSettings.college as Record<string, unknown>).hoursManuallySet === true;
    }
    writeJSON(STORAGE_KEYS.settings, migrated);
  }

  // ---- 5. Only now retire the old keys ----
  removeKey(LEGACY_STORAGE_KEYS.settingsV3);
  removeKey(LEGACY_STORAGE_KEYS.extraClassesV3);
  removeKey(LEGACY_TARGET_TRANSFER);

  try {
    window.localStorage.setItem(MIGRATION_FLAG_V4, 'done');
  } catch {
    /* rerun is safe — every step above is idempotent */
  }

  report.ran = true;
  notify();
  return report;
}

/**
 * Run both migrations in order, once, at app start.
 * Call this from a top-level client effect — NOT from a page component that
 * can remount. v2→v3 must complete before v3→v4 reads the settings blob.
 */
export function runMigrations(): {
  v3: MigrationReport;
  v4: MigrationV4Report;
} {
  const v3 = migrateV2toV3();
  const v4 = migrateV3toV4();
  return { v3, v4 };
}


// -----------------------------------------------------------------------------
// SECTION 16 — Backup / restore
//
// Replaces the deleted lib/attendance/backup.ts, which imported a type
// (YearKey) that no longer exists.
//
// ⚠ Import PRESERVES ENTRY IDS. The old backup module minted fresh ones, which
//   orphaned every mark on restore — a student would import their timetable and
//   watch a year of attendance vanish. Ids are the join key. Keep them.
// -----------------------------------------------------------------------------

export interface AttendanceBackup {
  version: 3 | 4;
  exportedAt: string;
  timetable: TimetableStore;
  postings: PostingStore;
  extraClasses: ExtraClassStore;
  blockouts: BlockoutStore;
  marks: SessionMarks;
  openingBalance: OpeningBalanceStore;
  exclusions: ExclusionStore;
  thresholds: ThresholdStore;
  settings: AttendanceSettings;
}

export function exportBackup(): AttendanceBackup {
  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    timetable: getTimetableStore(),
    postings: getPostingStore(),
    extraClasses: readJSON<ExtraClassStore>(STORAGE_KEYS.extraClasses, {}),
    blockouts: readJSON<BlockoutStore>(STORAGE_KEYS.blockouts, {}),
    marks: getMarks(),
    openingBalance: getOpeningBalanceStore(),
    exclusions: getExclusionStore(),
    thresholds: getThresholdStore(),
    settings: getSettings(),
  };
}

export function exportBackupJSON(): string {
  return JSON.stringify(exportBackup(), null, 2);
}

export interface ImportResult {
  ok: boolean;
  error: string | null;
  notes: string[];
}

/**
 * REPLACES the current data wholesale. The caller must confirm with the student
 * first — this is not a merge, and there is no undo.
 */
export function importBackup(json: string): ImportResult {
  const notes: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.', notes };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'That file is not an attendance backup.', notes };
  }

  const version = parsed.version;
  if (version !== 3 && version !== 4) {
    return {
      ok: false,
      error: `Unsupported backup version: ${String(version)}. This app reads versions 3 and 4.`,
      notes,
    };
  }

  const b = parsed as Partial<AttendanceBackup>;

  if (b.timetable) writeJSON(STORAGE_KEYS.timetable, b.timetable);
  if (b.postings) writeJSON(STORAGE_KEYS.postings, b.postings);
  if (b.blockouts) writeJSON(STORAGE_KEYS.blockouts, b.blockouts);
  if (b.marks) writeJSON(STORAGE_KEYS.marks, b.marks);
  if (b.openingBalance) writeJSON(STORAGE_KEYS.openingBalance, b.openingBalance);
  if (b.exclusions) writeJSON(STORAGE_KEYS.exclusions, b.exclusions);
  if (b.settings) writeJSON(STORAGE_KEYS.settings, b.settings);

  // A v3 backup predates per-entry denominator policy. Seed it the same way
  // migrateV3toV4 does, so an old file behaves exactly as it used to.
  if (b.extraClasses) {
    if (version === 3) {
      const legacyPolicy = (b.settings as unknown as Record<string, unknown>)
        ?.extraClassPolicy;
      const seed = legacyPolicy !== 'ignore';
      const fixed: ExtraClassStore = {};

      for (const [year, list] of Object.entries(b.extraClasses)) {
        if (!isAcademicYear(year) || !Array.isArray(list)) continue;
        fixed[year] = list
          .map((raw) => sanitiseExtra({ ...(raw as object), countsTowardDenominator: seed }))
          .filter((x): x is ExtraClass => x !== null);
      }
      writeJSON(STORAGE_KEYS.extraClasses, fixed);
      notes.push(
        `Version 3 backup: extra classes seeded with your old "${seed ? 'add' : 'ignore'}" policy, now editable per class.`,
      );
    } else {
      writeJSON(STORAGE_KEYS.extraClasses, b.extraClasses);
    }
  }

  if (b.thresholds) writeJSON(STORAGE_KEYS.thresholds, b.thresholds);
  else if (version === 3) {
    notes.push('Version 3 backup had no thresholds. Defaults applied: 75% theory, 80% practical and clinical.');
  }

  // A restored file is already in its final shape; do not re-migrate it.
  try {
    window.localStorage.setItem(MIGRATION_FLAG, 'done');
    window.localStorage.setItem(MIGRATION_FLAG_V4, 'done');
  } catch {
    /* ignore */
  }

  notify();
  return { ok: true, error: null, notes };
}


// -----------------------------------------------------------------------------
// SECTION 17 — Wipe
//
// Used by "start over" in setup. Deliberately leaves LEGACY keys alone, so a
// student who wipes can still recover v2 data by forcing a migration.
// -----------------------------------------------------------------------------

export function clearAllAttendanceData(): void {
  Object.values(STORAGE_KEYS).forEach(removeKey);
  removeKey(MIGRATION_FLAG);
  removeKey(MIGRATION_FLAG_V4);
  notify();
}


// =============================================================================
// NEXT FILE — calculate.ts
//   • Pure. No storage reads. Sessions + resolved settings in, numbers out.
//   • ONE pass over the session list, bucketed by subject+category.
//   • Exact ratio for every decision; percentDisplay for eyeballs only.
//   • Memo keyed by getDataVersion(). Nothing derived is ever persisted.
//   • No OverallResult. No SubjectResult.percent. No YearResult.percent.
// =============================================================================
// -----------------------------------------------------------------------------
// SECTION 18 — ENT / Ophthalmology placement
//
// Some colleges examine these in 3rd MBBS Part 1, others in Part 2. Drives
// which subjects the setup pickers offer, so it must persist.
// -----------------------------------------------------------------------------

const ENT_OPHTHA_KEY = 'medprep.attendance.entOphthaFinal.v1';

export function getEntOphthaInFinalYear(): boolean {
  return readJSON<boolean>(ENT_OPHTHA_KEY, false);
}

export function setEntOphthaInFinalYear(value: boolean): void {
  writeJSON(ENT_OPHTHA_KEY, value);
  notify();
}
