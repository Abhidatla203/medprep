'use client';

// =============================================================================
// app/attendance/components/RingGrid.tsx
// -----------------------------------------------------------------------------
// One tile per subject. Two concentric rings per tile.
//
//     OUTER ring = theory          (every subject has it)
//     INNER ring = practical OR clinical
//     coloured  = attended
//     grey      = missed
//     notch     = the pass threshold
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ WHY THE RINGS LOOKED FULL WHEN THEY WERE EMPTY — 25 Sep 2026
// ═════════════════════════════════════════════════════════════════════════════
//  The previous version gave each category a TINTED track:
//      theory: { arc: '#7c3aed', track: '#cfc7dd' }   ← pale violet
//  So a subject at 0/0 drew a complete circle of pale violet. At 112px on a
//  phone, pale violet and violet are the same ring. The arc maths was correct
//  the whole time; the TRACK was impersonating it.
//
//  The rule now, and it is not negotiable:
//      COLOUR = ATTENDED.  GREY = NOT ATTENDED.
//
//  ★ GEOMETRY COMES FROM attended/conducted. Never `ratio`, never
//    `percentDisplay`. Two integers cannot be in the wrong units.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ WHY "CRITICAL" STOPPED MEANING ANYTHING — 25 Sep 2026
// ═════════════════════════════════════════════════════════════════════════════
//  Three of four subjects read "Critical" at once. A word that describes most
//  of the screen describes nothing, and a student who sees it everywhere stops
//  reading it — which is the opposite of what a warning is for.
//
//  The cause was semantic, not arithmetic. `bandFor()` returns 'critical' for
//  anything more than dangerMargin below the threshold. At 75%, a subject at
//  50% in week four of a six-month term lands there — even though attending
//  every remaining class recovers it comfortably. That is not critical. That
//  is behind.
//
//  ★ THE DISTINCTION THAT MATTERS IS REACHABILITY, NOT DISTANCE.
//    calculate.ts already computes `targetUnreachable` — true only when
//    attending EVERY remaining class still misses the threshold. That is the
//    genuinely unrecoverable state, and it was being computed and ignored.
//
//  So the word "Critical" is now gated on targetUnreachable. Everything else
//  below the line is Behind or Well behind: honest, ordered, and still
//  uncomfortable, without crying wolf.
//
//  ⚠ THIS IS A DISPLAY DECISION ONLY. No band, ratio, threshold or count is
//    recalculated here. calculate.ts remains the single source of arithmetic.
// ═════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CategoryResult, ClassCategory, SafetyBand, SubjectResult } from '../types';
import { statusLine } from '../calculate';
import AttendanceRing, { type RingSpec } from './AttendanceRing';


// -----------------------------------------------------------------------------
// SECTION 1 — Category identity
//
// Hue tells you WHAT the class is. The label tells you HOW YOU ARE DOING.
// Status never steals the ring colour, or the grid becomes a wall of red.
// -----------------------------------------------------------------------------

const CATEGORY_DOT: Record<ClassCategory, string> = {
  theory: '#AF52DE',
  practical: '#0A84FF',
  clinical: '#30B0C7',
};

const CATEGORY_LABEL: Record<ClassCategory, string> = {
  theory: 'Theory',
  practical: 'Practical',
  clinical: 'Clinical',
};

/** Outer first. Theory is outermost on every tile, so tiles stay comparable. */
const CATEGORY_ORDER: ClassCategory[] = ['theory', 'practical', 'clinical'];


// -----------------------------------------------------------------------------
// SECTION 2 — Standing: the word, the chip, the colour
//
// ⚠ types.ts and globals.css disagree on the middle two band names:
//     types.ts    safe | warning | danger | critical
//     globals.css safe | watch   | risk   | critical
//   The translation lives here and nowhere else. Never interpolate
//   `chip-${band}` inline — `chip-warning` does not exist and fails silently.
// -----------------------------------------------------------------------------

/** Five states, worst first. More granular than SafetyBand on purpose. */
type Standing = 'unreachable' | 'wellBehind' | 'behind' | 'watch' | 'onTrack';

