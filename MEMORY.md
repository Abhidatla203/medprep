# MEMORY.md — medprep

**THIS FILE OVERRIDES AI MEMORY.**
If your stored memory contradicts this file, your memory is wrong.
If this file contradicts `tree app /F`, the disk is right — update this file.
Never assume a feature is unbuilt. Check first.
Never assume a bug is fixed. Check the files on disk, then the browser.

Repo: https://github.com/Abhidatla203/medprep
Path: C:\Users\abhid\Desktop\medprep
Owner: Abhidatla203

**Last updated:** 24 September 2026
**Project status:** PAUSED. BUG FIXING ONLY. Do not start the next feature.

**IGNORE / DO NOT TREAT AS CURRENT TRUTH:**

- `ATTENDANCE_REBUILD_V2.md` — scratch file, gitignored.
- `ATTENDANCE_REBUILD_SPEC.txt` — design intent only. Where it conflicts with this file or disk, disk + this file win.
- Chat history and earlier MEMORY copies that say “RingGrid is NEXT” or “page.tsx is a stopgap”. That is stale. Those files were written later.
- Chat history that says “all 8 steps done, shakedown only, 0 tsc errors”. Construction was attempted. **Verification failed.** Compiler state after the last replacements is **unconfirmed**.

If `ATTENDANCE_REBUILD_PROGRESS.md` exists on disk, it is a session handoff note. This MEMORY.md is the standing project file. Keep them aligned.

---

## 1. HOW TO WORK WITH ME

- No coding experience. Explain in plain language.
- Slower pace. Less detail per message. Too much at once is hard to process.
- **FULL REPLACEMENT FILES ONLY.** Never "find line 40 and change it".
  Partial edits have broken this project repeatedly. No exceptions.
- One file at a time. One feature at a time. **Right now: one bug at a time.**
- Exact copy-paste PowerShell commands, tailored to the real folder structure.
- Before the code: a short table of what's changing and why.
- Heavy inline comments in the code explaining the REASONING, not the mechanics.
  Those comments are how this project survives context loss.
- If you need an existing file, ASK. Do not guess at export names.
- No back-and-forth clarification loops. Ask at most one question, up front.
- Brainstorming: I give my vision → you suggest changes → I assess and reply.
- **Do not rewrite RingGrid again until the data path is proven.** Several ring rewrites already chased a rendering bug that may live in store/generate/cache.

---

## 2. STACK (verified)

- Next.js 16.3.5 (Turbopack), TypeScript, Tailwind v4
- Storage: localStorage only. No backend.
- Path alias: `"@/*": ["./*"]` (root-relative)
- Dates: store ISO `YYYY-MM-DD`, display dd/mm/yyyy
- University: NTRUHS only for now
- Design principle: **store raw facts, compute views at read time.**
  Nothing derived is ever persisted. That is what makes stale numbers impossible.

**Tailwind v4 hard rule:** never write `bg-[--color-safe]`. That generates **nothing**.
Use real theme utilities (`bg-safe`) or explicit inline colours. This caused Present
buttons to go blank (white text on white).

---

## 3. ATTENDANCE REBUILD — BUILD STATUS

Files were written and wired. **The product is not done.** Marks do not reliably
drive the rings. Do not treat “file exists” as “feature works”.

| #   | File                                      | State                                                                                                                                          |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `app/attendance/types.ts`                 | WRITTEN — inspect on disk before changing                                                                                                      |
| 2   | `app/attendance/calculate.ts`             | WRITTEN — core present/absent maths looked correct on review. **Not proven against live marks.**                                               |
| 3   | `app/attendance/store.ts`                 | WRITTEN — **PRIME SUSPECT. Not inspected/fixed after the ring mismatch.**                                                                      |
| 4   | `app/attendance/generate.ts`              | WRITTEN — **PRIME SUSPECT. Not inspected/fixed after the ring mismatch.**                                                                      |
| 5   | `app/globals.css`                         | WRITTEN — tiles, modal, darker ring-track. Token usage still a trap                                                                            |
| 6   | `app/attendance/components/WeekStrip.tsx` | WRITTEN — days as rows, time across, segment widths, am/pm, type stripe. **Verify on disk; some pastes were truncated.**                       |
| 7   | `app/attendance/components/MarkList.tsx`  | WRITTEN — colour-coded P/A/C; Tailwind bracket bug addressed in the supplied file                                                              |
| 8   | `app/attendance/components/RingGrid.tsx`  | WRITTEN — modal, hard-coded colours, geometry from attended/conducted. **Still not matching marked data in screenshots.**                      |
| 9   | `app/attendance/page.tsx`                 | REAL PAGE — WeekStrip + MarkList + RingGrid. Hydration gate. Page-scoped `runMigrations()`. No “other subjects” dropdown. Helper copy removed. |

`app/attendance/debug/page.tsx` — **NOT CREATED.** Proposed. Required next.

**TypeScript:** last confirmed `npx tsc --noEmit` in an older session was 0 errors.
After later RingGrid/WeekStrip/page replacements, compile was **not confirmed**.
A `SubjectModal` missing-name error appeared; a full RingGrid was then supplied.
**Run tsc again before trusting anything.**

