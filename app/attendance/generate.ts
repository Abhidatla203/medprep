// =============================================================================
// app/attendance/generate.ts
// -----------------------------------------------------------------------------
// Turns the three sources of truth into concrete, dated sessions.
//
//     timetable  ─┐
//     postings   ─┼─→  generate()  ─→  blockouts  ─→  marks  ─→  Session[]
//     extras     ─┘
//
// Nothing here writes to storage. Pure derivation, every time.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ THE MOST IMPORTANT RULE IN THIS FILE: DETERMINISTIC IDS
// ═════════════════════════════════════════════════════════════════════════════
// A session id is a PURE FUNCTION of (source id + date + category).
// It is never random, never timestamped, never counter-based.
//
// Why this matters more than anything else here:
//   Sessions are derived, so they are discarded and rebuilt whenever the
//   timetable changes. Marks live in a separate store keyed by session id.
//   If ids were random, editing one class time in March would orphan every
//   mark made since September — silently, with no error, and no way back.
//
// Corollary: never put Date.now() or Math.random() anywhere in this file.
// ═════════════════════════════════════════════════════════════════════════════
//
// REBUILD v4 — four changes from the previous version:
//
//   1. EXTRA SESSIONS CARRY countsTowardDenominator.
//      Copied from the parent ExtraClass at generation time. Regular and
//      posting sessions deliberately leave the field undefined — that absence
//      is the safety mechanism that stops an extra-class policy change from
//      ever reaching a scheduled class.
//
//   2. REGULAR SESSIONS RESPECT workingDays.
//      A 6-day college was generating Sunday classes, which then sat unmarked
//      forever and fired nightly notifications at a student who did nothing
//      wrong.
//
//   3. THE TERM EXPANSION IS CACHED, keyed by DataVersion.
//      Arithmetic was never the bottleneck; rebuilding ~2,000 sessions on
//      every read was.
//
//   4. BLOCKOUTS NOW OUTRANK STALE ABSENCE MARKS. See SECTION 6.
//
// TRAPS ENFORCED HERE:
//   TRAP 1 — a replaced slot takes the REPLACEMENT's category.
//   TRAP 3 — countsToward 'both' emits TWO sessions sharing a bothPairKey.
//   TRAP 6 — college hours validated in the data layer, not just the UI.
//   TRAP 7 — overlapping blockouts mark a date ONCE.
// =============================================================================

import type {
  AcademicYear,
  Blockout,
  ClassCategory,
  ConflictReport,
  DataVersion,
  DayIndex,
  ExtraClass,
  Id,
  ISODate,
  Posting,
  Session,
  SessionMarks,
  SubjectId,
  TimeHHMM,
  TimetableByDay,
  TimetableEntry,
} from './types';

import { BOTH_RESOLVES_TO } from './types';

import {
  dateRangesOverlap,
  eachDateInRange,
  eachDateInRangeOnDays,
  findNextFreeStart,
  formatTimeRange,
  isoToDayIndex,
  isDateInRange,
  isWithinCollegeHours,
  timeRangesOverlap,
  todayISO,
} from '@/lib/attendance/datetime';

import { isValidCategoryForSubject, subjectName } from '@/lib/attendance/curriculum';

import {
  getBlockouts,
  getDataVersion,
  getExtraClasses,
  getMarks,
  getPostings,
  getSettings,
  getTimetableStore,
} from './store';


// -----------------------------------------------------------------------------
// SECTION 1 — Deterministic id construction
//
// Read the banner at the top of this file before changing anything here.
// -----------------------------------------------------------------------------

/** Regular class. One per timetable entry per date it falls on. */
export function regularSessionId(entryId: Id, date: ISODate): Id {
  return `s_reg_${entryId}_${date}`;
}

/**
 * Posting day. Category is baked in because an exception can change it —
 * a replaced day is genuinely a different session and deserves its own id.
 */
export function postingSessionId(
  postingId: Id,
  date: ISODate,
  category: ClassCategory,
): Id {
  return `s_post_${postingId}_${date}_${category}`;
}