const STANDING_WORD: Record<Standing, string> = {
  unreachable: 'Critical',
  wellBehind: 'Well behind',
  behind: 'Behind',
  watch: 'Watch',
  onTrack: 'On track',
};

const STANDING_TEXT: Record<Standing, string> = {
  unreachable: '#C0353F',
  wellBehind: '#C2410C',
  behind: '#B25E09',
  watch: '#8A6D1F',
  onTrack: '#1C7C54',
};

const STANDING_CHIP: Record<Standing, string> = {
  unreachable: 'chip-critical',
  wellBehind: 'chip-risk',
  behind: 'chip-risk',
  watch: 'chip-watch',
  onTrack: 'chip-safe',
};

const STANDING_ORDER: Record<Standing, number> = {
  unreachable: 0,
  wellBehind: 1,
  behind: 2,
  watch: 3,
  onTrack: 4,
};

/**
 * ★ One category's standing.
 *
 * targetUnreachable is checked FIRST and overrides the band entirely. A
 * subject can be only slightly below the line and still be unrecoverable if
 * the term is nearly over — distance from the threshold does not capture that,
 * and reachability is the thing a student can actually act on.
 */
function standingOfCategory(c: CategoryResult): Standing {
  if (c.targetUnreachable) return 'unreachable';

  const byBand: Record<SafetyBand, Standing> = {
    safe: 'onTrack',
    warning: 'watch',
    danger: 'behind',
    critical: 'wellBehind',   // ← was 'Critical'. Downgraded deliberately.
  };
  return byBand[c.band];
}

/**
 * The subject's standing = its worst real category.
 *
 * Empty and excluded categories are skipped — there is nothing to be failing.
 * This is what stops a seeded 0/0 clinical ring painting a whole subject red.
 */
function standingOfSubject(subject: SubjectResult): Standing {
  let worst: Standing = 'onTrack';
  for (const c of subject.categories) {
    if (c.isExcluded || c.isEmpty) continue;
    const s = standingOfCategory(c);
    if (STANDING_ORDER[s] < STANDING_ORDER[worst]) worst = s;
  }
  return worst;
}


// -----------------------------------------------------------------------------
// SECTION 3 — Maths. All of it.
// -----------------------------------------------------------------------------

/**
 * ★ HOW FULL THE RING IS. The only input to the geometry.
 * Two integers in, one clamped 0–1 fraction out.
 */
function fractionOf(c: CategoryResult): number {
  const conducted = c.conducted ?? 0;
  const attended = c.attended ?? 0;
  if (conducted <= 0) return 0;
  const f = attended / conducted;
  return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
}

function hasClasses(c: CategoryResult): boolean {
  return (c.conducted ?? 0) > 0;
}

function subjectHasData(subject: SubjectResult): boolean {
  return subject.categories.some(hasClasses);
}

/** CategoryResult → the shape AttendanceRing draws. */
function toSpec(c: CategoryResult, isExcluded: boolean): RingSpec {
  return {
    ratio: fractionOf(c),
    isEmpty: !hasClasses(c),
    band: c.band,
    category: c.category,
    threshold: c.threshold,
    isExcluded,
  };
}

/**
 * Categories in draw order.
 *
 * calculate.ts now guarantees every exam subject carries its full legal pair,
 * so this normally returns exactly two. It still tolerates one or three — a
 * non-exam subject may legitimately have only what it has.
 */
function ringsFor(subject: SubjectResult): CategoryResult[] {
  return CATEGORY_ORDER
    .map((cat) => subject.categories.find((c) => c.category === cat))
    .filter((c): c is CategoryResult => Boolean(c));
}


// -----------------------------------------------------------------------------
// SECTION 4 — Grid
// -----------------------------------------------------------------------------

export interface RingGridProps {
  subjects: SubjectResult[];
  /** Store revision. Lets the parent force a repaint after a mark. */
  revision?: number;
}

