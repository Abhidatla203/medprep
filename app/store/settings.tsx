"use client";

import { createContext, useContext, useState } from "react";
import { CURRICULUM, type Year } from "../data/universities/ntruhs/curriculum";

export const ALL = "All subjects";

/** "Subject::Topic" — topics the student has already covered. */
const INITIAL_COVERED = [
  "Pharmacology::ANS",
  "Pharmacology::ANS & Autacoids",
  "Pharmacology::Endocrine",
  "Pathology::General Pathology",
  "Microbiology::Bacteriology",
];

type Settings = {
  year: Year;
  subject: string;
  showAllSubjects: boolean;
  examDate: string;
  covered: string[];
  setYear: (y: Year) => void;
  setSubject: (s: string) => void;
  setShowAllSubjects: (v: boolean) => void;
  setExamDate: (d: string) => void;
  toggleCovered: (subject: string, topic: string) => void;
  availableSubjects: string[];
  yearSubjects: string[];
};

const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [year, setYearState] = useState<Year>("2nd MBBS");
  const [subject, setSubject] = useState<string>(ALL);
  const [showAllSubjects, setShowAllSubjects] = useState(false);
  const [examDate, setExamDate] = useState("2027-03-15");
  const [covered, setCovered] = useState<string[]>(INITIAL_COVERED);

  const yearSubjects = showAllSubjects
    ? Object.values(CURRICULUM).flat()
    : CURRICULUM[year];

  const availableSubjects = [ALL, ...yearSubjects];

  function setYear(y: Year) {
    setYearState(y);
    setSubject(ALL);
  }

  function toggleCovered(subj: string, topic: string) {
    const key = `${subj}::${topic}`;
    setCovered((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  return (
    <SettingsContext.Provider
      value={{
        year,
        subject,
        showAllSubjects,
        examDate,
        covered,
        setYear,
        setSubject,
        setShowAllSubjects,
        setExamDate,
        toggleCovered,
        availableSubjects,
        yearSubjects,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used inside SettingsProvider");
  }
  return context;
}
