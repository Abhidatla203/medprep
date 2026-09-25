# Attendance Rebuild — Handoff and Progress Report

**Project:** `C:\Users\abhid\Desktop\medprep`  
**Module:** `app/attendance`  
**Stack:** Next.js 16.3.5 (Turbopack), React 19, TypeScript, Tailwind v4  
**Handoff date:** 24 September 2026  
**Status:** **STOPPED. BUG FIXING ONLY. Do not start the next feature.**

This file is the session handoff. Read it before writing code.

Related files:

- `ATTENDANCE_REBUILD_SPEC.txt` — product intent / design spec
- `MEMORY.txt` / `MEMORY.md` — working rules and trap list (may be slightly optimistic; this handoff is more current)
- Actual source of truth for behaviour: **the files on disk**, not chat history

---

## 0. Hard rule for the next session

**Fix every known attendance bug before any new feature, polish pass, or expansion.**

Do not start:

- a new attendance feature
- RingGrid “improvements” that are not bug fixes
- settings redesign
- navigation work
- visual makeover of the whole app
- relocating migrations to root layout (unless it is required to diagnose a live bug)

The compiler is not enough. The attendance screen is not done until a student can mark classes and the rings, week preview, and calculator all agree with those marks.

The product requirement that is currently failing:

> Marks made in the UI must drive generated sessions, calculated percentages, and rings.

Until that is true, nothing else matters.

---

## 1. What this session was trying to do

The attendance page was being rebuilt so it behaves like a real app, not a cheap HTML dashboard.

Intended page order:

1. `WeekStrip` — read-only week timetable preview
2. `MarkList` — the only marking surface
3. `RingGrid` — standing by subject and class type

Intended product rules:

- No “Other subjects” dropdown on the main page
- Every exam-year subject in this year’s schedule appears in the main UI
- Theory and practical/clinical are counted separately
- No pooled overall percentage
- Ring colour = class type identity, not safety
- Safety lives on the label and threshold tick
- Numbers belong in a modal, not on the resting rings
- Week preview days = rows, time = columns
- Class width should reflect duration
- Breaks are inferred, not configured
- Times must read `2pm`, `10:30am`, never bare `2`
- Present / Absent / Cancelled must be colour-coded and visible
- Unmarked classes must look unmarked; no guessed default

---

## 2. Files touched or rewritten this session

### Logic

| File | Role | Session status |
|---|---|---|
| `app/attendance/types.ts` | Domain types | Exists; inspect on disk before changing |
| `app/attendance/store.ts` | Persistence, marks, version, subscribe | **Prime suspect. Not inspected/fixed in the last two messages.** |
| `app/attendance/calculate.ts` | Pure calculator + memoised UI layer | Reviewed. Core arithmetic looks correct. **Not proven against live data.** |
| `app/attendance/generate.ts` | Timetable + extras → dated sessions | **Prime suspect. Not inspected/fixed in the last two messages.** |

### UI

| File | Role | Session status |
|---|---|---|
| `app/globals.css` | Theme, modal, tiles, ring CSS | Ring track darkened; modal styles added. Tailwind v4 token usage still a trap |
| `app/attendance/page.tsx` | Assembles strip + list + rings | Dropdown/helper text removed. Hydration gate + page-scoped migrations |
| `app/attendance/components/WeekStrip.tsx` | Week preview | Segment model, am/pm, type stripe/letter. **Must be verified on disk — several pastes were truncated** |
| `app/attendance/components/MarkList.tsx` | Daily marking | Colour-coded P/A/C; Tailwind `bg-[--color-*]` bug addressed in the supplied replacement |
| `app/attendance/components/RingGrid.tsx` | Standing rings + modal | Multiple rewrites. Geometry now intended to use `attended/conducted`. **Still not matching marked data in screenshots** |

### Not created

| File | Why it matters |
|---|---|
| `app/attendance/debug/page.tsx` | Proposed diagnostic route. **NOT created.** |

---

## 3. What was completed or attempted

