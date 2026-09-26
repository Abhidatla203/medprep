"use client";

// =============================================================================
// app/store/settings.tsx
// -----------------------------------------------------------------------------
// The settings store. Profile, academics, exam subjects, and the year/subject
// selection every other screen reads from.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ ONE STATE OBJECT, NOT TWELVE. Why this was restructured.
// ═════════════════════════════════════════════════════════════════════════════
// This file used to hold twelve separate useState calls. That forced persist()
// to take twelve POSITIONAL arguments, and every one of the twelve setters had
// to pass all twelve in exactly the right order:
//
//     persist(year, examDate, subject, showAllSubjects, firstName, lastName,
//             birthday, age, joiningYear, photo, entOphthaInFinalYear,
//             customExamSubjects);
//
// 144 positional arguments across the file. Swap any two of the same type —
// firstName and lastName, birthday and joiningYear — and the app keeps running
// while quietly writing the wrong value to storage. Nothing would catch it: not
// TypeScript, not the linter, not a test. You would find out weeks later when
// your surname appeared as your first name.
//
// Now there is ONE state object and ONE commit function taking a PATCH:
//
//     commit({ firstName: n });
//
// Named, partial, impossible to mis-order, and adding a thirteenth field means
// editing two places instead of thirteen.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ LOADING HAPPENS DURING RENDER, NOT IN AN EFFECT.
// ═════════════════════════════════════════════════════════════════════════════
// The old code loaded saved data in a useEffect. Effects run AFTER the first
// paint, so every single page load went:
//
//     paint #1 — defaults: "2nd MBBS", no name, exam date 2027-03-15
//     paint #2 — your actual data
//
// That is the flicker on app open. It is not a slow computer; it is the
// architecture. React 19's react-hooks/set-state-in-effect rule flags it.
//
// The fix has two parts:
//
//   1. useSyncExternalStore tells us whether we are on the client. It returns
//      false during the server render AND the hydration render — so both
//      produce identical markup and there is no hydration mismatch — then true
//      immediately afterwards.
//
//   2. On that first true render we call setState DURING RENDER. React allows
//      this explicitly: it discards the in-progress render and re-runs the
//      component with the new state BEFORE anything reaches the screen.
//
// Net result: your real data is in the very first paint the user sees.
//
// ⚠ localStorage must never be touched during the server render or the
//   hydration render. The isClient gate is the only thing preventing that.
//   Do not remove it.
// ═════════════════════════════════════════════════════════════════════════════

import { createContext, useContext, useState, useSyncExternalStore } from "react";
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

/**
 * The legacy profile format stored the year as "1".."4". Both directions are
 * kept because PROFILE_KEY is still written for anything that reads it, and
 * old installs may still hold only that format.
 */
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


// -----------------------------------------------------------------------------
// Pure helpers — no React, no storage
// -----------------------------------------------------------------------------

