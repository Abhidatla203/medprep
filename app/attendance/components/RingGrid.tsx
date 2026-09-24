'use client';

// =============================================================================
// app/attendance/components/RingGrid.tsx
// -----------------------------------------------------------------------------
// One ring per class type. Fuller ring = better attendance. That is the whole
// idea, and the code is deliberately no cleverer than that sentence.
//
//     fraction = attended / conducted        →  how much of the ring is filled
//     track    = the rest, in grey           →  the part you did not attend
//     tick     = the threshold               →  past it is safe
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ WHY THIS FILE IS NOW SELF-CONTAINED — THREE BUGS, ONE ROOT CAUSE
// ═════════════════════════════════════════════════════════════════════════════
// Every ring bug so far came from INDIRECTION, not from the maths:
//
//   1. Arcs drew as full circles because the code fed `result.ratio` into a
//      function expecting 0–1, while `ratio` actually carries 0–100. Everything
//      clamped to 1. A student at 34% and one at 98% got identical rings — the
//      worst kind of bug, because it does not look broken, it looks reassuring.
//
//   2. Colours vanished because `stroke` came from CSS classes like
//      `.ring-theory`, and a token rename or a Tailwind v4 change breaks those
//      SILENTLY. No error, no warning, just a grey circle.
//
//   3. The grey track was invisible against the warm canvas — a 4% luminance
//      difference. The denominator disappeared, so the arc meant nothing.
//
// THE FIX FOR ALL THREE IS THE SAME: this component now computes its own
// fraction from two integers, and paints its own colours from constants defined
// twelve lines below. It reads exactly three fields off CategoryResult —
// attended, conducted, threshold — plus band and percentDisplay for the label
// and modal. Nothing else can break it.
//
// ★ DO NOT reintroduce `ratio` or `percentDisplay` into the geometry.
//   attended/conducted is exact, unrounded, and cannot be in the wrong units.
// ═════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  CategoryResult,
  ClassCategory,
  SafetyBand,
  SubjectResult,
} from '../types';
import { statusLine } from '../calculate';


// -----------------------------------------------------------------------------
// SECTION 1 — Colours
//
// ★ HARD-CODED ON PURPOSE. These are the single source of truth for ring colour
//   and they are passed to SVG as literal `stroke` values. No CSS class, no
//   theme token, no Tailwind utility — nothing that can resolve to empty.
//
// PURPLE and ORANGE, chosen over the old blue/green pair for three reasons:
//   • neither collides with the green that means "present" elsewhere in the app
//   • they sit on opposite sides of the wheel, so two adjacent rings never
//     blend at 7px stroke on a phone
//   • both stay distinguishable under the most common colour-blindness types,
//     where blue/green does not
//
// EACH RING HAS ITS OWN TRACK GREY. This is the part that was missing. Two rings
// with the same grey track look like one thick grey band when both are nearly
// empty — you cannot tell where theory ends and practical begins. The theory
// track is deliberately DARKER, matching the fact that its arc is the darker of
// the two, so each ring reads as one object rather than two unrelated layers.
// -----------------------------------------------------------------------------

interface RingPalette {
  /** The filled arc — what you attended. */
  arc: string;
  /** The unfilled remainder — what you missed. Distinct per category. */
  track: string;
  /** Dot used in the key and the modal. */
  dot: string;
}

const PALETTE: Record<ClassCategory, RingPalette> = {
  theory: {
    arc: '#7c3aed',    // violet 600
    track: '#cfc7dd',  // darker, cool-tinted grey — pairs with the violet
    dot: '#7c3aed',
  },
  practical: {
    arc: '#ea580c',    // orange 600
    track: '#e6d9cd',  // lighter, warm-tinted grey — pairs with the orange
    dot: '#ea580c',
  },
  clinical: {
    arc: '#0891b2',    // cyan 600 — only appears in clinical years
    track: '#c9dbe0',
    dot: '#0891b2',
  },
};

/** Dashed ring for a category with no classes conducted yet. */
const EMPTY_STROKE = '#c9c2b6';

/** The threshold marker. Dark, neutral, deliberately not a category colour. */
const TICK_STROKE = '#6b6478';


// -----------------------------------------------------------------------------
// SECTION 2 — Band and category labels
//
// ⚠ types.ts and globals.css disagree on the middle two band names:
//     types.ts    : safe | warning | danger | critical
//     globals.css : safe | watch   | risk   | critical
//   Both are reasonable, so the translation lives here and nowhere else.
//   Never write `ring-label-${band}` inline — `ring-label-warning` does not
//   exist, renders with no colour, and reports no error.
// -----------------------------------------------------------------------------

