'use client';

// =============================================================================
// app/attendance/components/RingGrid.tsx
// -----------------------------------------------------------------------------
// The resting view. Two concentric rings per subject, and no numbers until
// asked for.
//
// THE QUESTION IT ANSWERS IS "AM I SAFE?" — nothing else.
// The week strip above answers "have I logged everything?". Keeping those two
// questions in two separate objects is the single decision that stops this
// screen becoming a wall of figures.
//
// ═════════════════════════════════════════════════════════════════════════════
//  WHAT ONE RING PAIR TELLS YOU, WITHOUT A SINGLE DIGIT
// ═════════════════════════════════════════════════════════════════════════════
//
//   OUTER ARC  = theory                        --color-theory     (#4f6ef7)
//   INNER ARC  = practical or clinical         --color-practical / --color-clinical
//   TRACK      = the unfilled remainder        --color-ring-track
//   TICK       = the threshold, ON the track   --color-ink-faint
//   LABEL      = safety band, in words+colour  --ring-label-*
//
//   arc past tick  → safe
//   arc short of it→ not safe, and the gap is the size of the problem
//
// ★ RING COLOUR IS IDENTITY, ALWAYS. It never changes with safety. If the arc
//   went red when you dropped below threshold, you would lose the ability to
//   tell theory from practical at exactly the moment that distinction matters
//   most — because they have DIFFERENT thresholds and one can fail while the
//   other is fine. Safety lives on the label beneath.
//
// ⚠ THE ILLUSION THIS COMPONENT HAS TO FIGHT
//   The outer ring is physically longer, so 75% on the outside draws a visibly
//   longer arc than 75% on the inside. Students read the inner one as worse.
//   Three mitigations, all present below:
//     1. the radii are kept CLOSE (gap of 9px, not 20)
//     2. both arcs start at 12 o'clock, so they are comparable by angle
//     3. the tick marks carry the actual comparison — "past the tick" is the
//        judgement, not "longer than the other one"
//
// ⚠ NEVER SHRINK RINGS TO FIT MORE SUBJECTS. Below about 96px two concentric
//   arcs stop being separable and the whole idea collapses. Change the
//   ARRANGEMENT, or scroll. See SECTION 2.
// =============================================================================

import { useMemo, useState } from 'react';

import type {
  CategoryResult,
  ClassCategory,
  RingGridArrangement,
  SafetyBand,
  SubjectResult,
} from '../types';
import { RING_MIN_DIAMETER_PX } from '../types';
import { statusLine } from '../calculate';


// -----------------------------------------------------------------------------
// SECTION 1 — Band name mapping
//
// ⚠ types.ts and globals.css disagree on the middle two band names, and both
//   vocabularies are reasonable, so the translation lives HERE and nowhere
//   else.
//
//     types.ts    : safe | warning | danger | critical
//     globals.css : safe | watch   | risk   | critical
//
//   Never write `ring-label-${band}` inline. It silently produces
//   `ring-label-warning`, which does not exist, and the label renders with no
//   colour and no error.
// -----------------------------------------------------------------------------

const BAND_CLASS: Record<SafetyBand, string> = {
  safe: 'ring-label-safe',
  warning: 'ring-label-watch',
  danger: 'ring-label-risk',
  critical: 'ring-label-critical',
};

/** Plain words. "Danger" is alarming; "At risk" is accurate and actionable. */
const BAND_WORD: Record<SafetyBand, string> = {
  safe: 'Safe',
  warning: 'Watch',
  danger: 'At risk',
  critical: 'Critical',
};

const ARC_CLASS: Record<ClassCategory, string> = {
  theory: 'ring-theory',
  practical: 'ring-practical',
  clinical: 'ring-clinical',
};

const CATEGORY_LABEL: Record<ClassCategory, string> = {
  theory: 'Theory',
  practical: 'Practical',
  clinical: 'Clinical',
};


