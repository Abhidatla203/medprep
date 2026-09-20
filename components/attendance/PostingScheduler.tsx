"use client";

import { useMemo, useState } from "react";
import {
  DAYS,
  YEARS,
  subjectsForYear,
  subjectName,
  typeMeta,
  type YearKey,
} from "@/lib/attendance/curriculum";

export type PostingBlock = {
  id: string;
  subjectId: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  days: number[];    // 0 = Sun ... 6 = Sat
  start: string;     // "09:00"
  end: string;       // "12:00"
};

/* ---------- local date helpers (self-contained on purpose) ---------- */

const todayISO = () => new Date().toISOString().slice(0, 10);

const addDaysISO = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const dayOfWeekISO = (iso: string) => new Date(iso + "T00:00:00").getDay();

const eachDateInRange = (startISO: string, endISO: string) => {
  const out: string[] = [];
  if (!startISO || !endISO || startISO > endISO) return out;
  let cur = startISO;
  let guard = 0;
  while (cur <= endISO && guard < 800) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
    guard++;
  }
  return out;
};

const prettyDate = (iso: string) =>
  iso
    ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

const fmtTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hh} ${ampm}` : `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
};

const uid = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------- component ------------------------------- */

export default function PostingScheduler({
  year,
  postings,
  onChange,
}: {
  year: YearKey;
  postings: PostingBlock[];
  onChange: (next: PostingBlock[]) => void;
}) {
  // Design rule: no escape hatch by default — current year only.
  const subjects = useMemo(
    () => subjectsForYear(year, false).filter((s) => s.types.includes("clinical")),
    [year]
  );

  const [open, setOpen] = useState(false);
  const [subjectId, setSubjectId] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(addDaysISO(todayISO(), 13));
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("12:00");

  const meta = typeMeta("clinical");

  const sessionCount = useMemo(() => {
    if (!startDate || !endDate) return 0;
    return eachDateInRange(startDate, endDate).filter((d) =>
      days.includes(dayOfWeekISO(d))
    ).length;
  }, [startDate, endDate, days]);

  const yearLabel =
    YEARS.find((y) => y.key === year)?.short ?? "your year";

  const reset = () => {
    setSubjectId("");
    setStartDate(todayISO());
    setEndDate(addDaysISO(todayISO(), 13));
    setDays([1, 2, 3, 4, 5]);
    setStart("09:00");
    setEnd("12:00");
    setOpen(false);
  };

  const add = () => {
    if (!subjectId || !startDate || !endDate || days.length === 0) return;
    onChange([
      ...postings,
      { id: uid(), subjectId, startDate, endDate, days, start, end },
    ]);
    reset();
  };

  const remove = (id: string) =>
    onChange(postings.filter((p) => p.id !== id));

  const toggleDay = (index: number) =>
    setDays((prev) =>
      prev.includes(index)
        ? prev.filter((d) => d !== index)
        : [...prev, index].sort()
    );

  /* --------------------------- empty-state branch --------------------------- */

  if (subjects.length === 0) {
    return (
      <section className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
        <h3 className="text-sm font-semibold text-neutral-100">
          Clinical postings
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-neutral-400">
          No clinical postings in {yearLabel}. Postings begin in second year —
          Medicine, Surgery and Community Medicine. Nothing to set up here yet.
        </p>
      </section>
    );
  }

  /* -------------------------------- normal -------------------------------- */

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">
            Clinical postings
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            Block postings that run for weeks. Added once, not day by day.
          </p>
        </div>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            + Add posting
          </button>
        )}
      </div>

      {/* existing postings */}
      {postings.length > 0 && (
        <ul className="mt-4 space-y-2">
          {postings.map((p) => (
            <li
              key={p.id}
              className={`flex items-start justify-between gap-3 rounded-lg border-l-4 px-3 py-2.5 ${meta.tile} ${meta.border}`}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-neutral-50">
                  {subjectName(p.subjectId)}
                </div>
                <div className={`mt-0.5 text-[11px] ${meta.text}`}>
                  {prettyDate(p.startDate)} → {prettyDate(p.endDate)} ·{" "}
                  {fmtTime(p.start)}–{fmtTime(p.end)}
                </div>
                <div className="mt-0.5 text-[11px] text-neutral-500">
                  {p.days
                    .map((d) => DAYS.find((x) => x.index === d)?.short)
                    .filter(Boolean)
                    .join(" ")}
                </div>
              </div>
              <button
                onClick={() => remove(p.id)}
                className="shrink-0 text-neutral-500 hover:text-white"
                aria-label="Remove posting"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {postings.length === 0 && !open && (
        <p className="mt-4 text-xs text-neutral-500">
          None added yet.
        </p>
      )}

      {/* add form */}
      {open && (
        <div className="mt-4 space-y-4 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          {/* subject */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              Department
            </label>
            <div className="flex flex-wrap gap-2">
              {subjects.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSubjectId(s.id)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs transition ${
                    subjectId === s.id
                      ? meta.chipActive
                      : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          {/* dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Starts
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Ends
              </label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100"
              />
            </div>
          </div>

          {/* days */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              Days
            </label>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d) => (
                <button
                  key={d.index}
                  onClick={() => toggleDay(d.index)}
                  className={`w-12 rounded-md border py-1.5 text-xs transition ${
                    days.includes(d.index)
                      ? meta.chipActive
                      : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
                  }`}
                >
                  {d.short}
                </button>
              ))}
            </div>
          </div>

          {/* times */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                From
              </label>
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                To
              </label>
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100"
              />
            </div>
          </div>

          {/* summary */}
          <p className="text-xs text-neutral-400">
            {subjectId ? (
              <>
                <span className="font-medium text-neutral-200">
                  {sessionCount}
                </span>{" "}
                session{sessionCount === 1 ? "" : "s"} will be generated.
              </>
            ) : (
              "Pick a department to continue."
            )}
          </p>

          <div className="flex gap-2">
            <button
              onClick={add}
              disabled={!subjectId || days.length === 0 || sessionCount === 0}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add posting
            </button>
            <button
              onClick={reset}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
