"use client";

export default function AttendanceSettingsPage() {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-2xl font-bold tracking-tight">Attendance</h2>
        <p className="mt-1 text-sm text-slate-400">
          Timetable and tracking options live here. Save will appear when these are editable.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="text-sm font-semibold text-slate-200">Edit timetable</h3>
        <p className="mt-2 text-sm text-slate-400">
          Weekly lecture grid (subject × day) will open from this card. Not wired yet on purpose.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="text-sm font-semibold text-slate-200">Other attendance settings</h3>
        <p className="mt-2 text-sm text-slate-400">
          Things like the 75% target, holidays, and catch-up rules will sit here once tracking exists.
        </p>
      </section>
    </div>
  );
}
