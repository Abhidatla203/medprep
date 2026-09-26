// components/attendance/DateField.tsx
"use client";

// -----------------------------------------------------------------------------
// A date input that is BOTH typeable and pickable. dd/mm/yyyy, always.
//
// ⚠ dd/mm/yyyy IS NOT A PREFERENCE IN THIS APP. It is a hard rule, everywhere.
//   The audience is Indian medical students; nobody here reads 03/15/2026 as a
//   date in March. A plain <input type="date"> renders in the BROWSER's locale,
//   which is how the setup screen once showed 09/20/2026 to a dd/mm reader.
//   Hence a text field we control completely, plus a calendar button for the
//   native picker. Typists type. Tappers tap. Neither ever sees mm/dd.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ THE INPUT MASK — why this is not a plain text box
// ═════════════════════════════════════════════════════════════════════════════
// The previous version accepted ANY text and only checked it on blur. Two
// failures followed directly, both visible in a single screenshot:
//
//   1. "2489612329473" — thirteen digits, sitting in a date field. No length
//      limit existed at all.
//   2. No slashes appeared while typing, so the field silently disagreed with
//      its own dd/mm/yyyy placeholder until you clicked away.
//
// A date has EXACTLY 8 digits in a FIXED shape. The field should therefore
// refuse to hold anything else, at the moment of typing, rather than accepting
// nonsense and complaining later. Rejecting input at the keystroke teaches the
// format; rejecting it on blur only reports a failure.
//
// ⚠ WHY THE TRAILING SLASH IS NEVER AUTO-ADDED.
//   The tempting version appends a slash as soon as you finish a segment: type
//   "25" and get "25/". It feels helpful and it breaks backspace. Pressing
//   delete removes the slash, the mask immediately puts it back, and the field
//   is stuck — you can never delete the "5". This is the single most common bug
//   in hand-written date masks.
//
//   So: a slash only exists once a digit AFTER it exists. "25" then "251"
//   becomes "25/1". Deleting walks straight back down the same path, one
//   character at a time, with nothing regrowing behind you.
//
// ⚠ WHY THE CARET IS NOT MANAGED.
//   Editing mid-string — clicking between two digits and typing — will jump the
//   caret to the end, because the mask rewrites the whole string. Fixing that
//   properly means measuring digit offsets before and after and restoring the
//   selection by hand, which is a large amount of fragile code.
//
//   Accepted deliberately: on a phone, dates are typed left to right in one go
//   or picked from the calendar. Mid-string editing of a date is close to
//   nonexistent, and the cost of the fix outweighs it. Logged as SM-9.
// ═════════════════════════════════════════════════════════════════════════════

import { useRef, useState } from "react";
import {
  formatDateDMY,
  formatDateLong,
  parseDateInput,
  todayISO,
} from "@/lib/attendance/datetime";


// -----------------------------------------------------------------------------
// The mask
// -----------------------------------------------------------------------------

/** A complete date is exactly this many digits: dd + mm + yyyy. */
const DATE_DIGITS = 8;

/**
 * Throw away everything that is not a digit, and cap the length.
 *
 * ⚠ This is also the paste handler. Paste "15-03-2026", "15.03.2026" or
 *   "15 03 2026" and the separators vanish, leaving 15032026 to be re-masked
 *   in our own format. Whatever shape it arrived in, it leaves as dd/mm/yyyy.
 */
function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, DATE_DIGITS);
}

/**
 * Insert slashes into a run of digits.
 *
 * ⚠ NO TRAILING SLASH, EVER. See the header note — a slash that appears before
 *   the digit following it makes backspace impossible.
 *
 *   ""        → ""
 *   "2"       → "2"
 *   "25"      → "25"
 *   "251"     → "25/1"
 *   "2512"    → "25/12"
 *   "25122"   → "25/12/2"
 *   "25122026"→ "25/12/2026"
 */
function maskDate(digits: string): string {
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}


