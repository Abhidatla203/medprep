"use client";

import { useSettings, ALL } from "../store/settings";

type MockTest = {
  id: string;
  subject: string;
  topic: string;
  title: string;
  questionCount: number;
  minutes: number;
};

const MOCK_TESTS: MockTest[] = [
  {
    id: "pharm-ans",
    subject: "Pharmacology",
    topic: "ANS & Autacoids",
    title: "ANS & Autacoids Blitz",
    questionCount: 20,
    minutes: 20,
  },
  {
    id: "pharm-chemo",
    subject: "Pharmacology",
    topic: "Chemotherapy",
    title: "Antimicrobials Rapid Round",
    questionCount: 25,
    minutes: 25,
  },
  {
    id: "pharm-cvs",
    subject: "Pharmacology",
    topic: "CVS & Renal",
    title: "Cardiovascular Drugs Drill",
    questionCount: 20,
    minutes: 20,
  },
  {
    id: "path-haem",
    subject: "Pathology",
    topic: "Haematology",
    title: "Haematology Blitz",
    questionCount: 20,
    minutes: 20,
  },
  {
    id: "path-general",
    subject: "Pathology",
    topic: "General Pathology",
    title: "Inflammation & Neoplasia",
    questionCount: 25,
    minutes: 25,
  },
  {
    id: "micro-bact",
    subject: "Microbiology",
    topic: "Bacteriology",
    title: "Systematic Bacteriology Blitz",
    questionCount: 20,
    minutes: 20,
  },
  {
    id: "micro-viro",
    subject: "Microbiology",
    topic: "Virology",
    title: "Virology Rapid Round",
    questionCount: 20,
    minutes: 20,
  },
];

function dayIndex() {
  return Math.floor(Date.now() / 86_400_000);
}

function dailyRoll(salt: number) {
  const x = Math.sin(dayIndex() + salt) * 10_000;
  return x - Math.floor(x);
}

const AHEAD_CHANCE = 0.15;

export default function RecommendedTest() {
  const { subject, year, yearSubjects, covered } = useSettings();

  const viewingAll = subject === ALL;

  const pool = viewingAll
    ? MOCK_TESTS.filter((t) => yearSubjects.includes(t.subject))
    : MOCK_TESTS.filter((t) => t.subject === subject);

  if (pool.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
        No mock tests for {subject} yet.
      </div>
    );
  }

  const done = pool.filter((t) => covered.includes(`${t.subject}::${t.topic}`));
  const ahead = pool.filter((t) => !covered.includes(`${t.subject}::${t.topic}`));

  const wantAhead = dailyRoll(7) < AHEAD_CHANCE;
  const useAhead = (wantAhead && ahead.length > 0) || done.length === 0;
  const chosen = useAhead && ahead.length > 0 ? ahead : done;
  const isAhead = useAhead && ahead.length > 0;

  const test = chosen[dayIndex() % chosen.length];

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-teal-500/30 bg-gradient-to-br from-teal-500/10 to-slate-900/50 p-5">
      <div>
        <div className="flex items-center justify-between">
          {isAhead ? (
            <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-[11px] font-medium text-violet-300">
              Study Ahead
            </span>
          ) : (
            <span className="rounded-full bg-teal-500/15 px-2.5 py-1 text-[11px] font-medium text-teal-300">
              Recommended
            </span>
          )}
          <span className="text-[11px] text-slate-500">
            {viewingAll ? `${year} mixed` : test.subject}
          </span>
        </div>

        <h3 className="mt-3 text-lg font-semibold text-slate-100">
          {test.title}
        </h3>
        <p className="mt-1.5 text-sm text-slate-400">
          {test.questionCount} MCQs · {test.minutes} minutes · {test.topic}
        </p>

        {isAhead && (
          <p className="mt-2 text-[11px] text-violet-400/80">
            Not covered yet — a preview of what&apos;s coming.
          </p>
        )}

        <div className="mt-4 flex gap-5 text-xs text-slate-500">
          <span>Last score: —</span>
          <span>Attempts: 0</span>
        </div>
      </div>

      <button className="mt-5 w-full rounded-xl bg-teal-500 py-3 text-sm font-semibold text-slate-950 transition hover:bg-teal-400">
        Start Mock Test
      </button>
    </div>
  );
}