const BAND_TEXT: Record<SafetyBand, string> = {
  safe: '#0f9b6c',
  warning: '#c2870b',
  danger: '#dd6b20',
  critical: '#d64550',
};

const BAND_CHIP: Record<SafetyBand, string> = {
  safe: 'chip-safe',
  warning: 'chip-watch',
  danger: 'chip-risk',
  critical: 'chip-critical',
};

/** Plain words. "Danger" alarms; "At risk" informs. */
const BAND_WORD: Record<SafetyBand, string> = {
  safe: 'Safe',
  warning: 'Watch',
  danger: 'At risk',
  critical: 'Critical',
};

/** Worst first. A student should never hunt for the subject that is failing. */
const BAND_ORDER: Record<SafetyBand, number> = {
  critical: 0,
  danger: 1,
  warning: 2,
  safe: 3,
};

const CATEGORY_LABEL: Record<ClassCategory, string> = {
  theory: 'Theory',
  practical: 'Practical',
  clinical: 'Clinical',
};

/**
 * Drawing order, outside in. Theory is always outermost because every subject
 * has it — so the outer ring means the same thing on every tile in the grid,
 * which is what makes them comparable at a glance.
 */
const CATEGORY_ORDER: ClassCategory[] = ['theory', 'practical', 'clinical'];


// -----------------------------------------------------------------------------
// SECTION 3 — The maths. All of it.
// -----------------------------------------------------------------------------

/**
 * ★ HOW FULL THE RING IS. Nothing else feeds the geometry.
 *
 * Two integers in, one 0–1 fraction out. No rounding, no unit conversion, no
 * dependency on any other field.
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

/**
 * The threshold tick, placed on the track.
 *
 * Arcs start at 12 o'clock and run clockwise, so angles are measured from -90°.
 * Without that offset every tick lands a quarter-turn out and the grid quietly
 * lies about where the pass mark is.
 */
function tickCoords(
  cx: number,
  cy: number,
  radius: number,
  thresholdPercent: number,
  width: number,
) {
  const angle = ((thresholdPercent / 100) * 360 - 90) * (Math.PI / 180);
  const r1 = radius - width / 2 - 2;
  const r2 = radius + width / 2 + 2;
  return {
    x1: cx + r1 * Math.cos(angle),
    y1: cy + r1 * Math.sin(angle),
    x2: cx + r2 * Math.cos(angle),
    y2: cy + r2 * Math.sin(angle),
  };
}


// -----------------------------------------------------------------------------
// SECTION 4 — Which rings does a subject get?
//
// ⚠ TRAP 9 — only what is REAL. The curriculum says what is POSSIBLE; this
//   draws what the student actually has. A theory-only subject gets one ring,
//   not one ring plus an empty circle implying a missing practical.
//
// ★ NO PAIRING LOGIC. An earlier version picked "one theory + one other", which
//   could silently drop a subject's only real category and then render it as
//   "no data" beside a Critical label — the component contradicting itself.
// -----------------------------------------------------------------------------

function ringsFor(subject: SubjectResult): CategoryResult[] {
  return CATEGORY_ORDER.map((cat) =>
    subject.categories.find((c) => c.category === cat),
  ).filter((c): c is CategoryResult => Boolean(c));
}

function subjectHasData(subject: SubjectResult): boolean {
  return subject.categories.some(hasClasses);
}


// -----------------------------------------------------------------------------
// SECTION 5 — Grid
// -----------------------------------------------------------------------------

export interface RingGridProps {
  subjects: SubjectResult[];
  /** Store revision. Lets the parent force a repaint after a mark. */
  revision?: number;
}

