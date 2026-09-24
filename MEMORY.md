# MEMORY.md — medprep

**THIS FILE OVERRIDES AI MEMORY.**
If your stored memory contradicts this file, your memory is wrong.
If this file contradicts `tree app /F`, the disk is right — update this file.
Never assume a feature is unbuilt. Check first.

Repo: https://github.com/Abhidatla203/medprep
Path: C:\Users\abhid\Desktop\medprep
Owner: Abhidatla203

**IGNORE THESE FILES.** They are stale or were never real:
- `ATTENDANCE_REBUILD_PROGRESS.md` — never existed on disk. Phantom.
- `ATTENDANCE_REBUILD_V2.md` — scratch file, now in .gitignore.
- `ATTENDANCE_REBUILD_SPEC.txt` — superseded by sections 10–15 of this file.

---

## 1. HOW TO WORK WITH ME

- No coding experience. Explain in plain language.
- Slower pace. Less detail per message. Too much at once is hard to process.
- **FULL REPLACEMENT FILES ONLY.** Never "find line 40 and change it".
  Partial edits have broken this project repeatedly. No exceptions.
- One file at a time. One feature at a time.
- Exact copy-paste PowerShell commands, tailored to the real folder structure.
- Before the code: a short table of what's changing and why.
- Heavy inline comments in the code explaining the REASONING, not the mechanics.
  Those comments are how this project survives context loss.
- If you need an existing file, ASK. Do not guess at export names.
- No back-and-forth clarification loops. Ask at most one question, up front.
- Brainstorming: I give my vision → you suggest changes → I assess and reply.

---

## 2. STACK (verified)

- Next.js 16.3.5 (Turbopack), TypeScript, Tailwind v4
- Storage: localStorage only. No backend.
- Path alias: `"@/*": ["./*"]` (root-relative)
- Dates: store ISO `YYYY-MM-DD`, display dd/mm/yyyy
- University: NTRUHS only for now
- Design principle: **store raw facts, compute views at read time.**
  Nothing derived is ever persisted. That is what makes stale numbers impossible.

---

## 3. ATTENDANCE REBUILD — BUILD STATUS

Verified by `npx tsc --noEmit` returning **zero errors**.

| # | File | State |
|---|------|-------|
| 1 | `app/attendance/types.ts` | DONE — v4 |
| 2 | `app/attendance/calculate.ts` | DONE — v4 |
| 3 | `app/attendance/store.ts` | DONE — v4 |
| 4 | `app/attendance/generate.ts` | DONE — v4 |
| 5 | `app/globals.css` | DONE — tile + ring tokens added |
| 6 | `app/attendance/components/WeekStrip.tsx` | DONE |
| 7 | `app/attendance/components/MarkList.tsx` | DONE |
| 8 | `app/attendance/components/RingGrid.tsx` | **NEXT** |
| 9 | `app/attendance/page.tsx` | TEMPORARY STOPGAP — rewrite last |

`page.tsx` currently renders plain Tailwind with no design tokens. It exists
only so the dev server compiles. It is NOT the real page.

Error-count history, for detecting regressions:
45 → 5 → 42 → 21 → 18 → 0

---

## 4. THE FIVE RULES OF THE REBUILD

Every one of these exists because the v3 code got it wrong.

1. **EXACT RATIO FOR EVERY DECISION.**
   v3 rounded to one decimal, then compared. 74.96% became 75.0, scored "safe",
   and reported zero classes needed — to a student below the line.
   `ratio` is the unrounded fraction and is the only thing compared.
   `percentDisplay` exists solely to be printed.

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

---

## 5. THE MARKING MODEL (universal, not configurable)

```
present        → attended += weight,  conducted += weight
absent         → attended += 0,       conducted += weight
not-conducted  → nothing. 0/0. Leaves both sides. UI label: "Cancelled"
unmarked       → nothing. Counted only for the "N unmarked" nag.
```

Stored value stays `'not-conducted'`. The UI says "Cancelled". Renaming the
stored value would orphan every existing mark for zero benefit.

---

## 6. WHAT v4 CHANGED FROM v3

| Change | Why |
|---|---|
| `ExtraClass.countsTowardDenominator` per entry | Was one global setting that swept through regular classes too |
| `settings.term.targetPercent` DELETED | One number cannot express 75% theory / 80% practical |
| `settings.extraClassPolicy` DELETED | Now per-entry |
| New `ThresholdStore` | Sparse, per year/subject/category |
| `DataVersion` counter | Memo key for both caches |
| TRAP 8 exclusion lock REMOVED | Exclusion deletes nothing and reverses instantly |
| Blockouts outrank stale `absent` marks | A class that didn't happen cannot be an absence |
| Regular sessions filtered by `workingDays` | A 6-day college was generating Sunday classes |
| Backup preserves entry ids | Old importer minted fresh ids, orphaning every mark |