/**
 * Extra class. Category is part of the id so that a 'both' extra produces
 * two distinct, independently markable sessions. (TRAP 3)
 *
 * ⚠ countsTowardDenominator is NOT part of the id. Flipping that flag must
 *   preserve the student's marks — it is an accounting change, not a
 *   different class.
 */
export function extraSessionId(
  extraId: Id,
  date: ISODate,
  category: ClassCategory,
): Id {
  return `s_extra_${extraId}_${date}_${category}`;
}

/** Links the two halves of a 'both' extra so the UI can mark them together. */
export function bothPairKeyFor(extraId: Id, date: ISODate): Id {
  return `pair_${extraId}_${date}`;
}


// -----------------------------------------------------------------------------
// SECTION 2 — Regular sessions from the timetable
//
// A timetable entry is a WEEKLY RULE: "Surgery, Tuesdays, 10:00–13:00".
// Expanding it means walking the term and emitting one session per matching
// weekday.
//
// ★ v4 — workingDays now filters the expansion.
//
//   A student on a Mon–Sat timetable was still getting Sunday sessions if a
//   stray entry existed on day 6. Those sessions could never be attended, sat
//   unmarked forever, and drove the "N unmarked" nag up by one every week.
//
//   The entry is NOT deleted — it stays in the timetable, and re-enabling
//   Sunday in settings brings its sessions straight back. Suppression here is
//   a view over the data, never a mutation of it.
// -----------------------------------------------------------------------------

export interface GenerateWindow {
  /** Inclusive. Usually settings.term.startDate. */
  from: ISODate;
  /** Inclusive. Usually settings.term.endDate. */
  to: ISODate;
}

export function buildRegularSessions(
  year: AcademicYear,
  byDay: TimetableByDay,
  window: GenerateWindow,
  workingDays?: readonly DayIndex[],
): Session[] {
  const out: Session[] = [];
  if (window.to < window.from) return out;

  // undefined means "no filter" — tests and the setup preview need the raw
  // expansion. An EMPTY array is different: it means no working days at all,
  // and correctly yields nothing.
  const allowed = workingDays ? new Set(workingDays) : null;

  for (const [dayKey, entries] of Object.entries(byDay)) {
    if (!entries || entries.length === 0) continue;

    const day = Number(dayKey);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;

    // ★ Suppress non-working days. The entry survives; only its sessions stop.
    if (allowed && !allowed.has(day as DayIndex)) continue;

    const dates = eachDateInRangeOnDays(window.from, window.to, [day as DayIndex]);

    for (const date of dates) {
      for (const entry of entries) {
        out.push({
          id: regularSessionId(entry.id, date),
          date,
          academicYear: year,
          subjectId: entry.subjectId,
          subjectName: entry.subjectName || subjectName(entry.subjectId),
          // ⚠ TRAP 1 — straight from the entry. Never inferred.
          category: entry.category,
          origin: 'regular',
          start: entry.start,
          end: entry.end,
          weight: entry.weight,
          status: 'unmarked',
          timetableEntryId: entry.id,
          // ⚠ countsTowardDenominator is deliberately ABSENT on regular
          //   sessions. See SECTION 4.
        });
      }
    }
  }
  return out;
}


// -----------------------------------------------------------------------------
// SECTION 3 — Posting sessions
//
// A posting is a DATE RANGE plus a set of working days. Exceptions override
// individual dates.
//
// ⚠ TRAP 1 LIVES HERE.
//   'replace' + a replacement → the session takes the REPLACEMENT's subject,
//   category and weight. A clinical posting swapped for a theory class
//   produces a THEORY session. Getting this wrong is silent: the numbers still
//   add up, they are just filed under the wrong heading.
//
//   'replace' + null replacement → the posting simply did not run. No session.
//   'alongside' → both run, both count. Exceptions only.
//
// NOTE: postings carry their OWN workingDays, chosen when the posting was
// created. They are not filtered by the college-wide setting — a posting that
// genuinely runs on a Sunday is a real thing in clinical medicine.
// -----------------------------------------------------------------------------