### 3.1 Architecture that should remain

- `page.tsx` owns `selectedDate` so WeekStrip and MarkList cannot drift
- Mount gate: first client render matches the server skeleton; store reads happen only after mount
- `runMigrations()` is called in the attendance page effect, before `setMounted(true)`, with a `useRef` StrictMode guard
- Marking happens only in MarkList. WeekStrip is read-only
- Rings are a resting view. Numbers belong in a modal
- No “other subjects” disclosure on the main page

### 3.2 UI fixes attempted

1. **Invisible unmarked ring track**  
   Track was `#e9e5de` on `#fbfaf7` (about 4% luminance). Intended fix: darker visible grey, plus a dashed empty state for “no classes yet”.

2. **Detail card felt like cheap HTML**  
   Inline card below the grid was replaced with a centred modal: scrim, backdrop blur, spring scale, Escape, scrim tap, body scroll lock via `body[data-modal-open="true"]`.

3. **No other-subjects dropdown**  
   Main grid should show this year’s exam subjects. Non-exam subjects stay tracked in data, not behind a disclosure.

4. **Times showing as `2` instead of `2pm`**  
   `formatTime()` was changed to always include am/pm.

5. **Class length and breaks not visible**  
   WeekStrip was rewritten around a **segment model**:
   - collect every start/end boundary
   - width ∝ duration in minutes
   - uncovered gaps ≥ 20 minutes become inferred breaks
   - consecutive breaks merge
   - short gaps stay changeover, not lunch

6. **Present click made the button go blank**  
   Cause: Tailwind v4 does not generate `bg-[--color-safe]`. `text-white` applied, background did not → white on white.  
   Intended MarkList classes: `bg-safe`, `bg-safe-soft`, `bg-critical`, etc.

7. **Class type missing from week preview**  
   Intended: status owns the **fill**; type rides on a 3px left stripe + `T` / `P` / `C` letter.  
   Colours (hard-coded on purpose):

   ```
   theory    #7c3aed  violet   track #cfc7dd
   practical #ea580c  orange   track #e6d9cd
   clinical  #0891b2  cyan     track #c9dbe0
   ```

   Practical must not use the same green as Present.

8. **Helper copy removed**  
   User did not want the explanatory paragraph under “Where you stand” or the “other subjects tracked” footnote.

### 3.3 Ring rewrites — important history

Rings were rewritten several times. Do **not** rewrite them again until the data path is proven.

Known failed/fixed ring bugs:

| Bug | Cause | Lesson |
|---|---|---|
| Full circles for every subject | `result.ratio` treated as 0–1 while calculator `ratio` is 0–1 from `attended/conducted` in calculate.ts, but an earlier display path may have assumed 0–100. Screenshot later still showed full rings | Geometry must use `attended / conducted` only |
| Dashed empty ring + “Critical” label | Pair-based ring selection dropped a real category; empty vs band disagreed | Draw every real category; empty categories must not be Critical |
| Invisible track | Near-white grey on warm canvas | Track is the denominator; it must be visible |
| Colours vanished | CSS class / Tailwind token silently generated nothing | RingGrid now hard-codes stroke colours |

**Current intended ring math:**

```ts
const fraction = conducted > 0 ? attended / conducted : 0;
const dashOffset = circumference * (1 - fraction);
```

Do not feed `ratio` or `percentDisplay` into SVG geometry.

---

## 4. Current status: the rebuild is NOT done

Construction of the eight-step module happened. **Verification failed.**

The user marked mock attendance (Present / Absent mix). The rings did not match:

- some subjects looked fully attended / Safe
- another subject looked like “no classes” while labelled Critical
- practical rings were missing or not obvious
- the week preview still needed class-type confirmation in the browser

That screenshot is why work stopped.

**Do not treat MEMORY.txt “all 8 steps done, 0 tsc errors, shakedown only” as permission to polish.** Shakedown found a correctness bug. Stay on it.

---

## 5. Calculator review (`calculate.ts`) — what we know

