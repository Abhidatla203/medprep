"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { CURRICULUM, YEARS, type Year } from "../data/universities/ntruhs/curriculum";

export const ALL = "All subjects";

const SETTINGS_KEY = "medprep.settings.v1";
const PROFILE_KEY = "medprep.profile.v1";

const INITIAL_COVERED = [
  "Pharmacology::ANS",
  "Pharmacology::ANS & Autacoids",
  "Pharmacology::Endocrine",
  "Pathology::General Pathology",
  "Microbiology::Bacteriology",
];

const YEAR_TO_PROFILE: Record<Year, "1" | "2" | "3" | "4"> = {
  "1st MBBS": "1",
  "2nd MBBS": "2",
  "3rd MBBS Part 1": "3",
  "3rd MBBS Part 2": "4",
};

const PROFILE_TO_YEAR: Record<string, Year> = {
  "1": "1st MBBS",
  "2": "2nd MBBS",
  "3": "3rd MBBS Part 1",
  "4": "3rd MBBS Part 2",
};

export type ExamSubjectMap = Record<Year, string[]>;

export function emptyExamMap(): ExamSubjectMap {
  return {
    "1st MBBS": [],
    "2nd MBBS": [],
    "3rd MBBS Part 1": [],
    "3rd MBBS Part 2": [],
  };
}

export function ageFromBirthday(iso: string) {
  if (!iso) return "";
  const born = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(born.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();
  const monthDiff = today.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < born.getDate())) age -= 1;
  if (age < 0 || age > 120) return "";
  return String(age);
}

function splitName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
}

function unique(list: string[]) {
  return [...new Set(list.filter(Boolean))];
}

function isEnt(s: string) {
  const n = s.toLowerCase();
  return (
    n === "ent" ||
    n.includes("otorhinolaryng") ||
    n.includes("oto-rhino") ||
    n.includes("oto rhino") ||
    n.includes("ear, nose")
  );
}

function isOphtha(s: string) {
  return s.toLowerCase().includes("ophthalm");
}

function isEntOrOphtha(s: string) {
  return isEnt(s) || isOphtha(s);
}

function namedFromCurriculum(test: (s: string) => boolean, fallback: string) {
  const found = Object.values(CURRICULUM).flat().find(test);
  return found || fallback;
}

export function allCurriculumSubjects() {
  return unique([
    ...Object.values(CURRICULUM).flat(),
    namedFromCurriculum(isEnt, "ENT"),
    namedFromCurriculum(isOphtha, "Ophthalmology"),
  ]);
}

function applyEntOphthaShift(year: Year, list: string[], on: boolean) {
  if (!on) return unique(list);
  if (year === "3rd MBBS Part 1") return unique(list.filter((s) => !isEntOrOphtha(s)));
  if (year === "3rd MBBS Part 2") {
    return unique([
      ...list,
      namedFromCurriculum(isEnt, "ENT"),
      namedFromCurriculum(isOphtha, "Ophthalmology"),
    ]);
  }
  return unique(list);
}

function subjectsForYear(
  year: Year,
  showAllSubjects: boolean,
  entOphthaInFinalYear: boolean,
  customExamSubjects: ExamSubjectMap
) {
  if (showAllSubjects) return allCurriculumSubjects();
  const custom = customExamSubjects[year] || [];
  if (custom.length) return unique(custom);
  return applyEntOphthaShift(year, CURRICULUM[year] || [], entOphthaInFinalYear);
}

export function normalizeExamMap(map: ExamSubjectMap): ExamSubjectMap {
  const taken = new Set<string>();
  const next = emptyExamMap();
  YEARS.forEach((year) => {
    next[year] = unique(map[year] || []).filter((s) => !taken.has(s));
    next[year].forEach((s) => taken.add(s));
  });
  return next;
}

type Settings = {
  year: Year;
  subject: string;
  showAllSubjects: boolean;
  examDate: string;
  firstName: string;
  lastName: string;
  name: string;
  birthday: string;
  age: string;
  joiningYear: string;
  photo: string;
  entOphthaInFinalYear: boolean;
  customExamSubjects: ExamSubjectMap;
  covered: string[];
  setYear: (y: Year) => void;
  setSubject: (s: string) => void;
  setShowAllSubjects: (v: boolean) => void;
  setExamDate: (d: string) => void;
  setFirstName: (n: string) => void;
  setLastName: (n: string) => void;
  setBirthday: (d: string) => void;
  setJoiningYear: (y: string) => void;
  setPhoto: (p: string) => void;
  saveProfile: (next: {
    firstName: string;
    lastName: string;
    birthday: string;
    joiningYear: string;
    year: Year;
    photo: string;
  }) => void;
  saveAcademics: (next: { examDate: string; entOphthaInFinalYear: boolean }) => void;
  saveExamSubjects: (next: ExamSubjectMap) => void;
  toggleCovered: (subject: string, topic: string) => void;
  availableSubjects: string[];
  yearSubjects: string[];
  allSubjects: string[];
};

