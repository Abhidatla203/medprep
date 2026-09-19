"use client";

import { useState } from "react";

type Circular = {
  id: string;
  title: string;
  type: "Exam" | "Fees" | "Timetable" | "General";
  date: string;
  url: string;
  unread: boolean;
};

const EXAM_NOTIFICATIONS = "https://drntr.uhsap.in/index/notification_examination";
const ALL_NOTIFICATIONS = "https://drntr.uhsap.in/index/Notifications";

const CIRCULARS: Circular[] = [
  {
    id: "c1",
    title:
      "Revised time table — 2nd MBBS Regular & Supplementary theory examinations",
    type: "Exam",
    date: "2026-09-16",
    url: EXAM_NOTIFICATIONS,
    unread: true,
  },
  {
    id: "c2",
    title:
      "Last date for payment of examination fees without late fee extended to 30 September",
    type: "Fees",
    date: "2026-09-12",
    url: EXAM_NOTIFICATIONS,
    unread: true,
  },
  {
    id: "c3",
    title:
      "Instructions to candidates regarding practical and viva-voce examination centres",
    type: "Timetable",
    date: "2026-09-05",
    url: EXAM_NOTIFICATIONS,
    unread: false,
  },
  {
    id: "c4",
    title:
      "Notification on minimum attendance requirement for eligibility to appear in university examinations",
    type: "General",
    date: "2026-08-28",
    url: ALL_NOTIFICATIONS,
    unread: false,
  },
];

const TYPE_STYLES: Record<Circular["type"], string> = {
  Exam: "bg-rose-500/10 text-rose-400",
  Fees: "bg-amber-500/10 text-amber-400",
  Timetable: "bg-sky-500/10 text-sky-400",
  General: "bg-slate-500/10 text-slate-400",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

export default function Circulars() {
  const [items, setItems] = useState(CIRCULARS);

  const unreadCount = items.filter((i) => i.unread).length;

  function markRead(id: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, unread: false } : i))
    );
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          University Circulars
        </h2>

        {unreadCount > 0 && (
          <span className="rounded-full bg-teal-500/15 px-2 py-0.5 text-[11px] font-medium text-teal-300">
            {unreadCount} new
          </span>
        )}
      </div>

      <div className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
        {items.map((c) => (
          <a
            key={c.id}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => markRead(c.id)}
            className="group flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-slate-900"
          >
            <span
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                c.unread ? "bg-teal-400" : "bg-transparent"
              }`}
            />

            <div className="min-w-0 flex-1">
              <p
                className={`text-sm leading-snug ${
                  c.unread ? "font-medium text-slate-200" : "text-slate-400"
                }`}
              >
                {c.title}
              </p>

              <div className="mt-1.5 flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    TYPE_STYLES[c.type]
                  }`}
                >
                  {c.type}
                </span>
                <span className="text-[11px] text-slate-600">
                  {formatDate(c.date)}
                </span>
              </div>
            </div>

            <span className="mt-0.5 shrink-0 text-xs text-slate-700 transition group-hover:text-teal-400">
              ↗
            </span>
          </a>
        ))}
      </div>

      <a
        href={ALL_NOTIFICATIONS}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block text-xs text-slate-500 transition hover:text-teal-400"
      >
        View all on Dr. NTRUHS website →
      </a>
    </section>
  );
}
