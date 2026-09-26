'use client';

// =============================================================================
// app/attendance/setup/SaveBar.tsx
// -----------------------------------------------------------------------------
// The answer to "where is the save button?"
//
// There is no save button because there is nothing unsaved. Every mutation in
// store.ts writes to localStorage synchronously and calls notify(). By the time
// a sheet closes, the data is already on disk.
//
// What was missing was CONFIRMATION â€” silent success is indistinguishable from
// silent failure. This bar flashes a timestamped "Saved" on every write, states
// the resting truth otherwise, and offers Done as the real primary action.
//
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  âš  TWO LAYOUT RULES THIS FILE EXISTS TO GET RIGHT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//
//  1. FULLY OPAQUE. It was bg-surface/92 with a backdrop-blur. Frosted glass
//     looks refined over a photo and looks broken over dense text â€” the cards
//     behind it stayed legible enough to read, which made the bar seem like a
//     rendering fault rather than a surface. A status bar carrying a primary
//     action must be a solid object.
//
//  2. IT RESERVES ITS OWN SPACE. A `fixed` element is out of the document flow,
//     so the page has no idea it exists and the last card sits underneath it.
//     Relying on the page to remember a matching pb-24 is a bug waiting for the
//     next person who edits the page. Instead this component renders a static
//     spacer in the flow AND the fixed bar, so the clearance can never drift
//     out of sync with the thing it is clearing.
//
//  Positioning uses bottom offsets rather than padding: bottom-[4.5rem] clears
//  the mobile tab bar, bottom-4 on desktop where that bar is hidden.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SaveBar(props: {
  /** The parent's store revision. Any increment means something was written. */
  revision: number;
  /** Suppresses the bar while a sheet is open, so footers never stack. */
  hidden?: boolean;
}) {
  const { revision, hidden } = props;
  const router = useRouter();

  const [justSaved, setJustSaved] = useState(false);
  const [stamp, setStamp] = useState<string | null>(null);

  // Revision 0 is the initial mount, not a write. Confirming a save the user
  // never made would be a small lie, and those add up.
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }

    setStamp(
      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    );
    setJustSaved(true);

    const t = window.setTimeout(() => setJustSaved(false), 2400);
    return () => window.clearTimeout(t);
  }, [revision]);

  // The spacer stays mounted even when the bar is hidden. Removing it would
  // make the page jump upward every time a sheet opens.
  return (
    <>
      {/* Reserves the bar's footprint in the document flow. */}
      <div className="h-24 md:h-20" aria-hidden />

      {!hidden && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[4.5rem] z-30 md:bottom-4">
          <div className="mx-auto w-full max-w-5xl px-4">
            <div
              className="pointer-events-auto flex items-center gap-3 rounded-card border border-line-strong bg-surface p-2.5 pl-4 shadow-lift"
              role="status"
              aria-live="polite"
            >
              <span className="min-w-0 flex-1">
                {justSaved ? (
                  <span className="flex items-center gap-2 text-sm font-medium text-safe">
                    <span
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-safe-soft text-[11px]"
                      aria-hidden
                    >
                      âœ“
                    </span>
                    Saved
                    {stamp && (
                      <span className="tnum font-normal text-ink-faint">
                        Â· {stamp}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="block truncate text-sm text-ink-muted">
                    Changes save automatically
                  </span>
                )}
              </span>

              <button
                onClick={() => router.push('/attendance')}
                className="btn btn-primary shrink-0 px-5"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