// -----------------------------------------------------------------------------
// SECTION 2 — Arrangement
//
// The rings are a fixed size. What changes is how many sit in a row.
//
//   1–2  → single   large, centred, room for a full label
//   3    → row-3
//   4    → grid-2x2
//   5–6  → grid-3x2
//   7+   → scroll-3 three per row, page scrolls
//
// A first-year with 7 subjects and a final-year with 4 both get rings they can
// actually read. That is the whole point of not scaling to fit.
// -----------------------------------------------------------------------------

function arrangementFor(count: number): RingGridArrangement {
  if (count <= 2) return 'single';
  if (count === 3) return 'row-3';
  if (count === 4) return 'grid-2x2';
  if (count <= 6) return 'grid-3x2';
  return 'scroll-3';
}

const GRID_CLASS: Record<RingGridArrangement, string> = {
  single: 'grid-cols-2 justify-items-center',
  'row-3': 'grid-cols-3',
  'grid-2x2': 'grid-cols-2',
  'grid-3x2': 'grid-cols-3',
  'scroll-3': 'grid-cols-3',
};

/** Large rings when there is room; the floor is never crossed. */
function diameterFor(arrangement: RingGridArrangement): number {
  return arrangement === 'single' ? 148 : Math.max(RING_MIN_DIAMETER_PX, 108);
}


// -----------------------------------------------------------------------------
// SECTION 3 — Arc geometry
//
// ★ THE ARC IS DRAWN FROM `ratio`, NOT FROM `percentDisplay`.
//
//   percentDisplay is rounded to one decimal for reading. Using it here would
//   reintroduce the v3 rounding bug in pixel form: a student on 74.96% would
//   see an arc drawn exactly on the tick and conclude they were safe. The
//   geometry has to be as honest as the arithmetic.
// -----------------------------------------------------------------------------

interface ArcGeometry {
  radius: number;
  circumference: number;
  /** stroke-dashoffset for the filled portion. */
  offset: number;
}

function arcFor(radius: number, ratio: number): ArcGeometry {
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, ratio));
  return {
    radius,
    circumference,
    offset: circumference * (1 - clamped),
  };
}

/**
 * The threshold tick: a short radial line sitting ON the track.
 *
 * Arcs start at 12 o'clock and run clockwise, so the angle is measured from
 * -90°. Without that offset every tick lands a quarter-turn out and the whole
 * grid quietly lies.
 */
function tickFor(cx: number, cy: number, radius: number, threshold: number, width: number) {
  const angle = ((threshold / 100) * 360 - 90) * (Math.PI / 180);
  const inner = radius - width / 2 - 1;
  const outer = radius + width / 2 + 1;

  return {
    x1: cx + inner * Math.cos(angle),
    y1: cy + inner * Math.sin(angle),
    x2: cx + outer * Math.cos(angle),
    y2: cy + outer * Math.sin(angle),
  };
}


// -----------------------------------------------------------------------------
// SECTION 4 — Which two categories get rings?
//
// ⚠ TRAP 9 — only what is REAL. The curriculum says what is possible; this
//   reads what the student actually has data for. A subject with theory only
//   draws one ring, not one ring and an empty circle implying a missing
//   practical they were never meant to have.
//
// A subject can have at most two rings. Theory is always outer. Practical and
// clinical are mutually exclusive in this codebase's curriculum, so whichever
// exists takes the inner position.
// -----------------------------------------------------------------------------

interface RingPair {
  outer: CategoryResult | null;
  inner: CategoryResult | null;
}

function ringPairFor(subject: SubjectResult): RingPair {
  const usable = subject.categories.filter((c) => !c.isEmpty || c.isExcluded);
  const pool = usable.length > 0 ? usable : subject.categories;

  return {
    outer: pool.find((c) => c.category === 'theory') ?? null,
    inner:
      pool.find((c) => c.category === 'practical') ??
      pool.find((c) => c.category === 'clinical') ??
      null,
  };
}


// -----------------------------------------------------------------------------
// SECTION 5 — Component
// -----------------------------------------------------------------------------

export interface RingGridProps {
  subjects: SubjectResult[];
  /** Store revision. Present so the parent can force a repaint after a mark. */
  revision?: number;
}

