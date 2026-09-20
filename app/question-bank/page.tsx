"use client";

import { useMemo, useState } from "react";
import { allQuestions, type Question, type QuestionType } from "@/app/data/questions";

const TYPE_STYLES: Record<
  QuestionType,
  { label: string; short: string; bar: string; chip: string }
> = {
  essay: {
    label: "Essay · 10",
    short: "Essay",
    bar: "bg-red-500",
    chip: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30",
  },
  "short-note": {
    label: "Short Note · 5",
    short: "Short Note",
    bar: "bg-blue-500",
    chip: "bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30",
  },
  "very-short": {
    label: "Very Short · 2",
    short: "Very Short",
    bar: "bg-emerald-500",
    chip: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
  },
};

const TYPE_ORDER: QuestionType[] = ["essay", "short-note", "very-short"];

export default function QuestionBankPage() {
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<QuestionType | "all">("all");
  const [activeTopic, setActiveTopic] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const questions = useMemo(
    () => allQuestions.filter((q) => q.subject === "Pharmacology"),
    []
  );

  const topics = useMemo(
    () => Array.from(new Set(questions.map((q) => q.topic))).sort(),
    [questions]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return questions
      .filter((q) => activeType === "all" || q.type === activeType)
      .filter((q) => activeTopic === "all" || q.topic === activeTopic)
      .filter((q) => {
        if (!term) return true;
        return (
          q.question.toLowerCase().includes(term) ||
          q.topic.toLowerCase().includes(term) ||
          q.subtopic.toLowerCase().includes(term) ||
          q.keywords.some((k) => k.toLowerCase().includes(term))
        );
      })
      .sort(
        (a, b) =>
          TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
          a.topic.localeCompare(b.topic)
      );
  }, [questions, search, activeType, activeTopic]);

  const counts = useMemo(
    () => ({
      essay: questions.filter((q) => q.type === "essay").length,
      "short-note": questions.filter((q) => q.type === "short-note").length,
      "very-short": questions.filter((q) => q.type === "very-short").length,
    }),
    [questions]
  );

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">Pharmacology</h1>
        <p className="text-sm text-slate-400">
          {questions.length} questions · MBBS Year 2 · NTRUHS
        </p>
      </header>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search questions, topics, or keywords…"
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5
                     text-sm text-slate-100 placeholder:text-slate-500
                     outline-none focus:border-slate-500"
        />

        <select
          value={activeTopic}
          onChange={(e) => setActiveTopic(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5
                     text-sm text-slate-200 outline-none focus:border-slate-500 sm:w-64"
        >
          <option value="all">All topics</option>
          {topics.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <FilterChip
          active={activeType === "all"}
          onClick={() => setActiveType("all")}
          label={`All · ${questions.length}`}
        />
        {TYPE_ORDER.map((t) => (
          <FilterChip
            key={t}
            active={activeType === t}
            onClick={() => setActiveType(t)}
            label={`${TYPE_STYLES[t].short} · ${counts[t]}`}
          />
        ))}
      </div>

      <p className="mb-3 text-xs text-slate-500">
        Showing {filtered.length} of {questions.length}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-700 py-12 text-center text-sm text-slate-500">
          No questions match those filters.
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              isOpen={openId === q.id}
              onToggle={() => setOpenId(openId === q.id ? null : q.id)}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-slate-100 text-slate-900"
          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
      }`}
    >
      {label}
    </button>
  );
}

function QuestionCard({
  question,
  isOpen,
  onToggle,
}: {
  question: Question;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const style = TYPE_STYLES[question.type];

  return (
    <li className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 transition hover:border-slate-700">
      <span className={`absolute left-0 top-0 h-full w-[3px] ${style.bar}`} />

      <div className="p-4 pl-5">
        <button onClick={onToggle} className="w-full text-left">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${style.chip}`}>
              {style.label}
            </span>
            <span className="text-[11px] text-slate-500">{question.topic}</span>
            <span className="text-[11px] text-slate-600">·</span>
            <span className="text-[11px] text-slate-500">{question.subtopic}</span>
            {question.needsDiagram && (
              <span className="rounded bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-300 ring-1 ring-violet-500/30">
                Diagram
              </span>
            )}
          </div>

          <p className="text-sm font-medium leading-relaxed text-slate-100">
            {question.question}
          </p>

          <span className="mt-3 inline-block text-[11px] font-medium text-slate-400">
            {isOpen ? "Hide answer guide ▲" : "Answer guide ▼"}
          </span>
        </button>

        {isOpen && (
          <div className="mt-3 border-t border-slate-800 pt-3">
            {question.textbookRef ? (
              <div className="inline-flex flex-wrap items-center gap-2 rounded-lg bg-slate-800/70 px-3 py-2 text-[12px] text-slate-300">
                <span className="font-semibold text-slate-100">
                  {question.textbookRef.book} {question.textbookRef.edition}
                </span>
                <span className="text-slate-500">·</span>
                <span>{question.textbookRef.chapter}</span>
                <span className="text-slate-500">·</span>
                <span className="font-medium text-slate-100">
                  p. {question.textbookRef.page}
                </span>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Textbook reference not added yet.
              </p>
            )}

            {question.answer && (
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                {question.answer}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-1.5">
              {question.keywords.map((k) => (
                <span
                  key={k}
                  className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400"
                >
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