export default function RingGrid({ subjects, revision }: RingGridProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);

  const ordered = useMemo(() => {
    void revision;
    return [...subjects].sort((a, b) => {
      // Subjects with nothing recorded sink to the bottom — they are neither
      // achievements nor warnings.
      const aEmpty = subjectHasData(a) ? 0 : 1;
      const bEmpty = subjectHasData(b) ? 0 : 1;
      if (aEmpty !== bEmpty) return aEmpty - bEmpty;

      const byStanding =
        STANDING_ORDER[standingOfSubject(a)] - STANDING_ORDER[standingOfSubject(b)];
      if (byStanding !== 0) return byStanding;

      return a.subjectName.localeCompare(b.subjectName);
    });
  }, [subjects, revision]);

  /**
   * Two columns on a phone, always.
   *
   * Three 112px rings across a 360px screen leaves no room to breathe, and
   * cramped is the biggest single reason an interface reads as cheap.
   */
  const size = ordered.length <= 2 ? 148 : 132;

  const legend = useMemo(() => {
    const present = new Set<ClassCategory>();
    ordered.forEach((s) => s.categories.forEach((c) => present.add(c.category)));
    return CATEGORY_ORDER.filter((c) => present.has(c));
  }, [ordered]);

  const open = ordered.find((s) => s.subjectId === openId) ?? null;

  if (ordered.length === 0) {
    return (
      <section className="card p-6 text-center">
        <p className="text-sm text-ink-muted">
          No subjects tracked yet. Add your timetable in setup.
        </p>
      </section>
    );
  }

  return (
    <>
      {/* Legend — coloured dots instead of a paragraph. Outer/inner labelled,
          because concentric rings are not self-explanatory on first sight. */}
      <div className="mb-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {legend.map((cat, i) => (
          <span
            key={cat}
            className="inline-flex items-center gap-1.5 text-[0.6875rem] font-medium tracking-wide text-ink-muted"
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: CATEGORY_DOT[cat] }}
              aria-hidden
            />
            {CATEGORY_LABEL[cat]}
            <span className="text-ink-faint">{i === 0 ? '· outer' : '· inner'}</span>
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        {ordered.map((subject) => (
          <SubjectTile
            key={subject.subjectId}
            subject={subject}
            size={size}
            onOpen={() => setOpenId(subject.subjectId)}
          />
        ))}
      </div>

      {/* Numbers live in the modal and nowhere else. A figure on the grid gets
          read as an overall standing — the one thing this rebuild removes. */}
      {open && <SubjectModal subject={open} onClose={close} />}
    </>
  );
}


// -----------------------------------------------------------------------------
// SECTION 5 — One subject tile
//
// ★ NO BORDER. A 1px outline round every tile is what made the grid look like
//   a table. Depth comes from a near-white surface and one very soft shadow —
//   the iOS approach: separate by elevation, not by drawing lines.
// -----------------------------------------------------------------------------

