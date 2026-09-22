// =============================================================================
// lib/attendance/datetime.ts
// -----------------------------------------------------------------------------
// Every date and time operation in the attendance system lives here.
// Pure functions only. No storage, no React, no side effects.
//
// TWO RULES THIS FILE EXISTS TO ENFORCE:
//
//   1. ⚠ TRAP 4 — DAY INDEXING
//      JavaScript's Date.getDay() returns 0 for SUNDAY.
//      Our DayIndex uses 0 for MONDAY.
//      These are off by one for six days out of seven, which is exactly why
//      "Tuesday" rendered as "Wed". Every conversion goes through
//      dateToDayIndex(). Nothing else is allowed to touch .getDay().
//
//   2. THE UTC MIDNIGHT TRAP
//      new Date("2026-09-22") parses as UTC midnight. In IST (UTC+5:30) that
//      is still 2026-09-22 locally — but west of Greenwich it silently becomes
//      2026-09-21. Never pass an ISO date string to the Date constructor.
//      Use parseISODate(), which builds a local-midnight Date explicitly.
// =============================================================================

import type { DayIndex, ISODate, TimeHHMM } from '@/app/attendance/types';
import { DAY_NAMES, DAY_NAMES_SHORT } from '@/app/attendance/types';


// -----------------------------------------------------------------------------
// SECTION 1 — Day index conversion
// -----------------------------------------------------------------------------

/**
 * Maps JavaScript's Sunday-first weekday to our Monday-first DayIndex.
 * Index of this array is Date.getDay(); the value is our DayIndex.
 *
 *   getDay() 0 Sun → 6
 *   getDay() 1 Mon → 0
 *   getDay() 2 Tue → 1
 *   getDay() 3 Wed → 2
 *   getDay() 4 Thu → 3
 *   getDay() 5 Fri → 4
 *   getDay() 6 Sat → 5
 */
const JS_DAY_TO_DAY_INDEX: readonly DayIndex[] = Object.freeze([
  6, 0, 1, 2, 3, 4, 5,
]);

/**
 * The ONLY sanctioned way to get a DayIndex from a Date.
 * If you find `.getDay()` anywhere else in the codebase, it is a bug.
 */
export function dateToDayIndex(date: Date): DayIndex {
  return JS_DAY_TO_DAY_INDEX[date.getDay()];
}

/** Same, but from an ISO date string. Local-safe. */
export function isoToDayIndex(iso: ISODate): DayIndex {
  return dateToDayIndex(parseISODate(iso));
}

/** "Monday", "Tuesday", … Returns "" for an out-of-range index. */
export function dayName(day: DayIndex): string {
  return DAY_NAMES[day] ?? '';
}

/** "Mon", "Tue", … Returns "" for an out-of-range index. */
export function dayNameShort(day: DayIndex): string {
  return DAY_NAMES_SHORT[day] ?? '';
}

/** Runtime guard. Use when reading numbers out of storage or user input. */
export function isDayIndex(value: unknown): value is DayIndex {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 6
  );
}

/**
 * Migration helper for legacy `.v2` data.
 *
 * The old store wrote day numbers with a different convention: Tuesday was
 * saved as 2, which our Monday-first scheme reads as Wednesday. The old values
 * were Sunday-first-ish — effectively Monday = 1 … Saturday = 6, Sunday = 0.
 * This converts one of those to a correct DayIndex.
 *
 *   legacy 0 Sun → 6
 *   legacy 1 Mon → 0
 *   legacy 2 Tue → 1   ← the four classes you actually care about
 *   legacy 3 Wed → 2
 *   legacy 4 Thu → 3
 *   legacy 5 Fri → 4
 *   legacy 6 Sat → 5
 *
 * Out-of-range input falls back to Monday rather than throwing, because a
 * migration must never lose a user's class.
 */
export function legacyDayToDayIndex(legacy: number): DayIndex {
  if (!Number.isInteger(legacy) || legacy < 0 || legacy > 6) return 0;
  return JS_DAY_TO_DAY_INDEX[legacy];
}


// -----------------------------------------------------------------------------
// SECTION 2 — ISO date parsing and formatting
// -----------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed "YYYY-MM-DD" that is also a real calendar date. */
export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d);
  return (
    probe.getFullYear() === y &&
    probe.getMonth() === m - 1 &&
    probe.getDate() === d
  );
}