**The structural safety mechanism:** extra sessions HAVE
`countsTowardDenominator`. Regular and posting sessions leave it `undefined`.
Recalculating extras is therefore *incapable* of reaching a scheduled class —
enforced by the type system, not by carefulness.

---

## 7. OUTSTANDING WORK

### HIGH — data loss risk
**`runMigrations()` is never called.** It exists in `store.ts` and is correct,
but nothing invokes it. Any existing v3 user silently resets to defaults on
first load. Needs a top-level client effect — NOT in a page component that can
remount.

### MEDIUM
- `page.tsx` is a stopgap. Rewrite after RingGrid.
- `useAttendance.ts` — not audited this session. May reference deleted v3 API.
- `app/settings/attendance/page.tsx` — may still read `targetPercent`.

### LOW
- `extraPolicy` fallback in `calculate.ts` SECTION 3 is now dead code.
  `generate.ts` sets the flag properly. Delete after real-data verification.
- `datetime.ts` has a comment referencing `DateField` — cosmetic only.

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

Fine on the ring grid, where colour means CATEGORY.
Fatal on the week strip, where green means PRESENT — a practical tile would
read as "attended" purely by being a practical.

**Rule: the week strip uses STATUS colour only.** Category is carried by the
subject short code, never by hue.

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
`--color-practical`, `--color-clinical`, `--color-ring-track`,
`--radius-card/-field/-sheet/-pill`

**Classes:** `.card`, `.card-interactive`, `.display`, `.eyebrow`, `.tnum`,
`.btn` + `-primary/-ghost/-quiet/-danger`, `.field`, `.field-select`, `.seg`,
`.seg-on`, `.chip` + `-brand/-safe/-watch/-risk/-critical/-neutral`, `.sheet`
+ `-head/-body/-foot/-grip/-scrim`, `.tile` + `-present/-absent/-unmarked/`
`-future/-cancelled/-offgrid`, `.day-today`, `.break-row`, `.ring-track`,
`.ring-arc`, `.ring-theory/-practical/-clinical`, `.ring-tick`,
`.ring-label-*`, `.aurora`, `.animate-rise`

**The sheet layout that keeps Save buttons reachable:** flex column, three
children — shrink-0 head, `flex-1 min-h-0 overflow-y-auto` body, shrink-0 foot.
The footer is a SIBLING of the scroll area, never a sticky child of it.
`min-height: 0` on the body is the part that gets forgotten.

---

## 10. UI RULES BY COMPONENT

### Week strip (DONE)
- READ-ONLY. Renders sessions, computes nothing. Marking happens below.
- NO PERCENTAGES. Ever. Its job is "have I logged everything?", not "am I safe?".
- One column per WORKING day. A non-working day is ABSENT from the grid.
- Fill vs outline carries meaning, not hue — survives colour blindness.
- The three greys, ordered by how much each wants a tap:
  `unmarked` light+solid (live item) → `future` palest+dashed (nothing owed) →
  `cancelled` dark+struck (closed).
- Breaks are INFERRED, never configured. A span where no working day has a
  class collapses to a hairline. Consecutive breaks merge. Gaps under 20 min
  are changeover, not breaks.
- Tile count equals weight. A posting counted as 3 draws 3 tiles.

### Mark list (DONE)
- ONE ROW PER SESSION whatever the weight. One tap. "counts as 3" chip shown
  only when weight > 1.
- Cancelled button is SMALLER than Present/Absent. It's the occasional case and
  the one button that silently removes a class from the denominator.
- NO DEFAULT SELECTION. Pre-selecting "present" would guess at the exact thing
  the app exists to record.
- Tapping the same button again unmarks. No long press, no confirmation.
- "Mark all cancelled" — offered only for days that have already happened.
- Quick add writes a one-off `ExtraClass` with `countsTowardDenominator: true`.
  No Cancelled option — a class that never happened and was never scheduled is
  not an event.

### Ring grid (NEXT)
- Two concentric rings per subject.
  OUTER = theory `--color-theory`. INNER = practical/clinical.
  TRACK = `--color-ring-track`, so a 5% ring still reads as a ring.
- **Ring colour = IDENTITY, always.** Safety lives on the subject LABEL, plus a
  tick mark on each track at the threshold position.
- The outer ring is physically longer, so 75% outside draws a longer arc than
  75% inside. Keep radii close, start both arcs at 12 o'clock, let the ticks
  carry the comparison.
- NEVER shrink rings to fit more subjects. Change arrangement, or scroll.
  Min diameter 96px, min tap target 44px.
