import type {
  SessionRecord,
  OpeningBalance,
  Exclusion,
  AttendanceCategory,
} from "./types";

export interface AttendanceResult {
  conducted: number;
  attended: number;
  percentage: number;
  canMiss: number;
  mustAttend: number;
  unmarked: number;
  status: "safe" | "warning" | "danger" | "no-data";
}

function isIncluded(
  subject: string,
  academicYear: number,
  exclusions: Exclusion[]
): boolean {
  const ex = exclusions.find(
    (e) => e.subject === subject && e.academicYear === academicYear
  );
  return !ex?.excluded;
}

export function calculateAttendance(
  subject: string,
  category: AttendanceCategory,
  sessions: SessionRecord[],
  balances: OpeningBalance[],
  exclusions: Exclusion[],
  requiredPercentage: number
): AttendanceResult {
  let conducted = 0;
  let attended = 0;
  let unmarked = 0;

  for (const s of sessions) {
    if (s.subject !== subject || s.category !== category) continue;
    if (!isIncluded(s.subject, s.academicYear, exclusions)) continue;

    if (s.status === "unmarked") {
      unmarked += 1;
      continue;
    }
    if (s.status === "not-conducted") continue;

    conducted += s.multiplier;
    if (s.status === "present") attended += s.multiplier;
  }

  for (const b of balances) {
    if (b.subject !== subject || b.category !== category) continue;
    if (!isIncluded(b.subject, b.academicYear, exclusions)) continue;

    conducted += b.conducted;
    attended += b.attended;
  }

  if (conducted === 0) {
    return {
      conducted: 0,
      attended: 0,
      percentage: 0,
      canMiss: 0,
      mustAttend: 0,
      unmarked,
      status: "no-data",
    };
  }

  const target = requiredPercentage / 100;
  const percentage = (attended / conducted) * 100;

  const canMiss =
    percentage >= requiredPercentage
      ? Math.max(0, Math.floor(attended / target) - conducted)
      : 0;

  const mustAttend =
    percentage < requiredPercentage
      ? Math.ceil((target * conducted - attended) / (1 - target))
      : 0;

  let status: AttendanceResult["status"];
  if (percentage < requiredPercentage) status = "danger";
  else if (canMiss <= 2) status = "warning";
  else status = "safe";

  return {
    conducted,
    attended,
    percentage,
    canMiss,
    mustAttend,
    unmarked,
    status,
  };
}