Error-count history (older session only): 45 → 5 → 42 → 21 → 18 → 0
Do not reuse “0 errors” as current fact until a fresh compile is pasted.

---

## 4. THE FIVE RULES OF THE REBUILD

Every one of these exists because the v3 code got it wrong.

1. **EXACT RATIO FOR EVERY DECISION.**
   v3 rounded to one decimal, then compared. 74.96% became 75.0, scored "safe",
   and reported zero classes needed — to a student below the line.
   `ratio` is the unrounded fraction and is the only thing compared **in calculate.ts**.
   `percentDisplay` exists solely to be printed.
   **Ring SVG must use `attended / conducted`, never `ratio` or `percentDisplay`.**
   Do not assume `ratio` is 0–1 or 0–100 without reading `types.ts` + `calculate.ts` on disk.

2. **NO POOLED NUMBERS.**
   No overall percentage. No subject percentage. No year percentage.
   A pooled 78% can read green while Pathology practical sits at 68% and the
   student is debarred. `OverallResult`, `SubjectResult.percent` and
   `YearResult.percent` are DELETED. Do not reintroduce them.

3. **TWO THRESHOLDS, RESOLVED PER SUBJECT PER TYPE.**
   Defaults: theory 75%, practical 80%, clinical 80%.
   Overridable per subject per type, in SETTINGS ONLY, never in setup.
   Store is SPARSE — a missing key means "use the default", not zero.

4. **PURE CORE.**
   `calculate.ts` sections 1–6 are pure functions. No storage, no clock.
   Sections 7–8 are the thin storage-backed layer the UI calls.

5. **ONE PASS.**
   Sessions bucketed by `subjectId::category` in a single traversal.
   Both `calculate.ts` and `generate.ts` memoise on `DataVersion`.
   **If `setMark()` does not bump DataVersion, the year cache returns stale results forever.**

---

## 5. THE MARKING MODEL (universal, not configurable)

```
present        → attended += weight,  conducted += weight
absent         → attended += 0,       conducted += weight
not-conducted  → nothing. 0/0. Leaves both sides. UI label: "Cancelled"
unmarked       → currently excluded from the denominator (counted only for "N unmarked")
```

Stored value stays `'not-conducted'`. The UI says "Cancelled". Renaming the
stored value would orphan every existing mark for zero benefit.

**Unmarked policy is a product decision, not an accident.** Past unmarked classes
currently do **not** count as conducted. So Present + Present + Unmarked + Unmarked
= 2/2 = 100%. If the UI implies otherwise, that is a bug. Decide and document
before changing the unmarked branch.

---

## 6. WHAT v4 CHANGED FROM v3

| Change                                         | Why                                                           |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `ExtraClass.countsTowardDenominator` per entry | Was one global setting that swept through regular classes too |
| `settings.term.targetPercent` DELETED          | One number cannot express 75% theory / 80% practical          |
| `settings.extraClassPolicy` DELETED            | Now per-entry                                                 |
| New `ThresholdStore`                           | Sparse, per year/subject/category                             |
| `DataVersion` counter                          | Memo key for both caches                                      |
| TRAP 8 exclusion lock REMOVED                  | Exclusion deletes nothing and reverses instantly              |
| Blockouts outrank stale `absent` marks         | A class that didn't happen cannot be an absence               |
| Regular sessions filtered by `workingDays`     | A 6-day college was generating Sunday classes                 |
| Backup preserves entry ids                     | Old importer minted fresh ids, orphaning every mark           |

**The structural safety mechanism:** extra sessions HAVE
`countsTowardDenominator`. Regular and posting sessions leave it `undefined`.
Recalculating extras is therefore _incapable_ of reaching a scheduled class —
enforced by the type system, not by carefulness.

---

## 7. CURRENT PHASE — FIX BUGS BEFORE ANY NEXT FEATURE

**HARD STOP.** No new feature. No app-wide makeover. No RingGrid “improvements”.
No settings redesign. No relocating migrations to root layout unless required
to diagnose a live bug.

The requirement that is failing:

> Marks made in the UI must drive generated sessions, calculated percentages,
> week tiles, and rings.

Until that is true in the browser, nothing else matters.

### BLOCKING — rings / marks mismatch

Observed: mock Present/Absent marks in MarkList did not match RingGrid.
Some rings looked fully Safe. Another subject looked like “no classes”
(dashed empty ring) while labelled Critical. Practical rings were missing
or not obvious.

`calculate.ts` present/absent arithmetic looked correct on paper:

```
present  → attended += w; conducted += w
absent   → conducted += w
cancelled → neither
unmarked → neither (until marked)
```

So a full ring with mixed marks means the ring is drawing bad inputs, **or**
the sessions never carried the absent marks.

Likely causes, in order. Fix the earliest broken layer:

1. `setMark()` does not persist, or uses a different id than generate
2. `setMark()` does not increment `DataVersion`
3. `setMark()` does not notify subscribers
4. `generate.ts` does not attach stored status to the same id
5. year cache in `calculate.ts` returns a stale `YearResult`
6. category grouping does not match generated `session.category`
7. only then: RingGrid reading the wrong fields

**Do not rewrite RingGrid until a session table proves the result object is wrong.**

### NOT DONE — last proposed debug work