/**
 * "YYYY-MM-DD" → Date at LOCAL midnight.
 * Never use `new Date(isoString)` directly. See the UTC trap at the top.
 * Invalid input returns local midnight today, so callers never get NaN dates.
 */
export function parseISODate(iso: ISODate): Date {
  if (!isISODate(iso)) return startOfDay(new Date());
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Date → "YYYY-MM-DD" using LOCAL calendar fields, never toISOString(). */
export function formatISODate(date: Date): ISODate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today as "YYYY-MM-DD", local. */
export function todayISO(): ISODate {
  return formatISODate(new Date());
}

/** Strips the time portion. Returns a new Date; does not mutate. */
export function startOfDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0, 0, 0, 0,
  );
}


// -----------------------------------------------------------------------------
// SECTION 3 — Date arithmetic
// -----------------------------------------------------------------------------

/** Adds n days (negative to subtract). DST-safe: uses calendar fields. */
export function addDays(iso: ISODate, n: number): ISODate {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return formatISODate(d);
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function daysBetween(from: ISODate, to: ISODate): number {
  const MS_PER_DAY = 86_400_000;
  const a = parseISODate(from).getTime();
  const b = parseISODate(to).getTime();
  // Round, don't floor — a DST shift can leave a 23- or 25-hour day.
  return Math.round((b - a) / MS_PER_DAY);
}

/** Inclusive on both ends. */
export function isDateInRange(
  date: ISODate,
  start: ISODate,
  end: ISODate,
): boolean {
  return date >= start && date <= end;
}

/**
 * True when two inclusive date ranges share at least one day.
 * Plain string comparison is safe here — ISO dates sort lexicographically.
 */
export function dateRangesOverlap(
  aStart: ISODate,
  aEnd: ISODate,
  bStart: ISODate,
  bEnd: ISODate,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Every date from start to end inclusive.
 *
 * Hard capped at 1826 days (~5 years). A corrupt end date must not spin the
 * browser into an infinite loop — it returns what it has and stops.
 */
export function eachDateInRange(start: ISODate, end: ISODate): ISODate[] {
  const MAX_DAYS = 1826;
  const out: ISODate[] = [];
  if (end < start) return out;

  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < MAX_DAYS) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return out;
}

/**
 * Every date in the range whose weekday appears in `days`.
 * This is how a posting expands into concrete sessions.
 * An empty `days` array yields nothing — a posting that runs on no day runs
 * on no day, which is correct rather than surprising.
 */
export function eachDateInRangeOnDays(
  start: ISODate,
  end: ISODate,
  days: DayIndex[],
): ISODate[] {
  if (days.length === 0) return [];
  const wanted = new Set<DayIndex>(days);
  return eachDateInRange(start, end).filter((iso) =>
    wanted.has(isoToDayIndex(iso)),
  );
}

/** The Monday on or before the given date. Weeks start Monday here. */
export function startOfWeek(iso: ISODate): ISODate {
  return addDays(iso, -isoToDayIndex(iso));
}

/** The Sunday on or after the given date. */
export function endOfWeek(iso: ISODate): ISODate {
  return addDays(startOfWeek(iso), 6);
}


// -----------------------------------------------------------------------------
// SECTION 4 — Time of day
//
// Times are "HH:MM", 24-hour, zero-padded. Internally we work in minutes from
// midnight, because integer comparison cannot be got subtly wrong the way
// string comparison can.
// -----------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTimeHHMM(value: unknown): value is TimeHHMM {
  return typeof value === 'string' && TIME_RE.test(value);
}

