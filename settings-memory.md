# settings-memory.md

**Project:** medprep · **Path:** C:\Users\abhid\Desktop\medprep
**Repo:** https://github.com/Abhidatla203/medprep
**Last updated:** 2026-09-26 (Session 2 — React 19 lint sweep COMPLETE)

**Purpose:** everything a new chat needs to work on SETTINGS and future
features. Replaces MEMORY.txt (attendance-specific). Paste this at the start
of a new session.

**CURRENT STATE: `npm run lint` = 1 warning, 0 errors. `npx tsc --noEmit` =
clean.** The single remaining warning is DEFAULT_THRESHOLDS and is
DELIBERATE — see SM-14. Do not "fix" it.

---

## 0. WHO YOU ARE WORKING WITH

- Owner is a **medical student, not a developer**. Explain in plain English.
- **ALWAYS GIVE FULL FILE REPLACEMENTS** — complete text, ready to paste.
  Never diffs, snippets, or "change line 42 to...". Partial edits have
  repeatedly caused breakage.
- Start with **copiable PowerShell commands** (Windows), then VS Code steps.
- Back up before overwriting. Always offer the one-line rollback.
- **ONE FILE PER MESSAGE** when doing a multi-file sweep, with a test to run
  before moving on. Big multi-file messages get lost.
- Stack: Next.js **16.3.5** (Turbopack) · React **19** · TypeScript ·
  Tailwind **v4** · localStorage only, no backend.

### 0a. ⚠ VS CODE PASTE FAILURES — RECURRING, PLAN AROUND IT

Happened FOUR times in Session 2. A Ctrl+A / Ctrl+V / Ctrl+S in VS Code
**did not reach disk**; lint kept reporting the old line numbers. Suspected
cause: the tab held unsaved changes, so Ctrl+S wrote the OLD buffer back over
the paste.

**Signature:** line count unchanged, old code still at the same line number.

**Rule: for any file over ~300 lines, use PowerShell FIRST, not after a
failed paste.**

Whole-file write:

    @'
    ...file contents...
    '@ | Set-Content -Path "path\to\file.tsx" -Encoding UTF8

⚠ Avoid non-ASCII in here-strings (en-dashes, ▾ chevrons, ★). Some Windows
  locales mangle them, and a mangled character in JSX is a build error.
  Use `&#9662;` for ▾ and plain hyphens.

Always verify afterwards with `Select-String`.

### 0b. ⚠ SM-20 — POWERSHELL `-like` AND SQUARE BRACKETS

`-like` treats `[` and `]` as wildcard metacharacters. This:

    if ($line -like "*const [category, setCategory]*")   # MATCHES NOTHING

silently fails. It left a duplicate declaration in MarkList.tsx that ESLint
reported only as an "unused variable".

**Use `.Contains()` for literal text**, or escape as `` `[ `` and `` `] ``.

### 0c. ⚠ SM-21 — RUN BOTH CHECKERS

After any scripted or structural edit:

    npm run lint
    npx tsc --noEmit

ESLint does not type-check. In Session 2 it reported "unused variable" where
TypeScript saw a redeclaration, and it missed a removed prop still being
passed at two call sites entirely. **Neither tool alone is sufficient.**

---

## 1. THE HARD RULES (breaking these has cost whole sessions)

1. **Tailwind v4: never write `bg-[--color-x]`.**
   That arbitrary-value form generates NO CSS. No build warning, no console
   error, no red squiggle — the element just inherits and looks blank.
   Use real theme utilities: `bg-surface-sunk`, `text-ink-muted`,
   `border-line`, `rounded-card`, `rounded-field`, `accent-brand`.
   Caused invisible Present/Absent buttons, an unstyled setup page, a
   transparent SaveBar, and ~51 dead classes across 5 files.
   If you genuinely need arbitrary values, v4 syntax is PARENTHESES —
   `bg-(--color-safe)` — but every colour here is already a theme token.
   Also: `flex-[2]` is the same broken family. Write `flex-2`.

