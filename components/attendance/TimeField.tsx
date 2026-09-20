// components/attendance/TimeField.tsx
"use client";

// -----------------------------------------------------------------------------
// Replaces the 72-item scrolling <select> that made the Add-class sheet feel
// like a filing cabinet.
//
// Three ways in, because you were right that nobody wants to type every time:
//   1. Type it loosely — "9", "930", "2pm", "14:30" all resolve correctly.
//   2. Tap a quick chip — the handful of times a medical timetable actually uses.
//   3. Nudge with arrow keys — Up/Down moves in 15-minute steps.
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import {
  addMinutesToTime,
  formatTime12,
  parseTimeInput,
} from "@/lib/attendance/datetime";

interface TimeFieldProps {
  label: string;
  /** Canonical "HH:mm" 24-hour. */
  value: string;
  onChange: (time: string) => void;
  /** Quick-pick chips. Defaults to the usual college slot boundaries. */
  presets?: string[];
  error?: string | null;
}

const DEFAULT_PRESETS = ["08:00", "09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00"];

export default function TimeField({
  label,
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  error,
}: TimeFieldProps) {
  const [text, setText] = useState(value ? formatTime12(value) : "");
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(value ? formatTime12(value) : "");
    setLocalError(null);
  }, [value]);

  function commit(raw: string) {
    if (!raw.trim()) {
      setLocalError("Required");
      return;
    }
    const parsed = parseTimeInput(raw);
    if (!parsed) {
      setLocalError("Try 9:30 or 2pm");
      return;
    }
    setLocalError(null);
    onChange(parsed);
  }

  function nudge(deltaMinutes: number) {
    if (!value) return;
    onChange(addMinutesToTime(value, deltaMinutes));
  }

  const shown = error ?? localError;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </label>

      <div
        className={`flex items-stretch overflow-hidden rounded-xl border bg-neutral-950 transition
          ${shown ? "border-red-500/60" : "border-neutral-800 focus-within:border-emerald-500/70"}`}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="9:00 AM"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(text);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              nudge(15);
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              nudge(-15);
            }
          }}
          className="w-full bg-transparent px-3.5 py-2.5 text-[15px] tabular-nums text-neutral-100
                     placeholder:text-neutral-600 focus:outline-none"
        />

        <div className="flex shrink-0 flex-col border-l border-neutral-800">
          <button
            type="button"
            onClick={() => nudge(15)}
            aria-label="Later by 15 minutes"
            className="flex h-1/2 items-center px-2.5 text-neutral-500 transition
                       hover:bg-neutral-900 hover:text-emerald-400"
          >
            <Chevron dir="up" />
          </button>
          <button
            type="button"
            onClick={() => nudge(-15)}
            aria-label="Earlier by 15 minutes"
            className="flex h-1/2 items-center border-t border-neutral-800 px-2.5 text-neutral-500
                       transition hover:bg-neutral-900 hover:text-emerald-400"
          >
            <Chevron dir="down" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {presets.map((p) => {
          const active = p === value;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={`rounded-lg px-2 py-1 text-xs tabular-nums transition
                ${
                  active
                    ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/50"
                    : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                }`}
            >
              {formatTime12(p).replace(":00", "")}
            </button>
          );
        })}
      </div>

      {shown && <span className="text-xs text-red-400">{shown}</span>}
    </div>
  );
}

function Chevron({ dir }: { dir: "up" | "down" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: dir === "down" ? "rotate(180deg)" : undefined }}
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}