/** "09:30" → 570. Invalid input returns 0 rather than NaN. */
export function timeToMinutes(time: TimeHHMM): number {
  if (!isTimeHHMM(time)) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** 570 → "09:30". Clamped to a single day, so nothing wraps past midnight. */
export function minutesToTime(minutes: number): TimeHHMM {
  const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
  const h = String(Math.floor(clamped / 60)).padStart(2, '0');
  const m = String(clamped % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/** Length in minutes. Zero when end is not after start. */
export function durationMinutes(start: TimeHHMM, end: TimeHHMM): number {
  return Math.max(0, timeToMinutes(end) - timeToMinutes(start));
}

/** Negative, zero or positive — same contract as Array.prototype.sort. */
export function compareTime(a: TimeHHMM, b: TimeHHMM): number {
  return timeToMinutes(a) - timeToMinutes(b);
}

/** "09:00" → "9:00 AM". Display only; never store this. */
export function formatTime12h(time: TimeHHMM): string {
  const total = timeToMinutes(time);
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "09:00"–"10:30" → "9:00 AM – 10:30 AM". En dash, not hyphen. */
export function formatTimeRange(start: TimeHHMM, end: TimeHHMM): string {
  return `${formatTime12h(start)} – ${formatTime12h(end)}`;
}

/** 90 → "1h 30m". 60 → "1h". 45 → "45m". 0 → "0m". */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}


// -----------------------------------------------------------------------------
// SECTION 5 — Overlap detection
//
// ⚠ ZERO TOLERANCE. A student cannot be in two rooms at once.
//
// Touching edges are NOT an overlap: 09:00–10:00 and 10:00–11:00 are fine.
// One shared minute IS an overlap: 09:00–10:00 and 09:30–10:30 is rejected.
// The strict comparisons below are what make that distinction. Do not relax
// them to <= or the whole no-overlap guarantee quietly disappears.
// -----------------------------------------------------------------------------

export function timeRangesOverlap(
  aStart: TimeHHMM,
  aEnd: TimeHHMM,
  bStart: TimeHHMM,
  bEnd: TimeHHMM,
): boolean {
  const as = timeToMinutes(aStart);
  const ae = timeToMinutes(aEnd);
  const bs = timeToMinutes(bStart);
  const be = timeToMinutes(bEnd);
  // Strict: equal boundaries mean back-to-back, not overlapping.
  return as < be && bs < ae;
}

/** True when the inner range sits entirely inside the outer one. */
export function timeRangeContains(
  outerStart: TimeHHMM,
  outerEnd: TimeHHMM,
  innerStart: TimeHHMM,
  innerEnd: TimeHHMM,
): boolean {
  return (
    timeToMinutes(innerStart) >= timeToMinutes(outerStart) &&
    timeToMinutes(innerEnd) <= timeToMinutes(outerEnd)
  );
}


// -----------------------------------------------------------------------------
// SECTION 6 — Slot generation
//
// Feeds the add-class time picker. College hours plus a granularity give a
// list of candidate start times; occupied ones are then filtered out by the
// caller so the user physically cannot pick a clashing slot.
// -----------------------------------------------------------------------------

export interface TimeSlot {
  start: TimeHHMM;
  end: TimeHHMM;
  /** Precomputed so the UI never has to call formatTimeRange in a loop. */
  label: string;
}

/**
 * Consecutive slots of `slotMinutes` between dayStart and dayEnd.
 * A trailing partial slot is dropped — a 20-minute stub at the end of the day
 * is noise, not a class.
 */
export function generateSlots(
  dayStart: TimeHHMM,
  dayEnd: TimeHHMM,
  slotMinutes: number,
): TimeSlot[] {
  const out: TimeSlot[] = [];
  const startM = timeToMinutes(dayStart);
  const endM = timeToMinutes(dayEnd);
  if (slotMinutes <= 0 || endM <= startM) return out;

  for (let m = startM; m + slotMinutes <= endM; m += slotMinutes) {
    const start = minutesToTime(m);
    const end = minutesToTime(m + slotMinutes);
    out.push({ start, end, label: formatTimeRange(start, end) });
  }
  return out;
}

/** Candidate start times only, for a picker that lets the user choose an end. */
export function generateStartTimes(
  dayStart: TimeHHMM,
  dayEnd: TimeHHMM,
  slotMinutes: number,
): TimeHHMM[] {
  const out: TimeHHMM[] = [];
  const startM = timeToMinutes(dayStart);
  const endM = timeToMinutes(dayEnd);
  if (slotMinutes <= 0 || endM <= startM) return out;

  for (let m = startM; m < endM; m += slotMinutes) out.push(minutesToTime(m));
  return out;
}

/**
 * Valid end times for a chosen start, given what is already booked.
 *
 * Walks forward one slot at a time and STOPS at the first occupied range.
 * That stop is deliberate: it makes a class that swallows an existing one
 * impossible to express, rather than merely discouraged.
 */
export function generateEndTimes(
  start: TimeHHMM,
  dayEnd: TimeHHMM,
  slotMinutes: number,
  occupied: Array<{ start: TimeHHMM; end: TimeHHMM }>,
): TimeHHMM[] {
  const out: TimeHHMM[] = [];
  const startM = timeToMinutes(start);
  const endM = timeToMinutes(dayEnd);
  if (slotMinutes <= 0 || endM <= startM) return out;

  for (let m = startM + slotMinutes; m <= endM; m += slotMinutes) {
    const candidate = minutesToTime(m);
    const clashes = occupied.some((o) =>
      timeRangesOverlap(start, candidate, o.start, o.end),
    );
    if (clashes) break;
    out.push(candidate);
  }
  return out;
}

/**
 * The earliest free start time at or after `preferred`.
 *
 * This is what makes the add-class form feel considerate: finish a class at
 * 10:00 and the next one opens pre-filled at 10:00, with 09:00 gone from the
 * list entirely. Returns null when the rest of the day is full.
 */
export function findNextFreeStart(
  preferred: TimeHHMM,
  dayEnd: TimeHHMM,
  slotMinutes: number,
  occupied: Array<{ start: TimeHHMM; end: TimeHHMM }>,
): TimeHHMM | null {
  const endM = timeToMinutes(dayEnd);
  let m = timeToMinutes(preferred);

  while (m + slotMinutes <= endM) {
    const candidateStart = minutesToTime(m);
    const candidateEnd = minutesToTime(m + slotMinutes);
    const clashes = occupied.some((o) =>
      timeRangesOverlap(candidateStart, candidateEnd, o.start, o.end),
    );
    if (!clashes) return candidateStart;
    m += slotMinutes;
  }
  return null;
}

/** True when the whole range sits inside college hours. Enforces TRAP 6. */
export function isWithinCollegeHours(
  start: TimeHHMM,
  end: TimeHHMM,
  dayStart: TimeHHMM,
  dayEnd: TimeHHMM,
): boolean {
  return timeRangeContains(dayStart, dayEnd, start, end);
}


// -----------------------------------------------------------------------------
// SECTION 7 — Display helpers
// -----------------------------------------------------------------------------

/** "22 Sep 2026". */
export function formatDateLong(iso: ISODate): string {
  const d = parseISODate(iso);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Tue, 22 Sep". Weekday comes from dateToDayIndex, never from getDay(). */
export function formatDateWithDay(iso: ISODate): string {
  const d = parseISODate(iso);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${dayNameShort(dateToDayIndex(d))}, ${d.getDate()} ${months[d.getMonth()]}`;
}

/** "Today", "Yesterday", "Tomorrow", or "Tue, 22 Sep". */
export function formatDateRelative(iso: ISODate): string {
  const diff = daysBetween(todayISO(), iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return formatDateWithDay(iso);
}
// -----------------------------------------------------------------------------
// SECTION 8 — Human date entry
//
// Used by DateField, where the user types rather than picks. Kept here rather
// than in the component so every date input in the app parses identically.
// -----------------------------------------------------------------------------

/**
 * "2026-09-22" → "22/09/2026".
 * Day-first, because that is what an Indian medical student writes by hand.
 * Returns "" for invalid input so a half-typed field renders as empty rather
 * than as "NaN/NaN/NaN".
 */
export function formatDateDMY(iso: ISODate): string {
  if (!isISODate(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Anything a human plausibly types → "YYYY-MM-DD", or null if unreadable.
 *
 * Accepts:
 *   22/09/2026   22-09-2026   22.09.2026   22 09 2026
 *   2026-09-22   2026/09/22
 *   22/9/26      (two-digit year → 2000s)
 *
 * Deliberately day-first for ambiguous separators. "03/04/2026" is 3 April,
 * not 4 March. Guessing the American order here would be wrong far more often
 * than it was right, and wrong silently.
 *
 * Returns null rather than a fallback date — a caller that cannot parse the
 * input must keep the field in an editing state, not quietly invent a value.
 */
export function parseDateInput(input: string): ISODate | null {
  const raw = input.trim();
  if (raw === '') return null;

  // Already ISO, or ISO with slashes.
  const isoish = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoish) {
    const [, y, m, d] = isoish;
    const candidate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return isISODate(candidate) ? candidate : null;
  }

  // Day-first with any common separator.
  const dmy = raw.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/);
  if (dmy) {
    const [, dd, mm, yy] = dmy;
    // Two-digit years are this century. A medical student is not entering 1926.
    const year = yy.length === 2 ? `20${yy}` : yy;
    const candidate = `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    return isISODate(candidate) ? candidate : null;
  }

  return null;
}