export function buildPostingSessions(
  year: AcademicYear,
  postings: Posting[],
  window: GenerateWindow,
): Session[] {
  const out: Session[] = [];

  for (const posting of postings) {
    // Skip postings entirely outside the window — cheap, and keeps generation
    // linear in what the user can actually see.
    if (
      !dateRangesOverlap(posting.startDate, posting.endDate, window.from, window.to)
    ) {
      continue;
    }

    const from = posting.startDate > window.from ? posting.startDate : window.from;
    const to = posting.endDate < window.to ? posting.endDate : window.to;

    const dates = eachDateInRangeOnDays(from, to, posting.workingDays);

    // Index exceptions by date so the inner loop stays O(1) per day.
    const exceptionByDate = new Map(posting.exceptions.map((ex) => [ex.date, ex]));

    for (const date of dates) {
      const exception = exceptionByDate.get(date);

      // ---- No exception: the posting runs as configured ----
      if (!exception) {
        out.push({
          id: postingSessionId(posting.id, date, 'clinical'),
          date,
          academicYear: year,
          subjectId: posting.subjectId,
          subjectName: posting.subjectName || subjectName(posting.subjectId),
          category: 'clinical',
          origin: 'posting',
          start: posting.start,
          end: posting.end,
          weight: posting.weight,
          status: 'unmarked',
          postingId: posting.id,
        });
        continue;
      }

      // ---- 'replace' with nothing: the posting did not run ----
      if (exception.resolution === 'replace' && exception.replacement === null) {
        continue;
      }

      // ---- 'replace' with a class: the REPLACEMENT defines everything ----
      if (exception.resolution === 'replace' && exception.replacement) {
        const r = exception.replacement;
        out.push({
          id: postingSessionId(posting.id, date, r.category),
          date,
          academicYear: year,
          subjectId: r.subjectId,
          subjectName: r.subjectName || subjectName(r.subjectId),
          // ⚠ TRAP 1 — the replacement's category wins. Not 'clinical'.
          category: r.category,
          origin: 'posting',
          start: r.start,
          end: r.end,
          weight: r.weight,
          status: 'unmarked',
          postingId: posting.id,
        });
        continue;
      }

      // ---- 'alongside': both run, both count ----
      out.push({
        id: postingSessionId(posting.id, date, 'clinical'),
        date,
        academicYear: year,
        subjectId: posting.subjectId,
        subjectName: posting.subjectName || subjectName(posting.subjectId),
        category: 'clinical',
        origin: 'posting',
        start: posting.start,
        end: posting.end,
        weight: posting.weight,
        status: 'unmarked',
        postingId: posting.id,
      });

      if (exception.replacement) {
        const r = exception.replacement;
        out.push({
          id: postingSessionId(posting.id, date, r.category),
          date,
          academicYear: year,
          subjectId: r.subjectId,
          subjectName: r.subjectName || subjectName(r.subjectId),
          category: r.category,
          origin: 'posting',
          start: r.start,
          end: r.end,
          weight: r.weight,
          status: 'unmarked',
          postingId: posting.id,
        });
      }
    }
  }
  return out;
}


// -----------------------------------------------------------------------------
// SECTION 4 — Extra class sessions
//
// ⚠ TRAP 3 LIVES HERE.
//   countsToward: 'both' emits TWO sessions on the same date — one theory,
//   one practical — sharing a bothPairKey.
//
//   This is the ONLY correct reading of "one class that satisfies two
//   requirements". Each denominator gains the weight exactly once. There is
//   no combined denominator for the two to be double-counted in.
//
// ★ v4 — EACH EXTRA SESSION NOW CARRIES countsTowardDenominator.
//
//   Copied from the parent ExtraClass at generation time. This is the fix that
//   lets calculate.ts stop guessing, and it is the structural half of the
//   separation the rebuild was called for:
//
//     • extra sessions      → HAVE the field
//     • regular + posting   → the field is UNDEFINED, always
//
//   Because a regular session has no such field, recalculating extras is
//   incapable of reaching one. Not "unlikely to" — incapable. The old global
//   settings.extraClassPolicy could sweep through every class in the app;
//   this cannot, and no future maintainer has to remember why.
//
// NOTE ON VISIBILITY: generation stays blind to whether the flag is true or
// false. The session is always emitted, so the marking page shows the class
// either way. Only the arithmetic in calculate.ts differs. An accounting
// setting must never make a class disappear from a student's day.
// -----------------------------------------------------------------------------

