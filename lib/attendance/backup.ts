// lib/attendance/backup.ts
// -----------------------------------------------------------------------------
// Save / Export / Import for timetable + attendance data.
//
// This was missing, which is a real risk: everything lives in localStorage, and
// localStorage is one "clear browsing data" tap away from oblivion. A student
// who loses a semester of attendance records has lost something they cannot
// reconstruct from memory.
//
// Format is plain JSON, versioned, human-readable. If MedPrep ever dies, the
// student still owns their data in a file they can open.
// -----------------------------------------------------------------------------

import type { ClassBlock } from "@/components/attendance/WeekGrid";
import type { PostingBlock } from "@/components/attendance/PostingScheduler";
import type { YearKey } from "./curriculum";
import { todayISO } from "./datetime";

export const STORAGE_KEYS = {
  timetable: "medprep.attendance.timetable.v2",
  postings: "medprep.attendance.postings.v2",
  sessions: "medprep.attendance.sessions.v2",
  term: "medprep.attendance.term.v2",
} as const;

export const BACKUP_VERSION = 2;

export type SessionStatus = "present" | "absent" | "cancelled" | "unmarked";

export interface SessionRecord {
  id: string;
  date: string;
  subjectId: string;
  type: string;
  start: string;
  end: string;
  weight: number;
  status: SessionStatus;
  postingId?: string;
}

export interface TermConfig {
  startDate: string;
  endDate: string;
  year: YearKey;
  targetPercent: number;
}

export interface BackupPayload {
  app: "medprep";
  kind: "attendance-backup";
  version: number;
  exportedAt: string;
  term: TermConfig | null;
  timetable: ClassBlock[];
  postings: PostingBlock[];
  sessions: SessionRecord[];
}

// ---- storage ----------------------------------------------------------------

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded, or Safari private mode.
    return false;
  }
}

export function loadTimetable(): ClassBlock[] {
  return readJSON<ClassBlock[]>(STORAGE_KEYS.timetable, []);
}
export function saveTimetable(blocks: ClassBlock[]): boolean {
  return writeJSON(STORAGE_KEYS.timetable, blocks);
}

export function loadPostings(): PostingBlock[] {
  return readJSON<PostingBlock[]>(STORAGE_KEYS.postings, []);
}
export function savePostings(postings: PostingBlock[]): boolean {
  return writeJSON(STORAGE_KEYS.postings, postings);
}

export function loadSessions(): SessionRecord[] {
  return readJSON<SessionRecord[]>(STORAGE_KEYS.sessions, []);
}
export function saveSessions(sessions: SessionRecord[]): boolean {
  return writeJSON(STORAGE_KEYS.sessions, sessions);
}

export function loadTerm(): TermConfig | null {
  return readJSON<TermConfig | null>(STORAGE_KEYS.term, null);
}
export function saveTerm(term: TermConfig): boolean {
  return writeJSON(STORAGE_KEYS.term, term);
}

// ---- export -----------------------------------------------------------------

export function buildBackup(): BackupPayload {
  return {
    app: "medprep",
    kind: "attendance-backup",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    term: loadTerm(),
    timetable: loadTimetable(),
    postings: loadPostings(),
    sessions: loadSessions(),
  };
}

