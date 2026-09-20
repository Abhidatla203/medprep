import type {
  TimetableEntry,
  SessionRecord,
  OpeningBalance,
  Exclusion,
  SubjectCategoryConfig,
} from "./types";

const KEYS = {
  timetable: "medprep.attendance.timetable",
  sessions: "medprep.attendance.sessions",
  balances: "medprep.attendance.balances",
  exclusions: "medprep.attendance.exclusions",
  configs: "medprep.attendance.configs",
} as const;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked — fail quietly, don't crash the app
  }
}

export const attendanceStore = {
  getTimetable: () => read<TimetableEntry[]>(KEYS.timetable, []),
  setTimetable: (v: TimetableEntry[]) => write(KEYS.timetable, v),

  getSessions: () => read<SessionRecord[]>(KEYS.sessions, []),
  setSessions: (v: SessionRecord[]) => write(KEYS.sessions, v),

  getBalances: () => read<OpeningBalance[]>(KEYS.balances, []),
  setBalances: (v: OpeningBalance[]) => write(KEYS.balances, v),

  getExclusions: () => read<Exclusion[]>(KEYS.exclusions, []),
  setExclusions: (v: Exclusion[]) => write(KEYS.exclusions, v),

  getConfigs: () => read<SubjectCategoryConfig[]>(KEYS.configs, []),
  setConfigs: (v: SubjectCategoryConfig[]) => write(KEYS.configs, v),

  /** Everything, for export or Drive backup later. */
  exportAll: () => ({
    timetable: read<TimetableEntry[]>(KEYS.timetable, []),
    sessions: read<SessionRecord[]>(KEYS.sessions, []),
    balances: read<OpeningBalance[]>(KEYS.balances, []),
    exclusions: read<Exclusion[]>(KEYS.exclusions, []),
    configs: read<SubjectCategoryConfig[]>(KEYS.configs, []),
    exportedAt: new Date().toISOString(),
  }),
};