The uploaded `calculate.ts` core is conceptually correct:

```
present       → attended += weight; conducted += weight
absent        → conducted += weight
not-conducted → neither (Cancelled)
unmarked      → neither; past unmarked increment unmarkedCount; future add remainingWeight
```

Also:

- `exactRatio(attended, conducted)` returns **0–1**, never rounded
- `percentDisplay` is rounded to 1 decimal **for printing only**
- `bandFor` compares `ratio * 100` to threshold (75 / 80 etc.)
- empty categories (`conducted <= 0`) are `isEmpty: true` and band `'safe'`
- `worstBandOf` skips empty and excluded categories
- results are memoised in memory on `DataVersion` from `getDataVersion()`
- extras denominator policy is per extra class, with a temporary lookup fallback because generate.ts may not yet copy `countsTowardDenominator` onto sessions

### What this means

If rings show 100% after absences, **the calculator is probably receiving the wrong sessions**, or a **stale cached YearResult**, or the **UI is not receiving a new result**.

Do not “fix” RingGrid to compensate.

### Product-rule gap (not the screenshot bug)

Past **unmarked** classes are currently **excluded from the denominator**.

Example:

```
Present, Present, Unmarked, Unmarked
→ 2/2 = 100%
```

That is documented in calculate.ts. Decide later whether past unmarked classes should count as conducted. Do **not** change this until the Present/Absent path is proven. It does **not** explain absences disappearing.

### Known calculate.ts follow-ups (lower priority than the mark pipeline)

- Confirm `generate.ts` copies `countsTowardDenominator` onto extra sessions so the lookup fallback can die
- Confirm `getDataVersion()` actually changes on every `setMark`
- Confirm cache invalidation if version does not bump
- Empty + Critical self-contradiction in the screenshot cannot come from `worstBandOf` + `isEmpty` as written, unless the UI is mixing fields, using stale objects, or not running this file

---

## 6. NOT DONE — last two messages (add to the top of the TODO)

Work stopped before these steps. They are the first work on resume.

### 6.1 Temporary debug page — NOT created

Proposed: `app/attendance/debug/page.tsx`

It should:

- run migrations, then read the store
- independently tally generated sessions for ~the last 28 days + next 7
- count present / absent / cancelled / unmarked **by subject · category**, using session `weight`
- print expected `present / (present+absent)`
- dump `JSON.stringify(getYearResult(year), null, 2)`
- compare the independent tally with calculator output

This page was never added to the repo.

### 6.2 Console instrumentation in `getYearResult()` — NOT added

Proposed: before/while computing, log:

- every generated session: id, subject, category, status, weight, date
- `DataVersion`
- the calculated year result

Then mark one class absent and inspect the console.

Expected after one present + one absent in the same subject/category:

```
attended: 1
conducted: 2
ratio: 0.5
percentDisplay: 50
```

If the session list only contains `present`, the bug is `store.ts` or `generate.ts`.  
If sessions are right and the result is still `1/1`, the bug is calculation / ID / category mismatch.  
If the result is right and the ring is still full, only then touch `RingGrid.tsx`.

### 6.3 Direct inspection of `store.ts` and `generate.ts` — NOT done

These were identified as the likely fix locations and were **not opened and repaired**.

`setMark()` must:

1. persist status under the exact session id
2. increment `DataVersion`
3. notify subscribers

`generate.ts` must:

- attach stored status using that **same** id
- not drop absent sessions
- not change id because of category, date format, `08:00` vs `8:00`, extra vs regular, subject id vs name

### 6.4 End-to-end mark trace — NOT done

For one known class, nobody yet verified:

1. generated session id before marking
2. stored mark key after Present/Absent
3. generated session status after marking
4. DataVersion before and after
5. subscriber / page `revision` after marking
6. status after full page refresh

### 6.5 TypeScript after the latest full replacements — NOT confirmed

Earlier in the session:

```
npx tsc --noEmit
RingGrid.tsx: Cannot find name 'SubjectModal'
```