These were requested and **not implemented**:

1. Inspect real files on disk (do not trust chat pastes).
2. Fresh `npx tsc --noEmit`.
3. Temporary `app/attendance/debug/page.tsx` — independent session tally vs `getYearResult()`.
4. Console log of generated sessions + DataVersion + calculated result after one Present and one Absent.
5. Trace one mark: click → localStorage key → generate status → calculate → ring.
6. Open and fix `store.ts` / `generate.ts` if that trace fails.

### MEDIUM — after bugs are closed

- `runMigrations()` is now called in `app/attendance/page.tsx` before `setMounted(true)`, with a StrictMode ref guard. Still **page-scoped**. First visit to `/settings` or `/attendance/setup` can read pre-migration data. Proper home: root layout client effect. Do with the Turbopack font issue in `layout.tsx`.
- `useAttendance.ts` — not audited. May reference deleted v3 API.
- `app/settings/attendance/page.tsx` — may still read `targetPercent`.
- Thresholds belong in SETTINGS, not setup. Settings UI may still lack that.

### LOW — after bugs are closed

- `extraPolicy` fallback in `calculate.ts` may be dead. Delete after real-data verification.
- `datetime.ts` comment referencing `DateField` — cosmetic.
- `subjectShort()` codes are 4–6 chars; may truncate in week cells.
- Two component folders, two store patterns, two attendance settings screens — known issues, not this phase.

---

## 8. TWO NAMING COLLISIONS — READ BEFORE WRITING UI

**1. Safety band names differ between code and CSS.**

```
types.ts SafetyBand : safe | warning | danger | critical
CSS tokens          : safe | watch   | risk   | critical
```

Never write `` `chip-${band}` `` — it produces `chip-warning`, which does not
exist, and the chip renders unstyled. Map it explicitly, in one place.

