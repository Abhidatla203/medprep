"use client";

import { useState } from "react";
import { useSettings, ALL } from "../store/settings";

type DailyQuestion = {
  subject: string;
  topic: string;
  question: string;
  answer: string;
  rationale: string[];
};

const DAILY_QUESTIONS: DailyQuestion[] = [
  {
    subject: "Pharmacology",
    topic: "Endocrine",
    question:
      "A 28-year-old woman on treatment for hyperthyroidism develops fever and sore throat on day 12. Her WBC count is 1,800/mm³. Which drug is implicated, and what is the immediate next step?",
    answer: "Carbimazole-induced agranulocytosis.",
    rationale: [
      "Idiosyncratic reaction, usually within the first 3 months",
      "Stop the drug immediately — do not rechallenge",
      "Urgent CBC, start broad-spectrum antibiotics",
      "Definitive control with radioiodine or surgery",
    ],
  },
  {
    subject: "Pharmacology",
    topic: "ANS",
    question:
      "A farmer presents with pinpoint pupils, excessive salivation, fasciculations and bradycardia after spraying his field. What is the poisoning, and what two drugs form the mainstay of treatment?",
    answer: "Organophosphate poisoning — atropine and pralidoxime.",
    rationale: [
      "Irreversible acetylcholinesterase inhibition",
      "Atropine titrated to drying of secretions, not pupil size",
      "Pralidoxime reactivates the enzyme before ageing occurs",
      "Decontamination and airway protection come first",
    ],
  },
  {
    subject: "Pharmacology",
    topic: "CVS & Renal",
    question:
      "A patient on a loop diuretic develops muscle cramps, weakness and a U wave on ECG. What is the disturbance, and which co-prescribed drug becomes dangerous?",
    answer: "Hypokalaemia — digoxin toxicity is potentiated.",
    rationale: [
      "Loop diuretics increase distal potassium loss",
      "Low K⁺ increases digoxin binding to Na⁺/K⁺-ATPase",
      "Correct potassium before treating the arrhythmia",
      "Consider a potassium-sparing agent alongside",
    ],
  },
  {
    subject: "Pathology",
    topic: "Haematology",
    question:
      "A 45-year-old presents with fatigue. Peripheral smear shows hypersegmented neutrophils and macrocytes. MCV is 118 fL. What is the likely diagnosis and confirmatory test?",
    answer: "Megaloblastic anaemia — serum B12 and folate assay.",
    rationale: [
      "Hypersegmented neutrophils are the earliest morphological clue",
      "Impaired DNA synthesis causes nuclear-cytoplasmic asynchrony",
      "Look for pernicious anaemia — anti-intrinsic factor antibodies",
      "Treat B12 before folate to avoid subacute combined degeneration",
    ],
  },
  {
    subject: "Pathology",
    topic: "General Pathology",
    question:
      "A surgical specimen shows caseating granulomas with Langhans giant cells. Name the pattern of inflammation and the most likely aetiology in India.",
    answer: "Chronic granulomatous inflammation — tuberculosis.",
    rationale: [
      "Epithelioid cells, Langhans giant cells, lymphocyte cuff",
      "Central caseous necrosis distinguishes TB from sarcoidosis",
      "Confirm with Ziehl-Neelsen stain or GeneXpert",
      "Type IV hypersensitivity underlies granuloma formation",
    ],
  },
  {
    subject: "Microbiology",
    topic: "Bacteriology",
    question:
      "A child presents with a grey adherent pseudomembrane over the tonsils that bleeds on removal. Name the organism, the selective medium, and the basis of its toxicity.",
    answer:
      "Corynebacterium diphtheriae — Loeffler's serum slope / potassium tellurite agar.",
    rationale: [
      "Exotoxin inhibits protein synthesis via EF-2 ADP-ribosylation",
      "Albert stain shows metachromatic granules",
      "Elek test demonstrates toxigenicity",
      "Antitoxin is the priority — antibiotics are adjunctive",
    ],
  },
  {
    subject: "Microbiology",
    topic: "Virology",
    question:
      "A patient bitten by a stray dog presents three weeks later with hydrophobia and aerophobia. Name the inclusion bodies seen histologically and their location.",
    answer: "Negri bodies — in the cytoplasm of hippocampal pyramidal neurons.",
    rationale: [
      "Eosinophilic cytoplasmic inclusions, pathognomonic for rabies",
      "Also found in Purkinje cells of the cerebellum",
      "Antemortem diagnosis via corneal impression or nuchal skin biopsy",
      "Post-exposure prophylaxis is ineffective once symptoms appear",
    ],
  },
];

/** Days since epoch — same all day, rolls over at midnight. */
function dayIndex() {
  return Math.floor(Date.now() / 86_400_000);
}

/** Deterministic 0–1 value that changes daily. */
function dailyRoll(salt: number) {
  const x = Math.sin(dayIndex() + salt) * 10_000;
  return x - Math.floor(x);
}

const AHEAD_CHANCE = 0.15;

export default function QuestionOfTheDay() {
  const { subject, yearSubjects, covered } = useSettings();
  const [revealed, setRevealed] = useState(false);

  const pool =
    subject === ALL
      ? DAILY_QUESTIONS.filter((q) => yearSubjects.includes(q.subject))
      : DAILY_QUESTIONS.filter((q) => q.subject === subject);

  if (pool.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
        No daily question for {subject} yet.
      </div>
    );
  }

  const done = pool.filter((q) => covered.includes(`${q.subject}::${q.topic}`));
  const ahead = pool.filter((q) => !covered.includes(`${q.subject}::${q.topic}`));

  const wantAhead = dailyRoll(0) < AHEAD_CHANCE;
  const useAhead = (wantAhead && ahead.length > 0) || done.length === 0;
  const chosen = useAhead && ahead.length > 0 ? ahead : done;
  const isAhead = useAhead && ahead.length > 0;

  const q = chosen[dayIndex() % chosen.length];

  return (
    <div className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex items-center justify-between">
        {isAhead ? (
          <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-400">
            Look Ahead
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-400">
            High-Yield
          </span>
        )}
        <span className="text-[11px] text-slate-500">
          {q.subject} · {q.topic}
        </span>
      </div>

      <h3 className="mt-3 text-sm font-semibold text-slate-200">
        Question of the Day
      </h3>

      {isAhead && (
        <p className="mt-1 text-[11px] text-violet-400/80">
          You haven&apos;t covered this topic yet — have a go anyway.
        </p>
      )}

      <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">
        {q.question}
      </p>

      {revealed ? (
        <div className="mt-4 rounded-xl border border-teal-500/30 bg-teal-500/5 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-teal-400">
            Answer
          </p>
          <p className="mt-1.5 text-sm text-slate-300">{q.answer}</p>

          <p className="mt-3 text-[10px] font-semibold uppercase tracking-widest text-teal-400">
            Rationale
          </p>
          <ul className="mt-1.5 space-y-1 text-sm text-slate-400">
            {q.rationale.map((point, i) => (
              <li key={i}>• {point}</li>
            ))}
          </ul>

          <button
            onClick={() => setRevealed(false)}
            className="mt-3 text-[11px] text-slate-500 transition hover:text-slate-300"
          >
            Hide answer
          </button>
        </div>
      ) : (
        <button
          onClick={() => setRevealed(true)}
          className="mt-4 w-full rounded-xl border border-teal-500/40 py-2.5 text-sm font-medium text-teal-400 transition hover:bg-teal-500/10"
        >
          Reveal Answer &amp; Rationale
        </button>
      )}
    </div>
  );
}
