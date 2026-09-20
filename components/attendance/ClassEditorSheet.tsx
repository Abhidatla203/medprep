// components/attendance/ClassEditorSheet.tsx
"use client";

// -----------------------------------------------------------------------------
// Add / EDIT a single class. The edit path is new — previously the only way to
// change a class was to delete it and retype everything.
//
// Fixes carried here:
//  · Multiplier no longer jumps to 2x when you pick Practical or Clinical.
//    It starts at 1 and stays at 1 until the student deliberately changes it.
//  · Subject list is filtered by profile year, with an opt-in escape hatch.
//  · Type list is Theory / Practical / Clinical posting. Nothing else.
//  · Times are typeable, chip-pickable, and nudgeable. No 72-row dropdown.
//  · Duration chips set the end time, because end time is a chore, not a choice.
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  CLASS_TYPES,
  DAYS,
  DEFAULT_WEIGHT,
  earlierYearSubjectCount,
  subjectsForYear,
  typeMeta,
  type ClassType,
  type YearKey,
} from "@/lib/attendance/curriculum";
import {
  addMinutesToTime,
  formatDuration,
  timeToMinutes,
} from "@/lib/attendance/datetime";
import TimeField from "./TimeField";
import type { ClassBlock } from "./WeekGrid";

interface ClassEditorSheetProps {
  open: boolean;
  /** Profile year. NOT selectable here — it lives in Settings. */
  year: YearKey;
  /** Existing block when editing; null when adding. */
  editing: ClassBlock | null;
  defaultDay: number;
  onSave: (block: ClassBlock) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

const DURATION_CHIPS = [45, 60, 90, 120, 180];

export default function ClassEditorSheet({
  open,
  year,
  editing,
  defaultDay,
  onSave,
  onDelete,
  onClose,
}: ClassEditorSheetProps) {
  const [day, setDay] = useState(defaultDay);
  const [subjectId, setSubjectId] = useState("");
  const [type, setType] = useState<ClassType>("theory");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [weight, setWeight] = useState(DEFAULT_WEIGHT);
  const [showEarlier, setShowEarlier] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const earlierCount = earlierYearSubjectCount(year);
  const subjects = useMemo(
    () => subjectsForYear(year, showEarlier),
    [year, showEarlier]
  );

  // Hydrate whenever the sheet opens.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDay(editing.day);
      setSubjectId(editing.subjectId);
      setType(editing.type);
      setStart(editing.start);
      setEnd(editing.end);
      setWeight(editing.weight || DEFAULT_WEIGHT);
      setShowAdvanced((editing.weight || 1) !== 1);
    } else {
      setDay(defaultDay);
      setSubjectId("");
      setType("theory");
      setStart("09:00");
      setEnd("10:00");
      setWeight(DEFAULT_WEIGHT); // <- always 1, regardless of type
      setShowAdvanced(false);
    }
  }, [open, editing, defaultDay]);

  // Keep end after start without ever touching the weight.
  useEffect(() => {
    if (timeToMinutes(end) <= timeToMinutes(start)) {
      setEnd(addMinutesToTime(start, 60));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  // If the chosen subject can't have the chosen type, fall back to its first
  // legal type. Weight is untouched — that was the old bug.
  const selectedSubject = subjects.find((s) => s.id === subjectId);
  useEffect(() => {
    if (selectedSubject && !selectedSubject.types.includes(type)) {
      setType(selectedSubject.types[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId]);

  if (!open) return null;

  const duration = timeToMinutes(end) - timeToMinutes(start);
  const canSave = Boolean(subjectId) && duration > 0;
  const availableTypes = selectedSubject
    ? CLASS_TYPES.filter((t) => selectedSubject.types.includes(t.key))
    : CLASS_TYPES;

  function handleSave() {
    if (!canSave || !selectedSubject) return;
    onSave({
      id: editing?.id ?? `cls_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      day,
      subjectId,
      subjectName: selectedSubject.name,
      type,
      start,
      end,
      weight,
      postingId: editing?.postingId,
      activeFrom: editing?.activeFrom,
      activeTo: editing?.activeTo,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit class" : "Add class"}
        className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden
                   rounded-t-2xl border border-neutral-800 bg-neutral-950 shadow-2xl sm:rounded-2xl"
      >
        {/* header */}
        <header className="flex items-start justify-between border-b border-neutral-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-50">
              {editing ? "Edit class" : "Add class"}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {DAYS.find((d) => d.index === day)?.label}
              {duration > 0 && ` · ${formatDuration(duration)}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-neutral-500 transition hover:bg-neutral-900 hover:text-neutral-200"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* day */}
          <Field label="Day">
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d) => (
                <Chip key={d.index} active={day === d.index} onClick={() => setDay(d.index)}>
                  {d.short}
                </Chip>
              ))}
            </div>
          </Field>

          {/* subject */}
          <Field
            label="Subject"
            aside={
              earlierCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowEarlier((v) => !v)}
                  className="text-[11px] text-neutral-500 transition hover:text-emerald-400"
                >
                  {showEarlier ? "Hide earlier years" : `+ Earlier years (${earlierCount})`}
                </button>
              ) : null
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {subjects.map((s) => {
                const isOlder = !s.years.includes(year);
                return (
                  <Chip
                    key={s.id}
                    active={subjectId === s.id}
                    onClick={() => setSubjectId(s.id)}
                    muted={isOlder}
                  >
                    {s.name}
                    {isOlder && <span className="ml-1 text-[9px] opacity-60">prev yr</span>}
                  </Chip>
                );
              })}
            </div>
          </Field>

          {/* type */}
          <Field label="Type of class">
            <div className="flex flex-wrap gap-1.5">
              {availableTypes.map((t) => {
                const active = type === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setType(t.key)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition
                      ${
                        active
                          ? t.chipActive
                          : "border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                      }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                    {t.label}
                  </button>
                );
              })}
            </div>
            {selectedSubject && availableTypes.length < CLASS_TYPES.length && (
              <p className="mt-1.5 text-[11px] text-neutral-600">
                {selectedSubject.name} only has{" "}
                {availableTypes.map((t) => t.label.toLowerCase()).join(" and ")} sessions.
              </p>
            )}
          </Field>

          {/* times */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TimeField label="Starts at" value={start} onChange={setStart} />
            <TimeField
              label="Ends at"
              value={end}
              onChange={setEnd}
              error={duration <= 0 ? "Must be after start" : null}
            />
          </div>

          <Field label="Or pick a length">
            <div className="flex flex-wrap gap-1.5">
              {DURATION_CHIPS.map((mins) => (
                <Chip
                  key={mins}
                  active={duration === mins}
                  onClick={() => setEnd(addMinutesToTime(start, mins))}
                >
                  {formatDuration(mins)}
                </Chip>
              ))}
            </div>
          </Field>

          {/* advanced */}
          <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/30">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex w-full items-center justify-between px-3.5 py-2.5 text-xs text-neutral-400 transition hover:text-neutral-200"
            >
              <span>
                Counts as{" "}
                <span className="font-semibold text-neutral-200">
                  {weight} {weight === 1 ? "session" : "sessions"}
                </span>
              </span>
              <span className="text-neutral-600">{showAdvanced ? "Hide" : "Change"}</span>
            </button>

            {showAdvanced && (
              <div className="border-t border-neutral-800/80 px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <Stepper
                    label="−"
                    onClick={() => setWeight((w) => Math.max(1, w - 1))}
                    disabled={weight <= 1}
                  />
                  <span className="w-10 text-center text-sm font-semibold tabular-nums text-neutral-100">
                    {weight}×
                  </span>
                  <Stepper
                    label="+"
                    onClick={() => setWeight((w) => Math.min(6, w + 1))}
                    disabled={weight >= 6}
                  />
                  {weight !== 1 && (
                    <button
                      type="button"
                      onClick={() => setWeight(1)}
                      className="ml-1 text-[11px] text-neutral-500 hover:text-emerald-400"
                    >
                      Reset to 1×
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-neutral-600">
                  Leave this at 1× unless your college counts one session as several for
                  attendance. Changing the class type never changes this on its own.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* footer */}
        <footer className="flex items-center gap-2 border-t border-neutral-800 px-5 py-4">
          {editing && onDelete && (
            <button
              type="button"
              onClick={() => {
                onDelete(editing.id);
                onClose();
              }}
              className="rounded-xl px-3 py-2.5 text-sm text-red-400 transition hover:bg-red-500/10"
            >
              Delete
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm text-neutral-400 transition hover:bg-neutral-900 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white
                       transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {editing ? "Save changes" : "Add class"}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---- small primitives -------------------------------------------------------

function Field({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          {label}
        </span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Chip({
  active,
  muted,
  onClick,
  children,
}: {
  active: boolean;
  muted?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-sm transition
        ${
          active
            ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
            : muted
            ? "border-neutral-800/60 bg-neutral-900/30 text-neutral-500 hover:text-neutral-300"
            : "border-neutral-800 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700 hover:text-neutral-100"
        }`}
    >
      {children}
    </button>
  );
}

function Stepper({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-8 w-8 rounded-lg border border-neutral-800 bg-neutral-900 text-sm
                 text-neutral-300 transition hover:border-neutral-700 hover:text-neutral-100
                 disabled:opacity-30"
    >
      {label}
    </button>
  );
}