2. **Colour must mean ONE thing per screen.**
   `--color-practical` is the SAME green as `--color-safe`. Category colours
   are inline hex, matching the ring arcs exactly:
   - theory `#7c3aed` violet
   - practical `#ea580c` orange
   - clinical `#0891b2` cyan
   Never reintroduce green for "practical".

3. **Never rewrite a file that already works.** If a page passes its checks,
   touch only what is being fixed.

4. **Attendance store writes are synchronous + notify().** No draft state, so
   no page-level Save button — use a SaveBar-style confirmation. Silent
   success looks identical to silent failure.
   ⚠ The SETTINGS store is different: it uses explicit Save buttons with
   dirty-checking. Both patterns are correct in their own place.

5. **Mount gate everywhere.** localStorage does not exist on the server. Use
   `useSyncExternalStore` (see §2), not a useState + useEffect pair.

6. **Dates are dd/mm/yyyy ALWAYS. Times show am/pm. Week starts Monday.**
   Non-negotiable — the audience is Indian medical students, nobody reads
   mm/dd. A bare `<input type="date">` renders in BROWSER locale and will show
   mm/dd/yyyy. Use `components/attendance/DateField.tsx` instead.

---

## 2. ⚠ REACT 19 RULES — ALL ENFORCED, SWEEP COMPLETE

React 19's compiler-backed lint rules are strict. These patterns are law.
Session 2 cleared 15 problems down to 1 deliberate warning.

### SM-4 — NO setState INSIDE useEffect. ANYWHERE.

`react-hooks/set-state-in-effect`. Effects run AFTER paint, so setState in an
effect body renders once with WRONG data and corrects on a second pass. Not
theoretical: it caused the defaults-flicker on app open, a one-frame invalid
time in the class sheet, and a window where Save could file a class under a
category that subject does not have.

Four correct replacements, by situation:

| Situation | Fix |
|---|---|
| Reading an external store (localStorage, mount gate) | `useSyncExternalStore` |
| One-shot work (a migration) | module-level function with its own guard |
| Editing a saved value (a draft) | `useSyncedDraft` |
| Keeping a dropdown in range | `resolveChoice` — derive, don't store |

**An effect IS legitimate when it:**
- subscribes to an external system (keydown, resize) and calls setState only
  from the CALLBACK, never the body
- drives an external system (FileReader, body scroll lock, reporting upward
  to a parent prop)
- does cleanup only

### SM-7 — `lib/useSyncedDraft.ts` — THE SHARED HELPER

Created Session 2. Exports three things:

- **`useSyncedDraft(stored, areEqual?)`** — a draft that follows the store.
  Holds YOUR text while typing, catches up when storage changes elsewhere.
  Compares against a remembered `seen` value and calls setState DURING render
  (React discards the pass and re-runs before painting).
  ⚠ **Pass `jsonEqual` for objects and arrays.** The default `Object.is`
  compares IDENTITY — a store that rebuilds its object on every read would
  look "changed" every render and wipe edits as you make them. This is the
  one way the hook can be silently misused.
  ⚠ Never compare against the draft itself — the instant you type one
  character they differ, and it would erase your keystroke.

- **`jsonEqual(a, b)`** — deep compare via JSON. Safe because everything
  stored is plain JSON (that's what localStorage holds).

- **`resolveChoice(choice, options, fallback)`** — replaces the "snap the
  dropdown back into range" effect. State holds the raw CHOICE (may be stale,
  may be null); the effective value is computed each render. An invalid value
  never becomes a value, so it can never be painted.
  **Naming convention:** state is `xChoice` / `setXChoice`, the derived value
  is plain `x`. Buttons write the CHOICE.

⚠ **File lives at `lib/useSyncedDraft.ts`**, NOT `lib/attendance/`. It is used
  by settings pages too. Import as `@/lib/useSyncedDraft`.

