import type { TimetableEntry, SessionRecord } from "./types";

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Builds the sessions a timetable expects between two dates.
 * Existing records win — we never overwrite a marked session.
 */
export function generateSessions(
  entries: TimetableEntry[],
  from: string,
  to: string,
  academicYear: number,
  existing: SessionRecord[]
): SessionRecord[] {
  const seen = new Set(
    existing.map((s) => `${s.timetableEntryId}|${s.date}`)
  );

  const out: SessionRecord[] = [];
  const start = parseISO(from);
  const end = parseISO(to);

  for (const e of entries) {
    if (!e.isActive) continue;

    const eFrom = parseISO(e.activeFrom);
    const eTo = e.activeTo ? parseISO(e.activeTo) : null;

    const cursor = new Date(start);

    while (cursor <= end) {
      const inWindow =
        cursor >= eFrom && (eTo === null || cursor <= eTo);

      if (inWindow && cursor.getDay() === e.dayOfWeek) {
        const date = toISO(cursor);
        const key = `${e.id}|${date}`;

        if (!seen.has(key)) {
          out.push({
            id: `${e.id}-${date}`,
            date,
            subject: e.subject,
            category: e.category,
            status: "unmarked",
            multiplier: e.multiplier,
            academicYear,
            timetableEntryId: e.id,
            isExtra: false,
          });
          seen.add(key);
        }
      }

      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Sessions expected on one specific day. */
export function sessionsForDate(
  sessions: SessionRecord[],
  date: string
): SessionRecord[] {
  return sessions.filter((s) => s.date === date);
}