const SettingsContext = createContext<Settings | null>(null);

function persist(
  year: Year,
  examDate: string,
  subject: string,
  showAllSubjects: boolean,
  firstName: string,
  lastName: string,
  birthday: string,
  age: string,
  joiningYear: string,
  photo: string,
  entOphthaInFinalYear: boolean,
  customExamSubjects: ExamSubjectMap
) {
  try {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        year,
        examDate,
        subject,
        showAllSubjects,
        firstName,
        lastName,
        birthday,
        age,
        joiningYear,
        photo,
        entOphthaInFinalYear,
        customExamSubjects,
      })
    );
    window.localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({
        year: YEAR_TO_PROFILE[year],
        examDate,
        firstName,
        lastName,
        name: [firstName, lastName].filter(Boolean).join(" "),
        birthday,
        age,
        joiningYear,
        photo,
      })
    );
  } catch {
    /* storage blocked or photo too large — app still works until refresh */
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [year, setYearState] = useState<Year>("2nd MBBS");
  const [subject, setSubjectState] = useState<string>(ALL);
  const [showAllSubjects, setShowAllSubjectsState] = useState(false);
  const [examDate, setExamDateState] = useState("2027-03-15");
  const [firstName, setFirstNameState] = useState("");
  const [lastName, setLastNameState] = useState("");
  const [birthday, setBirthdayState] = useState("");
  const [age, setAgeState] = useState("");
  const [joiningYear, setJoiningYearState] = useState("");
  const [photo, setPhotoState] = useState("");
  const [entOphthaInFinalYear, setEntOphthaInFinalYearState] = useState(false);
  const [customExamSubjects, setCustomExamSubjectsState] = useState<ExamSubjectMap>(emptyExamMap);
  const [covered, setCovered] = useState<string[]>(INITIAL_COVERED);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      const profileRaw = window.localStorage.getItem(PROFILE_KEY);
      const profile = profileRaw ? JSON.parse(profileRaw) : null;
      const src = saved || profile || {};

      if (src.year && YEAR_TO_PROFILE[src.year as Year]) setYearState(src.year);
      else if (src.year && PROFILE_TO_YEAR[String(src.year)]) {
        setYearState(PROFILE_TO_YEAR[String(src.year)]);
      }
      if (typeof src.examDate === "string" && src.examDate) setExamDateState(src.examDate);
      if (typeof src.subject === "string" && src.subject) setSubjectState(src.subject);
      if (typeof src.showAllSubjects === "boolean") setShowAllSubjectsState(src.showAllSubjects);

      if (typeof src.firstName === "string" || typeof src.lastName === "string") {
        setFirstNameState(typeof src.firstName === "string" ? src.firstName : "");
        setLastNameState(typeof src.lastName === "string" ? src.lastName : "");
      } else if (typeof src.name === "string" && src.name) {
        const parts = splitName(src.name);
        setFirstNameState(parts.firstName);
        setLastNameState(parts.lastName);
      }

      if (typeof src.birthday === "string") {
        setBirthdayState(src.birthday);
        setAgeState(ageFromBirthday(src.birthday) || (typeof src.age === "string" ? src.age : ""));
      } else if (typeof src.age === "string") {
        setAgeState(src.age);
      }
      if (typeof src.joiningYear === "string") setJoiningYearState(src.joiningYear);
      if (typeof src.photo === "string") setPhotoState(src.photo);
      if (typeof src.entOphthaInFinalYear === "boolean") {
        setEntOphthaInFinalYearState(src.entOphthaInFinalYear);
      }
      if (src.customExamSubjects && typeof src.customExamSubjects === "object") {
        setCustomExamSubjectsState(normalizeExamMap({ ...emptyExamMap(), ...src.customExamSubjects }));
      }
    } catch {
      /* keep defaults */
    }
  }, []);

  const yearSubjects = subjectsForYear(year, showAllSubjects, entOphthaInFinalYear, customExamSubjects);
  const availableSubjects = [ALL, ...yearSubjects];
  const allSubjects = allCurriculumSubjects();
  const name = [firstName, lastName].filter(Boolean).join(" ");

  function setYear(y: Year) {
    setYearState(y);
    setSubjectState(ALL);
    persist(
      y,
      examDate,
      ALL,
      showAllSubjects,
      firstName,
      lastName,
      birthday,
      age,
      joiningYear,
      photo,
      entOphthaInFinalYear,
      customExamSubjects
    );
  }

  function setSubject(s: string) {
    setSubjectState(s);
    persist(
      year,
      examDate,
      s,
      showAllSubjects,
      firstName,
      lastName,
      birthday,
      age,
      joiningYear,
      photo,
      entOphthaInFinalYear,
      customExamSubjects
    );
  }

  function setShowAllSubjects(v: boolean) {
    setShowAllSubjectsState(v);
    persist(
      year,
      examDate,
      subject,
      v,
      firstName,
      lastName,
      birthday,
      age,
      joiningYear,
      photo,
      entOphthaInFinalYear,
      customExamSubjects
    );
  }

  function setExamDate(d: string) {
    setExamDateState(d);
    persist(
      year,
      d,
      subject,
      showAllSubjects,
      firstName,
      lastName,
      birthday,
      age,
      joiningYear,
      photo,
      entOphthaInFinalYear,
      customExamSubjects
    );
  }

  function setFirstName(n: string) {
    setFirstNameState(n);
    persist(
      year,
      examDate,
      subject,
      showAllSubjects,
      n,
      lastName,
      birthday,
      age,
      joiningYear,
      photo,
      entOphthaInFinalYear,
      customExamSubjects
    );
  }

  function setLastName(n: string) {
    setLastNameState(n);
    persist(
      year,
      examDate,
      subject,
      showAllSubjects,
      firstName,
      n,
      birthday,
      age,
      joiningYear,
      photo,
      entOphthaInFinalYear,
      customExamSubjects
    );
  }

  function setBirthday(d: string) {
    const nextAge = ageFromBirthday(d);
    setBirthdayState(d);
    setAgeState(nextAge);
    persist(
      year,
      examDate,
      subject,
      showAllSubjects,
      firstName,
      lastName,
      d,
      nextAge,
      joiningYear,
      photo,
      entOphthaInFinalYear,
      customExamSubjects
    );
  }

  function setJoiningYear(y: string) {
    setJoiningYearState(y);
    persist(
      year,
      examDate,
      subject,
      showAllSubjects,
      firstName,
      lastName,
      birthday,
      age,
      y,
      photo,
      entOphthaInFinalYear,
      customExamSubjects
    );
  }

  function setPhoto(p: string) {
    setPhotoState(p);
    persist(
      year,
      examDate,
      subject,
      showAllSubjects,
      firstName,
      lastName,
      birthday,
      age,
      joiningYear,
      p,
      entOphthaInFinalYear,
      customExamSubjects
    );
  }

  function saveProfile(next: {
    firstName: string;
    lastName: string;
    birthday: string;
    joiningYear: string;
    year: Year;
    photo: string;
  }) {
    const nextAge = ageFromBirthday(next.birthday);
    const yearChanged = next.year !== year;
    setFirstNameState(next.firstName);
    setLastNameState(next.lastName);
    setBirthdayState(next.birthday);
    setAgeState(nextAge);
    setJoiningYearState(next.joiningYear);
    setPhotoState(next.photo);
    setYearState(next.year);
    if (yearChanged) setSubjectState(ALL);
    persist(
      next.year,
      examDate,
      yearChanged ? ALL : subject,
      showAllSubjects,
      next.firstName,
      next.lastName,
      next.birthday,
      nextAge,
      next.joiningYear,
      next.photo,
      entOphthaInFinalYear,
      customExamSubjects
    );
  }

  function saveAcademics(next: { examDate: string; entOphthaInFinalYear: boolean }) {
    setExamDateState(next.examDate);
    setEntOphthaInFinalYearState(next.entOphthaInFinalYear);
    persist(
      year,
      next.examDate,
      subject,
      showAllSubjects,
      firstName,
      lastName,
      birthday,
      age,
      joiningYear,
      photo,
      next.entOphthaInFinalYear,
      customExamSubjects
    );
  }

  function saveExamSubjects(next: ExamSubjectMap) {
    const cleaned = normalizeExamMap(next);
    setCustomExamSubjectsState(cleaned);
    persist(
      year,
      examDate,
      subject,
      showAllSubjects,
      firstName,
      lastName,
      birthday,
      age,
      joiningYear,
      photo,
      entOphthaInFinalYear,
      cleaned
    );
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
        firstName,
        lastName,
        name,
        birthday,
        age,
        joiningYear,
        photo,
        entOphthaInFinalYear,
        customExamSubjects,
        covered,
        setYear,
        setSubject,
        setShowAllSubjects,
        setExamDate,
        setFirstName,
        setLastName,
        setBirthday,
        setJoiningYear,
        setPhoto,
        saveProfile,
        saveAcademics,
        saveExamSubjects,
        toggleCovered,
        availableSubjects,
        yearSubjects,
        allSubjects,
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