function SubjectTile(props: {
  subject: SubjectResult;
  size: number;
  onOpen: () => void;
}) {
  const { subject, size, onOpen } = props;

  const rings = ringsFor(subject);
  const started = subjectHasData(subject);
  const muted = subject.isExcluded;
  const standing = standingOfSubject(subject);

  const outer = rings[0] ? toSpec(rings[0], muted) : null;
  const inner = rings[1] ? toSpec(rings[1], muted) : null;

  const labelColor = muted || !started ? '#8E8E93' : STANDING_TEXT[standing];

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${subject.subjectName} — ${
        started ? STANDING_WORD[standing] : 'no classes yet'
      }`}
      className="group flex w-full flex-col items-center gap-3 rounded-[22px] px-2 py-4 transition-all duration-200 active:scale-[0.975]"
      style={{
        background: 'rgba(255,255,255,0.72)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -12px rgba(0,0,0,0.10)',
      }}
    >
      <div style={{ width: size, height: size }} className="relative">
        {outer ? (
          <AttendanceRing outer={outer} inner={inner} size={size} tone="category" />
        ) : (
          // No categories at all. One dotted placeholder, so the grid never has
          // a hole where a tile should be.
          <AttendanceRing
            outer={{ ratio: 0, isEmpty: true, band: 'safe', category: 'theory' }}
            inner={null}
            size={size}
            tone="category"
          />
        )}

        {!started && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[0.625rem] font-medium tracking-wide text-ink-faint">
            No classes
          </span>
        )}
      </div>

      <span className="w-full px-1 text-center leading-tight">
        <span
          className="block truncate text-[0.8125rem] font-semibold tracking-[-0.01em]"
          style={{ color: labelColor }}
        >
          {subject.subjectName}
        </span>
        <span className="mt-1 block text-[0.6875rem] font-medium text-ink-faint">
          {muted ? 'Excluded' : started ? STANDING_WORD[standing] : 'Not started'}
        </span>
      </span>
    </button>
  );
}


// -----------------------------------------------------------------------------
// SECTION 6 — Detail modal
//
// Every number in this component lives here. Escape closes, scrim tap closes,
// the page behind is scroll-locked. All three are expected; usually only one
// gets built.
// -----------------------------------------------------------------------------

function SubjectModal(props: { subject: SubjectResult; onClose: () => void }) {
  const { subject, onClose } = props;
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.setAttribute('data-modal-open', 'true');
    cardRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.removeAttribute('data-modal-open');
    };
  }, [onClose]);

  const started = subjectHasData(subject);
  const rings = ringsFor(subject);
  const standing = standingOfSubject(subject);

  return (
    <div
      className="modal-layer"
      role="dialog"
      aria-modal="true"
      aria-label={subject.subjectName}
    >
      <div className="modal-scrim" onClick={onClose} aria-hidden />

      <div className="modal-card" ref={cardRef} tabIndex={-1}>
        <div className="modal-head px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="display truncate text-xl tracking-[-0.02em]">
                {subject.subjectName}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {subject.isExcluded ? (
                  <span className="chip chip-neutral">Excluded</span>
                ) : started ? (
                  <span className={`chip ${STANDING_CHIP[standing]}`}>
                    {STANDING_WORD[standing]}
                  </span>
                ) : (
                  <span className="chip chip-neutral">No classes yet</span>
                )}
              </div>
            </div>

            <button onClick={onClose} aria-label="Close" className="modal-close">
              ✕
            </button>
          </div>

          {subject.isExcluded && (
            <p className="mt-3 text-xs leading-relaxed text-ink-muted">
              Excluded from your calculations. Still tracked — nothing deleted.
            </p>
          )}
        </div>

        {/* The same ring, large, at the top of the sheet — so the tap has
            somewhere to land. Same component, same numbers, no second
            implementation to drift out of sync. */}
        {rings[0] && (
          <div className="flex justify-center pb-1 pt-1">
            <AttendanceRing
              outer={toSpec(rings[0], subject.isExcluded)}
              inner={rings[1] ? toSpec(rings[1], subject.isExcluded) : null}
              size={168}
              tone="category"
            />
          </div>
        )}

        {/* Each category judged against ITS OWN threshold, and says so. "78%"
            beside "needs 80%" is understood instantly; "78%" alone is noise. */}
        <div className="modal-body px-5 pb-5 pt-2">
          <div className="space-y-4">
            {rings.map((c) => {
              const empty = !hasClasses(c);
              const catStanding = standingOfCategory(c);

              return (
                <div
                  key={c.category}
                  className="border-t border-line/60 pt-4 first:border-0 first:pt-0"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium text-ink">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: CATEGORY_DOT[c.category] }}
                        aria-hidden
                      />
                      {CATEGORY_LABEL[c.category]}
                    </span>

                    <span className="tnum text-sm">
                      {empty ? (
                        <span className="text-ink-faint">No classes yet</span>
                      ) : (
                        <>
                          <span className="text-ink-muted">
                            {c.attended}/{c.conducted}
                          </span>
                          <span
                            className="ml-2 text-base font-semibold tracking-[-0.01em]"
                            style={{ color: STANDING_TEXT[catStanding] }}
                          >
                            {c.percentDisplay}%
                          </span>
                        </>
                      )}
                    </span>
                  </div>

                  <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                    {statusLine(c)}
                  </p>

                  <p className="mt-1 text-[0.6875rem] text-ink-faint">
                    Needs {c.threshold}%
                    {c.isCustomThreshold ? ' — your setting' : ' — default'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
