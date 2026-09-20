"use client";

import { useMemo, useState } from "react";
import { allQuestions, type Question, type QuestionType } from "@/app/data/questions";

const TYPE_STYLES: Record<QuestionType, { label: string; card: string; chip: string }> = {
  essay: {
    label: "Essay · 10",
    card: "bg-amber-50 border-amber-200",
    chip: "bg-amber-100 text-amber-900",
  },
  "short-note": {
    label: "Short Note · 5",
    card: "bg-sky-50 border-sky-200",
    chip: "bg-sky-100 text-sky-900",
  },
  "very-short": {
    label: "Very Short · 2",
    card: "bg-emerald-50 border-emerald-200",
    chip: "bg-emerald-100 text-emerald-900",
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
        <h1 className="text-2xl font-semibold text-slate-900">Pharmacology</h1>
        <p className="text-sm text-slate-500">
          {questions.length} questions · MBBS Year 2 · NTRUHS
        </p>
      </header>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search questions, topics, or keywords…"
        className="mb-4 w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm
                   outline-none focus:border-slate-500"
      />

      <div className="mb-3 flex flex-wrap gap-2">
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
            label={`${TYPE_STYLES[t].label.split(" · ")[0]} · ${counts[t]}`}
          />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <FilterChip
          active={activeTopic === "all"}
          onClick={() => setActiveTopic("all")}
          label="All topics"
        />
        {topics.map((t) => (
          <FilterChip
            key={t}
            active={activeTopic === t}
            onClick={() => setActiveTopic(t)}
            label={t}
          />
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 py-12 text-center text-sm text-slate-500">
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
          ? "bg-slate-900 text-white"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
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
    <li className={`rounded-xl border p-4 transition ${style.card}`}>
      <button onClick={onToggle} className="w-full text-left">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${style.chip}`}>
            {style.label}
          </span>
          <span className="text-[11px] text-slate-500">{question.subtopic}</span>
          {question.needsDiagram && (
            <span className="rounded bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800">
              Diagram
            </span>
          )}
          {question.difficulty === "hard" && (
            <span className="rounded bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800">
              Hard
            </span>
          )}
        </div>

        <p className="text-sm font-medium leading-relaxed text-slate-900">
          {question.question}
        </p>
      </button>

      {isOpen && (
        <div className="mt-3 border-t border-black/5 pt-3">
          {question.parts.length > 0 && (
            <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-slate-700">
              {question.parts.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          )}

          <p className="text-sm leading-relaxed text-slate-700">
            {question.answer || "Answer not added yet."}
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {question.keywords.map((k) => (
              <span
                key={k}
                className="rounded bg-white/70 px-2 py-0.5 text-[11px] text-slate-600"
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}