- Arrangements: `single` (1–2), `row-3` (3), `grid-2x2` (4), `grid-3x2` (5–6),
  `scroll-3` (7+).
- Numbers appear on TAP. The resting screen is rings and colour.

---

## 11. THE TEN TRAPS

1. **Category from the slot, never from history.** A posting replaced by a
   theory class produces a THEORY session.
2. **An excluded subject's opening balance is excluded too.** Half-applying an
   exclusion is worse than not applying it.
3. **`countsToward: 'both'` = ONE class satisfying TWO requirements.** Emits two
   sessions sharing a `bothPairKey`. Does NOT add 2 to a combined total —
   there is no combined total.
4. **Monday = 0, NOT Sunday.** JS `getDay()` returns 0 for Sunday. Always
   `(jsDay + 6) % 7`. The v2→v3 migration corrects this; that was the Tuesday bug.
5. **Never use `toISOString().slice(0,10)`.** It converts to UTC first, so any
   date computed after 18:30 IST shifts back a day. Hand-roll local date.
6. **College hours enforced in the DATA layer**, not just hidden in the UI.
7. **Overlapping blockouts mark a date ONCE.** Build a Set, don't iterate and
   subtract.
8. ~~Exam subjects cannot be excluded~~ — **REMOVED in v4.** Exclusion deletes
   nothing and reverses instantly.
9. **Curriculum says POSSIBLE; timetable says REAL.** A student who never
   entered an ENT practical must never see "ENT Practical — 0%".
10. **Opening balance REPLACES, never adds.** Importing the same file twice must
    leave the same numbers.

**Plus the one that isn't numbered:** session ids must be DETERMINISTIC —
`s_reg_{entryId}_{date}`. No `Date.now()`, no `Math.random()`, no counters.
Marks are keyed by session id. Random ids would orphan a year of attendance on
the next timetable edit, silently, with no error.

---

## 12. ENVIRONMENT GOTCHAS

**Turbopack + Google Fonts intermittent build failure.**
`Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'`
Open upstream bug (vercel/next.js#99114). Not your code.
Fix order: clear `.next` → drop `--turbopack` → self-host Inter via
`next/font/local` (the only permanent fix).

**Zombie dev server.** Deleting `.next` while a server runs leaves the port
held. `taskkill /PID <pid> /F`.

**PowerShell `**` is NOT recursive.** `app\**\*.tsx` checks ONE directory level.
This nearly caused a real component to be deleted as an orphan. Use:
```powershell
Get-ChildItem -Recurse -Include *.ts,*.tsx -File | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.next\\' } | Select-String -Pattern "..."
```

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

## 14. KNOWN ISSUES

1. **Two component folders** — `app/components/` and root `components/`.
   Root now holds only `attendance/DateField.tsx` (used by
   `app/settings/academics/page.tsx`). New attendance UI goes in
   `app/attendance/components/`. Consolidate eventually.
2. **Two store patterns** — `app/store/settings.tsx` (Context) vs
   `app/attendance/store.ts` (plain module).
3. **Two attendance settings screens** — `app/settings/attendance/page.tsx` and
   `app/attendance/setup/page.tsx`. Decide which owns what.
4. **Thresholds belong in SETTINGS, not setup.** The settings screen does not
   yet have that UI.

---

## 15. SESSION START PROMPT

```
I'm rebuilding the attendance module in my Next.js app at
C:\Users\abhid\Desktop\medprep. MEMORY.md is attached — read it fully before
writing anything. It's the single source of truth; ignore any other planning
file you find in the repo.

Steps 1–7 are complete and `npx tsc --noEmit` returns zero errors.
Next is step 8, app/attendance/components/RingGrid.tsx.

How I want you to work:
- FULL REPLACEMENT FILES ONLY. Never tell me to append a block or change
  specific lines — partial edits have repeatedly broken this project.
- One file at a time. I'll run `npx tsc --noEmit` and paste the output before
  we move on.
- Before the code, a short table of what's changing and why.
- Heavy inline comments explaining the reasoning, not just the mechanics.
- If you need to see an existing file, ask rather than guessing at export names.

Start by asking me for whichever files you need to write RingGrid.tsx correctly.
```

---

## 16. SESSION END — 60 seconds, non-negotiable

1. Append a CHANGELOG entry below.
2. Run:

```powershell
cd C:\Users\abhid\Desktop\medprep; npx tsc --noEmit; git add -A; git commit -m "session: <what changed>"; git push
```

---

## 17. CHANGELOG — append only, newest at bottom

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

  `npx tsc --noEmit` → zero errors.

  NEXT: RingGrid.tsx, then page.tsx.
  BLOCKING BEFORE SHIP: runMigrations() is never called. See section 7.
