# MEMORY.md — medprep

**THIS FILE OVERRIDES AI MEMORY.**
If your stored memory contradicts this file, your memory is wrong.
If this file contradicts `tree app /F`, the disk is right — update this file.
Never assume a feature is unbuilt. Check first.

Repo: https://github.com/Abhidatla203/medprep
Path: C:\Users\abhid\Desktop\medprep
Owner: Abhidatla203

---

## 1. HOW TO WORK WITH ME

- No coding experience. Explain in plain language.
- Slower pace. Less detail per message. Too much at once is hard to process.
- Full replacement files only. Never "find line 40 and change it".
- One file at a time. One feature at a time.
- Exact copy-paste terminal commands, tailored to the real folder structure.
- No back-and-forth clarification loops. Ask at most one question, up front.
- Brainstorming: I give my vision → you suggest changes/additions → I assess and reply.

---

## 2. STACK (verified)

- Next.js 16.3.5, TypeScript, Tailwind
- Storage: localStorage
- Path alias: `"@/*": ["./*"]` (root-relative)
- Dates: store ISO, display dd/mm/yyyy
- University: NTRUHS only for now
- Design principle: store raw facts, compute views at read time

---

## 3. WHAT EXISTS — verified 22 Sep 2026 by `tree /F`

### app/
```
favicon.ico, globals.css, layout.tsx, page.tsx

attendance/
  calculate.ts, generate.ts, page.tsx, store.ts, types.ts, useAttendance.ts
  setup/page.tsx

components/
  Circulars.tsx, Nav.tsx, PageStub.tsx, QuestionOfTheDay.tsx,
  RecommendedTest.tsx, SubjectBadge.tsx

data/
  questions/index.ts, questions/pharmacology.json
  universities/ntruhs/curriculum.ts

papers/page.tsx
planner/page.tsx
question-bank/page.tsx

settings/
  layout.tsx, page.tsx, SettingsShell.tsx
  academics/page.tsx
  academics/subjects/page.tsx
  attendance/page.tsx
  profile/page.tsx, profile/PhotoCropper.tsx

store/settings.tsx
```

### lib/
```
attendance/backup.ts, curriculum.ts, datetime.ts
```

### components/  (root level — separate from app/components/)
```
attendance/ClassEditorSheet.tsx, DateField.tsx, PostingScheduler.tsx,
           TimeField.tsx, WeekGrid.tsx
```

---

## 4. PROJECT RULES

- Two curricula, intentionally separate:
  - **University curriculum** (`app/data/universities/ntruhs/curriculum.ts`) →
    question banks, MCQs, student analysis, schedule planner.
  - **Attendance curriculum** (`lib/attendance/curriculum.ts`) →
    attendance classes and timetable setup.
- Class types: theory, practical, clinical posting.
- Daily marking actions: Present, Absent, Cancelled.
- WeekGrid: days vertical, time horizontal. Shows subject names, colour = class type.
- WeekGrid must not render an empty 8 AM column if all classes start 9 AM or later.
- Clinical postings UI must explain when the student's current year has none.
- `/attendance` redirects to `/attendance/setup`.
- Backups: GitHub **and** offline.

---

## 5. KNOWN ISSUES

1. **Two component folders** — `app/components/` and root `components/`.
   Both work. Future sessions will guess wrong. Pick one and consolidate.
2. **Two store patterns** — `app/store/settings.tsx` (Context) vs
   `app/attendance/store.ts` (plain module).
3. **Two attendance settings screens** — `app/settings/attendance/page.tsx`
   and `app/attendance/setup/page.tsx`. Likely overlapping. Decide which owns what.

---

## 6. UNVERIFIED — do not state as fact

- Does attendance data survive a page refresh? **Unknown.**
  Older memory claimed "persistence not completed" — that was never confirmed
  after `store.ts` appeared. Test before building anything on top of it.
- Theme: slate vs zinc. Docs disagree. Check `globals.css`.

---

## 7. SESSION START PROMPT — paste this into any new chat

```
Read MEMORY.md in github.com/Abhidatla203/medprep.
Confirm the last CHANGELOG entry, then wait. Don't propose anything yet.
If your stored memory contradicts that file, say so — the file wins.
```

## 8. SESSION END — 60 seconds, non-negotiable

1. Append the session's MEMORY UPDATE block to the CHANGELOG below.
2. Run:

```powershell
cd C:\Users\abhid\Desktop\medprep; git add -A; git commit -m "session: <what changed>"; git push
```

---

## 9. CHANGELOG — append only, newest at bottom

[2026-09-20] Settings overlay work begun.
[2026-09-22] Settings overlay committed: app/settings/, 9 files, 1218 insertions (824da48).
[2026-09-22] Disk audit via tree /F. All three handover docs were each partially
             correct; no code was ever lost. Attendance exists in app/attendance/,
             lib/attendance/, and components/attendance/ simultaneously.
[2026-09-22] Deleted dead file app/attendance/page.old.tsx.bak.
[2026-09-22] MEMORY.md created as single source of truth, overriding AI memory.
[2026-09-22] NEXT: test whether attendance survives a refresh.
[2026-09-22 SESSION 2] Doc consolidation audit complete. AGENTS.md and CLAUDE.md
             already point to MEMORY.md (no drift risk). git ls-files: 4 .md files
             (AGENTS.md, CLAUDE.md, MEMORY.md, README.md).
[2026-09-22] F5 persistence test: /attendance redirects to /attendance/setup.
             /attendance marking page missing (earlier agent misunderstood intent,
             built only setup + redirect). User already has saved timetable.
[2026-09-22] DECISION: Rebuild /attendance page from scratch when user returns.
             Do not start rebuild until user confirms return.
[2026-09-22] USER REQUEST: wants MEMORY.md as downloadable file for local update
             before next session.
