"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { YEARS, type Year } from "../../../data/universities/ntruhs/curriculum";
import {
  emptyExamMap,
  normalizeExamMap,
  useSettings,
  type ExamSubjectMap,
} from "../../../store/settings";

const EMPTY_DRAFT: Record<Year, string> = {
  "1st MBBS": "",
  "2nd MBBS": "",
  "3rd MBBS Part 1": "",
  "3rd MBBS Part 2": "",
};

export default function ExamSubjectsPage() {
  const settings = useSettings();
  const [map, setMap] = useState<ExamSubjectMap>(settings.customExamSubjects);
  const [draft, setDraft] = useState<Record<Year, string>>(EMPTY_DRAFT);
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    setMap(settings.customExamSubjects);
  }, [settings.customExamSubjects]);

  const dirty = JSON.stringify(map) !== JSON.stringify(settings.customExamSubjects);

  const takenBefore = useMemo(() => {
    const acc: Record<Year, Set<string>> = {
      "1st MBBS": new Set(),
      "2nd MBBS": new Set(),
      "3rd MBBS Part 1": new Set(),
      "3rd MBBS Part 2": new Set(),
    };
    const seen = new Set<string>();
    YEARS.forEach((year) => {
      acc[year] = new Set(seen);
      (map[year] || []).forEach((s) => seen.add(s));
    });
    return acc;
  }, [map]);

  function add(year: Year) {
    const subject = (draft[year] || "").trim();
    if (!subject) return;
    if (takenBefore[year].has(subject)) return;
    if ((map[year] || []).includes(subject)) return;
    const next = emptyExamMap();
    YEARS.forEach((y) => {
      next[y] = [...(map[y] || [])];
    });
    next[year] = [...next[year], subject];
    YEARS.forEach((y) => {
      if (YEARS.indexOf(y) > YEARS.indexOf(year)) {
        next[y] = next[y].filter((s) => s !== subject);
      }
    });
    setMap(normalizeExamMap(next));
    setDraft((prev) => ({ ...prev, [year]: "" }));
  }

  function remove(year: Year, subject: string) {
    setMap((prev) =>
      normalizeExamMap({
        ...prev,
        [year]: (prev[year] || []).filter((s) => s !== subject),
      })
    );
  }

  function resetYear(year: Year) {
    setMap((prev) => normalizeExamMap({ ...prev, [year]: [] }));
  }

  function save() {
    settings.saveExamSubjects(map);
    setSavedAt(Date.now());
  }

  return (
    <div className="space-y-6 pb-24">
      <section>
        <Link href="/settings/academics" className="text-sm text-slate-400 hover:text-teal-300">
          ← Academics
        </Link>
        <h2 className="mt-3 text-2xl font-bold tracking-tight">Exam subjects</h2>
      </section>

      {YEARS.map((year) => {
        const selected = map[year] || [];
        const options = settings.allSubjects.filter(
          (s) => !takenBefore[year].has(s) && !selected.includes(s)
        );
        return (
          <section key={year} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-200">{year}</h3>
              {selected.length ? (
                <button
                  type="button"
                  onClick={() => resetYear(year)}
                  className="text-xs text-slate-400 hover:text-teal-300"
                >
                  Use default
                </button>
              ) : null}
            </div>

            <div className="mt-4 flex gap-2">
              <select
                value={draft[year] ?? ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, [year]: e.target.value }))}
                className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-teal-500/50"
              >
                <option value="">Subject</option>
                {options.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => add(year)}
                disabled={!draft[year]}
                className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:text-slate-600"
              >
                Add
              </button>
            </div>

            {selected.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {selected.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => remove(year, s)}
                    className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-300"
                  >
                    {s} ×
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">Default curriculum</p>
            )}
          </section>
        );
      })}

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-slate-800 bg-slate-950/95 py-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty}
          className="rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          Save changes
        </button>
        {savedAt > 0 && !dirty ? <span className="text-sm text-teal-300">Saved</span> : null}
        {dirty ? <span className="text-sm text-slate-500">Unsaved</span> : null}
      </div>
    </div>
  );
}
