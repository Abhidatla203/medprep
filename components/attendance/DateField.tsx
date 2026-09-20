// components/attendance/DateField.tsx
"use client";

// -----------------------------------------------------------------------------
// A date input that is BOTH typeable and pickable.
//
// Why not a plain <input type="date">? Because it renders in the browser's
// locale — which is how the setup screen ended up showing 09/20/2026 to a user
// who thinks in dd/mm/yyyy. So: a text field we control (dd/mm/yyyy, always),
// plus a calendar button that opens the native picker. Typists type. Tappers tap.
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import {
  formatDateDMY,
  formatDateLong,
  parseDateInput,
  todayISO,
} from "@/lib/attendance/datetime";

interface DateFieldProps {
  label: string;
  /** Canonical "yyyy-mm-dd", or "" when empty. */
  value: string;
  onChange: (isoDate: string) => void;
  hint?: string;
  optional?: boolean;
  min?: string;
  max?: string;
}

export default function DateField({
  label,
  value,
  onChange,
  hint,
  optional = false,
  min,
  max,
}: DateFieldProps) {
  const [text, setText] = useState(value ? formatDateDMY(value) : "");
  const [error, setError] = useState<string | null>(null);
  const nativeRef = useRef<HTMLInputElement>(null);

  // Keep the visible text in sync when the value changes from outside
  // (calendar pick, preset button, imported backup).
  useEffect(() => {
    setText(value ? formatDateDMY(value) : "");
    setError(null);
  }, [value]);

  function commit(raw: string) {
    if (!raw.trim()) {
      if (optional) {
        onChange("");
        setError(null);
      } else {
        setError("Required");
      }
      return;
    }
    const iso = parseDateInput(raw);
    if (!iso) {
      setError("Use dd/mm/yyyy");
      return;
    }
    setError(null);
    onChange(iso);
  }

  function openPicker() {
    const el = nativeRef.current;
    if (!el) return;
    // showPicker() is the modern path; focus+click is the fallback.
    if (typeof (el as HTMLInputElement & { showPicker?: () => void }).showPicker === "function") {
      (el as HTMLInputElement & { showPicker: () => void }).showPicker();
    } else {
      el.focus();
      el.click();
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-neutral-400">
        {label}
        {optional && <span className="ml-1 normal-case text-neutral-600">optional</span>}
      </label>

      <div
        className={`flex items-stretch overflow-hidden rounded-xl border bg-neutral-950 transition
          ${error ? "border-red-500/60" : "border-neutral-800 focus-within:border-emerald-500/70"}`}
      >
        <input
          type="text"
          inputMode="numeric"
          placeholder="dd/mm/yyyy"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(text);
            }
          }}
          className="w-full bg-transparent px-3.5 py-2.5 text-[15px] text-neutral-100
                     placeholder:text-neutral-600 focus:outline-none"
        />

        <button
          type="button"
          onClick={openPicker}
          aria-label={`Open calendar for ${label}`}
          className="flex shrink-0 items-center border-l border-neutral-800 px-3
                     text-neutral-400 transition hover:bg-neutral-900 hover:text-emerald-400"
        >
          <CalendarIcon />
        </button>

        {/* Native input drives the OS calendar. Visually hidden, never read by the user. */}
        <input
          ref={nativeRef}
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute h-0 w-0 opacity-0"
        />
      </div>

      <div className="flex min-h-[18px] items-center gap-2 text-xs">
        {error ? (
          <span className="text-red-400">{error}</span>
        ) : value ? (
          <span className="text-neutral-500">{formatDateLong(value)}</span>
        ) : (
          <button
            type="button"
            onClick={() => onChange(todayISO())}
            className="text-emerald-500 transition hover:text-emerald-400"
          >
            Use today
          </button>
        )}
        {hint && !error && <span className="text-neutral-600">· {hint}</span>}
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}
