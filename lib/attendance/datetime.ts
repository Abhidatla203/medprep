// lib/attendance/datetime.ts
// -----------------------------------------------------------------------------
// Date + time parsing / formatting for MedPrep.
//
// LOCALE CONTRACT: the app is dd/mm/yyyy and 12-hour clock, everywhere, always.
// Native <input type="date"> renders in the BROWSER's locale, which is why the
// setup screen was showing 09/20/2026. We therefore never expose a bare native
// date input — we wrap it (see DateField.tsx).
// -----------------------------------------------------------------------------

export const MINUTES_IN_DAY = 24 * 60;

// ---------- time: "HH:mm" 24h canonical form ---------------------------------

/**
 * Parse loose human time input into canonical "HH:mm".
 * Accepts: "9", "930", "9:30", "9.30", "9 30", "9am", "9:30 PM", "21:05", "2p"
 * Returns null if unparseable.
 */
export function parseTimeInput(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, ":");
  if (!s) return null;

  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?(a|p|am|pm)?$/);
  if (!m) return null;

  let hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3] ? m[3][0] : null;

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (minutes > 59) return null;

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "p" && hours !== 12) hours += 12;
    if (meridiem === "a" && hours === 12) hours = 0;
  } else {
    // No meridiem. Bare 1–7 is far more likely to mean afternoon on a college
    // timetable than 1 AM, but guessing silently is worse than being literal.
    // We stay literal; the quick-pick chips cover the common cases.
    if (hours > 23) return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** "09:30" -> 570 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 570 -> "09:30" */
export function minutesToTime(total: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_IN_DAY - 1, Math.round(total)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "09:30" -> "9:30 AM" */
export function formatTime12(time: string): string {
  const mins = timeToMinutes(time);
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const meridiem = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${meridiem}`;
}

/** Compact axis label: "9 AM", "12 PM", "1:30 PM" */
export function formatTimeAxis(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const meridiem = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${meridiem}` : `${h12}:${String(m).padStart(2, "0")}`;
}

/** "1 hr", "45 min", "3 hr 30 min" */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

export function addMinutesToTime(time: string, delta: number): string {
  return minutesToTime(timeToMinutes(time) + delta);
}

// ---------- dates: "yyyy-mm-dd" canonical, dd/mm/yyyy displayed --------------

/**
 * Parse dd/mm/yyyy (also dd-mm-yyyy, dd.mm.yyyy, ddmmyyyy) into "yyyy-mm-dd".
 * Two-digit years resolve to 20xx. Returns null if invalid or non-existent.
 */
export function parseDateInput(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // Already canonical?
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isRealDate(+iso[1], +iso[2], +iso[3]) ? s : null;

  const parts = s.split(/[\/\-.\s]+/).filter(Boolean);
  let d: number, mo: number, y: number;

  if (parts.length === 3) {
    d = parseInt(parts[0], 10);
    mo = parseInt(parts[1], 10);
    y = parseInt(parts[2], 10);
  } else if (parts.length === 1 && /^\d{8}$/.test(parts[0])) {
    d = parseInt(parts[0].slice(0, 2), 10);
    mo = parseInt(parts[0].slice(2, 4), 10);
    y = parseInt(parts[0].slice(4), 10);
  } else {
    return null;
  }

  if ([d, mo, y].some(Number.isNaN)) return null;
  if (y < 100) y += 2000;
  if (!isRealDate(y, mo, d)) return null;

  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** "2026-09-20" -> "20/09/2026" */
export function formatDateDMY(isoDate: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

/** "2026-09-20" -> "Sun, 20 Sep 2026" */
export function formatDateLong(isoDate: string): string {
  if (!isoDate) return "";
  const dt = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

export function addDaysISO(isoDate: string, days: number): string {
  const dt = new Date(`${isoDate}T00:00:00`);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
}

export function dayOfWeekISO(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00`).getDay();
}

/** Inclusive count of calendar days between two ISO dates. */
export function daysBetweenInclusive(startISO: string, endISO: string): number {
  const a = new Date(`${startISO}T00:00:00`).getTime();
  const b = new Date(`${endISO}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}

/** Walk every ISO date in an inclusive range. Capped to avoid runaway loops. */
export function eachDateInRange(startISO: string, endISO: string, cap = 400): string[] {
  const out: string[] = [];
  let cursor = startISO;
  let guard = 0;
  while (cursor <= endISO && guard < cap) {
    out.push(cursor);
    cursor = addDaysISO(cursor, 1);
    guard += 1;
  }
  return out;
}
