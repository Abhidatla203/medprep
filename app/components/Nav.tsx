"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Dashboard", icon: "◫" },
  { href: "/question-bank", label: "Questions", icon: "?" },
  { href: "/papers", label: "Papers", icon: "▤" },
  { href: "/attendance", label: "Attendance", icon: "✓" },
  { href: "/planner", label: "Planner", icon: "◷" },
];

export default function Nav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1024px] items-center justify-between px-4">
          <Link href="/" className="text-sm font-bold tracking-tight text-slate-100">
            med<span className="text-teal-400">prep</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {TABS.slice(1).map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  isActive(t.href)
                    ? "bg-slate-800 text-teal-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>

          <Link
            href="/settings"
            aria-label="Settings"
            className={`rounded-lg px-2 py-1.5 text-base transition ${
              isActive("/settings")
                ? "text-teal-300"
                : "text-slate-500 hover:text-slate-200"
            }`}
          >
            ⚙
          </Link>
        </div>
      </header>

      {/* Bottom tabs — mobile only */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/90 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-[1024px]">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] transition ${
                isActive(t.href) ? "text-teal-300" : "text-slate-500"
              }`}
            >
              <span className="text-base leading-none">{t.icon}</span>
              {t.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