/** Which dates does this extra class actually fall on? */
function extraDates(extra: ExtraClass, window: GenerateWindow): ISODate[] {
  const from = extra.startDate > window.from ? extra.startDate : window.from;
  const to = extra.endDate < window.to ? extra.endDate : window.to;
  if (to < from) return [];

  switch (extra.repeat) {
    case 'once':
      return isDateInRange(extra.startDate, window.from, window.to)
        ? [extra.startDate]
        : [];
    case 'daily':
      return eachDateInRange(from, to);
    case 'weekly':
      return eachDateInRangeOnDays(from, to, extra.weekdays);
    default:
      return [];
  }
}

/** 'both' fans out to theory + practical. Everything else is itself. */
function categoriesForExtra(extra: ExtraClass): ClassCategory[] {
  if (extra.countsToward === 'both') return [...BOTH_RESOLVES_TO];
  return [extra.countsToward];
}

export function buildExtraSessions(
  year: AcademicYear,
  extras: ExtraClass[],
  window: GenerateWindow,
): Session[] {
  const out: Session[] = [];

  for (const extra of extras) {
    const dates = extraDates(extra, window);
    const categories = categoriesForExtra(extra);
    const isPaired = extra.countsToward === 'both';

    // ★ Read once per extra, stamped onto every session it produces.
    //   Defaults to true only if storage somehow yielded a non-boolean —
    //   sanitiseExtra in store.ts should make that unreachable.
    const countsTowardDenominator = extra.countsTowardDenominator !== false;

    for (const date of dates) {
      const pairKey = isPaired ? bothPairKeyFor(extra.id, date) : undefined;

      for (const category of categories) {
        out.push({
          id: extraSessionId(extra.id, date, category),
          date,
          academicYear: year,
          subjectId: extra.subjectId,
          subjectName: extra.subjectName || subjectName(extra.subjectId),
          // ⚠ TRAP 1 / TRAP 3 — one session per category, category explicit.
          category,
          origin: 'extra',
          start: extra.start,
          end: extra.end,
          weight: extra.weight,
          status: 'unmarked',
          // ★ v4 — the whole point of this section.
          countsTowardDenominator,
          extraClassId: extra.id,
          bothPairKey: pairKey,
        });
      }
    }
  }
  return out;
}


// -----------------------------------------------------------------------------
// SECTION 5 — Blockouts
//
// ⚠ TRAP 7 LIVES HERE.
//   A date covered by three overlapping blockouts is blocked ONCE. We build a
//   Set of blocked dates rather than iterating blockouts and subtracting, so
//   double-counting is structurally impossible rather than merely avoided.
//
// A blocked session becomes 'not-conducted' — it leaves the denominator
// entirely. It is NOT an absence. Exam week must not damage anyone's
// percentage.
// -----------------------------------------------------------------------------

interface BlockedIndex {
  all: Set<ISODate>;
  bySubject: Map<SubjectId, Set<ISODate>>;
}

export function buildBlockedIndex(
  blockouts: Blockout[],
  window: GenerateWindow,
): BlockedIndex {
  const index: BlockedIndex = { all: new Set(), bySubject: new Map() };

  for (const b of blockouts) {
    if (!dateRangesOverlap(b.startDate, b.endDate, window.from, window.to)) {
      continue;
    }

    const from = b.startDate > window.from ? b.startDate : window.from;
    const to = b.endDate < window.to ? b.endDate : window.to;
    const dates = eachDateInRange(from, to);

    // Null subjectIds means "everything". An empty array means the user
    // created a subject-scoped blockout and picked no subjects — which blocks
    // nothing, and that is the honest reading.
    if (b.subjectIds === null) {
      dates.forEach((d) => index.all.add(d));
      continue;
    }

    for (const subjectId of b.subjectIds) {
      const set = index.bySubject.get(subjectId) ?? new Set<ISODate>();
      dates.forEach((d) => set.add(d));
      index.bySubject.set(subjectId, set);
    }
  }
  return index;
}

function isBlocked(index: BlockedIndex, session: Session): boolean {
  if (index.all.has(session.date)) return true;
  return index.bySubject.get(session.subjectId)?.has(session.date) === true;
}