export function ageFromBirthday(iso: string) {
  if (!iso) return "";
  const born = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(born.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();
  const monthDiff = today.getMonth() - born.getMonth();
  // Birthday not yet reached this year.
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

/**
 * ENT and Ophthalmology appear under many spellings across curricula.
 * Matching loosely is deliberate: a missed match silently drops a subject from
 * a student's exam list, which is far worse than a rare false positive.
 */
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

/** The curriculum's own wording for a subject, or a sensible fallback. */
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

/**
 * Some colleges examine ENT and Ophthalmology in Part 2 rather than Part 1.
 * When that toggle is on, both move: removed from Part 1, added to Part 2.
 */
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

/**
 * A subject may be examined in ONE year only. Earlier years win, so adding a
 * subject to Part 1 removes it from Part 2 rather than producing a duplicate
 * that would be counted twice.
 */
export function normalizeExamMap(map: ExamSubjectMap): ExamSubjectMap {
  const taken = new Set<string>();
  const next = emptyExamMap();
  YEARS.forEach((year) => {
    next[year] = unique(map[year] || []).filter((s) => !taken.has(s));
    next[year].forEach((s) => taken.add(s));
  });
  return next;
}


// -----------------------------------------------------------------------------
// The stored shape
// -----------------------------------------------------------------------------

/**
 * Everything that is persisted. `covered` is deliberately NOT here — it is
 * session-only and resets on reload, exactly as before.
 */
type StoredState = {
  year: Year;
  subject: string;
  showAllSubjects: boolean;
  examDate: string;
  firstName: string;
  lastName: string;
  birthday: string;
  age: string;
  joiningYear: string;
  photo: string;
  entOphthaInFinalYear: boolean;
  customExamSubjects: ExamSubjectMap;
};

/**
 * ⚠ A FUNCTION, not a constant. customExamSubjects is a mutable object; a
 *   shared constant would let one provider's edits leak into the defaults for
 *   the next one.
 */
function defaultState(): StoredState {
  return {
    year: "2nd MBBS",
    subject: ALL,
    showAllSubjects: false,
    examDate: "2027-03-15",
    firstName: "",
    lastName: "",
    birthday: "",
    age: "",
    joiningYear: "",
    photo: "",
    entOphthaInFinalYear: false,
    customExamSubjects: emptyExamMap(),
  };
}


// -----------------------------------------------------------------------------
// Storage
// -----------------------------------------------------------------------------

/**
 * Read saved settings, falling back through every format this app has used.
 *
 * ⚠ CLIENT ONLY. Guarded by the isClient gate in the provider.
 *
 * Each field is checked independently and on its own terms. A corrupt or
 * missing field must cost you that field alone, never the whole profile —
 * which is why this is a pile of narrow ifs rather than one object spread.
 */
function loadStored(): StoredState {
  const base = defaultState();

  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : null;

    const profileRaw = window.localStorage.getItem(PROFILE_KEY);
    const profile = profileRaw ? JSON.parse(profileRaw) : null;

    // Prefer the full settings record; fall back to the older profile-only one.
    const src = saved || profile || {};

    // ---- Year. Accept both the current names and the legacy "1".."4". ----
    if (src.year && YEAR_TO_PROFILE[src.year as Year]) {
      base.year = src.year as Year;
    } else if (src.year && PROFILE_TO_YEAR[String(src.year)]) {
      base.year = PROFILE_TO_YEAR[String(src.year)];
    }

    if (typeof src.examDate === "string" && src.examDate) base.examDate = src.examDate;
    if (typeof src.subject === "string" && src.subject) base.subject = src.subject;
    if (typeof src.showAllSubjects === "boolean") base.showAllSubjects = src.showAllSubjects;

    // ---- Name. Older versions stored a single joined string. ----
    if (typeof src.firstName === "string" || typeof src.lastName === "string") {
      base.firstName = typeof src.firstName === "string" ? src.firstName : "";
      base.lastName = typeof src.lastName === "string" ? src.lastName : "";
    } else if (typeof src.name === "string" && src.name) {
      const parts = splitName(src.name);
      base.firstName = parts.firstName;
      base.lastName = parts.lastName;
    }

    // ---- Birthday and age. Recomputed when possible, since a stored age
    //      goes stale the day after it was written. ----
    if (typeof src.birthday === "string") {
      base.birthday = src.birthday;
      base.age =
        ageFromBirthday(src.birthday) || (typeof src.age === "string" ? src.age : "");
    } else if (typeof src.age === "string") {
      base.age = src.age;
    }

    if (typeof src.joiningYear === "string") base.joiningYear = src.joiningYear;
    if (typeof src.photo === "string") base.photo = src.photo;

    if (typeof src.entOphthaInFinalYear === "boolean") {
      base.entOphthaInFinalYear = src.entOphthaInFinalYear;
    }

    // Spread over an empty map first: an old save may be missing a year key
    // entirely, and normalizeExamMap expects all four to exist.
    if (src.customExamSubjects && typeof src.customExamSubjects === "object") {
      base.customExamSubjects = normalizeExamMap({
        ...emptyExamMap(),
        ...src.customExamSubjects,
      });
    }
  } catch {
    // Unparseable storage means defaults. Never throw here — a corrupt value
    // would otherwise white-screen every page, since this provider wraps the
    // whole app.
  }

  return base;
}

/**
 * Write both records.
 *
 * ⚠ Takes the WHOLE state object. This is the change that removed twelve
 *   positional arguments and, with them, the possibility of writing a value
 *   into the wrong field.
 *
 * PROFILE_KEY is a projection of the same data in the legacy shape, kept in
 * step so anything still reading it stays correct.
 */
function persist(s: StoredState) {
  try {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        year: s.year,
        examDate: s.examDate,
        subject: s.subject,
        showAllSubjects: s.showAllSubjects,
        firstName: s.firstName,
        lastName: s.lastName,
        birthday: s.birthday,
        age: s.age,
        joiningYear: s.joiningYear,
        photo: s.photo,
        entOphthaInFinalYear: s.entOphthaInFinalYear,
        customExamSubjects: s.customExamSubjects,
      })
    );

    window.localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({
        year: YEAR_TO_PROFILE[s.year],
        examDate: s.examDate,
        firstName: s.firstName,
        lastName: s.lastName,
        name: [s.firstName, s.lastName].filter(Boolean).join(" "),
        birthday: s.birthday,
        age: s.age,
        joiningYear: s.joiningYear,
        photo: s.photo,
      })
    );
  } catch {
    // Storage blocked, or the photo pushed us past the quota. The app keeps
    // working from memory until refresh. Silent by design: a toast here would
    // fire on every keystroke in a name field.
  }
}


// -----------------------------------------------------------------------------
// Context
// -----------------------------------------------------------------------------

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