### SM-13 — NO manual useCallback / useMemo the Compiler disputes

`react-hooks/preserve-manual-memoization`. React Compiler memoises
automatically. When a hand-written dependency list disagrees with what it
infers, it **skips optimising the ENTIRE component** — far worse than the
allocation saved. Delete the memo and let the Compiler work.

### SM-17 — `react-hooks/purity`

No `Date.now()` / `Math.random()` during render. Use a lazy initialiser:

    const [nowMs] = useState(() => Date.now());

Fine in event handlers. ⚠ Accepted consequence on the home dashboard: the
exam countdown freezes at mount and does not tick over at midnight. If it
ever needs to be live, use a timer calling `setNowMs` from a callback —
never a clock read during render.

### SM-18 — `URL.createObjectURL` BREAKS UNDER STRICTMODE

⚠ This one produced a **black circle with no console error** and cost real
time to diagnose.

    const [url] = useState(() => URL.createObjectURL(file));       // BROKEN
    useEffect(() => () => URL.revokeObjectURL(url), [url]);

1. StrictMode mounts, runs effects, then UNMOUNTS and REMOUNTS.
2. The simulated unmount runs cleanup, which REVOKES the URL.
3. The remount preserves state, so `url` is the same string pointing at
   nothing.
4. onLoad never fires → dims stays null → dead UI, silent.

**Use `FileReader` + a data URL.** It cannot be revoked, so the failure mode
disappears. Setting state in `reader.onload` is the documented, permitted use
of an effect.

### Also: `react-hooks/refs`

No reading `ref.current` during render. Refs are not render inputs — changing
one re-renders nothing, so layout computed from a ref can be built from values
React has never seen. Put the value in state via an event (e.g. `onLoad`).

### SM-3 — REMOUNT, DON'T RESET

If a component needs to reset when its input changes, don't write reset logic.
Have the parent mount it conditionally with a `key`:

    {cropFile && <PhotoCropper key={`${f.name}-${f.lastModified}-${f.size}`} ... />}

A new key means a genuinely new component and every piece of state starts
fresh automatically. Nothing to reset, nothing to forget when a new field is
added later. This removed five setState calls from one effect in PhotoCropper.

⚠ Conditional mounting also means the child can type its prop as non-null.
  Rendering unconditionally with `file={null}` is what threw
  "createObjectURL: Overload resolution failed".

---

## 3. THE BOUNDARY — SETUP vs SETTINGS

Decided Session 1. Hold this line; it drifted three times before.

- **/attendance/setup = FACTS ABOUT YOUR COLLEGE.**
  College hours, working days, the weekly grid, postings, term dates,
  carry-forward data, export/import. It is a *builder*, needs a full canvas.

- **/settings = YOUR PREFERENCES.**
  Thresholds, unmarked policy, extra-class defaults, notifications, theme,
  text size, backup cadence, help, about. It is a *list of rows*.

**Deliberately NOT merged.** A builder crammed into a settings list makes both
worse. Setup carries a pointer at the bottom: "Looking for attendance targets?
They live in Settings."

---

## 4. SETTINGS PAGE — AGREED STRUCTURE

Seven top-level rows. Never deeper than two levels; a third level uses a
SHEET, not another page.

1. **Academics** — profile, university (NTRUHS, locked), year, subjects,
   term dates, working days, college hours
2. **Attendance** — default thresholds (theory 75 / practical 80 /
   clinical 80), per-subject overrides (sparse; blank = default), danger
   margin, unmarked policy, extra-class default, opening balance, blockouts,
   postings, timetable
3. **Notifications** — master toggle, daily reminder, unmarked nudge,
   danger alert, quiet hours
4. **Appearance** — theme (no auto dark mode yet), text size, date/time
   format, week start, density, reduce motion
5. **Data & Backup** — export, import (must preserve entry ids), last backup,
   storage used, reset (destructive, bottom, confirm)
