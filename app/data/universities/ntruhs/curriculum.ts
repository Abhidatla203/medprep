export const UNIVERSITY = {
  id: "ntruhs",
  name: "Dr. NTR University of Health Sciences",
  state: "Andhra Pradesh",
  type: "State",
  circularUrl: "https://drntr.uhsap.in/index/notification_examination",
} as const;

export type Year =
  | "1st MBBS"
  | "2nd MBBS"
  | "3rd MBBS Part 1"
  | "3rd MBBS Part 2";

/** Examinable subjects per year. Drives Question Bank, Syllabus and Planner. */
export const CURRICULUM: Record<Year, string[]> = {
  "1st MBBS": ["Anatomy", "Physiology", "Biochemistry"],
  "2nd MBBS": ["Pharmacology", "Pathology", "Microbiology"],
  "3rd MBBS Part 1": [
    "Forensic Medicine & Toxicology",
    "Community Medicine",
    "ENT",
    "Ophthalmology",
  ],
  "3rd MBBS Part 2": [
    "General Medicine",
    "General Surgery",
    "Obstetrics & Gynaecology",
    "Paediatrics",
    "Orthopaedics",
  ],
};

/** Clinical posting departments. Attendance only, spans all years. */
export const CLINICAL_DEPARTMENTS: string[] = [
  "General Medicine",
  "General Surgery",
  "Paediatrics",
  "Obstetrics & Gynaecology",
  "Orthopaedics",
  "ENT",
  "Ophthalmology",
  "Community Medicine",
  "Psychiatry",
  "Dermatology",
];

/** Default thresholds. Student can override in Settings. */
export const THRESHOLDS = {
  theory: 75,
  practical: 80,
  posting: 80,
};

export const YEARS = Object.keys(CURRICULUM) as Year[];
