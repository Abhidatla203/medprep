"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/* ========================================================================
   TYPES
   ===================================================================== */

export type SessionStatus = "pending" | "present" | "absent" | "not-conducted";

export type MbbsYear = 1 | 2 | 3 | 4;

export interface TimetableSlot {
  id: string;
  /** 0 = Sunday … 6 = Saturday */
  day: number;
  subject: string;
  category: string;
  /** "HH:MM" 24-hour */
  startTime: string;
  /** "HH:MM" 24-hour */
  endTime: string;
  /** How many attendance units this class is worth. Usually 1; practicals often 2. */
  multiplier: number;
}

export interface Timetable {
  academicYear: number;
  /** ISO "YYYY-MM-DD" */
  startDate: string;
  slots: TimetableSlot[];
}

export interface Session {
  id: string;
  date: string;
  subject: string;
  category: string;
  status: SessionStatus;
  slotId: string;
  startTime: string;
  endTime: string;
  multiplier: number;
}

export interface Exclusion {
  id: string;
  from: string;
  to: string;
  reason?: string;
}

export interface SubjectConfig {
  subject: string;
  category: string;
  state: "active" | "inactive";
  required: number;
}

export interface Balance {
  subject: string;
  carriedAttended: number;
  carriedTotal: number;
}

export interface BacklogRow {
  subject: string;
  attended: number;
  total: number;
  percent: number;
  required: number;
  deficit: number;
  canSkip: number;
}

/* ========================================================================
   STORAGE
   ===================================================================== */

const NS = "medprep.attendance.v2";
const DEFAULT_REQUIRED = 75;

const key = (year: number, name: string) => `${NS}.${year}.${name}`;

function read<T>(k: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(k);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write<T>(k: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(k, JSON.stringify(value));
  } catch {
    /* quota or private mode — in-memory state still works */
  }
}

/* ========================================================================
   DATES
   ===================================================================== */

