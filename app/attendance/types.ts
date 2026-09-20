export type AttendanceCategory = "theory" | "practical" | "clinical";

export type SessionStatus = "present" | "absent" | "not-conducted" | "unmarked";

export type CategoryState = "active" | "not-conducted" | "unconfigured";

export interface SubjectCategoryConfig {
  subject: string;
  category: AttendanceCategory;
  state: CategoryState;
  requiredPercentage: number; // 75 theory, 80 practical/clinical
}

export interface TimetableEntry {
  id: string;
  subject: string;
  category: AttendanceCategory;
  dayOfWeek: number;      // 0 = Sunday
  startTime: string;      // "09:00"
  endTime: string;        // display only
  multiplier: number;     // default 1
  activeFrom: string;     // "2026-06-01"
  activeTo: string | null;
  isActive: boolean;
}

export interface SessionRecord {
  id: string;
  date: string;           // "2026-09-20"
  subject: string;
  category: AttendanceCategory;
  status: SessionStatus;
  multiplier: number;
  academicYear: number;
  timetableEntryId: string | null;
  isExtra: boolean;
}

export interface OpeningBalance {
  subject: string;
  category: AttendanceCategory;
  academicYear: number;
  conducted: number;
  attended: number;
  isEstimate: boolean;
}

export interface Exclusion {
  subject: string;
  academicYear: number;
  excluded: boolean;
}