// -----------------------------------------------------------------------------
// The client-detection store
//
// ⚠ Module level, and deliberately trivial. This "store" has exactly two
//   states — rendering on the server, rendering on the client — and once
//   mounted it can never change again, so subscribe has nothing to do.
//   Defining these inside the component would hand React a new function every
//   render and cause a resubscribe each time.
// -----------------------------------------------------------------------------

const subscribeToNothing = (): (() => void) => () => {};
const getIsClient = (): boolean => true;
const getIsServer = (): boolean => false;


// -----------------------------------------------------------------------------
// Provider
// -----------------------------------------------------------------------------

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  // False on the server AND during hydration, so both render identical markup.
  const isClient = useSyncExternalStore(subscribeToNothing, getIsClient, getIsServer);

  const [state, setState] = useState<StoredState>(defaultState);
  const [hydrated, setHydrated] = useState(false);

  // ★ THE LOAD. During render, on purpose — React discards this pass and
  //   re-runs with the real data before anything is painted, so the defaults
  //   never appear on screen. This is what removed the flicker on app open.
  if (isClient && !hydrated) {
    setHydrated(true);
    setState(loadStored());
  }

  // `covered` is session-only and never persisted, exactly as before.
  const [covered, setCovered] = useState<string[]>(INITIAL_COVERED);

  /**
   * The single write path. Merge a patch, store it, persist it.
   *
   * ⚠ EVERY mutation goes through here. Bypassing it updates the screen
   *   without updating storage, and the change vanishes on refresh — the
   *   hardest kind of bug to notice, because everything looks right until you
   *   close the tab.
   */
  function commit(patch: Partial<StoredState>) {
    const next = { ...state, ...patch };
    setState(next);
    persist(next);
  }

  // ---- Derived on every render. Cheap, and never stale. ----
  const yearSubjects = subjectsForYear(
    state.year,
    state.showAllSubjects,
    state.entOphthaInFinalYear,
    state.customExamSubjects
  );
  const availableSubjects = [ALL, ...yearSubjects];
  const allSubjects = allCurriculumSubjects();
  const name = [state.firstName, state.lastName].filter(Boolean).join(" ");

  // ---- Setters. Each one is now a single named patch. ----

  // ⚠ Changing year resets the subject: the previous subject almost certainly
  //   is not taught in the new year, and a dangling selection shows an empty
  //   subject view with no clue as to why.
  const setYear = (y: Year) => commit({ year: y, subject: ALL });

  const setSubject = (s: string) => commit({ subject: s });
  const setShowAllSubjects = (v: boolean) => commit({ showAllSubjects: v });
  const setExamDate = (d: string) => commit({ examDate: d });
  const setFirstName = (n: string) => commit({ firstName: n });
  const setLastName = (n: string) => commit({ lastName: n });
  const setJoiningYear = (y: string) => commit({ joiningYear: y });
  const setPhoto = (p: string) => commit({ photo: p });

  // Age is stored alongside the birthday so the legacy profile record stays
  // complete, but it is always RECOMPUTED, never taken from input.
  const setBirthday = (d: string) => commit({ birthday: d, age: ageFromBirthday(d) });

  function saveProfile(next: {
    firstName: string;
    lastName: string;
    birthday: string;
    joiningYear: string;
    year: Year;
    photo: string;
  }) {
    const yearChanged = next.year !== state.year;
    commit({
      firstName: next.firstName,
      lastName: next.lastName,
      birthday: next.birthday,
      age: ageFromBirthday(next.birthday),
      joiningYear: next.joiningYear,
      photo: next.photo,
      year: next.year,
      // Same reasoning as setYear — only reset if the year actually moved.
      ...(yearChanged ? { subject: ALL } : {}),
    });
  }

  function saveAcademics(next: { examDate: string; entOphthaInFinalYear: boolean }) {
    commit({
      examDate: next.examDate,
      entOphthaInFinalYear: next.entOphthaInFinalYear,
    });
  }

  function saveExamSubjects(next: ExamSubjectMap) {
    // Normalise on the way in, never on the way out, so storage can never hold
    // a subject duplicated across two years.
    commit({ customExamSubjects: normalizeExamMap(next) });
  }

  function toggleCovered(subj: string, topic: string) {
    const key = `${subj}::${topic}`;
    setCovered((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  return (
    <SettingsContext.Provider
      value={{
        year: state.year,
        subject: state.subject,
        showAllSubjects: state.showAllSubjects,
        examDate: state.examDate,
        firstName: state.firstName,
        lastName: state.lastName,
        name,
        birthday: state.birthday,
        age: state.age,
        joiningYear: state.joiningYear,
        photo: state.photo,
        entOphthaInFinalYear: state.entOphthaInFinalYear,
        customExamSubjects: state.customExamSubjects,
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
