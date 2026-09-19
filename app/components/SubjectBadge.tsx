"use client";

import { useState } from "react";
import { useSettings, ALL } from "../store/settings";

export default function SubjectBadge() {
  const { year, subject, setSubject, availableSubjects, showAllSubjects } =
    useSettings();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full border border-teal-500/40 bg-teal-500/10 px-4 py-1.5 text-sm font-medium text-teal-300 transition hover:border-teal-400"
      >
        <span className="h-2 w-2 rounded-full bg-teal-400" />
        {subject}
        <span className="text-xs text-teal-500">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-xl">
          <p className="border-b border-slate-800 px-4 py-2 text-[10px] uppercase tracking-widest text-slate-500">
            {showAllSubjects ? "All years" : year}
          </p>
          {availableSubjects.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSubject(s);
                setOpen(false);
              }}
              className={`block w-full px-4 py-2.5 text-left text-sm transition hover:bg-slate-800 ${
                s === subject ? "text-teal-400" : "text-slate-300"
              } ${s === ALL ? "border-b border-slate-800" : ""}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