A complete `SubjectModal` was later supplied. The user did **not** paste a later clean `tsc` result after the final WeekStrip / page / RingGrid replacements.

Some replacements were truncated mid-file and resent. **Do not assume disk matches chat.**

First commands on resume:

```powershell
cd C:\Users\abhid\Desktop\medprep
npx tsc --noEmit
```

Then read the real files. Do not paste another RingGrid from memory.

---

## 7. TODO — ordered, bug-first

### P0 — stop the bleeding (do these first)

1. Read the real files on disk, especially:
   - `app/attendance/store.ts`
   - `app/attendance/generate.ts`
   - `app/attendance/calculate.ts`
   - `app/attendance/types.ts`
   - `app/attendance/components/RingGrid.tsx`
   - `app/attendance/components/WeekStrip.tsx`
   - `app/attendance/components/MarkList.tsx`
   - `app/attendance/page.tsx`
2. Run `npx tsc --noEmit` and record the exact output.
3. Create the temporary debug page **or** equivalent console logging.
4. Trace **one mark** from click → localStorage → generate → calculate → RingGrid.
5. Fix the **earliest** broken layer:
   - wrong stored key → `store.ts` / session id
   - stored key right, generated status wrong → `generate.ts`
   - sessions right, numbers wrong → `calculate.ts`
   - numbers right, ring wrong → `RingGrid.tsx`
   - data updates, UI does not → subscribe / DataVersion / page `revision`
6. Prove Present, Absent, and Cancelled all update:
   - MarkList row
   - WeekStrip tile
   - calculator `attended` / `conducted`
   - ring fraction
   - after refresh
7. Delete or clearly mark temporary debug code after the fix.

**Do not move past P0 until the testing matrix below is green.**

### P1 — verify the rest of this screen (still bugs / shakedown, not new features)

8. Theory and practical/clinical percentages are independent.
9. Ring unfilled remainder is visible grey; theory grey ≠ practical grey.
10. Week preview shows subject **and** class type (stripe + letter), colour-coded, without using Present-green for practical.
11. Time headers show `9am`, `10:30am`, `2pm`.
12. Longer classes are visibly wider.
13. Inferred breaks are visible.
14. Modal: blur, centre, Escape, scrim, no background scroll.
15. No leftover helper paragraph / other-subjects dropdown.
16. Hydration: no mismatch warning.
17. Grep the module for `.ratio` and confirm nothing else still assumes the wrong units.

### P2 — only after P0 and P1 pass

18. Decide unmarked-past-class denominator policy and document it.
19. Copy `countsTowardDenominator` from extras onto generated extra sessions; delete calculate.ts fallback if unused.
20. Filter generation by `settings.college.workingDays` if Sunday classes still appear for a 6-day college.
21. Cache term expansion in generate.ts if `generateForYear()` is expensive.
22. Move `runMigrations()` to a root-layout client effect so `/settings` and `/attendance/setup` are not pre-migration.
23. Turbopack font issue in `layout.tsx`.
24. Shorten `subjectShort()` codes if they truncate on a 360px phone.
25. Whole-app visual makeover (user asked; **explicitly deferred**).

---

## 8. Testing matrix — must pass before any next feature

