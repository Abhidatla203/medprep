// =============================================================================
// app/attendance/store.ts
// -----------------------------------------------------------------------------
// The ONLY file in the codebase that touches localStorage for attendance.
//
// Nothing else may call localStorage.getItem / setItem for attendance data.
// One door in, one door out — that is what makes the migration reliable and
// the storage keys greppable.
//
// THREE GUARANTEES:
//
//   1. NEVER THROWS. Corrupt JSON, quota exceeded, private browsing with
//      storage disabled — every path returns a valid default instead of
//      crashing. Losing a setting is recoverable; a white screen is not.
//
//   2. SSR-SAFE. Next.js renders on the server where `window` is undefined.
//      Every access is guarded by isBrowser().
//
//   3. NON-DESTRUCTIVE MIGRATION. v2 data is READ and never deleted. If v3
//      turns out wrong, the original is still sitting there untouched.
//
// ⚠ TRAP 4 — the v2 → v3 migration is where the day index is corrected.
//   v2 stored Tuesday as 2 (Monday=1 convention). v3 stores Tuesday as 1
//   (Monday=0 convention). legacyDayToDayIndex does the conversion.
// =============================================================================

import {
  STORAGE_KEYS,
  DEFAULT_COLLEGE_CONFIG,
  type AcademicYear,
  type AttendanceSettings,
  type Blockout,
  type BlockoutStore,
  type ClassCategory,
  type DayIndex,
  type ExclusionStore,
  type ExtraClass,
  type ExtraClassStore,
  type Id,
  type OpeningBalanceStore,
  type Posting,
  type PostingStore,
  type SessionMarks,
  type SessionStatus,
  type SubjectExclusion,
  type SubjectId,
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

/**
 * Reads and parses a key. Returns `fallback` on ANY failure:
 * not in a browser, key absent, malformed JSON, storage throwing.
 */
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

/** Returns true on success. Silent false on quota exceeded or SSR. */
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

/**
 * Collision-resistant enough for a single-device store, and readable in the
 * console when debugging — which matters more here than cryptographic rigour.
 */
export function makeId(prefix: string): Id {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}


// -----------------------------------------------------------------------------
// SECTION 3 — Change notification
//
// Any mutation bumps a counter and notifies subscribers. React hooks subscribe
// to this so a toggle in Subject Preferences repaints the summary instantly.
//
// ⚠ TRAP 5 — nothing caches a computed percentage. Recalculation is driven
//   from here, on every change, with no memoised stale values in between.
// -----------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
let revision = 0;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Monotonic. Used by hooks as a cheap "has anything changed?" signal. */
export function getRevision(): number {
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
// Everything coming out of localStorage is untrusted. It may have been written
// by an older build, hand-edited in devtools, or half-written when a tab died.
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

/** Validates one timetable entry. Returns null if unsalvageable. */
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


// -----------------------------------------------------------------------------
// SECTION 5 — Settings
// -----------------------------------------------------------------------------

export const DEFAULT_SETTINGS: AttendanceSettings = Object.freeze({
  college: DEFAULT_COLLEGE_CONFIG,
  term: Object.freeze({
    startDate: todayISO(),
    endDate: todayISO(),
    targetPercent: 75,
  }),
  extraClassesEnabled: false,
  extraClassPolicy: 'add',
  examSubjectsByYear: Object.freeze({}),
  currentYear: '3rd MBBS Part 2',
}) as AttendanceSettings;

/**
 * Merged field by field against defaults, so a settings object written by an
 * older build gains new fields instead of breaking on their absence.
 */
export function getSettings(): AttendanceSettings {
  const raw = readJSON<Partial<AttendanceSettings>>(STORAGE_KEYS.settings, {});

  const college = isPlainObject(raw.college)
    ? { ...DEFAULT_COLLEGE_CONFIG, ...raw.college }
    : { ...DEFAULT_COLLEGE_CONFIG };

  // Working days must be a clean DayIndex array or the picker misbehaves.
  const wd = Array.isArray(college.workingDays)
    ? college.workingDays.map(asDayIndex).filter((d): d is DayIndex => d !== null)
    : [];
  college.workingDays = wd.length > 0 ? wd : [...DEFAULT_COLLEGE_CONFIG.workingDays];

  if (!isTimeHHMM(college.dayStart)) college.dayStart = DEFAULT_COLLEGE_CONFIG.dayStart;
  if (!isTimeHHMM(college.dayEnd)) college.dayEnd = DEFAULT_COLLEGE_CONFIG.dayEnd;
  if (![15, 30, 60].includes(college.slotMinutes)) college.slotMinutes = 30;

  const term = isPlainObject(raw.term)
    ? { ...DEFAULT_SETTINGS.term, ...raw.term }
    : { ...DEFAULT_SETTINGS.term };

  if (
    typeof term.targetPercent !== 'number' ||
    term.targetPercent <= 0 ||
    term.targetPercent > 100
  ) {
    term.targetPercent = 75;
  }

  return {
    college,
    term,
    extraClassesEnabled: raw.extraClassesEnabled === true,
    extraClassPolicy: raw.extraClassPolicy === 'ignore' ? 'ignore' : 'add',
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

/** Patch a subset of settings without reading the whole object first. */
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

/** All entries for one day of one year. Always sorted by start time. */
export function getDayEntries(year: AcademicYear, day: DayIndex): TimetableEntry[] {
  return getTimetableStore()[year]?.[`${day}`] ?? [];
}

/** Every entry for a year, flattened, each tagged with its day. */
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

/**
 * Adds an entry. Assumes the caller has already run conflict validation —
 * that check lives in generate.ts so both the form and any bulk import share
 * exactly one implementation.
 */
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

/**
 * Updates an entry in place. Handles the case where the edit moves it to a
 * different day — it is removed from the old day and inserted into the new.
 */
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

/** Wipes one year's timetable. Used by the reset action. */
export function clearYearTimetable(year: AcademicYear): void {
  const store = getTimetableStore();
  delete store[year];
  saveTimetableStore(store);
}


// -----------------------------------------------------------------------------
// SECTION 7 — Postings
// -----------------------------------------------------------------------------

export function getPostings(year: AcademicYear): Posting[] {
  const store = readJSON<PostingStore>(STORAGE_KEYS.postings, {});
  const list = store[year];
  return Array.isArray(list) ? list : [];
}

export function getPostingStore(): PostingStore {
  const store = readJSON<PostingStore>(STORAGE_KEYS.postings, {});
  return isPlainObject(store) ? store : {};
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
// -----------------------------------------------------------------------------

export function getExtraClasses(year: AcademicYear): ExtraClass[] {
  const store = readJSON<ExtraClassStore>(STORAGE_KEYS.extraClasses, {});
  const list = store[year];
  return Array.isArray(list) ? list : [];
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
 *   demands. Because sessions are GENERATED from this record rather than
 *   stored alongside it, changing theory → practical relocates every past
 *   mark to the other denominator the instant this returns. No backfill,
 *   no migration, no stale rows.
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
// This separation is the quiet hero of the whole design. Sessions are derived
// from the timetable, so they are thrown away and rebuilt on every change.
// If marks lived inside them, editing a class time would erase months of
// attendance. Here, a mark is just an id → status pair that survives.
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
  // 'unmarked' is the absence of a mark, so store nothing rather than a row.
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
// ⚠ TRAP 10 — an import REPLACES the figures for that exact
//   year + subject + category. It never adds to what is already there.
//   Importing the same file twice must leave the same numbers, not double them.
// -----------------------------------------------------------------------------

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
  // Attended can never exceed conducted, whatever the file claimed.
  return { conducted, attended: Math.min(attended, conducted) };
}

export function setOpeningBalance(
  year: AcademicYear,
  subjectId: SubjectId,
  category: ClassCategory,
  conducted: number,
  attended: number,
  isEstimate = false,
): void {
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
 * Convenience for the "I'm 68% through 50 classes" import path.
 * Attended is derived and rounded; the flag records that it is an estimate.
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
// ⚠ TRAP 8 — the LOCK is NOT enforced here. getExclusionLock() in
//   curriculum.ts owns that rule, and the UI must consult it before offering
//   a toggle. Keeping the store dumb means an import or a future bulk tool
//   cannot accidentally route around the check by writing directly.
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
 * `whole: true` wins over the individual flags — that is what makes the
 * "exclude entire subject" switch a genuine master toggle.
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
// SECTION 13 — v2 → v3 MIGRATION   ⚠ THIS IS WHERE THE TUESDAY BUG DIES
//
// Runs at most once. Non-destructive: v2 keys are read and left in place.
//
// What v2 looked like:
//   medprep.attendance.timetable.v2 → flat array
//     [{ id, day: 2, subjectId: "obg", subjectName: "…",
//        type: "theory", start: "09:00", end: "10:00", weight: 1 }]
//
// Two differences that matter:
//   1. FLAT ARRAY → day-grouped object.
//   2. day: 2 meant TUESDAY under the old Monday=1 convention. Under v3's
//      Monday=0 convention, 2 means Wednesday. legacyDayToDayIndex maps
//      2 → 1, and Tuesday finally lands on Tuesday.
//
// Also note `type` → `category`. v2 overloaded one field for both the class
// kind and its category; v3 separates concerns.
// -----------------------------------------------------------------------------

const MIGRATION_FLAG = 'medprep.attendance.migrated.v3';

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

/**
 * Idempotent. Safe to call on every mount — it returns immediately once the
 * flag is set. Pass `force: true` only from a debug button.
 */
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

  // Which year does the legacy data belong to? v2 stored a numeric year on
  // the term record; fall back to the current setting when it is missing.
  const legacyTerm = readJSON<Record<string, unknown>>(LEGACY_KEYS.term, {});
  const settings = getSettings();
  const targetYear: AcademicYear = settings.currentYear;
  report.targetYear = targetYear;

  if (legacyTerm.startDate || legacyTerm.endDate) {
    const start = typeof legacyTerm.startDate === 'string' ? legacyTerm.startDate : null;
    const end = typeof legacyTerm.endDate === 'string' ? legacyTerm.endDate : null;
    const target =
      typeof legacyTerm.targetPercent === 'number' ? legacyTerm.targetPercent : 75;

    if (start && end) {
      updateSettings({
        term: { startDate: start, endDate: end, targetPercent: target },
      });
      report.notes.push(`Term dates carried over: ${start} → ${end}.`);
    }
  }

  // ---- Timetable: flat array → day-grouped, with the day index corrected ----
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

  // ---- Postings ----
  const legacyPostings = readJSON<unknown[]>(LEGACY_KEYS.postings, []);

  if (Array.isArray(legacyPostings) && legacyPostings.length > 0) {
    const migrated: Posting[] = [];

    for (const raw of legacyPostings) {
      if (!isPlainObject(raw)) continue;

      const subjectId = typeof raw.subjectId === 'string' ? raw.subjectId : null;
      const startDate = typeof raw.startDate === 'string' ? raw.startDate : null;
      const endDate = typeof raw.endDate === 'string' ? raw.endDate : null;
      if (!subjectId || !startDate || !endDate) continue;

      migrated.push({
        id: typeof raw.id === 'string' ? raw.id : makeId('post'),
        subjectId,
        subjectName:
          typeof raw.subjectName === 'string' ? raw.subjectName : subjectName(subjectId),
        startDate,
        endDate,
        start: isTimeHHMM(raw.start) ? raw.start : '09:00',
        end: isTimeHHMM(raw.end) ? raw.end : '13:00',
        workingDays: Array.isArray(raw.workingDays)
          ? (raw.workingDays
              .map(asDayIndex)
              .filter((d): d is DayIndex => d !== null))
          : [0, 1, 2, 3, 4],
        weight: asPositiveWeight(raw.weight),
        exceptions: [],
        createdAt: Date.now(),
      });
    }

    if (migrated.length > 0) {
      savePostings(targetYear, [...getPostings(targetYear), ...migrated]);
      report.postingsMigrated = migrated.length;
    }
  }

  try {
    window.localStorage.setItem(MIGRATION_FLAG, 'done');
  } catch {
    /* ignore */
  }

  report.ran = true;
  report.notes.push(
    `Day indices converted from the old Monday=1 scheme to Monday=0. Tuesday classes now sit on Tuesday.`,
  );

  notify();
  return report;
}

/** Debug only. Lets you re-run the migration while testing. */
export function resetMigrationFlag(): void {
  removeKey(MIGRATION_FLAG);
}


// -----------------------------------------------------------------------------
// SECTION 14 — Export / import
// -----------------------------------------------------------------------------

export interface AttendanceBackup {
  version: 3;
  exportedAt: string;
  settings: AttendanceSettings;
  timetable: TimetableStore;
  postings: PostingStore;
  extraClasses: ExtraClassStore;
  blockouts: BlockoutStore;
  marks: SessionMarks;
  openingBalance: OpeningBalanceStore;
  exclusions: ExclusionStore;
}

export function exportAll(): AttendanceBackup {
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    timetable: getTimetableStore(),
    postings: getPostingStore(),
    extraClasses: readJSON<ExtraClassStore>(STORAGE_KEYS.extraClasses, {}),
    blockouts: readJSON<BlockoutStore>(STORAGE_KEYS.blockouts, {}),
    marks: getMarks(),
    openingBalance: getOpeningBalanceStore(),
    exclusions: getExclusionStore(),
  };
}

export function exportAllAsJSON(): string {
  return JSON.stringify(exportAll(), null, 2);
}

export interface ImportResult {
  ok: boolean;
  message: string;
}

/**
 * Replaces everything. Deliberately all-or-nothing: a partial merge of two
 * attendance histories produces numbers nobody can explain or audit.
 */
export function importAll(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, message: 'That file is not valid JSON.' };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, message: 'That file does not look like a MedPrep backup.' };
  }
  if (parsed.version !== 3) {
    return {
      ok: false,
      message: `Backup version ${String(parsed.version)} is not supported. This build reads version 3.`,
    };
  }

  const b = parsed as unknown as AttendanceBackup;

  writeJSON(STORAGE_KEYS.settings, b.settings ?? DEFAULT_SETTINGS);
  writeJSON(STORAGE_KEYS.timetable, b.timetable ?? {});
  writeJSON(STORAGE_KEYS.postings, b.postings ?? {});
  writeJSON(STORAGE_KEYS.extraClasses, b.extraClasses ?? {});
  writeJSON(STORAGE_KEYS.blockouts, b.blockouts ?? {});
  writeJSON(STORAGE_KEYS.marks, b.marks ?? {});
  writeJSON(STORAGE_KEYS.openingBalance, b.openingBalance ?? {});
  writeJSON(STORAGE_KEYS.exclusions, b.exclusions ?? {});

  notify();
  return { ok: true, message: 'Backup restored.' };
}

/** Nuclear option. Clears v3 keys only — v2 data stays as a last resort. */
export function clearAllAttendanceData(): void {
  Object.values(STORAGE_KEYS).forEach(removeKey);
  removeKey(MIGRATION_FLAG);
  notify();
}
// -----------------------------------------------------------------------------
// SECTION 15 — Profile settings bridge
//
// Attendance needs one flag that lives in the PROFILE store, not this one:
// entOphthaInFinalYear, set in Settings → Academics.
//
// Read-only and defensive. Attendance never WRITES to the profile key — two
// stores with authority over one value is precisely how they drift apart.
//
// TEMPORARY: once app/store/settings.ts exposes a plain accessor, this should
// call that instead of reading localStorage directly.
// -----------------------------------------------------------------------------

const PROFILE_SETTINGS_KEY = 'medprep.settings.v1';

/** True when ENT and Ophthalmology are examined in 3rd MBBS Part 2. */
export function getEntOphthaInFinalYear(): boolean {
  const profile = readJSON<Record<string, unknown>>(PROFILE_SETTINGS_KEY, {});
  return profile.entOphthaInFinalYear === true;
}
