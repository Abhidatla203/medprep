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
//   Because ids are deterministic, a mark made on day one still finds its
//   session after any number of edits. Change a class's SUBJECT or CATEGORY
//   and the id legitimately changes — that is correct, because it is no
//   longer the same class and its old marks should not follow it.
//
// Corollary: never put Date.now() or Math.random() anywhere in this file.
// ═════════════════════════════════════════════════════════════════════════════
//
// TRAPS ENFORCED HERE:
//   TRAP 1 — a replaced slot takes the REPLACEMENT's category, never the
//            original's. See buildPostingSessions().
//   TRAP 3 — countsToward 'both' emits TWO sessions, one per category, sharing
//            a bothPairKey. Never one session counted twice.
//   TRAP 6 — college hours are validated in the data layer, not just hidden
//            in the UI. See validateEntry().
//   TRAP 7 — overlapping blockouts mark a date ONCE. Set-based, not additive.
// =============================================================================

import type {
  AcademicYear,
  Blockout,
  ClassCategory,
  ConflictReport,
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
): Session[] {
  const out: Session[] = [];
  if (window.to < window.from) return out;

  for (const [dayKey, entries] of Object.entries(byDay)) {
    if (!entries || entries.length === 0) continue;

    const day = Number(dayKey);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;

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
//   produces a THEORY session. Its attendance lands in the theory denominator.
//   Getting this wrong is silent: the numbers still add up, they are just
//   filed under the wrong heading.
//
//   'replace' + null replacement → the posting simply did not run. No session.
//   'alongside' → both run, both count. Exceptions only.
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
      !dateRangesOverlap(
        posting.startDate,
        posting.endDate,
        window.from,
        window.to,
      )
    ) {
      continue;
    }

    const from = posting.startDate > window.from ? posting.startDate : window.from;
    const to = posting.endDate < window.to ? posting.endDate : window.to;

    const dates = eachDateInRangeOnDays(from, to, posting.workingDays);

    // Index exceptions by date so the inner loop stays O(1) per day.
    const exceptionByDate = new Map(
      posting.exceptions.map((ex) => [ex.date, ex]),
    );

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
//   The alternative — one session with a flag — forces every downstream
//   consumer to remember the special case. Two sessions means calculate.ts
//   needs no special case at all. The complexity is paid once, here.
//
// NOTE ON POLICY: this file is deliberately blind to extraClassPolicy
// ('add' vs 'ignore'). Generation always emits the sessions; calculate.ts
// decides whether they touch the denominator. Mixing that decision in here
// would make the marking page show or hide classes based on an accounting
// setting, which is not what the student asked for.
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

/**
 * Blocked dates, split by scope.
 *   `all`       → dates where every subject is blocked
 *   `bySubject` → subjectId → dates blocked for that subject only
 */
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
    // created a subject-scoped blockout and picked no subjects — which
    // blocks nothing, and that is the honest reading.
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

/**
 * Forces blocked sessions to 'not-conducted'.
 * Returns a new array; does not mutate the input.
 */
export function applyBlockouts(
  sessions: Session[],
  index: BlockedIndex,
): Session[] {
  return sessions.map((s) =>
    isBlocked(index, s) ? { ...s, status: 'not-conducted' as const } : s,
  );
}


// -----------------------------------------------------------------------------
// SECTION 6 — Marks
//
// Applied LAST, and deliberately so.
//
// Order matters: blockouts run first, then marks. A user who marked a class
// 'present' before declaring exam week should see that week drop out of the
// denominator... but a blocked session that was explicitly marked keeps its
// mark, because an explicit statement from the user outranks a range rule.
//
// The one exception: 'not-conducted' from a blockout is not overridden by an
// 'unmarked' absence of a mark, which is the common case.
// -----------------------------------------------------------------------------

export function applyMarks(sessions: Session[], marks: SessionMarks): Session[] {
  return sessions.map((s) => {
    const mark = marks[s.id];
    if (!mark || mark === 'unmarked') return s;
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

  let sessions: Session[] = [
    ...buildRegularSessions(year, byDay, window),
    ...buildPostingSessions(year, postings, window),
    ...buildExtraSessions(year, extras, window),
  ];

  sessions = applyBlockouts(sessions, buildBlockedIndex(blockouts, window));
  sessions = applyMarks(sessions, marks);

  return sessions.sort(
    (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
  );
}

/** Convenience: the whole term for a year, straight from storage. */
export function generateForYear(year: AcademicYear): Session[] {
  const { term } = getSettings();
  return generateSessions({
    year,
    window: { from: term.startDate, to: term.endDate },
  });
}

/** Sessions on one date. Used by "Today's classes" on the marking page. */
export function generateForDate(year: AcademicYear, date: ISODate): Session[] {
  return generateSessions({ year, window: { from: date, to: date } });
}

/** Today, for the current year. The marking page's default view. */
export function generateForToday(): Session[] {
  const { currentYear } = getSettings();
  return generateForDate(currentYear, todayISO());
}

/** A Monday-to-Sunday week containing the given date. */
export function generateForWeek(
  year: AcademicYear,
  weekStart: ISODate,
  weekEnd: ISODate,
): Session[] {
  return generateSessions({ year, window: { from: weekStart, to: weekEnd } });
}


// -----------------------------------------------------------------------------
// SECTION 8 — Conflict validation
//
// ⚠ TRAP 6 LIVES HERE.
//   College hours are checked in the DATA layer. Hiding out-of-hours slots in
//   the picker is a courtesy; this is the actual rule. A slot outside college
//   hours is legal only when the entry is explicitly flagged isAfterHours AND
//   the setting permits it.
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

  // ---- Basic sanity ----
  if (proposed.start >= proposed.end) {
    return {
      ...clean,
      hasConflict: true,
      message: 'The end time must be after the start time.',
    };
  }

  // ---- Category legality for this subject ----
  if (!isValidCategoryForSubject(proposed.subjectId, proposed.category)) {
    return {
      ...clean,
      hasConflict: true,
      message: `${subjectName(proposed.subjectId)} does not have ${proposed.category} classes.`,
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
 * This is the behaviour requested by name: finish a class at 10:00 and the
 * next form opens pre-filled at 10:00, with 09:00 gone from the list. Returns
 * null when the day is full — the caller should then disable the add button
 * rather than present an empty picker.
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
// SECTION 9 — Posting conflict detection
//
// Postings collide by DATE, not by weekday, so they need their own check.
// Unlike timetable overlaps this does NOT hard-block: the spec calls for a
// warning with Replace / Alongside / Change-time, which is a UI decision.
// This function reports; it does not decide.
// -----------------------------------------------------------------------------

export interface PostingConflict {
  date: ISODate;
  /** Regular timetable entries clashing on that date. */
  withEntries: TimetableEntry[];
  /** Other postings clashing on that date. */
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
// SECTION 10 — Query helpers
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
