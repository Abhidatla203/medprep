# MedPrep — Canonical Handoff

**Last verified:** 22 Sep 2026, from `tree /F` on disk + `git log`.
**Authority rule:** This file is the ONLY source of truth. If any chat, backup .txt,
or AI memory contradicts it, THIS FILE WINS. Older handover docs
(PROJECT_BACKUP_FULL, medprep_handover, 22-9-26 context) are ARCHIVED — do not read
them for status; each was written blind and all three contradict each other.

---

## 1. Working agreement (do not violate)

- Owner is NON-TECHNICAL. No "you know the drill" shortcuts.
- Tooling: VS Code only. Terminal commands must be copy-paste, single line.
- Code delivery: FULL FILE REPLACEMENTS ONLY. Never diffs, never "add this near line 40".
- ONE FILE AT A TIME. Wait for confirmation before sending the next.
- Always state the exact file path above every code block.

---

## 2. Stack

- Next.js 16.3.5 (App Router) + TypeScript + Tailwind CSS
- Persistence: localStorage (no backend, no database)
- Local path: C:\Users\abhid\Desktop\medprep
- Remote: https://github.com/Abhidatla203/medprep  (branch: main)
- Backups: offline copy + GitHub, both

---

## 3. Core design principles

1. STORE RAW FACTS, COMPUTE VIEWS AT READ TIME. Never persist a derived number.
   Attendance percentages, totals and streaks are calculated on render.
2. Dates: STORE as ISO (YYYY-MM-DD). DISPLAY as dd/mm/yyyy. Always.
3. University scope: NTRUHS only. Architecture stays multi-university ready
   (see app/data/universities/), but do not build a second university yet.

---

## 4. VERIFIED FILE TREE (22 Sep 2026)

app/
  favicon.ico
  globals.css
  layout.tsx
  page.tsx
  attendance/
    calculate.ts
    generate.ts
    page.tsx
    page.old.tsx.bak        <-- DEAD FILE, delete
    store.ts
    types.ts
    useAttendance.ts
    setup/
      page.tsx
  components/
    Circulars.tsx
    Nav.tsx
    PageStub.tsx
    QuestionOfTheDay.tsx
    RecommendedTest.tsx
    SubjectBadge.tsx
  data/
    questions/
      index.ts
      pharmacology.json
    universities/
      ntruhs/
        curriculum.ts
  papers/page.tsx
  planner/page.tsx
  question-bank/page.tsx
  settings/
    layout.tsx
    page.tsx
    SettingsShell.tsx
    academics/
      page.tsx
      subjects/page.tsx
    attendance/page.tsx
    profile/
      page.tsx
      PhotoCropper.tsx
  store/
    settings.tsx

lib/
  attendance/
    backup.ts
    curriculum.ts
    datetime.ts

components/
  attendance/
    ClassEditorSheet.tsx
    DateField.tsx
    PostingScheduler.tsx
    TimeField.tsx
    WeekGrid.tsx

---

## 5. Status

BUILT (files exist on disk, confirmed):
- Home / layout / global styles
- Nav + dashboard widgets (Circulars, QuestionOfTheDay, RecommendedTest, SubjectBadge)
- NTRUHS curriculum data + pharmacology question bank seed
- Attendance engine: types, store, calculate, generate, useAttendance hook
- Attendance main page + setup page
- Attendance UI kit: WeekGrid, ClassEditorSheet, PostingScheduler, DateField, TimeField
- Settings overlay: shell, layout, Profile (+PhotoCropper), Academics, Subjects,
  Attendance settings  [committed 824da48, 22 Sep, 9 files / 1218 insertions]

STUBS / PLACEHOLDER:
- papers/, planner/, question-bank/  (likely rendering PageStub)

NOT YET VERIFIED — confirm by running, do not assume:
- [ ] Does attendance data actually PERSIST across a browser refresh?
      One archived doc claimed persistence was unfinished. store.ts exists but
      its contents have not been audited.
- [ ] Do app/settings/attendance/page.tsx and app/attendance/setup/page.tsx
      overlap or conflict? Both configure attendance.

---

## 6. Known debt (fix before adding features)

1. TWO COMPONENT FOLDERS: app/components/ and root components/.
   Decide on one location and move everything there.
2. TWO STORE PATTERNS: app/store/settings.tsx (Context) vs app/attendance/store.ts
   (plain module). Unify or document why they differ.
3. DUPLICATE ATTENDANCE CONFIG: settings/attendance vs attendance/setup.
4. DEAD FILE: app/attendance/page.old.tsx.bak — delete, git holds the history.
5. Two curriculum files exist: app/data/universities/ntruhs/curriculum.ts and
   lib/attendance/curriculum.ts. Determine which is canonical.

---

## 7. Session protocol

START OF SESSION — paste to the AI:
  "Read HANDOFF.md in the repo root. That file is the only source of truth for
   project status. Do not ask me to re-explain the project. Confirm what is built,
   then propose the next step."

END OF SESSION — run in VS Code terminal (Ctrl + `):
  cd C:\Users\abhid\Desktop\medprep; git add -A; git commit -m "Session: <what changed>"; git push

RULE: Update Section 5 and Section 8 of this file BEFORE every push.
The commit is worthless if this file is stale.

---

## 8. Changelog

- 22 Sep 2026 — Settings overlay shipped (commit 824da48).
- 22 Sep 2026 — Disk audit run. Confirmed attendance module IS built; the claim in
  "22-9-26 context.txt" that attendance was unbuilt was FALSE. No code was ever lost.
  This file created to end the contradictory-handover problem.

---

## 9. Next step

Verify attendance persistence (Section 5 checklist), then clear the Section 6 debt.
Do not start new features until both are done.