6. **Help** — quick start, FAQ, standings glossary, report a bug
7. **About** — version, what's new, licences, hidden developer unlock
   (tap version 7 times)

Later, without disturbing the order: Study & Learning (row 3 when the question
bank ships), Privacy & Security, Accessibility, Language & Region.

**Destructive actions obey one shape everywhere:** red text, bottom of its
section, separated by a gap, always a confirm step, never beside a harmless one.

---

## 5. ⚠ WHAT ALREADY EXISTS UNDER /settings (SM-6)

**`/settings` is NOT greenfield.** These exist and are all lint-clean:

    app/settings/profile/page.tsx            name, photo, birthday, year
    app/settings/profile/PhotoCropper.tsx    crop UI — FileReader, remount-keyed
    app/settings/academics/page.tsx          exam date, ENT/Ophtha toggle
    app/settings/academics/subjects/page.tsx per-year exam subjects
    app/store/settings.tsx                   the settings store + provider

**SM-12 — there is still NO `app/settings/page.tsx`.** All of the above are
orphan routes reachable only by typing the URL. **Building that index shell is
the next session's main job.**

⚠ The settings pages use a DIFFERENT dark palette from the attendance
  module — see SM-10. Resolve when building the shell.

---

## 6. THE SETTINGS STORE — `app/store/settings.tsx`

Rewritten Session 2. Key facts:

- **ONE state object**, not twelve useState calls. Previously `persist()` took
  **twelve positional arguments** and all twelve setters had to pass them in
  the right order — 144 positional args, any two swappable without any tool
  catching it. Now `commit({ field: value })`, a named partial patch.
- **Loads during render**, not in an effect, gated by `useSyncExternalStore`
  for client detection. This removed the defaults-flicker on app open.
- **Two storage keys**, both written on every save:
  - `medprep.settings.v1` — full record
  - `medprep.profile.v1` — legacy projection, year stored as "1".."4"
- `loadStored()` falls back through every historical format: legacy year
  codes, single joined `name` string, missing customExamSubjects keys.
  Each field checked independently so one corrupt field costs only itself.
- `covered` is session-only, never persisted.
- `normalizeExamMap` enforces: a subject may be examined in ONE year only,
  earlier years win.
- **Every mutation goes through `commit()`.** Bypassing it updates the screen
  without updating storage — the change vanishes on refresh, which is the
  hardest bug to notice because everything looks right until you close the tab.

### ⚠ SM-8 — THE PHOTO QUOTA BOMB (highest-risk open item)

`photo` is a base64 data URL written into **BOTH** storage keys — stored
twice. A 2 MB photo becomes ~5.5 MB and exceeds the ~5 MB localStorage quota.
`persist()` catches and **swallows** the error, so **every setting silently
stops saving** with no error anywhere.

Partial mitigation exists: PhotoCropper caps its export at `MAX_BYTES =
350_000`, stepping JPEG quality down and then shrinking to 320px if needed.
**Proper fix still outstanding:** drop `photo` from PROFILE_KEY so it is
stored once, not twice.

---

## 7. VOCABULARY — USE THESE EXACT WORDS

Five standings, never percentages in the resting view:
**On track · Watch · Behind · Well behind · Critical**

Header counts must be OUTSTANDING ACTIONS ("5 unmarked"), never scores.
A number in a header should be drivable to zero by doing something.

---

## 8. OPEN ITEMS

### Lint — CLEAR

    npm run lint    → 1 warning (deliberate)
    npx tsc --noEmit → clean

**SM-14 — `DEFAULT_THRESHOLDS` in `calculate.ts:51` is flagged unused.
DO NOT DELETE IT.** It is the constant the settings thresholds page will
consume. The warning disappears the moment it is wired up. This is the
*reason* Attendance should be the first settings section built.

### Architecture