export default function RingGrid(props: RingGridProps) {
  const { subjects, revision } = props;

  // Which subject is expanded. Null = resting state, which is the default and
  // should be what the student sees 95% of the time.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const arrangement = useMemo(() => arrangementFor(subjects.length), [subjects.length]);
  const diameter = diameterFor(arrangement);

  if (subjects.length === 0) {
    return (
      <section className="card p-6 text-center">
        <p className="text-sm text-[--color-ink-muted]">
          No subjects tracked yet. Add your timetable in setup.
        </p>
      </section>
    );
  }

  const expanded = subjects.find((s) => s.subjectId === expandedId) ?? null;

  return (
    <section className="mt-4">
      <div
        className={`grid gap-x-3 gap-y-5 ${GRID_CLASS[arrangement]}`}
        // void: the grid re-renders when the store changes, via the parent.
        data-revision={revision}
      >
        {subjects.map((subject) => (
          <SubjectRings
            key={subject.subjectId}
            subject={subject}
            diameter={diameter}
            isExpanded={subject.subjectId === expandedId}
            onToggle={() =>
              setExpandedId((id) =>
                id === subject.subjectId ? null : subject.subjectId,
              )
            }
          />
        ))}
      </div>

      {/* ---- detail panel ----
          Numbers live HERE and only here. The resting grid stays shape and
          colour; the moment a figure appears in the grid itself, someone reads
          it as their overall standing. */}
      {expanded && (
        <SubjectDetail
          subject={expanded}
          onClose={() => setExpandedId(null)}
        />
      )}
    </section>
  );
}


// -----------------------------------------------------------------------------
// SECTION 6 — One subject's ring pair
// -----------------------------------------------------------------------------

function SubjectRings(props: {
  subject: SubjectResult;
  diameter: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { subject, diameter, isExpanded, onToggle } = props;

  const { outer, inner } = ringPairFor(subject);

  const cx = diameter / 2;
  const cy = diameter / 2;

  // Stroke width scales gently with size; the 9px radial gap does not. Keeping
  // the rings close is what makes the two arcs comparable by eye.
  const width = diameter >= 140 ? 11 : 9;
  const outerRadius = cx - width / 2 - 2;
  const innerRadius = outerRadius - width - 9;

  const isMuted = subject.isExcluded;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      aria-label={`${subject.subjectName} — ${BAND_WORD[subject.worstBand]}`}
      className="flex flex-col items-center gap-1.5 rounded-[--radius-card] p-1 transition-transform active:scale-[0.98]"
    >
      <div
        className={`relative ${isExpanded ? 'ring-2 ring-[--color-brand] ring-offset-4 rounded-full' : ''}`}
        style={{ width: diameter, height: diameter }}
      >
        <svg
          width={diameter}
          height={diameter}
          viewBox={`0 0 ${diameter} ${diameter}`}
          // -90° puts 12 o'clock at the start of both arcs.
          style={{ transform: 'rotate(-90deg)' }}
          aria-hidden
        >
          {outer && (
            <Ring
              cx={cx}
              cy={cy}
              radius={outerRadius}
              width={width}
              result={outer}
              muted={isMuted}
            />
          )}
          {inner && (
            <Ring
              cx={cx}
              cy={cy}
              radius={innerRadius}
              width={width}
              result={inner}
              muted={isMuted}
            />
          )}
        </svg>

        {/* Centre stays EMPTY in the resting state. A number here would be a
            pooled figure by implication — the one thing this rebuild exists to
            remove. The only exception is a subject with no data at all. */}
        {!outer && !inner && (
          <span className="absolute inset-0 flex items-center justify-center text-sm text-[--color-ink-faint]">
            —
          </span>
        )}
      </div>

      {/* ---- label: the ONLY place safety colour appears ---- */}
      <span className="w-full px-1 text-center">
        <span
          className={`block truncate text-xs font-semibold ${
            isMuted ? 'ring-label-muted' : BAND_CLASS[subject.worstBand]
          }`}
        >
          {subject.subjectName}
        </span>
        <span className="block text-[0.625rem] text-[--color-ink-faint]">
          {isMuted ? 'Excluded' : BAND_WORD[subject.worstBand]}
        </span>
      </span>
    </button>
  );
}


