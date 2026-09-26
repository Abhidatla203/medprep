"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DateField from "@/components/attendance/DateField";
import { useSettings } from "../../store/settings";

export default function AcademicsSettingsPage() {
  const settings = useSettings();
  const [examDate, setExamDate] = useState(settings.examDate);
  const [entOphthaInFinalYear, setEntOphthaInFinalYear] = useState(settings.entOphthaInFinalYear);
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    setExamDate(settings.examDate);
    setEntOphthaInFinalYear(settings.entOphthaInFinalYear);
  }, [settings.examDate, settings.entOphthaInFinalYear]);

  const dirty =
    examDate !== settings.examDate || entOphthaInFinalYear !== settings.entOphthaInFinalYear;

  function save() {
    settings.saveAcademics({ examDate, entOphthaInFinalYear });
    setSavedAt(Date.now());
  }

  return (
    <div className="space-y-6 pb-24">
      <section>
        <h2 className="text-2xl font-bold tracking-tight">Academics</h2>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:max-w-md">
        <h3 className="mb-4 text-sm font-semibold text-slate-200">Exam date</h3>
        <DateField label="Professional exam" value={examDate} onChange={setExamDate} />
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-semibold text-slate-200">
            ENT &amp; Ophthalmology in 3rd MBBS Part 2
          </h3>
          <button
            type="button"
            role="switch"
            aria-checked={entOphthaInFinalYear}
            onClick={() => setEntOphthaInFinalYear((v) => !v)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${
              entOphthaInFinalYear ? "bg-teal-500" : "bg-slate-700"
            }`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${
                entOphthaInFinalYear ? "left-5" : "left-0.5"
              }`}
            />
          </button>
        </div>
      </section>

      <Link
        href="/settings/academics/subjects"
        className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/40 p-5 transition hover:border-teal-500/40"
      >
        <h3 className="text-sm font-semibold text-slate-200">Exam subjects</h3>
        <span className="text-slate-500">→</span>
      </Link>

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