export function downloadBackup(): void {
  const payload = buildBackup();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `medprep-attendance-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Spreadsheet-friendly export for students who want to eyeball the log. */
export function downloadSessionsCSV(subjectLookup: (id: string) => string): void {
  const sessions = loadSessions();
  const header = ["Date", "Subject", "Type", "Start", "End", "Weight", "Status"];
  const rows = sessions
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .map((s) => [
      s.date,
      subjectLookup(s.subjectId),
      s.type,
      s.start,
      s.end,
      String(s.weight),
      s.status,
    ]);

  const csv = [header, ...rows]
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `medprep-attendance-${todayISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- import -----------------------------------------------------------------

export interface ImportResult {
  ok: boolean;
  message: string;
  counts?: { timetable: number; postings: number; sessions: number };
}

export function validateBackup(raw: unknown): raw is BackupPayload {
  if (!raw || typeof raw !== "object") return false;
  const p = raw as Partial<BackupPayload>;
  return (
    p.app === "medprep" &&
    p.kind === "attendance-backup" &&
    typeof p.version === "number" &&
    Array.isArray(p.timetable) &&
    Array.isArray(p.sessions)
  );
}

/**
 * @param mode "replace" wipes existing data. "merge" keeps existing sessions and
 *             only adds ones whose id is not already present — safer default
 *             when restoring onto a device that has been in use.
 */
export function restoreBackup(
  raw: unknown,
  mode: "replace" | "merge" = "replace"
): ImportResult {
  if (!validateBackup(raw)) {
    return { ok: false, message: "That file isn't a MedPrep attendance backup." };
  }
  if (raw.version > BACKUP_VERSION) {
    return {
      ok: false,
      message: "This backup came from a newer version of MedPrep. Update the app first.",
    };
  }

  const postings = Array.isArray(raw.postings) ? raw.postings : [];

  if (mode === "replace") {
    saveTimetable(raw.timetable);
    savePostings(postings);
    saveSessions(raw.sessions);
    if (raw.term) saveTerm(raw.term);
  } else {
    const existingSessions = loadSessions();
    const seen = new Set(existingSessions.map((s) => s.id));
    const merged = [...existingSessions, ...raw.sessions.filter((s) => !seen.has(s.id))];

    const existingBlocks = loadTimetable();
    const seenBlocks = new Set(existingBlocks.map((b) => b.id));
    const mergedBlocks = [
      ...existingBlocks,
      ...raw.timetable.filter((b) => !seenBlocks.has(b.id)),
    ];

    const existingPostings = loadPostings();
    const seenPostings = new Set(existingPostings.map((p) => p.id));
    const mergedPostings = [
      ...existingPostings,
      ...postings.filter((p) => !seenPostings.has(p.id)),
    ];

    saveSessions(merged);
    saveTimetable(mergedBlocks);
    savePostings(mergedPostings);
  }

  return {
    ok: true,
    message: mode === "replace" ? "Backup restored." : "Backup merged into your data.",
    counts: {
      timetable: raw.timetable.length,
      postings: postings.length,
      sessions: raw.sessions.length,
    },
  };
}

export async function readBackupFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}

// ---- v1 -> v2 migration -----------------------------------------------------
// Data written before the v2 namespace change is invisible to the current build.
// This is NOT data loss; it just needs adopting once.

const V1_KEYS = {
  timetable: "medprep.timetable",
  sessions: "medprep.attendance",
};

export function hasLegacyData(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.localStorage.getItem(V1_KEYS.timetable) ||
      window.localStorage.getItem(V1_KEYS.sessions)
  );
}

export function migrateLegacyData(): ImportResult {
  if (!hasLegacyData()) {
    return { ok: false, message: "No older data found on this device." };
  }
  try {
    const oldTimetable = readJSON<ClassBlock[]>(V1_KEYS.timetable, []);
    const oldSessions = readJSON<SessionRecord[]>(V1_KEYS.sessions, []);

    if (oldTimetable.length) saveTimetable([...loadTimetable(), ...oldTimetable]);
    if (oldSessions.length) {
      const seen = new Set(loadSessions().map((s) => s.id));
      saveSessions([...loadSessions(), ...oldSessions.filter((s) => !seen.has(s.id))]);
    }

    return {
      ok: true,
      message: `Recovered ${oldTimetable.length} classes and ${oldSessions.length} records.`,
      counts: {
        timetable: oldTimetable.length,
        postings: 0,
        sessions: oldSessions.length,
      },
    };
  } catch {
    return { ok: false, message: "Older data was found but couldn't be read." };
  }
}
