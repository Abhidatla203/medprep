"use client";

// =============================================================================
// app/components/Nav.tsx
// -----------------------------------------------------------------------------
// Light theme. White bars, slate text, slate-900 as the only strong accent.
// Teal has been retired across the app.
//
// ⚠ Z-INDEX NOTE
//   The bottom tab bar is z-30. Every bottom sheet in the app is z-50, so a
//   sheet always covers the tabs rather than fighting them. Previously both
//   were z-40, which on a short window meant the tab bar could sit on top of
//   a sheet's Save button — present, rendered, and completely unclickable.
// =============================================================================

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
      {/* ------------------------------ Top bar ------------------------------ */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1024px] items-center justify-between px-4">
          <Link
            href="/"
            className="text-sm font-bold tracking-tight text-slate-900"
          >
            med<span className="text-slate-400">prep</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {TABS.slice(1).map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  isActive(t.href)
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
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
                ? "bg-slate-900 text-white"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            ⚙
          </Link>
        </div>
      </header>

      {/* ------------------- Bottom tabs — mobile only, z-30 ------------------ */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-[1024px]">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] transition ${
                isActive(t.href)
                  ? "font-medium text-slate-900"
                  : "text-slate-400"
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