| Test | Expected | Status |
|---|---|---|
| Present click | Row, week tile, calculator, ring update | **NOT VERIFIED / FAILING** |
| Absent click | conducted grows, attended does not; ring partial | **NOT VERIFIED / FAILING** |
| Cancelled click | neither attended nor conducted | **NOT VERIFIED** |
| Repeat same button | returns to unmarked | **NOT VERIFIED** |
| Refresh | marks persist | **NOT VERIFIED** |
| DataVersion | increments on mark | **NOT DONE** |
| Subscribe / revision | UI recomputes on mark | **NOT DONE** |
| Session id | `setMark` key === generated session id | **NOT DONE** |
| Independent tally vs `getYearResult` | agree | **NOT DONE** |
| Theory vs practical | separate percentages | **NOT VERIFIED** |
| Ring arc | `attended/conducted` fullness | **FAILING IN SCREENSHOTS** |
| Ring track | visible category-specific grey | **NOT VERIFIED** |
| Empty vs band | no dashed-empty + Critical | **FAILING IN SCREENSHOTS** |
| Week type coding | stripe + T/P/C | **NOT VERIFIED IN BROWSER** |
| Times | include am/pm | **NOT VERIFIED IN BROWSER** |
| Duration width | long class wider | **NOT VERIFIED IN BROWSER** |
| Breaks | inferred and visible | **NOT VERIFIED IN BROWSER** |
| `tsc --noEmit` | 0 errors after latest files | **NOT CONFIRMED** |
| Hydration | no mismatch | **NOT CONFIRMED after last replacements** |

No next feature until this table is actually checked in the browser, not inferred from chat.

---

## 9. Working rules (do not regress)

1. **Full replacement files only.** Partial “insert this block” edits have broken the project.
2. **One file at a time.** Compile after each file.
3. Short table of what changes and why, before the code.
4. Heavy comments for *why*, not *what*.
5. Ask for the real file; do not guess export names.
6. If a paste might truncate, send that file alone.
7. Never use Tailwind v4 `bg-[--color-safe]`. Use `bg-safe` or explicit `style`.
8. Never build `chip-${band}` / `ring-label-${band}` by interpolation. Band names differ:
   - types: `safe | warning | danger | critical`
   - CSS: `safe | watch | risk | critical`
9. Monday is `0` in this codebase. JS `getDay()` is Sunday `0`.
10. Never `toISOString()` for local calendar dates (IST after 18:30 shifts the day).
11. Arc ticks: measure from `-90°` if arcs start at 12 o’clock.
12. Ring geometry: `attended / conducted` only.
13. Do not shrink rings below ~96px.
14. Draw only real categories, not every curriculum possibility.
15. StrictMode: one-time work needs a `useRef` guard.
16. Calculation cache must die when marks change.
17. Paths: `app/attendance/page.tsx` vs `app/attendance/setup/page.tsx` look identical in editor tabs.

---

## 10. Likely root cause going into the next session

Highest probability, in order:

1. **`setMark()` does not bump DataVersion and/or does not notify**, so `getYearResult()` returns a cached year and rings stay at the previous (often empty or all-present) state.
2. **Session id mismatch** between MarkList / `setMark` and `generate.ts`, so absences never attach.
3. **`generate.ts` not reading marks**, or reading them after filtering.
4. Only then: RingGrid stale props / wrong fields.

The calculator’s present/absent arithmetic, as uploaded, should produce partial rings if it sees both statuses.

---

## 11. Suggested resume prompt

> Read `ATTENDANCE_REBUILD_PROGRESS.md` fully before writing code.
>
> Project: `C:\Users\abhid\Desktop\medprep`, attendance module.
>
> We are paused. **Do not build a new feature.** Fix bugs first.
>
> The last two proposed steps were **not done**: no debug page, no `getYearResult` logging, no inspection/fix of `store.ts` or `generate.ts`.
>
> First: inspect files on disk, run `npx tsc --noEmit`, then trace one Present and one Absent mark from click to ring.
>
> Do not rewrite RingGrid until generated sessions and `getYearResult()` are shown to be wrong or right.
>
> Do not continue to the next feature until the testing matrix in the handoff file passes with real marked data.

---

## 12. One-paragraph summary

The attendance rebuild has a real page assembling a week preview, a marking list, and subject rings, with a hydration gate, page-scoped migrations, colour-coded P/A/C controls, inferred-break timetable segments, and a modal ring detail view. That construction is **not** a finished product. Marked attendance still does not reliably appear in the rings. The last session identified `store.ts` / `generate.ts` / cache invalidation as the next investigation and then **stopped before doing it**. Resume there. Fix the mark pipeline. Verify in the browser. Only then consider another feature.