- **SM-1 — migrations run in the wrong place.** `runMigrations()` is called in
  `app/attendance/page.tsx` only. A student whose first stop is /settings reads
  pre-migration data. Proper home is the root layout. `layout.tsx` also has an
  outstanding font issue — fix both in one pass when the settings shell is built.
- **SM-2 — duplicate attendance settings screen.** `app/settings/attendance/page.tsx`
  may still exist and may still read the deleted `targetPercent`. One screen
  survives; the other redirects. Resolve before building Attendance settings.
- **Thresholds have nowhere to live.** The real gap, and the reason Attendance
  should be the first settings section built.

### UI / polish

- **SM-9** — DateField's mask does not preserve caret position on mid-string
  edits (the caret jumps to the end). Accepted trade-off: fixing it properly
  means measuring digit offsets and restoring selection by hand. Dates are
  typed left-to-right or picked from the calendar.
- **SM-10 — THREE PALETTES IN THE APP.** `DateField.tsx` uses
  `neutral-*` / `emerald-*`; the settings pages use `slate-*` / `teal-*`; the
  attendance module uses theme tokens (`ink`, `surface`, `line`, `brand`).
  Three languages for the same thing. **Recommendation: standardise on theme
  tokens** — they are what `@theme` generates and they cannot silently fail
  the way the bracket form did. Unify when building the settings shell.
- **SM-11** — `TermPanel.tsx` still uses native `<input type="date">`, so it
  renders in browser locale, not dd/mm/yyyy. Now a one-line swap to
  `DateField`, which handles the mask properly.
- **SM-16** — `app/page.tsx` greeting is hardcoded "Good evening, Abhi".
  Neither the name nor the time of day is live, though `settings.firstName`
  is already in scope.
- **SM-5** — `w-0.75` equals 3px only while the Tailwind spacing scale stays
  on its 4px base. The category rails in setup depend on this.

### SM-19 / SM-22 — BROKEN TAILWIND: CLEARED, BUT WILL RECUR

All `[--color-*]` / `[--radius-*]` / `[--shadow-*]` classes fixed across
TermPanel, DataPanel, PostingsPanel, SaveBar and WeekStrip. ~51 total.

**The conversion is fully scriptable:**

    $c = [regex]::Replace($c, '\[--(?:color|radius|shadow)-([a-z0-9-]+)\]', '$1')

It works because every design token in `@theme` already generates a matching
utility. Detection grep (filters out comments, which are false positives):

    Get-ChildItem -Recurse -Include *.tsx |
      Select-String -Pattern "\[--color|\[--radius|\[--shadow" |
      Where-Object { -not ($_.Line.TrimStart().StartsWith("//") -or
                           $_.Line.TrimStart().StartsWith("*")) } |
      Select-Object Filename, LineNumber

⚠ **Run this after any batch of UI work.** The failure is silent by nature, so
  it will keep recurring until nobody writes the bracket form.

---

## 9. SESSION LOG

### 2026-09-26 — Session 1 (settings planning)
- Mapped all 13 possible submenus, trimmed to the 7 in §4.
- Decided the setup/settings boundary (§3). Chose NOT to merge.
- Rewrote `app/attendance/setup/page.tsx`: all `bg-[--color-*]` replaced with
  real utilities; category colours moved to inline hex; `minutesBetween()`
  helper; body scroll lock; `role="dialog"` + `aria-modal` on sheets;
  `role="alert"` on errors; Settings pointer line. No logic changed.
- Updated `app/attendance/page.tsx`: Settings link, `aria-live` on the
  migration note, aria-label on the unmarked chip.

### 2026-09-26 — Session 2 (React 19 lint sweep) — COMPLETE
**15 lint problems → 1 deliberate warning. 16 files touched.**

**Pattern A — stored-value drafts (6 files)**
- **Created `lib/useSyncedDraft.ts`** — `useSyncedDraft`, `jsonEqual`,
  `resolveChoice`. ⚠ Initially created in the wrong folder
  (`lib/attendance/`), causing a module-not-found; moved to `lib/`.