/** Returns a new array; does not mutate the input. */
export function applyBlockouts(sessions: Session[], index: BlockedIndex): Session[] {
  return sessions.map((s) =>
    isBlocked(index, s) ? { ...s, status: 'not-conducted' as const } : s,
  );
}


// -----------------------------------------------------------------------------
// SECTION 6 — Marks
//
// ★ v4 — BLOCKOUTS NOW OUTRANK STALE ABSENCE MARKS.
//
//   The old order let any mark overwrite a blockout. That produced this:
//
//     March — student marks Tuesday's Pathology 'absent'.
//     April — college announces that Tuesday was a public holiday.
//     Student adds a holiday blockout covering it.
//     Result: the session goes 'not-conducted', then the stale 'absent' mark
//             immediately overwrites it. The percentage never recovers, and
//             nothing on screen explains why.
//
//   A class that did not happen cannot be an absence. So:
//
//     • blocked + marked 'absent' or 'unmarked' → stays 'not-conducted'
//     • blocked + marked 'present'              → the mark WINS
//
//   That asymmetry is deliberate, not an oversight. "I was absent" is a guess
//   about a class the student now knows never ran. "I was present" is a
//   first-hand report of actually being there — which happens when a
//   department runs a make-up session during a blocked week. First-hand
//   knowledge beats a range rule; a guess does not.
// -----------------------------------------------------------------------------

export function applyMarks(sessions: Session[], marks: SessionMarks): Session[] {
  return sessions.map((s) => {
    const mark = marks[s.id];
    if (!mark || mark === 'unmarked') return s;

    // ★ Only a first-hand 'present' may override a blockout.
    if (s.status === 'not-conducted' && mark !== 'present') return s;

    return { ...s, status: mark };
  });
}


// -----------------------------------------------------------------------------
// SECTION 7 — The main entry point
// -----------------------------------------------------------------------------

export interface GenerateOptions {
  year: AcademicYear;
  window: GenerateWindow;
  /** Omit to read from storage. Pass explicitly in tests. */
  byDay?: TimetableByDay;
  postings?: Posting[];
  extras?: ExtraClass[];
  blockouts?: Blockout[];
  marks?: SessionMarks;
  /** False skips extra classes entirely. Defaults to the settings toggle. */
  includeExtras?: boolean;
  /**
   * ★ v4 — which weekdays generate regular sessions.
   * Defaults to settings.college.workingDays.
   * Pass null to disable filtering (setup previews, tests).
   */
  workingDays?: readonly DayIndex[] | null;
}

/**
 * The full pipeline. Deterministic: same inputs, same output, every time.
 * Sorted by date then start time so callers never have to re-sort.
 */