export const isoToday = (): string => {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

const parseIso = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const toIso = (d: Date): string => {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

const inAnyExclusion = (iso: string, exclusions: Exclusion[]): boolean =>
  exclusions.some((e) => iso >= e.from && iso <= e.to);

/* ========================================================================
   SESSION GENERATION
   ===================================================================== */

function buildSessions(
  timetable: Timetable | null,
  exclusions: Exclusion[],
  existing: Session[]
): Session[] {
  if (!timetable || timetable.slots.length === 0) return existing;

  const seen = new Set(existing.map((s) => s.id));
  const out: Session[] = [];

  const cursor = parseIso(timetable.startDate);
  const stop = parseIso(isoToday());

  let guard = 0; // ~3 years of days, so a stray date can't hang the loop

  while (cursor <= stop && guard < 1200) {
    guard += 1;
    const iso = toIso(cursor);

    if (!inAnyExclusion(iso, exclusions)) {
      const weekday = cursor.getDay();

      for (const slot of timetable.slots) {
        if (slot.day !== weekday) continue;

        const id = `${iso}__${slot.id}`;
        if (seen.has(id)) continue;

        out.push({
          id,
          date: iso,
          subject: slot.subject,
          category: slot.category,
          status: "pending",
          slotId: slot.id,
          startTime: slot.startTime,
          endTime: slot.endTime,
          multiplier: slot.multiplier ?? 1,
        });
        seen.add(id);
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return out.length > 0 ? [...existing, ...out] : existing;
}

/* ========================================================================
   BACKLOG — weighted by multiplier
   ===================================================================== */

function buildBacklog(
  sessions: Session[],
  configs: SubjectConfig[],
  balances: Balance[]
): BacklogRow[] {
  const requiredBySubject = new Map<string, number>();
  for (const c of configs) {
    requiredBySubject.set(c.subject, c.required ?? DEFAULT_REQUIRED);
  }

  const tally = new Map<string, { attended: number; total: number }>();

  for (const b of balances) {
    tally.set(b.subject, {
      attended: b.carriedAttended ?? 0,
      total: b.carriedTotal ?? 0,
    });
  }

  for (const s of sessions) {
    if (s.status === "not-conducted" || s.status === "pending") continue;

    const w = s.multiplier ?? 1;
    const row = tally.get(s.subject) ?? { attended: 0, total: 0 };
    row.total += w;
    if (s.status === "present") row.attended += w;
    tally.set(s.subject, row);
  }

  return Array.from(tally.entries())
    .map(([subject, { attended, total }]) => {
      const required = requiredBySubject.get(subject) ?? DEFAULT_REQUIRED;
      const percent = total === 0 ? 0 : (attended / total) * 100;

      // Consecutive classes needed to climb back to the requirement.
      const deficit =
        percent >= required || required >= 100
          ? 0
          : Math.max(
              0,
              Math.ceil((required * total - 100 * attended) / (100 - required))
            );

      // Classes you could miss and still stay at or above the requirement.
      const canSkip =
        percent < required || required <= 0
          ? 0
          : Math.max(0, Math.floor((100 * attended - required * total) / required));

      return { subject, attended, total, percent, required, deficit, canSkip };
    })
    .sort((a, b) => a.percent - b.percent);
}

function deriveConfigs(
  timetable: Timetable | null,
  saved: SubjectConfig[]
): SubjectConfig[] {
  if (!timetable) return saved;

  const map = new Map(saved.map((c) => [`${c.subject}__${c.category}`, c]));

  for (const slot of timetable.slots) {
    const k = `${slot.subject}__${slot.category}`;
    if (!map.has(k)) {
      map.set(k, {
        subject: slot.subject,
        category: slot.category,
        state: "active",
        required: DEFAULT_REQUIRED,
      });
    }
  }

  return Array.from(map.values());
}

/* ========================================================================
   HOOK
   ===================================================================== */

export function useAttendance(academicYear: number) {
  const [ready, setReady] = useState(false);

  const [timetable, setTimetableState] = useState<Timetable | null>(null);
  const [sessions, setSessionsState] = useState<Session[]>([]);
  const [balances, setBalancesState] = useState<Balance[]>([]);
  const [exclusions, setExclusionsState] = useState<Exclusion[]>([]);
  const [configs, setConfigsState] = useState<SubjectConfig[]>([]);

  useEffect(() => {
    let cancelled = false;

    const tt = read<Timetable | null>(key(academicYear, "timetable"), null);
    const stored = read<Session[]>(key(academicYear, "sessions"), []);
    const bal = read<Balance[]>(key(academicYear, "balances"), []);
    const exc = read<Exclusion[]>(key(academicYear, "exclusions"), []);
    const savedCfg = read<SubjectConfig[]>(key(academicYear, "configs"), []);

    const all = buildSessions(tt, exc, stored);
    const cfg = deriveConfigs(tt, savedCfg);

    if (all.length !== stored.length) write(key(academicYear, "sessions"), all);
    if (cfg.length !== savedCfg.length) write(key(academicYear, "configs"), cfg);

    queueMicrotask(() => {
      if (cancelled) return;
      setTimetableState(tt);
      setSessionsState(all);
      setBalancesState(bal);
      setExclusionsState(exc);
      setConfigsState(cfg);
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [academicYear]);

  const setTimetable = useCallback(
    (next: Timetable) => {
      write(key(academicYear, "timetable"), next);
      setTimetableState(next);

      setSessionsState((prev) => {
        const regenerated = buildSessions(next, exclusions, prev);
        write(key(academicYear, "sessions"), regenerated);
        return regenerated;
      });

      setConfigsState((prev) => {
        const derived = deriveConfigs(next, prev);
        write(key(academicYear, "configs"), derived);
        return derived;
      });
    },
    [academicYear, exclusions]
  );

  const setSessions = useCallback(
    (next: Session[]) => {
      write(key(academicYear, "sessions"), next);
      setSessionsState(next);
    },
    [academicYear]
  );

  const setBalances = useCallback(
    (next: Balance[]) => {
      write(key(academicYear, "balances"), next);
      setBalancesState(next);
    },
    [academicYear]
  );

  const setExclusions = useCallback(
    (next: Exclusion[]) => {
      write(key(academicYear, "exclusions"), next);
      setExclusionsState(next);
    },
    [academicYear]
  );

  const setConfigs = useCallback(
    (next: SubjectConfig[]) => {
      write(key(academicYear, "configs"), next);
      setConfigsState(next);
    },
    [academicYear]
  );

  const todayIso = isoToday();

  const today = useMemo(
    () =>
      sessions
        .filter((s) => s.date === todayIso)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [sessions, todayIso]
  );

  const backlog = useMemo(
    () => buildBacklog(sessions, configs, balances),
    [sessions, configs, balances]
  );

  const markSession = useCallback(
    (sessionId: string, status: SessionStatus) => {
      setSessionsState((prev) => {
        const next = prev.map((s) =>
          s.id === sessionId ? { ...s, status } : s
        );
        write(key(academicYear, "sessions"), next);
        return next;
      });
    },
    [academicYear]
  );

  const markRangeNotConducted = useCallback(
    (fromIso: string, toIso: string, subject?: string) => {
      setSessionsState((prev) => {
        const next = prev.map((s) => {
          if (s.date < fromIso || s.date > toIso) return s;
          if (subject && s.subject !== subject) return s;
          return { ...s, status: "not-conducted" as SessionStatus };
        });
        write(key(academicYear, "sessions"), next);
        return next;
      });
    },
    [academicYear]
  );

  const activeCategories = useCallback(
    (subject: string): string[] =>
      configs
        .filter((c) => c.subject === subject && c.state === "active")
        .map((c) => c.category),
    [configs]
  );

  /** Wipes everything for this year — used by "Start over". */
  const resetYear = useCallback(() => {
    for (const name of [
      "timetable",
      "sessions",
      "balances",
      "exclusions",
      "configs",
    ]) {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(key(academicYear, name));
      }
    }
    setTimetableState(null);
    setSessionsState([]);
    setBalancesState([]);
    setExclusionsState([]);
    setConfigsState([]);
  }, [academicYear]);

  return {
    ready,
    timetable,
    sessions,
    balances,
    exclusions,
    configs,
    today,
    backlog,
    markSession,
    markRangeNotConducted,
    activeCategories,
    resetYear,
    setTimetable,
    setSessions,
    setBalances,
    setExclusions,
    setConfigs,
  };
}