- `app/settings/profile/page.tsx` — 6 drafts → `useSyncedDraft`.
- `app/settings/academics/page.tsx` — 2 drafts → `useSyncedDraft`.
- `app/settings/academics/subjects/page.tsx` — object draft →
  `useSyncedDraft` + `jsonEqual`. First use of the deep comparison.
- `app/attendance/setup/TermPanel.tsx` — drafts → `useSyncedDraft`;
  ~20 broken Tailwind classes; `useCallback` removed.
  ⚠ Took three attempts — VS Code paste kept not reaching disk.
- `components/attendance/DateField.tsx` — two passes:
  1. draft sync during render instead of an effect
  2. **a real dd/mm/yyyy input mask.** The field previously accepted ANY text
     and only validated on blur — it happily held "2489612329473", thirteen
     digits, and never punctuated as you typed. Now: digits only, slashes
     inserted automatically, hard cap at 8 digits, auto-commit on the 8th,
     paste re-masked, "Not a real date" for 32/13.
     ⚠ No trailing slash is ever auto-added — "25" does NOT become "25/".
     Doing so makes backspace impossible (delete the slash, the mask puts it
     straight back). Slashes only appear once the digit after them exists.
- `app/store/settings.tsx` — twelve useState → one state object; twelve
  positional persist args → one named patch; load moved from an effect into
  render via `useSyncExternalStore`. ~470 lines → ~330. Removed the
  defaults-flicker on app open.

**Pattern B — dropdown resync (2 files)**
- `app/attendance/components/MarkList.tsx` — category effect → `resolveChoice`.
  ⚠ SM-20 bit here: a `-like` pattern with square brackets silently failed,
  leaving a duplicate declaration that only `tsc` would have caught.
- `app/attendance/setup/DataPanel.tsx` — same fix, plus ~30 broken Tailwind
  classes and `flex-[2]` → `flex-2`. Kept `saved` in the useMemo deps as a
  deliberate cache-buster with `void saved` making it explicit.

**Patterns C, D, E**
- `app/attendance/page.tsx` — deleted the disputed `useCallback` (SM-13).
- `app/page.tsx` — `Date.now()` → lazy `useState` initialiser (SM-17).
- `app/settings/profile/PhotoCropper.tsx` — the hardest one. Effect with five
  setState calls + ref read during render. Fixed by remount-keying from the
  parent (SM-3) and moving image dimensions into state via `onLoad`.
  ⚠ Then hit SM-18: `createObjectURL` + StrictMode = black circle, no error.
  Switched to `FileReader`. Also fixed a real zoom-clamp drift bug where the
  slider clamped against the PREVIOUS zoom.
- `app/attendance/components/AttendanceRing.tsx` — removed the unused `tone`
  prop. ⚠ ESLint passed while `tsc` failed: the signature changed but two
  call sites still passed it (SM-21).

**Tailwind sweep (SM-19)**
- `PostingsPanel.tsx` (13), `SaveBar.tsx` (5), `WeekStrip.tsx` (1) —
  scripted regex conversion. SaveBar was the worst: the pinned footer on
  every setup screen had been rendering transparent.

**Bugs fixed that were NOT lint errors:**
1. defaults-flicker on app open
2. 13-digit date field
3. no dd/mm punctuation while typing
4. StrictMode black-circle cropper
5. zoom-clamp drift in the cropper
6. ~51 invisible Tailwind classes across 5 files

**Next up:**
1. **SM-12 — build the `/settings` index shell**, the 7 rows of §4, around the
   pages that already exist (§5). Decide the palette first (SM-10 —
   recommend theme tokens). Fix SM-1 in the same pass.
2. Then the Attendance settings section, so thresholds finally have a home
   and SM-14 resolves itself.
3. SM-8 (photo stored twice) is the highest-risk outstanding bug — worth
   folding into the Data & Backup section.
