// =============================================================================
// lib/useSyncedDraft.ts
// -----------------------------------------------------------------------------
// Two small tools that between them retire eight lint errors across the app.
//
// Neither of these is a workaround for the linter. Both fix a real, visible
// glitch that the linter happened to point at.
// =============================================================================

import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';


// =============================================================================
// 1. useSyncedDraft — "let me edit a saved value"
// =============================================================================
//
// THE SITUATION. A panel reads something from the store, puts it in a box, and
// lets you edit it. Two rules pull in opposite directions:
//
//   1. While you are typing, the box must hold YOUR text, not the stored value.
//      Otherwise every keystroke gets overwritten as you type.
//
//   2. If the stored value changes from somewhere else — a backup import, a
//      reset, another browser tab — the box must catch up. Otherwise you are
//      editing a ghost, and pressing Save quietly reinstates the old data.
//
// THE OLD WAY, AND WHY IT WAS WRONG.
//
//     useEffect(() => { setDraft(stored); }, [stored]);
//
// This renders ONCE WITH THE OLD VALUE, then corrects itself on a second pass.
// For one frame the box genuinely shows the previous term dates. Usually too
// fast to notice; on a mid-range phone, not always. React 19's
// react-hooks/set-state-in-effect rule flags it, and it is right to.
//
// THE RIGHT WAY. React explicitly allows setState DURING RENDER for exactly
// this case. When it happens React throws away the in-progress render and
// immediately re-runs the component with the new state — BEFORE anything is
// painted. No effect, no wasted render, no stale frame.
// https://react.dev/reference/react/useState#storing-information-from-previous-renders
//
// ⚠ WHY WE TRACK `seen` INSTEAD OF COMPARING AGAINST `draft`.
//   Comparing stored against draft would fight the user: the instant you type
//   one character, draft !== stored, so it would reset your text on the very
//   next render. We need to detect "the STORED value changed", not "they now
//   differ" — so we remember what stored looked like last time we checked.
// =============================================================================

/**
 * Keeps an editable draft in step with a stored value.
 *
 * Use it exactly like useState.
 *
 * @param stored   the value from the store — the source of truth
 * @param areEqual optional comparison. Defaults to Object.is, which is correct
 *                 for strings, numbers and booleans.
 *
 *                 ⚠ FOR OBJECTS AND ARRAYS, PASS jsonEqual. A store that
 *                   rebuilds its object on every read returns a different
 *                   reference each time, so Object.is would report "changed"
 *                   on every single render and wipe your edits as you make
 *                   them. This is the one way to misuse this hook.
 */
export function useSyncedDraft<T>(
  stored: T,
  areEqual: (a: T, b: T) => boolean = Object.is,
): [T, Dispatch<SetStateAction<T>>] {
  const [draft, setDraft] = useState<T>(stored);
  const [seen, setSeen] = useState<T>(stored);

  // ⚠ Runs during render, deliberately. React re-renders immediately and
  //   discards this pass, so the `draft` returned below is already the new one.
  if (!areEqual(stored, seen)) {
    setSeen(stored);
    setDraft(stored);
  }

  return [draft, setDraft];
}


/**
 * Deep comparison for objects and arrays, via JSON.
 *
 * Crude but honest: everything this app stores is plain JSON — that is literally
 * what localStorage holds — so key order is stable and there are no Dates, Maps
 * or functions to trip over. Pair it with useSyncedDraft for maps like
 * customExamSubjects.
 */
export function jsonEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}


// =============================================================================
// 2. resolveChoice — "keep this dropdown inside the valid range"
// =============================================================================
//
// THE SITUATION. Some choices depend on other choices:
//
//     subject     →  which class types are allowed
//     start time  →  which end times are legal
//
// Change the thing on the left and the selection on the right may become
// invalid. Something has to bring it back into range.
//
// THE OLD WAY, AND WHY IT WAS WRONG.
//
//     useEffect(() => {
//       if (!options.includes(value)) setValue(options[0]);
//     }, [options, value]);
//
// Same flaw as above, but with worse consequences: it renders once with an
// ILLEGAL value and corrects afterwards. For one frame the Ends dropdown really
// is showing a time that clashes with another class. This is also why the end
// time sometimes appeared to "jump" a moment after changing the start.
//
// THE RIGHT WAY. A value that can always be computed from other values is not
// state — it is a calculation. So:
//
//   - STATE holds the student's raw CHOICE. It may be stale. It may be null,
//     meaning "they have not chosen anything yet".
//   - The EFFECTIVE value is computed on every render by checking that choice
//     against the current options.
//
// An invalid value never becomes a value, so it can never be painted.
// =============================================================================

/**
 * Pick the effective value from a list of valid options.
 *
 * Honours the student's choice while it remains valid; otherwise falls back to
 * the first available option, and to `fallback` only if there are none at all.
 *
 * @param choice   what the student picked, or null if they have not picked
 * @param options  the currently valid options
 * @param fallback last resort when options is empty
 */
export function resolveChoice<T>(
  choice: T | null | undefined,
  options: readonly T[],
  fallback: T,
): T {
  if (choice != null && options.includes(choice)) return choice;
  return options[0] ?? fallback;
}