**2. `--color-practical` is the SAME GREEN as `--color-safe` (#0f9b6c).**

Fatal on the week strip, where green means PRESENT — a practical tile would
read as "attended" purely by being a practical.

**Rule: the week strip uses STATUS colour for the fill only.**
Class type is a stripe + letter (T / P / C), not the fill hue.

Intended type colours (hard-coded in RingGrid and WeekStrip on purpose,
because CSS classes failed silently):

```
theory    arc #7c3aed  track #cfc7dd
practical arc #ea580c  track #e6d9cd
clinical  arc #0891b2  track #c9dbe0
```

Do not “fix” these back into `@theme` until the UI is verified.

---

## 9. DESIGN SYSTEM — `app/globals.css`

"Ink & Aurora". Warm paper (#fbfaf7), hairlines over shadows, tabular numbers
everywhere. No automatic dark mode — the `prefers-color-scheme` block was
removed deliberately.

**Tokens:** `--color-canvas`, `--color-surface`, `--color-surface-sunk`,
`--color-surface-raised`, `--color-ink`, `--color-ink-soft`, `--color-ink-muted`,
`--color-ink-faint`, `--color-line`, `--color-line-strong`, `--color-brand`,
`--color-brand-hover`, `--color-brand-soft`, `--color-brand-line`,
`--color-brand-ink`, `--color-safe/-soft/-line`, `--color-watch/-soft/-line`,
`--color-risk/-soft/-line`, `--color-critical/-soft/-line`, `--color-theory`,
`--color-practical`, `--color-clinical`, `--color-ring-track`, `--color-ring-empty`,
`--radius-card/-field/-sheet/-modal/-pill`

**Classes:** `.card`, `.card-interactive`, `.display`, `.eyebrow`, `.tnum`,
`.btn` + `-primary/-ghost/-quiet/-danger`, `.field`, `.field-select`, `.seg`,
`.seg-on`, `.chip` + `-brand/-safe/-watch/-risk/-critical/-neutral`, `.sheet`

- `-head/-body/-foot/-grip/-scrim`, `.modal-layer`, `.modal-scrim`, `.modal-card`,
  `.modal-head`, `.modal-body`, `.modal-close`, `.tile` + `-present/-absent/-unmarked/`
  `-future/-cancelled/-offgrid`, `.day-today`, `.break-row`, `.ring-track`,
  `.ring-empty`, `.ring-arc`, `.ring-theory/-practical/-clinical`, `.ring-tick`,
  `.ring-label-*`, `.aurora`, `.animate-rise`

**Modal:** centred, blurred scrim, spring scale, Escape, scrim tap, body
`data-modal-open="true"` locks scroll.

**The sheet layout that keeps Save buttons reachable:** flex column, three
children — shrink-0 head, `flex-1 min-h-0 overflow-y-auto` body, shrink-0 foot.
The footer is a SIBLING of the scroll area, never a sticky child of it.
`min-height: 0` on the body is the part that gets forgotten.

---

## 10. UI RULES BY COMPONENT

### Week strip

- READ-ONLY. Renders sessions, computes nothing. Marking happens below.
- NO PERCENTAGES. Ever. Its job is "have I logged everything?", not "am I safe?".
- **ROWS = days. COLUMNS = time.** Matches printed college timetables. Overflow
  goes sideways, not taller.
- One row per WORKING day. A non-working day is ABSENT from the grid.
- Width ∝ duration (segment model: every start/end boundary).
- Breaks INFERRED. Uncovered span ≥ 20 min. Consecutive breaks merge. Shorter
  gaps are changeover. Breaks must be visible, not 6px of nothing.
- Time labels ALWAYS include am/pm: `9am`, `10:30am`, `2pm`. Never bare `2`.
- Fill = status. Stripe + T/P/C = class type.
- The three greys, ordered by how much each wants a tap:
  `unmarked` light+solid → `future` palest+dashed → `cancelled` dark+struck.
- Tile segment count equals weight. A posting counted as 3 draws 3 segments.

### Mark list

- ONE ROW PER SESSION whatever the weight. One tap. "counts as 3" chip shown
  only when weight > 1.
- Cancelled button is SMALLER than Present/Absent.
- NO DEFAULT SELECTION.
- Tapping the same button again unmarks.
- Colour-coded at rest and selected (green / red / grey). Must stay visible.
- "Mark all cancelled" — only for days that have already happened.
- Quick add writes a one-off `ExtraClass` with `countsTowardDenominator: true`.
  No Cancelled option on quick add.

### Ring grid

- One ring per REAL category the subject has. Theory outermost.
  Do not assume a theory+practical pair. That dropped real data.
- Fuller coloured arc = higher `attended / conducted`. Grey track = remainder.
  Theory track and practical track must be different greys.
- **Ring colour = IDENTITY, always.** Safety lives on the LABEL + threshold tick.
- Geometry: `fraction = conducted > 0 ? attended / conducted : 0`.
- Empty (`conducted === 0`) is dashed “not started”, **not Critical**.
- NEVER shrink rings to fit more subjects. Min diameter ~96px.
- Numbers appear in a **modal**, not a card shoved under the grid.
- No helper paragraph under “Where you stand”. Category dots are enough.

### Page

- Owns `selectedDate`. Strip and list stay in sync.
- Mount gate: no store reads until after first client pass + migrations.
- This year’s exam subjects in the main grid. **No other-subjects dropdown.**
- Non-exam subjects stay tracked in data, not on this screen.

---

## 11. THE TEN TRAPS (+ session traps)

1. **Category from the slot, never from history.** A posting replaced by a
   theory class produces a THEORY session.
2. **An excluded subject's opening balance is excluded too.**
3. **`countsToward: 'both'` = ONE class satisfying TWO requirements.**
4. **Monday = 0, NOT Sunday.** `(jsDay + 6) % 7`.
5. **Never use `toISOString().slice(0,10)`.** Hand-roll local date.
6. **College hours enforced in the DATA layer**, not just hidden in the UI.
7. **Overlapping blockouts mark a date ONCE.**
8. ~~Exam subjects cannot be excluded~~ — **REMOVED in v4.**
9. **Curriculum says POSSIBLE; timetable says REAL.** Never show “ENT Practical — 0%”
   for a practical that was never on the timetable.
10. **Opening balance REPLACES, never adds.**

**Plus:**

- Session ids must be DETERMINISTIC — `s_reg_{entryId}_{date}` (and the extra
  equivalent). No `Date.now()`, no `Math.random()`. Marks are keyed by session id.
- **Tailwind v4 `bg-[--color-*]` is dead.** Use `bg-safe` or inline styles.
- **`setMark` id must equal generated session id.**
- **Caches must die when marks change.**
- **Do not trust screenshots alone.** Compare store, generated sessions, calculator, UI.

---

## 12. ENVIRONMENT GOTCHAS

**Turbopack + Google Fonts intermittent build failure.**
`Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'`
Open upstream bug (vercel/next.js#99114). Not your code.
Fix order: clear `.next` → drop `--turbopack` → self-host Inter via
`next/font/local` (the only permanent fix).

**Zombie dev server.** Deleting `.next` while a server runs leaves the port
held. Stop PID, or:

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
```

**PowerShell `**`is NOT recursive.** Use`Get-ChildItem -Recurse`.

---

## 13. PROJECT RULES

- Two curricula, intentionally separate:
  - **University** (`app/data/universities/ntruhs/curriculum.ts`) → question
    banks, MCQs, analysis, planner.
  - **Attendance** (`lib/attendance/curriculum.ts`) → classes and timetable.
- Class types: theory, practical, clinical.
- Daily marking: Present, Absent, Cancelled.
- Clinical postings UI must explain when the student's year has none.
- Backups: GitHub **and** offline.

---

## 14. KNOWN ISSUES (not this phase)

1. **Two component folders** — `app/components/` and root `components/`.
   Root now holds only `attendance/DateField.tsx` (used by
   `app/settings/academics/page.tsx`). New attendance UI goes in
   `app/attendance/components/`.
2. **Two store patterns** — `app/store/settings.tsx` (Context) vs
   `app/attendance/store.ts` (plain module).
3. **Two attendance settings screens** — `app/settings/attendance/page.tsx` and
   `app/attendance/setup/page.tsx`.
4. **Thresholds belong in SETTINGS, not setup.**

---

## 15. TESTING MATRIX — must pass before any next feature

| Test                 | Expected                                        | Status                               |
| -------------------- | ----------------------------------------------- | ------------------------------------ |
| Present click        | Row, week tile, ring update                     | NOT VERIFIED                         |
| Absent click         | Row, week tile, ring update                     | NOT VERIFIED                         |
| Cancelled click      | Row, week tile, ring update                     | NOT VERIFIED                         |
| Repeat active mark   | Returns to unmarked                             | NOT VERIFIED                         |
| Refresh              | Marks persist                                   | NOT VERIFIED                         |
| DataVersion          | Changes after mark                              | NOT VERIFIED                         |
| Subscriber           | Fires after mark                                | NOT VERIFIED                         |
| Session id           | Same in setMark and generate                    | NOT VERIFIED                         |
| Theory %             | Independent, matches present/(present+absent)   | NOT VERIFIED                         |
| Practical/clinical % | Independent                                     | NOT VERIFIED                         |
| Ring arc             | Proportional to attended/conducted              | NOT VERIFIED                         |
| Ring track           | Visible grey remainder; theory ≠ practical grey | NOT VERIFIED                         |
| Empty category       | Not labelled Critical                           | NOT VERIFIED                         |
| Week type coding     | Stripe + T/P/C visible                          | NOT VERIFIED                         |
| Time labels          | am/pm                                           | NOT VERIFIED                         |
| Duration / breaks    | Long classes wider; breaks visible              | NOT VERIFIED                         |
| Hydration            | No mismatch                                     | NOT VERIFIED                         |
| TypeScript           | Zero errors on a **fresh** `tsc`                | NOT VERIFIED after last replacements |

---

## 16. SESSION START PROMPT

```
I'm rebuilding the attendance module in my Next.js app at
C:\Users\abhid\Desktop\medprep. MEMORY.md is attached — read it fully before
writing anything. It's the single source of truth.

STATUS: paused. BUG FIXING ONLY. Do not start a new feature, polish pass,
or RingGrid rewrite.

The blocking bug: Present/Absent/Cancelled marks do not reliably show in the
rings. calculate.ts present/absent maths looked correct on paper. store.ts and
generate.ts were NOT inspected. The debug page was NOT created.

How I want you to work:
- FULL REPLACEMENT FILES ONLY. Never append a block or change specific lines.
- One file at a time. I'll run npx tsc --noEmit and paste the output.
- Before the code, a short table of what's changing and why.
- Heavy inline comments explaining the reasoning.
- If you need an existing file, ASK. Do not guess exports.

First actions, in order:
1. Read the real files on disk (store.ts, generate.ts, calculate.ts, types.ts,
   RingGrid.tsx, WeekStrip.tsx, MarkList.tsx, page.tsx).
2. Tell me to run: cd C:\Users\abhid\Desktop\medprep; npx tsc --noEmit
3. Trace one Present and one Absent from click → storage → generate → calculate
   → ring. Add a temporary /attendance/debug page if needed.
4. Fix the earliest broken layer. Do not patch the ring to hide bad data.
5. Do not move to the next feature until the testing matrix in MEMORY.md passes.
```

---

## 17. SESSION END — 60 seconds, non-negotiable

1. Append a CHANGELOG entry below.
2. Run:

```powershell
cd C:\Users\abhid\Desktop\medprep; npx tsc --noEmit; git add -A; git commit -m "session: <what changed>"; git push
```

If the working tree is clean, still `git push`.

Stop the dev server first if needed:

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
```

Or Ctrl+C in the window running `npm run dev`.

---

## 18. CHANGELOG — append only, newest at bottom

[2026-09-20] Settings overlay work begun.
[2026-09-22] Settings overlay committed: app/settings/, 9 files, 1218 insertions (824da48).
[2026-09-22] Disk audit via tree /F. All three handover docs were each partially
correct; no code was ever lost.
[2026-09-22] Deleted dead file app/attendance/page.old.tsx.bak.
[2026-09-22] MEMORY.md created as single source of truth, overriding AI memory.
[2026-09-22 SESSION 2] Doc consolidation audit complete. AGENTS.md and CLAUDE.md
already point to MEMORY.md.
[2026-09-22] F5 persistence test: /attendance redirects to /attendance/setup.
Marking page missing — earlier agent built only setup + redirect.
[2026-09-22] DECISION: rebuild /attendance from scratch.

[2026-09-24 REBUILD SESSION] Full v4 rebuild of the attendance logic layer.

Removed 1,618 lines of orphaned pre-rewrite code (56fcc3c):
components/attendance/{ClassEditorSheet,PostingScheduler,TimeField,WeekGrid}.tsx
lib/attendance/backup.ts
DateField.tsx restored (3a9ab7c) — still used by app/settings/academics.
Backup/restore moved into store.ts, now preserving entry ids.

Rewritten to v4: types.ts, store.ts, calculate.ts, generate.ts.
Added: globals.css tile + ring tokens, WeekStrip.tsx, MarkList.tsx.
page.tsx replaced with a temporary stopgap so the dev server compiles.

Key fixes: exact-ratio comparisons (the 74.96% bug), all pooled numbers
deleted, per-subject-per-type thresholds, per-entry extra-class denominator
policy, workingDays filtering, DataVersion-keyed caches, blockouts now
outrank stale absence marks, deterministic ids verified throughout.

ATTENDANCE_REBUILD_V2.md untracked and gitignored.
ATTENDANCE_REBUILD_SPEC.txt was never saved to disk — superseded by this file.

`npx tsc --noEmit` → zero errors at that moment.

NEXT at that time: RingGrid.tsx, then page.tsx.
BLOCKING at that time: runMigrations() never called.

[2026-09-24 UI ASSEMBLY + BUG CHASE] Work continued past the stopgap.

Written and wired: RingGrid.tsx, real page.tsx (WeekStrip + MarkList + RingGrid).
runMigrations() now called on the attendance page before first store read.
Hydration gate in page.tsx.
WeekStrip rotated: days as rows, time as columns, duration-proportional
segments, am/pm labels, inferred breaks, class-type stripe + letter.
MarkList: Tailwind v4 [--var] blank-button bug; Present/Absent/Cancelled colours.
RingGrid: visible tracks, modal detail, hard-coded category colours,
geometry from attended/conducted, no pair-only rings.
Page: no other-subjects dropdown; helper copy removed.

NOT DONE: debug page, store.ts/generate.ts inspection, end-to-end mark trace.

BLOCKING NOW: marked attendance does not match rings in the browser.
Do not start the next feature. Fix bugs first. Fresh tsc is unconfirmed.

---

## SESSION LOG — 25 September 2026

**Status:** Bug fixing. Diagnostic complete. One defect confirmed and isolated.

### Verified baseline (do not re-investigate)

- Branch `main`, last commit `e9ff51f`.
- `npx tsc --noEmit` passes.
- `app/attendance/debug/page.tsx` EXISTS and was fully replaced this session
  with a controlled 7-panel diagnostic. It is TEMPORARY. Delete only after the
  full test matrix passes.

### BUG 1 — ONE-DAY TERM — ROOT CAUSE, WORKED AROUND, NOT YET FIXED IN CODE

Symptom: 20 of 24 week sessions missing from the year dataset. Rings saw almost
no data. OBG absent from "Where you stand".

Root cause: **no screen in the entire app writes `settings.term`.** Grep of
`app/` + `lib/` proved every reference is a read, a default, or a legacy
migration:

- `store.ts:278, 307-308` default both dates to `todayISO()`
- `generate.ts:686, 699, 727-728` read the term to build the year window
- `PostingsPanel.tsx` dates are POSTING dates, unrelated
  So the only term value that ever existed was `today → today`. This is a
  MISSING FEATURE, not a user configuration mistake.

Temporary unblock applied via browser console to key
`medprep.attendance.settings.v4`:

### BUG 2 — FIXED 25 Sep 2026 — calculate.ts SECTION 6

`computeYear()` rewritten to three explicit passes:
PASS 1 real session buckets (curriculum-illegal categories dropped)
PASS 2 every EXAM subject completed to its full legal category pair with 0/0
PASS 3 opening-balance-only categories on NON-EXAM subjects (TRAP 9 intact)

`bySubject` is now `Map<SubjectId, Map<ClassCategory, CategoryResult>>`. The
local `put()` helper no-ops on an existing key, so a populated category can
never be recomputed or overwritten by a later pass.

TRAP 9 is NARROWED, not deleted: non-exam subjects still show only categories
with real data. Exam subjects are exempt because they own a fixed outer/inner
ring slot and a missing inner ring is worse than an empty one.

Verified: medicine and paediatrics now return theory + clinical; no
CATEGORY MISSING or SUBJECT MISSING in diagnostic section 5; all previously
passing counts unchanged (medicine/theory 2/4, surgery/theory 2/3,
surgery/clinical 3/5, obg/theory 2/2, paediatrics/theory 2/2).
`npx tsc --noEmit` clean.

NEXT: term fields on the setup screen (Bug 1 permanent fix).

### BUG 2 — FIXED AND VERIFIED — 25 Sep 2026 — calculate.ts SECTION 6

`computeYear()` rewritten to three explicit passes:
PASS 1 real session buckets; curriculum-illegal categories dropped
PASS 2 every EXAM subject completed to its full legal category pair with 0/0
PASS 3 opening-balance-only categories on NON-EXAM subjects (TRAP 9 intact)

`bySubject` is now Map<SubjectId, Map<ClassCategory, CategoryResult>>. The local
put() helper no-ops on an existing key, so a populated category can never be
recomputed or overwritten by a later pass.

TRAP 9 NARROWED, not deleted: non-exam subjects still show only categories with
real data. Exam subjects are exempt — they own a fixed outer/inner ring slot and
a missing inner ring is worse than an empty one.

VERIFIED in browser: no CATEGORY MISSING, no SUBJECT MISSING in diagnostic
section 5. medicine and paediatrics now return theory + clinical. All previously
passing counts unchanged. npx tsc --noEmit clean. Committed.

### STILL OPEN — BUG 1 PERMANENT FIX

The term is currently only settable by hand-editing localStorage key
medprep.attendance.settings.v4. Any cleared storage or fresh install returns to
the one-day term (today → today) and re-breaks everything. Setup screen needs
term start/end inputs with validation. THIS IS THE NEXT FILE.

### RING RENDERING — FIXED 25 Sep 2026

Symptom: every ring looked full regardless of attendance; tiles looked cheap.

ROOT CAUSE, not what it appeared to be. The arc maths was correct all along.
The TRACK was tinted per category — theory track #cfc7dd against arc #7c3aed.
A 0/0 ring drew a complete circle of pale violet, indistinguishable from a
full violet arc at phone size.

FIX: all tracks are now one neutral grey (#E8E8ED). COLOUR = ATTENDED,
GREY = MISSED. Drawing delegated to AttendanceRing.tsx, which draws NO arc at
all when conducted === 0 — an empty ring is a faint dotted track and nothing
more, so 0/0 can never again read as 100%.

RingGrid.tsx rewritten to:

- pass outer = theory, inner = practical/clinical to AttendanceRing
- compute geometry from attended/conducted only (never ratio/percentDisplay)
- drop tile borders; depth from surface + one soft shadow, not outlines
- two columns on mobile, larger rings, more whitespace
- hairline threshold notch on the track, replacing 2.5px stubs
- show the same ring large at the top of the detail modal

tone="category" retained: hue = class type, label = safety. Unchanged rule.

NEW FILE: app/attendance/components/AttendanceRing.tsx — presentational only,
no store, no calculator, no Tailwind. Gradient arcs, round caps, useId for
unique gradient ids (duplicate ids make every ring inherit the first one's
colours — classic SVG trap).

### RING SILHOUETTE — FIXED 25 Sep 2026 — AttendanceRing.tsx

Symptom: "circle doesn't look too circly." Geometry was correct; the OUTLINE
was being broken by three details:

1. Threshold notch overhung the rim. Drawn radius±(STROKE/2 − 1) with round
   caps, which add ~half the line width beyond each endpoint → visible stubs
   at 9 o'clock. Now inset to STROKE/2 − 2.5 with butt caps: a mark ON the
   ring, never a spur off it.
2. Empty track used strokeDasharray '1 7' + round caps → scalloped, beaded
   rim. Now a solid, very light track (#F0F0F4). Lightness says "empty";
   texture is not needed and costs the outline.
3. Arc round start-cap mounted the track edge at 12 o'clock. Dash is now
   trimmed by STROKE/2 so the cap curve completes inside the band.

Also: STROKE 11→13, GAP 7→5, R_OUTER 50→51. Thin hoops with a large hole read
as wireframe; Activity rings are ~22% of radius and that weight is most of why
they look solid.

Added shapeRendering:'geometricPrecision' (stops curve points snapping to the
pixel grid, which makes small circles look polygonal) and flexShrink:0 (stops a
narrow grid column squashing the SVG into an oval).

### BAND VOCABULARY — FIXED 25 Sep 2026 — RingGrid.tsx

Symptom: three of four subjects read "Critical" simultaneously. A warning that
describes most of the screen describes nothing.

Cause was semantic, not arithmetic. bandFor() returns 'critical' for anything
more than dangerMargin below threshold, so a subject at 50% in week four of a
six-month term qualified — despite being comfortably recoverable.

★ THE DISTINCTION IS REACHABILITY, NOT DISTANCE. calculate.ts already computes
targetUnreachable (true only when attending EVERY remaining class still misses
the threshold). It was being computed and ignored.

RingGrid now maps to five display standings, checking targetUnreachable FIRST:
unreachable → "Critical" (any band, if targetUnreachable)
critical → "Well behind" (downgraded)
danger → "Behind"
warning → "Watch"
safe → "On track"

Grid sort order now uses standing, not raw band.
Modal chip and per-category percentage colour use the same mapping.

⚠ DISPLAY ONLY. No band, ratio, threshold or count is recalculated in RingGrid.
calculate.ts remains the sole source of arithmetic. SafetyBand in types.ts is
unchanged — the four-value union is still what the calculator produces.

### "CRITICAL" — SECOND PASS — 25 Sep 2026 — calculate.ts

After the RingGrid standing gate, only General Surgery still read Critical.
Cause: surgery clinical is a POSTING block (21–25 Sep). Past its end date there
are no future unmarked sessions, so remainingWeight === 0, so
isUnreachable(3, 5, 0, 80) returns true — best case 60% vs 80% threshold.

Mathematically correct, semantically wrong. A finished posting block is not a
finished term; it usually means the NEXT block has not been entered yet.

FIX: targetUnreachable now requires remainingWeight > 0. With zero runway the
band alone conveys severity ("Well behind"). "Critical" is reserved for: runway
exists AND attending every remaining class still misses the threshold.

⚠ SIDE EFFECT, ACCEPTED: at genuine term end every category has
remainingWeight 0, so nothing will ever say Critical on the final day. If an
end-of-term "finalised / below requirement" state is wanted later, add an
explicit isFinalised flag driven by settings.term.endDate — do NOT revert this.

### RING VISUALS — DONE 25 Sep 2026

Silhouette fixed, verified in browser. Circular outline, neutral grey tracks,
inset butt-cap notch, solid light track for empty rings, STROKE 13 / GAP 5.
Tiles: no borders, soft elevation, two columns. Legend labels outer/inner.

### "CRITICAL" — RESOLVED, NOT A BUG 25 Sep 2026

After both fixes only General Surgery reads Critical, and it EARNS it:
surgery/clinical 3/5 at an 80% threshold needs x ≥ 5 consecutive classes
((3+x)/(5+x) ≥ 0.8). Fewer than 5 remain scheduled, so runway exists but is
insufficient → targetUnreachable true → "Critical". Correct behaviour.

ROOT CAUSE IS DATA, NOT CODE: only the current surgery posting block
(21-25 Sep) is entered. Adding the next posting block restores runway and the
label self-corrects to "Well behind". If no further surgery clinical sessions
exist this term, 60% vs 80% is genuinely final and Critical is accurate.

DO NOT soften targetUnreachable further to make this label go away.

### BUG 1 — PERMANENTLY FIXED 25 Sep 2026 — new file setup/TermPanel.tsx

The term is now settable in the UI. Previously NOTHING in app/ or lib/ ever
wrote settings.term — every reference was a read, a default (store.ts:278,
307-308, both todayISO()), or a legacy migration. The only value that had ever
existed on a real device was a ONE-DAY TERM, which silently starved
generateForYear() and caused every symptom chased this session.

TermPanel sits under HoursCard in setup. Warns on: one-day term, span under 14
days, end before start, today before start, today after end. Warnings name the
CONSEQUENCE ("anything you mark outside this range will not reach your rings"),
not the rule.

⚠ Uses LOCAL DRAFT STATE + commit on blur, unlike the rest of setup which
writes immediately. A date input fires onChange per keystroke; typing a year
would write 0002/0020/0202/2027, bumping DataVersion and regenerating the term
four times. Draft state is the deliberate exception, not an oversight.

LESSON RECORDED: a required setting with a plausible default and no UI is worse
than one with no default. A missing value announces itself; a default of
`today` poisons every downstream calculation while looking reasonable in the
debugger.

REMAINING QUEUE:

1. WeekStrip: start/end times inside tiles, remove break duration labels
2. WeekStrip: prev/next week navigation + date jump + "This week"
3. Delete debug route once the test matrix passes

### WEEKSTRIP — TILE TIMES + WEEK NAVIGATION — 25 Sep 2026

TILE TIMES: each class tile now shows its own start (left) and end (right) at
0.5rem, with code + T/P/C centred above. Grid floor raised 2.75rem → 4.5rem —
two timestamps do not fit

### WEEKSTRIP — TILE TIMES + WEEK NAVIGATION — 25 Sep 2026

TILE TIMES: each class tile now shows its own start (left) and end (right) at
0.5rem, with code + T/P/C centred above. Grid floor raised 2.75rem to 4.5rem —
two timestamps do not fit in 44px at a legible size. Cost: the strip scrolls
sideways more often. Correct trade on a phone, where swiping is free and
squinting is not.

BREAK DURATION LABELS REMOVED from the time header. Redundant once every tile
states its own end: the gap between one tile's end and the next tile's start
IS the break, already stated twice. The dashed divider still marks it.

NAVIGATION: prev/next week, "Today" (rendered only when not on the current
week — a permanently visible Today button does nothing most of the time), and
a date jump implemented as a transparent input type=date over the range label,
so a phone opens the OS wheel instead of a hand-built HTML calendar.

SWIPE, AND THE GESTURE CONFLICT. The strip is already a horizontal scroller —
that is the point of days-as-rows. A swipe handler over a horizontal scroller
fights it and the user loses. RESOLVED: the week gesture only ARMS at a
scroller edge. scrollLeft 0 + rightward drag = previous week; scrollLeft max +
leftward drag = next week; anywhere between, native scroll is untouched. Two
extra filters: the drag must be mostly horizontal (dx > dy) so vertical page
scrolling never changes week, and it must clear 56px so a wobbly tap does
nothing. touchAction pan-y keeps vertical scrolling native.

STATE: localAnchor is a FALLBACK, not a second owner. page.tsx still owns
selectedDate; navigating always calls onSelectDay. localAnchor only covers the
case where a parent does not feed the date back through anchorDate — without
it the strip would navigate then snap back, which reads as a broken button. It
is cleared by an effect on parentAnchor, so a controlled parent always wins.

OUTSIDE-TERM WARNING added, unprompted but necessary now that TermPanel makes
the term real and settable. Navigating past the term edges shows an amber note:
marks made out there are saved but never reach the rings. Silently rendering a
normal grid is exactly the deception that cost this project weeks.

npx tsc --noEmit clean.

QUEUE ITEMS 1 AND 2 CLOSED. Remaining: delete app/attendance/debug/page.tsx
once the section 15 matrix passes.

### WEEKSTRIP — LONG PRESS + PINNED COMPACT CARD — 25 Sep 2026

Compact strip is pinned to THIS week. Overlay owns browseAnchor and throws
it away on close. They never share an anchor.

Long-press (450ms, 10px) expands into a blurred overlay. Swipe lives only
there: follows the finger, glides past 56px, incoming week enters from the
opposite side. Compact card has no arrows.

Times live on the rail, not on every tile. Start at the left edge of a
class column; end only after a gap or on the last column.

tsc clean. ESLint/React Compiler clean (hooks ordered, hint via
useSyncExternalStore). Matrix rounds 1–5 PASSED.

QUEUE CLOSED. Debug route deleted after matrix pass.
