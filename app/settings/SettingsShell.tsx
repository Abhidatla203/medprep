"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/settings/profile", title: "Profile" },
  { href: "/settings/academics", title: "Academics" },
  { href: "/settings/attendance", title: "Attendance" },
];

export default function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        <Link
          href="/"
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-teal-500/50 hover:text-teal-200"
        >
          ← Back
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-32 shrink-0 overflow-y-auto border-r border-slate-800 p-2 sm:w-44">
          {ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`mb-1 block rounded-xl px-3 py-3 text-sm font-semibold transition ${
                  active
                    ? "bg-teal-500/10 text-teal-200"
                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                }`}
              >
                {item.title}
              </Link>
            );
          })}
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