export function generateSessions(options: GenerateOptions): Session[] {
  const { year, window } = options;

  const byDay = options.byDay ?? getTimetableStore()[year] ?? {};
  const postings = options.postings ?? getPostings(year);
  const blockouts = options.blockouts ?? getBlockouts(year);
  const marks = options.marks ?? getMarks();

  const settings = getSettings();
  const includeExtras = options.includeExtras ?? settings.extraClassesEnabled;
  const extras = includeExtras ? (options.extras ?? getExtraClasses(year)) : [];

  // undefined → use the setting. null → explicitly no filter.
  const workingDays =
    options.workingDays === null
      ? undefined
      : (options.workingDays ?? settings.college.workingDays);

  let sessions: Session[] = [
    ...buildRegularSessions(year, byDay, window, workingDays),
    ...buildPostingSessions(year, postings, window),
    ...buildExtraSessions(year, extras, window),
  ];

  sessions = applyBlockouts(sessions, buildBlockedIndex(blockouts, window));
  sessions = applyMarks(sessions, marks);

  return sessions.sort(
    (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
  );
}


// -----------------------------------------------------------------------------
// SECTION 8 — Generation cache   ★ NEW IN v4
//
// Expanding a full term is the expensive step — roughly 1,500–2,500 sessions,
// each an object allocation. The arithmetic in calculate.ts is free by
// comparison; this was always the real cost.
//
// Keyed by DataVersion, which store.ts bumps on every mutating write. Same
// version → serve the cached array. Anything changes → rebuild.
//
// ★ IN MEMORY ONLY, and the array is treated as FROZEN by convention: callers
//   must not mutate what they receive. Nothing derived is ever persisted, so
//   a stale session list cannot survive a reload.
// -----------------------------------------------------------------------------

interface GenCacheEntry {
  version: DataVersion;
  sessions: Session[];
}

const generationCache = new Map<string, GenCacheEntry>();

/** Cache key. Window is included so a week view cannot serve a term view. */
function cacheKey(year: AcademicYear, from: ISODate, to: ISODate): string {
  return `${year}|${from}|${to}`;
}

export function invalidateGenerationCache(): void {
  generationCache.clear();
}

/** Diagnostics for the dev panel. Never shown to a student. */
export function generationCacheStats(): { entries: number; keys: string[] } {
  return { entries: generationCache.size, keys: [...generationCache.keys()] };
}

/** Shared read-through path for every cached helper below. */
function cachedGenerate(
  year: AcademicYear,
  window: GenerateWindow,
): Session[] {
  const version = getDataVersion();
  const key = cacheKey(year, window.from, window.to);

  const hit = generationCache.get(key);
  if (hit && hit.version === version) return hit.sessions;

  const sessions = generateSessions({ year, window });

  // A version bump invalidates EVERYTHING, so drop stale keys rather than
  // letting the map grow one entry per week the student ever scrolled to.
  if (hit || generationCache.size > 24) {
    for (const [k, v] of generationCache) {
      if (v.version !== version) generationCache.delete(k);
    }
  }

  generationCache.set(key, { version, sessions });
  return sessions;
}


// -----------------------------------------------------------------------------
// SECTION 9 — Convenience entry points
// -----------------------------------------------------------------------------

/** The whole term for a year, straight from storage. Cached. */
export function generateForYear(year: AcademicYear): Session[] {
  const { term } = getSettings();
  return cachedGenerate(year, { from: term.startDate, to: term.endDate });
}

/**
 * Sessions on one date. Used by "Today's classes" on the marking page.
 *
 * Filters the cached term rather than regenerating, so opening the day
 * dropdown and stepping through a week costs nothing.
 */
export function generateForDate(year: AcademicYear, date: ISODate): Session[] {
  const { term } = getSettings();

  // Inside the term: reuse the cached expansion.
  if (isDateInRange(date, term.startDate, term.endDate)) {
    return generateForYear(year).filter((s) => s.date === date);
  }

  // Outside it — a quick-added class before term start, say. Generate directly.
  return generateSessions({ year, window: { from: date, to: date } });
}

/** Today, for the current year. The marking page's default view. */
export function generateForToday(): Session[] {
  const { currentYear } = getSettings();
  return generateForDate(currentYear, todayISO());
}

/**
 * One week. Powers the week strip.
 *
 * Same trick as generateForDate: slice the cached term when the week sits
 * inside it, so swiping through history is a filter, not a rebuild.
 */
export function generateForWeek(
  year: AcademicYear,
  weekStart: ISODate,
  weekEnd: ISODate,
): Session[] {
  const { term } = getSettings();

  if (
    isDateInRange(weekStart, term.startDate, term.endDate) &&
    isDateInRange(weekEnd, term.startDate, term.endDate)
  ) {
    return generateForYear(year).filter(
      (s) => s.date >= weekStart && s.date <= weekEnd,
    );
  }

  return cachedGenerate(year, { from: weekStart, to: weekEnd });
}


// -----------------------------------------------------------------------------
// SECTION 10 — Conflict validation
//
// ⚠ TRAP 6 LIVES HERE.
//   College hours are checked in the DATA layer. Hiding out-of-hours slots in
//   the picker is a courtesy; this is the actual rule.
//
// ZERO OVERLAP TOLERANCE. Back-to-back is fine (10:00 end, 10:00 start).
// One shared minute is rejected. A student cannot be in two rooms at once.
// -----------------------------------------------------------------------------

export interface ProposedEntry {
  subjectId: SubjectId;
  category: ClassCategory;
  start: TimeHHMM;
  end: TimeHHMM;
  isAfterHours: boolean;
  /** Set when editing, so the entry does not collide with its own old self. */
  excludeEntryId?: Id;
}

/** Occupied ranges on one day. Feeds the time picker's slot filtering. */
export function occupiedRanges(
  byDay: TimetableByDay,
  day: DayIndex,
  excludeEntryId?: Id,
): Array<{ start: TimeHHMM; end: TimeHHMM }> {
  const entries = byDay[`${day}`] ?? [];
  return entries
    .filter((e) => e.id !== excludeEntryId)
    .map((e) => ({ start: e.start, end: e.end }));
}

/**
 * The single validator. The add form, the edit sheet and any future bulk
 * import all call this — one implementation, one behaviour, no drift.
 */
export function validateEntry(
  year: AcademicYear,
  day: DayIndex,
  proposed: ProposedEntry,
  byDayOverride?: TimetableByDay,
): ConflictReport {
  const settings = getSettings();
  const byDay = byDayOverride ?? getTimetableStore()[year] ?? {};
  const entries = (byDay[`${day}`] ?? []).filter(
    (e) => e.id !== proposed.excludeEntryId,
  );

  const clean: ConflictReport = {
    hasConflict: false,
    collidesWith: [],
    message: '',
    suggestedStart: null,
  };

  if (proposed.start >= proposed.end) {
    return {
      ...clean,
      hasConflict: true,
      message: 'The end time must be after the start time.',
    };
  }

  if (!isValidCategoryForSubject(proposed.subjectId, proposed.category)) {
    return {
      ...clean,
      hasConflict: true,
      message: `${subjectName(proposed.subjectId)} does not have ${proposed.category} classes.`,
    };
  }

  // ★ v4 — a class on a non-working day warns rather than blocks. The student
  //   may be about to enable that day in settings, and refusing outright would
  //   be a dead end with no explanation.
  if (!settings.college.workingDays.includes(day)) {
    return {
      ...clean,
      hasConflict: true,
      message:
        'That day is not one of your working days. Add it in settings, or the class will be saved but not counted.',
    };
  }

  // ---- TRAP 6: college hours, enforced for real ----
  const within = isWithinCollegeHours(
    proposed.start,
    proposed.end,
    settings.college.dayStart,
    settings.college.dayEnd,
  );

  if (!within && !proposed.isAfterHours) {
    return {
      ...clean,
      hasConflict: true,
      message: `That time is outside college hours (${formatTimeRange(
        settings.college.dayStart,
        settings.college.dayEnd,
      )}). Use "After hours" to add it anyway.`,
    };
  }

  if (!within && proposed.isAfterHours && !settings.college.allowAfterHours) {
    return {
      ...clean,
      hasConflict: true,
      message: 'After-hours classes are turned off. Enable them in settings first.',
    };
  }

  // ---- Overlap ----
  const collisions = entries.filter((e) =>
    timeRangesOverlap(proposed.start, proposed.end, e.start, e.end),
  );

  if (collisions.length === 0) return clean;

  const first = collisions[0];
  const suggested = findNextFreeStart(
    proposed.start,
    settings.college.dayEnd,
    settings.college.slotMinutes,
    entries.map((e) => ({ start: e.start, end: e.end })),
  );

  return {
    hasConflict: true,
    collidesWith: collisions,
    message:
      collisions.length === 1
        ? `Overlaps with ${first.subjectName} (${formatTimeRange(first.start, first.end)}).`
        : `Overlaps with ${collisions.length} existing classes.`,
    suggestedStart: suggested,
  };
}

/**
 * Where should the add-class form open?
 *
 * Finish a class at 10:00 and the next form opens pre-filled at 10:00, with
 * 09:00 gone from the list. Returns null when the day is full — the caller
 * should disable the add button rather than present an empty picker.
 */
export function suggestedStartFor(
  year: AcademicYear,
  day: DayIndex,
  byDayOverride?: TimetableByDay,
): TimeHHMM | null {
  const settings = getSettings();
  const byDay = byDayOverride ?? getTimetableStore()[year] ?? {};
  return findNextFreeStart(
    settings.college.dayStart,
    settings.college.dayEnd,
    settings.college.slotMinutes,
    occupiedRanges(byDay, day),
  );
}


// -----------------------------------------------------------------------------
// SECTION 11 — Posting conflict detection
//
// Postings collide by DATE, not by weekday, so they need their own check.
// Unlike timetable overlaps this does NOT hard-block: the spec calls for a
// warning with Replace / Alongside / Change-time, which is a UI decision.
// This function reports; it does not decide.
// -----------------------------------------------------------------------------

export interface PostingConflict {
  date: ISODate;
  withEntries: TimetableEntry[];
  withPostings: Posting[];
}

export function findPostingConflicts(
  year: AcademicYear,
  posting: Posting,
  byDayOverride?: TimetableByDay,
  postingsOverride?: Posting[],
): PostingConflict[] {
  const byDay = byDayOverride ?? getTimetableStore()[year] ?? {};
  const others = (postingsOverride ?? getPostings(year)).filter(
    (p) => p.id !== posting.id,
  );

  const out: PostingConflict[] = [];
  const dates = eachDateInRangeOnDays(
    posting.startDate,
    posting.endDate,
    posting.workingDays,
  );

  for (const date of dates) {
    const day = isoToDayIndex(date);

    const withEntries = (byDay[`${day}`] ?? []).filter((e) =>
      timeRangesOverlap(posting.start, posting.end, e.start, e.end),
    );

    const withPostings = others.filter(
      (p) =>
        isDateInRange(date, p.startDate, p.endDate) &&
        p.workingDays.includes(day) &&
        timeRangesOverlap(posting.start, posting.end, p.start, p.end),
    );

    if (withEntries.length > 0 || withPostings.length > 0) {
      out.push({ date, withEntries, withPostings });
    }
  }
  return out;
}


// -----------------------------------------------------------------------------
// SECTION 12 — Query helpers
//
// ⚠ TRAP 9 — subjectsInTimetable() is the function the summary page must use
//   to decide what to display. The curriculum lists what is POSSIBLE; this
//   lists what is REAL. A first-year who never entered ENT must never see
//   "ENT — 0%".
// -----------------------------------------------------------------------------

/** Distinct subjects the student has actually scheduled for a year. */
export function subjectsInTimetable(year: AcademicYear): SubjectId[] {
  const byDay = getTimetableStore()[year] ?? {};
  const found = new Set<SubjectId>();

  Object.values(byDay).forEach((entries) =>
    entries?.forEach((e) => found.add(e.subjectId)),
  );
  getPostings(year).forEach((p) => found.add(p.subjectId));
  getExtraClasses(year).forEach((x) => found.add(x.subjectId));

  return [...found];
}

/** Which categories does this subject actually have data for, this year? */
export function categoriesInUse(
  year: AcademicYear,
  subjectId: SubjectId,
): ClassCategory[] {
  const byDay = getTimetableStore()[year] ?? {};
  const found = new Set<ClassCategory>();

  Object.values(byDay).forEach((entries) =>
    entries?.forEach((e) => {
      if (e.subjectId === subjectId) found.add(e.category);
    }),
  );

  getPostings(year).forEach((p) => {
    if (p.subjectId === subjectId) found.add('clinical');
  });

  getExtraClasses(year).forEach((x) => {
    if (x.subjectId !== subjectId) return;
    if (x.countsToward === 'both') BOTH_RESOLVES_TO.forEach((c) => found.add(c));
    else found.add(x.countsToward);
  });

  return [...found];
}

/** Total scheduled minutes on a day. Powers "4 classes · 5h 30m" in the UI. */
export function dayLoadMinutes(year: AcademicYear, day: DayIndex): number {
  const entries = getTimetableStore()[year]?.[`${day}`] ?? [];
  return entries.reduce((sum, e) => {
    const [sh, sm] = e.start.split(':').map(Number);
    const [eh, em] = e.end.split(':').map(Number);
    return sum + Math.max(0, eh * 60 + em - (sh * 60 + sm));
  }, 0);
}


// =============================================================================
// NEXT — the UI layer. Needs app/globals.css first.
//   • WeekStrip.tsx  — 5 tile states, break inference, working-day columns
//   • MarkList.tsx   — day header, dropdown, calendar jump, quick add,
//                      mark-all-cancelled
//   • RingGrid.tsx   — concentric rings, auto-layout, tap to expand
//   • page.tsx       — assembles the three
// =============================================================================
