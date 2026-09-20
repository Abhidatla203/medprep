// app/attendance/setup/page.tsx
"use client";

// -----------------------------------------------------------------------------
// Timetable setup — rebuilt.
//
// Structure is now four calm cards instead of one long scroll:
//   1. Term dates        (typeable dd/mm/yyyy + calendar)
//   2. Your week         (proportional grid, click any tile to edit)
//   3. Clinical postings (date-ranged department blocks)
//   4. Your data         (save / export / import / CSV / legacy recovery)
//
// The year selector is gone. It lives in the profile, where it belongs.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import WeekGrid, { type ClassBlock } from "@/components/attendance/WeekGrid";
import ClassEditorSheet from "@/components/attendance/ClassEditorSheet";
import PostingScheduler, {
  type PostingBlock,
} from "@/components/attendance/PostingScheduler";
import DateField from "@/components/attendance/DateField";
import {
  DAYS,
  YEARS,
  subjectName,
  type YearKey,
} from "@/lib/attendance/curriculum";
import { addDaysISO, todayISO } from "@/lib/attendance/datetime";
import {
  downloadBackup,
  downloadSessionsCSV,
  hasLegacyData,
  loadPostings,
  loadTerm,
  loadTimetable,
  migrateLegacyData,
  readBackupFile,
  restoreBackup,
  savePostings,
  saveTerm,
  saveTimetable,
  type ImportResult,
} from "@/lib/attendance/backup";

// TODO: swap for the real profile hook once Settings exposes it.
function useProfileYear(): YearKey {
  const [year, setYear] = useState<YearKey>("1");
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("medprep.profile.v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.year) setYear(String(parsed.year) as YearKey);
      }
    } catch {
      /* default stands */
    }
  }, []);
  return year;
}