/** One arc: track, filled portion, and the threshold tick on the track. */
function Ring(props: {
  cx: number;
  cy: number;
  radius: number;
  width: number;
  result: CategoryResult;
  muted: boolean;
}) {
  const { cx, cy, radius, width, result, muted } = props;

  // ★ Geometry from the EXACT ratio. Never from percentDisplay.
  const arc = arcFor(radius, result.ratio);
  const tick = tickFor(cx, cy, radius, result.threshold, width);

  return (
    <g opacity={muted ? 0.35 : 1}>
      <circle
        className="ring-track"
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        strokeWidth={width}
      />

      {!result.isEmpty && (
        <circle
          className={`ring-arc ${ARC_CLASS[result.category]}`}
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          strokeWidth={width}
          strokeDasharray={arc.circumference}
          strokeDashoffset={arc.offset}
        />
      )}

      {/* The tick is the judgement. Arc past it = safe. It is deliberately
          uncoloured — a reference line, not another status. */}
      <line
        className="ring-tick"
        x1={tick.x1}
        y1={tick.y1}
        x2={tick.x2}
        y2={tick.y2}
      />
    </g>
  );
}


// -----------------------------------------------------------------------------
// SECTION 7 — Detail panel
//
// Revealed on tap. This is where every number lives.
//
// Each category is judged against ITS OWN threshold and says so, because a
// student seeing "78%" next to "needs 80%" understands their position
// instantly, while "78%" alone is meaningless.
// -----------------------------------------------------------------------------

function SubjectDetail(props: { subject: SubjectResult; onClose: () => void }) {
  const { subject, onClose } = props;

  return (
    <div className="card animate-rise mt-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="display truncate text-lg">{subject.subjectName}</h3>
          <span
            className={`text-xs font-semibold ${
              subject.isExcluded ? 'ring-label-muted' : BAND_CLASS[subject.worstBand]
            }`}
          >
            {subject.isExcluded
              ? 'Excluded from your calculations'
              : BAND_WORD[subject.worstBand]}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="btn btn-quiet min-h-9 shrink-0 px-2 text-sm"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {subject.categories.map((c) => (
          <div
            key={c.category}
            className="border-t border-[--color-line] pt-3 first:border-0 first:pt-0"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm text-[--color-ink-soft]">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor:
                      c.category === 'theory'
                        ? 'var(--color-theory)'
                        : c.category === 'clinical'
                          ? 'var(--color-clinical)'
                          : 'var(--color-practical)',
                  }}
                  aria-hidden
                />
                {CATEGORY_LABEL[c.category]}
              </span>

              <span className="tnum text-sm">
                {c.isEmpty ? (
                  <span className="text-[--color-ink-faint]">No classes yet</span>
                ) : (
                  <>
                    <span className="text-[--color-ink-muted]">
                      {c.attended}/{c.conducted}
                    </span>
                    <span className={`ml-2 font-semibold ${BAND_CLASS[c.band]}`}>
                      {c.percentDisplay}%
                    </span>
                  </>
                )}
              </span>
            </div>

            <p className="mt-1 text-xs text-[--color-ink-muted]">{statusLine(c)}</p>

            <p className="mt-0.5 text-[0.625rem] text-[--color-ink-faint]">
              Needs {c.threshold}%
              {c.isCustomThreshold ? ' — your setting' : ' — default'}
              {c.unmarkedCount > 0 &&
                ` · ${c.unmarkedCount} unmarked`}
            </p>

            {/* Extras breakdown: semi-hidden by design. Shown only when extras
                exist, and never as the default view — the clubbed figure is the
                one that matters for debarment. */}
            {c.extrasOnly && !c.extrasOnly.isEmpty && (
              <p className="mt-1 text-[0.625rem] text-[--color-ink-faint]">
                Extra classes alone: {c.extrasOnly.attended}/{c.extrasOnly.conducted}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