export default function RingGrid(props: RingGridProps) {
  const { subjects, revision } = props;

  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);

  // Worst first, subjects with no data last, alphabetical inside a band.
  const ordered = useMemo(() => {
    void revision;
    return [...subjects].sort((a, b) => {
      const aEmpty = subjectHasData(a) ? 0 : 1;
      const bEmpty = subjectHasData(b) ? 0 : 1;
      if (aEmpty !== bEmpty) return aEmpty - bEmpty;

      const byBand = BAND_ORDER[a.worstBand] - BAND_ORDER[b.worstBand];
      if (byBand !== 0) return byBand;

      return a.subjectName.localeCompare(b.subjectName);
    });
  }, [subjects, revision]);

  /**
   * Rings are a FIXED size — never scaled down to fit more subjects. Below
   * about 96px two concentric arcs stop being separable and the whole idea
   * collapses. What changes is how many sit in a row.
   */
  const columns = ordered.length <= 2 ? 2 : ordered.length === 4 ? 2 : 3;
  const diameter = ordered.length <= 2 ? 150 : 112;

  // Only categories actually in use this year. A first-year should not be shown
  // a "Clinical" key for something they will not meet for two more years.
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
      {/* ---- category key ----
          Replaces the paragraph of explanation that used to sit here. Coloured
          dots do the same job in a fifth of the space, and the same colours key
          the week strip above — one visual language for class type. */}
      <div className="mb-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
        {legend.map((cat) => (
          <span
            key={cat}
            className="inline-flex items-center gap-1.5 text-[0.6875rem] font-medium text-ink-muted"
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: PALETTE[cat].dot }}
              aria-hidden
            />
            {CATEGORY_LABEL[cat]}
          </span>
        ))}
      </div>

      <div
        className="grid justify-items-center gap-x-3 gap-y-6"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {ordered.map((subject) => (
          <SubjectTile
            key={subject.subjectId}
            subject={subject}
            diameter={diameter}
            onOpen={() => setOpenId(subject.subjectId)}
          />
        ))}
      </div>

      {/* Numbers live in the modal and nowhere else. The moment a figure appears
          in the grid itself, someone reads it as an overall standing. */}
      {open && <SubjectModal subject={open} onClose={close} />}
    </>
  );
}


// -----------------------------------------------------------------------------
// SECTION 6 — One subject
// -----------------------------------------------------------------------------