export default function TimetableSetupPage() {
  const router = useRouter();
  const year = useProfileYear();

  const [termStart, setTermStart] = useState(todayISO());
  const [termEnd, setTermEnd] = useState(addDaysISO(todayISO(), 120));
  const [blocks, setBlocks] = useState<ClassBlock[]>([]);
  const [postings, setPostings] = useState<PostingBlock[]>([]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ClassBlock | null>(null);
  const [defaultDay, setDefaultDay] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [legacy, setLegacy] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  // hydrate
  useEffect(() => {
    setBlocks(loadTimetable());
    setPostings(loadPostings());
    const term = loadTerm();
    if (term) {
      setTermStart(term.startDate);
      setTermEnd(term.endDate);
    }
    setLegacy(hasLegacyData());
  }, []);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const yearLabel = YEARS.find((y) => y.key === year)?.label ?? "Your year";

  // ---- class CRUD -----------------------------------------------------------

  function openAdd(day: number) {
    setEditing(null);
    setDefaultDay(day);
    setSheetOpen(true);
  }

  function openEdit(block: ClassBlock) {
    setEditing(block);
    setDefaultDay(block.day);
    setSheetOpen(true);
  }

  function upsertBlock(block: ClassBlock) {
    setBlocks((prev) => {
      const exists = prev.some((b) => b.id === block.id);
      return exists ? prev.map((b) => (b.id === block.id ? block : b)) : [...prev, block];
    });
    setDirty(true);
  }

  function deleteBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setDirty(true);
  }

  function copyDay(from: number, to: number) {
    const source = blocks.filter((b) => b.day === from);
    if (source.length === 0) return;
    const copies = source.map((b) => ({
      ...b,
      id: `cls_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      day: to,
    }));
    setBlocks((prev) => [...prev.filter((b) => b.day !== to), ...copies]);
    setDirty(true);
    flash(`Copied ${source.length} classes to ${DAYS.find((d) => d.index === to)?.label}.`);
  }

  // ---- persistence ----------------------------------------------------------

  const persist = useCallback(() => {
    const okA = saveTimetable(blocks);
    const okB = savePostings(postings);
    const okC = saveTerm({
      startDate: termStart,
      endDate: termEnd,
      year,
      targetPercent: 75,
    });
    if (okA && okB && okC) {
      setDirty(false);
      flash("Saved.");
      return true;
    }
    flash("Couldn't save — storage may be full or blocked.");
    return false;
  }, [blocks, postings, termStart, termEnd, year, flash]);

  function finish() {
    if (persist()) router.push("/attendance");
  }

  async function handleImport(file: File) {
    try {
      const raw = await readBackupFile(file);
      const result: ImportResult = restoreBackup(raw, "replace");
      flash(result.message);
      if (result.ok) {
        setBlocks(loadTimetable());
        setPostings(loadPostings());
        const term = loadTerm();
        if (term) {
          setTermStart(term.startDate);
          setTermEnd(term.endDate);
        }
        setDirty(false);
      }
    } catch {
      flash("That file couldn't be read.");
    }
  }

  const stats = useMemo(() => {
    const units = blocks.reduce((sum, b) => sum + (b.weight || 1), 0);
    const daysUsed = new Set(blocks.map((b) => b.day)).size;
    return { units, daysUsed };
  }, [blocks]);

  const populatedDays = DAYS.filter((d) => blocks.some((b) => b.day === d.index));

  return (
    <main className="mx-auto max-w-5xl px-4 pb-32 pt-8 sm:px-6">
      {/* ---- header ---------------------------------------------------- */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-50">
          Set up your timetable
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-neutral-400">
          One time only. After this, you just tap Present, Absent, or Cancelled each day.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-neutral-900 px-2.5 py-1 text-xs text-neutral-400">
            {yearLabel}
          </span>
          <button
            type="button"
            onClick={() => router.push("/settings/profile")}
            className="text-xs text-neutral-600 transition hover:text-emerald-400"
          >
            Change in profile
          </button>
        </div>
      </header>

      {legacy && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30
                        bg-amber-500/[0.07] px-4 py-3">
          <p className="flex-1 text-xs text-amber-200">
            Attendance data from an older version of MedPrep is on this device. It isn't lost —
            it just needs adopting.
          </p>
          <button
            type="button"
            onClick={() => {
              const r = migrateLegacyData();
              flash(r.message);
              if (r.ok) {
                setBlocks(loadTimetable());
                setLegacy(false);
              }
            }}
            className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-200
                       transition hover:bg-amber-500/30"
          >
            Recover it
          </button>
        </div>
      )}

      <div className="space-y-6">
        {/* ---- 1. term dates ------------------------------------------- */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-5">
          <h2 className="text-sm font-semibold text-neutral-100">Term dates</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Sessions are generated from the start date up to today. Past dates are fine — mark
            them in bulk afterwards.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 sm:max-w-md">
            <DateField label="Term starts" value={termStart} onChange={setTermStart} />
            <DateField
              label="Term ends"
              value={termEnd}
              onChange={setTermEnd}
              optional
              min={termStart}
            />
          </div>
        </section>

        {/* ---- 2. week grid -------------------------------------------- */}
        <WeekGrid blocks={blocks} onEdit={openEdit} onAdd={openAdd} />

        {/* copy-day helpers */}
        {populatedDays.length > 0 && populatedDays.length < 6 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800/70
                          bg-neutral-950/40 px-4 py-3">
            <span className="text-xs text-neutral-500">Repeat a day:</span>
            {populatedDays.map((from) => (
              <div key={from.index} className="flex items-center gap-1">
                <span className="text-xs text-neutral-400">{from.short} →</span>
                {DAYS.filter(
                  (d) => d.index !== from.index && !blocks.some((b) => b.day === d.index)
                ).map((to) => (
                  <button
                    key={`${from.index}-${to.index}`}
                    type="button"
                    onClick={() => copyDay(from.index, to.index)}
                    className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1
                               text-[11px] text-neutral-400 transition hover:border-emerald-600/50
                               hover:text-emerald-300"
                  >
                    {to.short}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ---- 3. clinical postings ------------------------------------ */}
        <PostingScheduler
          year={year}
          postings={postings}
          onChange={(p) => {
            setPostings(p);
            setDirty(true);
          }}
        />

        {/* ---- 4. data management -------------------------------------- */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-5">
          <h2 className="text-sm font-semibold text-neutral-100">Your data</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Everything is stored on this device only. Export now and again — clearing your
            browser data would otherwise take your attendance record with it.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <DataButton onClick={persist} primary={dirty}>
              {dirty ? "Save changes" : "Saved"}
            </DataButton>
            <DataButton onClick={downloadBackup}>Export backup (.json)</DataButton>
            <DataButton onClick={() => downloadSessionsCSV(subjectName)}>
              Export log (.csv)
            </DataButton>
            <DataButton onClick={() => fileRef.current?.click()}>Import backup</DataButton>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
              e.target.value = "";
            }}
          />

          <p className="mt-3 text-[11px] text-neutral-600">
            Importing replaces what's currently on this device. Export first if you're unsure.
          </p>
        </section>
      </div>

      {/* ---- sticky footer --------------------------------------------- */}
      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-800 bg-neutral-950/95
                      px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="hidden text-xs text-neutral-500 sm:block">
            {blocks.length} classes · {stats.units} units/week · {stats.daysUsed} days
            {postings.length > 0 && ` · ${postings.length} postings`}
            {dirty && <span className="ml-2 text-amber-400">Unsaved</span>}
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={finish}
            disabled={blocks.length === 0 && postings.length === 0}
            className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white
                       transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save and start tracking
          </button>
        </div>
      </div>

      {/* ---- sheet + toast ---------------------------------------------- */}
      <ClassEditorSheet
        open={sheetOpen}
        year={year}
        editing={editing}
        defaultDay={defaultDay}
        onSave={upsertBlock}
        onDelete={deleteBlock}
        onClose={() => setSheetOpen(false)}
      />

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl border
                        border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm text-neutral-100 shadow-xl">
          {toast}
        </div>
      )}
    </main>
  );
}

function DataButton({
  onClick,
  children,
  primary,
}: {
  onClick: () => void;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3.5 py-2 text-xs font-medium transition
        ${
          primary
            ? "border-emerald-600 bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/25"
            : "border-neutral-800 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700 hover:text-neutral-100"
        }`}
    >
      {children}
    </button>
  );
}
