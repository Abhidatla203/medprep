"use client";

import SubjectBadge from "./components/SubjectBadge";
import QuestionOfTheDay from "./components/QuestionOfTheDay";
import RecommendedTest from "./components/RecommendedTest";
import Circulars from "./components/Circulars";
import { useSettings, ALL } from "./store/settings";

const STATS = [
  { label: "Questions covered", value: "0" },
  { label: "Accuracy", value: "—" },
  { label: "Attendance", value: "—" },
  { label: "Study streak", value: "0 days" },
];

export default function Home() {
  const { subject, examDate, year, yearSubjects, setSubject } = useSettings();

  const viewingAll = subject === ALL;

  const daysLeft = Math.ceil(
    (new Date(examDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Good evening, Abhi
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            {daysLeft} days to your{" "}
            {viewingAll ? `${year} examinations` : `${subject} examination`}.
          </p>
        </div>

        <div className="shrink-0">
          <SubjectBadge />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"
          >
            <p className="text-2xl font-semibold text-teal-400">{stat.value}</p>
            <p className="mt-1 text-xs text-slate-500">
              {stat.label}
              {viewingAll && (
                <span className="ml-1 text-slate-600">· all subjects</span>
              )}
            </p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
          Focus Today
        </h2>

        <div className="grid gap-4 md:grid-cols-2">
          <QuestionOfTheDay />
          <RecommendedTest />
        </div>
      </section>

      <Circulars />

      {viewingAll && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
            Subject Overview
          </h2>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {yearSubjects.map((s) => (
              <button
                key={s}
                onClick={() => setSubject(s)}
                className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-left transition hover:border-teal-500/50 hover:bg-slate-900"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-200">
                    {s}
                  </span>
                  <span className="text-xs text-slate-600">→</span>
                </div>

                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-teal-500"
                    style={{ width: "0%" }}
                  />
                </div>

                <div className="mt-2.5 flex gap-4 text-[11px] text-slate-500">
                  <span>0 questions covered</span>
                  <span>Attendance —</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