function SubjectTile(props: {
  subject: SubjectResult;
  diameter: number;
  onOpen: () => void;
}) {
  const { subject, diameter, onOpen } = props;

  const rings = ringsFor(subject);
  const started = subjectHasData(subject);

  const cx = diameter / 2;
  const cy = diameter / 2;

  /**
   * Stroke and gap adapt to ring count so a three-ring subject stays legible
   * without shrinking a two-ring one.
   *
   * ⚠ The innermost radius must stay above ~16px. Closer than that and the arcs
   *   smear into a single band.
   */
  const width = rings.length >= 3 ? 8 : diameter >= 140 ? 13 : 11;
  const gap = rings.length >= 3 ? 4 : 6;
  const outerRadius = cx - width / 2 - 2;

  const muted = subject.isExcluded;
  const labelColor = muted || !started
    ? '#a8a2b3'
    : BAND_TEXT[subject.worstBand];

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${subject.subjectName} — ${
        started ? BAND_WORD[subject.worstBand] : 'not started'
      }`}
      className="flex w-full flex-col items-center gap-2 rounded-card p-1 transition-transform active:scale-[0.97]"
    >
      <div className="relative" style={{ width: diameter, height: diameter }}>
        <svg
          width={diameter}
          height={diameter}
          viewBox={`0 0 ${diameter} ${diameter}`}
          /* -90° puts 12 o'clock at the start of every arc. */
          style={{ transform: 'rotate(-90deg)' }}
          aria-hidden
        >
          {rings.map((result, i) => (
            <Ring
              key={result.category}
              cx={cx}
              cy={cy}
              radius={outerRadius - i * (width + gap)}
              width={width}
              result={result}
              muted={muted}
            />
          ))}

          {/* A subject with nothing scheduled still gets a ring, so the grid
              never has a hole in it. */}
          {rings.length === 0 && (
            <circle
              cx={cx}
              cy={cy}
              r={outerRadius}
              fill="none"
              stroke={EMPTY_STROKE}
              strokeWidth={width}
              strokeDasharray="3 6"
              strokeLinecap="round"
            />
          )}
        </svg>

        {/* Centre stays EMPTY once there is data. A number here would be a
            pooled figure by implication — the one thing this rebuild removes. */}
        {!started && (
          <span className="absolute inset-0 flex items-center justify-center text-[0.625rem] font-medium text-ink-faint">
            Not started
          </span>
        )}
      </div>

      <span className="w-full px-0.5 text-center leading-tight">
        <span
          className="block truncate text-xs font-semibold"
          style={{ color: labelColor }}
        >
          {subject.subjectName}
        </span>
        <span className="mt-0.5 block text-[0.625rem] text-ink-faint">
          {muted
            ? 'Excluded'
            : started
              ? BAND_WORD[subject.worstBand]
              : 'No classes yet'}
        </span>
      </span>
    </button>
  );
}


/**
 * ONE RING.
 *
 *   1. grey track   — the whole circle, so the denominator is always visible
 *   2. coloured arc — attended/conducted of the way round
 *   3. threshold tick
 *
 * Every colour is an explicit `stroke` attribute. Nothing here depends on a CSS
 * class existing, which is what makes this the version that cannot silently
 * render invisible.
 */
function Ring(props: {
  cx: number;
  cy: number;
  radius: number;
  width: number;
  result: CategoryResult;
  muted: boolean;
}) {
  const { cx, cy, radius, width, result, muted } = props;

  if (radius < 6) return null; // defensive: too many categories to draw

  const palette = PALETTE[result.category];
  const circumference = 2 * Math.PI * radius;
  const fraction = fractionOf(result);
  const empty = !hasClasses(result);
  const tick = tickCoords(cx, cy, radius, result.threshold, width);

  return (
    <g opacity={muted ? 0.4 : 1}>
      {/* ★ THE TRACK — the part you did NOT attend.
          Each category has its own grey so two adjacent near-empty rings do not
          merge into one thick grey band. */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke={palette.track}
        strokeWidth={width}
      />

      {empty ? (
        /* Dashed overlay says "nothing here yet". A bare track with no arc just
           looks like the component failed to load. */
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={EMPTY_STROKE}
          strokeWidth={width}
          strokeDasharray="3 6"
          strokeLinecap="round"
          opacity={0.7}
        />
      ) : (
        /* ★ THE ARC — attended/conducted of the way round. */
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={palette.arc}
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          style={{
            transition: 'stroke-dashoffset 480ms cubic-bezier(0.32, 0.72, 0, 1)',
          }}
        />
      )}

      {/* The tick is the judgement: arc past it means safe. Neutral on purpose —
          a reference line, not another status. */}
      <line
        x1={tick.x1}
        y1={tick.y1}
        x2={tick.x2}
        y2={tick.y2}
        stroke={TICK_STROKE}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </g>
  );
}


// -----------------------------------------------------------------------------
// SECTION 7 — Detail modal
//
// Every number in this component lives here.
//
// WHY A MODAL, NOT A CARD BELOW: an inline card moved the page on every tap,
// left the background competing for attention, and on a phone often opened
// off-screen — you tapped a ring and, as far as you could tell, nothing
// happened. A modal lifts one object above a dimmed, blurred page: the
// background is visibly still there, but unmistakably inactive.
//
// Escape closes it, a scrim tap closes it, and the page behind is scroll-locked
// while it is open. All three are expected; usually only one gets built.
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

  return (
    <div
      className="modal-layer"
      role="dialog"
      aria-modal="true"
      aria-label={subject.subjectName}
    >
      <div className="modal-scrim" onClick={onClose} aria-hidden />

      <div className="modal-card" ref={cardRef} tabIndex={-1}>
        <div className="modal-head border-b border-line px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="display truncate text-xl">{subject.subjectName}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {subject.isExcluded ? (
                  <span className="chip chip-neutral">Excluded</span>
                ) : started ? (
                  <span className={`chip ${BAND_CHIP[subject.worstBand]}`}>
                    {BAND_WORD[subject.worstBand]}
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

        {/* Each category is judged against ITS OWN threshold and says so. "78%"
            beside "needs 80%" is understood instantly; "78%" alone is noise. */}
        <div className="modal-body px-5 py-4">
          <div className="space-y-4">
            {ringsFor(subject).map((c) => {
              const empty = !hasClasses(c);

              return (
                <div
                  key={c.category}
                  className="border-t border-line pt-4 first:border-0 first:pt-0"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium text-ink">
                      {/* Same colour as the ring it describes — this dot is the
                          entire legend, no separate key needed. */}
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: PALETTE[c.category].dot }}
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
                            className="ml-2 text-base font-semibold"
                            style={{ color: BAND_TEXT[c.band] }}
                          >
                            {c.percentDisplay}%
                          </span>
                        </>
                      )}
                    </span>
                  </div>

                  {/* The actionable sentence — "you can miss 3 more", never a
                      bare number. */}
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