// -----------------------------------------------------------------------------

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

  // What `value` was the last time we rewrote the text.
  //
  // ⚠ NOT the same as comparing against `text`. The instant you type one
  //   character, text differs from the formatted value — a comparison against
  //   text would wipe your keystroke on the next render and make typing a date
  //   by hand impossible. We need "did the PROP change", not "do they differ".
  const [seenValue, setSeenValue] = useState(value);

  const nativeRef = useRef<HTMLInputElement>(null);

  // ★ Runs DURING render, on purpose. React discards this pass and re-runs
  //   immediately, so a calendar pick lands in the first paint. An effect would
  //   paint the old text first, then correct it.
  if (value !== seenValue) {
    setSeenValue(value);
    setText(value ? formatDateDMY(value) : "");
    // The old text is gone, so any complaint about it is gone too. A stale
    // "Use dd/mm/yyyy" beside a date the calendar just filled in is nonsense.
    setError(null);
  }

  /**
   * Every keystroke, paste and deletion passes through here.
   *
   * ★ Nothing invalid can ever enter the field. Letters and symbols are dropped
   *   before they are ever shown, and a 9th digit simply does not appear.
   */
  function handleInput(raw: string) {
    const digits = digitsOnly(raw);
    const masked = maskDate(digits);
    setText(masked);

    // Typing again after an error clears the complaint. Leaving it up while
    // the student is visibly fixing the problem is just nagging.
    if (error) setError(null);

    // ★ Auto-commit on the 8th digit. The date is unambiguously complete, so
    //   there is nothing to wait for — no blur, no Enter, no extra tap. On a
    //   phone that removes a whole interaction from every date entry.
    if (digits.length === DATE_DIGITS) {
      const iso = parseDateInput(masked);
      if (iso) onChange(iso);
      else setError("Not a real date");
    }
  }

  /**
   * Final check when the field loses focus or Enter is pressed.
   *
   * Still needed despite auto-commit: it catches the half-finished date
   * ("25/12") that the student walked away from.
   */
  function commit(raw: string) {
    const digits = digitsOnly(raw);

    if (digits.length === 0) {
      if (optional) {
        onChange("");
        setError(null);
      } else {
        setError("Required");
      }
      return;
    }

    if (digits.length < DATE_DIGITS) {
      // ⚠ Keep what they typed. Wiping an incomplete date means retyping the
      //   whole thing to add one missing digit.
      setError("Incomplete — dd/mm/yyyy");
      return;
    }

    const iso = parseDateInput(maskDate(digits));
    if (!iso) {
      // 8 digits but not a real date — 32/13/2026, or 30/02 in a non-leap year.
      setError("Not a real date");
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
        className={`relative flex items-stretch overflow-hidden rounded-xl border bg-neutral-950 transition
          ${error ? "border-red-500/60" : "border-neutral-800 focus-within:border-emerald-500/70"}`}
      >
        <input
          type="text"
          // ⚠ inputMode="numeric" gives phones a number pad instead of the full
          //   keyboard. type="text" is kept on purpose: type="number" would
          //   allow "e", "+" and "-", strip leading zeros from "05", and show
          //   spinner arrows that make no sense on a date.
          inputMode="numeric"
          autoComplete="off"
          placeholder="dd/mm/yyyy"
          // 10 = 8 digits + 2 slashes. A second line of defence behind the mask.
          maxLength={10}
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${label}-error` : undefined}
          onChange={(e) => handleInput(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(text);
            }
          }}
          className="tnum w-full bg-transparent px-3.5 py-2.5 text-[15px] text-neutral-100
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

        {/* Native input drives the OS calendar. Visually hidden, never read by
            the user, kept out of the tab order so keyboard users reach the
            typeable field instead.

            ⚠ Needs a positioned ancestor — hence `relative` on the wrapper.
              Without it this escapes to the nearest positioned element and can
              drag layout around on some browsers. */}
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

      {/* Fixed minimum height: without it, an error appearing shoves every
          field below it down the page. */}
      <div className="flex min-h-[18px] items-center gap-2 text-xs">
        {error ? (
          <span id={`${label}-error`} role="alert" className="text-red-400">
            {error}
          </span>
        ) : value ? (
          // Echoing the date in long form is the confirmation that dd/mm was
          // read the way the student meant it. "15 Mar 2027" cannot be
          // misread; 15/03/2027 theoretically can.
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
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}
