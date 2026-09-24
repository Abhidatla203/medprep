'use client';

// =============================================================================
// app/attendance/components/RingGrid.tsx
// -----------------------------------------------------------------------------
// The resting view. Two concentric rings per subject, no numbers until asked.
//
//   OUTER ARC = theory                     --color-theory
//   INNER ARC = practical or clinical      --color-practical / --color-clinical
//   TRACK     = the unfilled remainder     --color-ring-track
//   TICK      = the threshold, ON the track
//   LABEL     = safety band, in words and colour
//
//   arc past tick → safe.  arc short of it → the gap is the size of the problem.
//
// ★ RING COLOUR IS IDENTITY, ALWAYS. It never changes with safety. If the arc
//   went red below threshold you would lose the ability to tell theory from
//   practical at exactly the moment it matters — they have DIFFERENT thresholds
//   and one can fail while the other is fine.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ★ TWO FIXES IN THIS REVISION
// ═════════════════════════════════════════════════════════════════════════════
//
//  1. THE TRACK IS NOW VISIBLE.
//     It was #e9e5de on a #fbfaf7 canvas — a 4% luminance difference, invisible
//     on a phone in daylight. A subject at 20% looked identical to a broken
//     component. The track is not decoration: it is the DENOMINATOR made
//     visible, and without it the arc means nothing. It is also stroked
//     slightly WIDER than the arc, so the filled portion sits in a groove.
//
//  2. THE DETAIL VIEW IS A REAL MODAL.
//     It used to be a card appended below the grid. That pushed the page
//     around, left the background fully legible and competing for attention,
//     and gave no signal you were in a temporary state. Now: centred, dimmed,
//     backdrop BLURRED, spring entry, Escape to close, background scroll locked.
// ═════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
// ⚠ types.ts and globals.css disagree on the middle two names. Both are
//   reasonable, so the translation lives HERE and nowhere else.
//     types.ts    : safe | warning | danger | critical
//     globals.css : safe | watch   | risk   | critical
//
//   Never write `ring-label-${band}` inline — `ring-label-warning` does not
//   exist and renders with no colour and no error.
// -----------------------------------------------------------------------------

const BAND_CLASS: Record<SafetyBand, string> = {
  safe: 'ring-label-safe',
  warning: 'ring-label-watch',
  danger: 'ring-label-risk',
  critical: 'ring-label-critical',
};

/** Chip variant for the modal header. Same mapping problem, same solution. */
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

const CATEGORY_VAR: Record<ClassCategory, string> = {
  theory: 'var(--color-theory)',
  practical: 'var(--color-practical)',
  clinical: 'var(--color-clinical)',
};


// -----------------------------------------------------------------------------
// SECTION 2 — Arrangement
//
// The rings are a FIXED size. What changes is how many sit in a row. A
// first-year with 8 subjects and a final-year with 4 both get rings they can
// actually read — that is the whole point of not scaling to fit.
// -----------------------------------------------------------------------------

function arrangementFor(count: number): RingGridArrangement {
  if (count <= 2) return 'single';
  if (count === 3) return 'row-3';
  if (count === 4) return 'grid-2x2';
  if (count <= 6) return 'grid-3x2';
  return 'scroll-3';
}

const GRID_CLASS: Record<RingGridArrangement, string> = {
  single: 'grid-cols-2',
  'row-3': 'grid-cols-3',
  'grid-2x2': 'grid-cols-2',
  'grid-3x2': 'grid-cols-3',
  'scroll-3': 'grid-cols-3',
};

function diameterFor(arrangement: RingGridArrangement): number {
  return arrangement === 'single' ? 148 : Math.max(RING_MIN_DIAMETER_PX, 108);
}


// -----------------------------------------------------------------------------
// SECTION 3 — Arc geometry
//
// ★ DRAWN FROM `ratio`, NEVER FROM `percentDisplay`.
//
//   percentDisplay is rounded for reading. Using it here would reintroduce the
//   v3 rounding bug in pixel form: a student on 74.96% would see an arc landing
//   exactly on the tick and conclude they were safe. The geometry has to be as
//   honest as the arithmetic.
// -----------------------------------------------------------------------------

function arcOffset(circumference: number, ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  return circumference * (1 - clamped);
}

/**
 * The threshold tick: a short radial line sitting ON the track.
 *
 * Arcs start at 12 o'clock and run clockwise, so the angle is measured from
 * -90°. Without that offset every tick lands a quarter-turn out and the entire
 * grid quietly lies.
 */
function tickFor(
  cx: number,
  cy: number,
  radius: number,
  threshold: number,
  width: number,
) {
  const angle = ((threshold / 100) * 360 - 90) * (Math.PI / 180);
  const inner = radius - width / 2 - 1.5;
  const outer = radius + width / 2 + 1.5;
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
// ⚠ TRAP 9 — only what is REAL. The curriculum says what is POSSIBLE; this
//   reads what the student actually has data for. A subject with theory only
//   draws one ring, not one ring plus an empty circle implying a missing
//   practical they were never meant to have.
//
// Theory is always outer. Practical and clinical are mutually exclusive in this
// curriculum, so whichever exists takes the inner position.
// -----------------------------------------------------------------------------

interface RingPair {
  outer: CategoryResult | null;
  inner: CategoryResult | null;
}

function ringPairFor(subject: SubjectResult): RingPair {
  const cats = subject.categories;
  return {
    outer: cats.find((c) => c.category === 'theory') ?? null,
    inner:
      cats.find((c) => c.category === 'practical') ??
      cats.find((c) => c.category === 'clinical') ??
      null,
  };
}

/** Has this subject any conducted classes at all? Drives the "not started" look. */
function hasAnyData(subject: SubjectResult): boolean {
  return subject.categories.some((c) => !c.isEmpty);
}


// -----------------------------------------------------------------------------
// SECTION 5 — Component
// -----------------------------------------------------------------------------

export interface RingGridProps {
  subjects: SubjectResult[];
  /** Store revision. Lets the parent force a repaint after a mark. */
  revision?: number;
}

export default function RingGrid(props: RingGridProps) {
  const { subjects, revision } = props;

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Worst first, then subjects with no data, then alphabetical inside a band.
  const ordered = useMemo(() => {
    void revision;
    return [...subjects].sort((a, b) => {
      const aEmpty = hasAnyData(a) ? 0 : 1;
      const bEmpty = hasAnyData(b) ? 0 : 1;
      if (aEmpty !== bEmpty) return aEmpty - bEmpty;

      const byBand = BAND_ORDER[a.worstBand] - BAND_ORDER[b.worstBand];
      if (byBand !== 0) return byBand;

      return a.subjectName.localeCompare(b.subjectName);
    });
  }, [subjects, revision]);

  const arrangement = arrangementFor(ordered.length);
  const diameter = diameterFor(arrangement);

  const expanded = ordered.find((s) => s.subjectId === expandedId) ?? null;
  const close = useCallback(() => setExpandedId(null), []);

  if (ordered.length === 0) {
    return (
      <section className="card p-6 text-center">
        <p className="text-sm text-[--color-ink-muted]">
          No subjects tracked yet. Add your timetable in setup.
        </p>
      </section>
    );
  }

  return (
    <>
      <div
        className={`grid justify-items-center gap-x-3 gap-y-6 ${GRID_CLASS[arrangement]}`}
      >
        {ordered.map((subject) => (
          <SubjectRings
            key={subject.subjectId}
            subject={subject}
            diameter={diameter}
            isExpanded={subject.subjectId === expandedId}
            onOpen={() => setExpandedId(subject.subjectId)}
          />
        ))}
      </div>

      {/* Numbers live in the modal and nowhere else. The resting grid stays
          shape and colour — the moment a figure appears in the grid itself,
          someone reads it as an overall standing. */}
      {expanded && <SubjectModal subject={expanded} onClose={close} />}
    </>
  );
}


// -----------------------------------------------------------------------------
// SECTION 6 — One subject's ring pair
// -----------------------------------------------------------------------------

function SubjectRings(props: {
  subject: SubjectResult;
  diameter: number;
  isExpanded: boolean;
  onOpen: () => void;
}) {
  const { subject, diameter, isExpanded, onOpen } = props;

  const { outer, inner } = ringPairFor(subject);
  const started = hasAnyData(subject);

  const cx = diameter / 2;
  const cy = diameter / 2;

  // Stroke scales gently with size; the 9px radial gap does not. Keeping the
  // rings CLOSE is what makes the two arcs comparable by eye despite the outer
  // one being physically longer.
  const width = diameter >= 140 ? 11 : 9;
  const outerRadius = cx - width / 2 - 3;
  const innerRadius = outerRadius - width - 9;

  const isMuted = subject.isExcluded;
  const labelClass =
    isMuted || !started ? 'ring-label-muted' : BAND_CLASS[subject.worstBand];

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={isExpanded}
      aria-label={`${subject.subjectName} — ${
        started ? BAND_WORD[subject.worstBand] : 'not started'
      }`}
      className="flex w-full flex-col items-center gap-2 rounded-[--radius-card] p-1 transition-transform active:scale-[0.97]"
    >
      <div className="relative" style={{ width: diameter, height: diameter }}>
        <svg
          width={diameter}
          height={diameter}
          viewBox={`0 0 ${diameter} ${diameter}`}
          /* -90° puts 12 o'clock at the start of both arcs. */
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

          {/* A subject with nothing scheduled at all still gets a ring, so the
              grid never has a hole in it. */}
          {!outer && !inner && (
            <circle
              className="ring-empty"
              cx={cx}
              cy={cy}
              r={outerRadius}
              fill="none"
              strokeWidth={width}
            />
          )}
        </svg>

        {/* Centre stays EMPTY once there is data. A number here would be a
            pooled figure by implication — the one thing this rebuild removes. */}
        {!started && (
          <span className="absolute inset-0 flex items-center justify-center text-[0.625rem] font-medium text-[--color-ink-faint]">
            Not started
          </span>
        )}
      </div>

      {/* ---- label: the ONLY place safety colour appears ---- */}
      <span className="w-full px-0.5 text-center leading-tight">
        <span className={`block truncate text-xs font-semibold ${labelClass}`}>
          {subject.subjectName}
        </span>
        <span className="mt-0.5 block text-[0.625rem] text-[--color-ink-faint]">
          {isMuted
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
 * One arc: track, filled portion, threshold tick.
 *
 * ★ THE TRACK IS DRAWN FIRST AND SLIGHTLY WIDER than the arc. That extra half
 *   pixel on each side makes the filled portion sit IN a groove rather than
 *   floating on the canvas, which is what sells it as a gauge.
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

  const circumference = 2 * Math.PI * radius;
  const tick = tickFor(cx, cy, radius, result.threshold, width);

  return (
    <g opacity={muted ? 0.4 : 1}>
      {/* ★ THE DENOMINATOR, MADE VISIBLE. Always drawn, always legible. */}
      <circle
        className="ring-track"
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        strokeWidth={width + 1}
      />

      {result.isEmpty ? (
        /* Dashed overlay says "nothing here yet". A bare track with no arc
           just looks like the component failed to load. */
        <circle
          className="ring-empty"
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          strokeWidth={width}
        />
      ) : (
        /* ★ Geometry from the EXACT ratio, never percentDisplay. */
        <circle
          className={`ring-arc ${ARC_CLASS[result.category]}`}
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          strokeWidth={width}
          strokeDasharray={circumference}
          strokeDashoffset={arcOffset(circumference, result.ratio)}
        />
      )}

      {/* The tick is the judgement. Arc past it = safe. Uncoloured on purpose:
          a reference line, not another status. */}
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
// SECTION 7 — Detail modal
//
// Every number in this component lives here, and nowhere else.
//
// ═════════════════════════════════════════════════════════════════════════════
//  WHY A MODAL AND NOT A CARD BELOW THE GRID
// ═════════════════════════════════════════════════════════════════════════════
// The previous version appended a card underneath. Three things were wrong with
// that, and none of them are cosmetic:
//
//   1. IT MOVED THE PAGE. Content below shifted down on every tap, so the grid
//      you were reading jumped out from under your thumb.
//   2. THE BACKGROUND STAYED FULLY LEGIBLE and competed for attention. Nothing
//      signalled that you were in a temporary, dismissible state.
//   3. ON A PHONE IT OFTEN OPENED OFF-SCREEN. You tapped a ring and, as far as
//      you could tell, nothing happened.
//
// A modal fixes all three by lifting one object above a dimmed, BLURRED page:
// the background is visibly still there — so you never feel lost — but
// unmistakably inactive.
//
// FOUR DETAILS THAT MAKE IT FEEL NATIVE RATHER THAN WEB:
//   • BLUR, not just dim. This is what iOS does and what plain CSS overlays
//     almost never do. It reads as depth rather than as a grey rectangle.
//   • SPRING SCALE from 0.94, on the UIKit presentation curve.
//   • ESCAPE CLOSES IT, and so does a tap on the scrim. Both are expected; only
//     one is ever implemented.
//   • BACKGROUND SCROLL IS LOCKED via a body attribute. Without this the page
//     behind scrolls under the scrim on iOS, which instantly breaks the
//     illusion of a layer.
// ═════════════════════════════════════════════════════════════════════════════

function SubjectModal(props: { subject: SubjectResult; onClose: () => void }) {
  const { subject, onClose } = props;

  const cardRef = useRef<HTMLDivElement>(null);

  // Escape to close + lock the page behind. The cleanup runs on unmount, so the
  // attribute can never be left behind if the component disappears abruptly.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    document.body.setAttribute('data-modal-open', 'true');

    // Move focus into the dialog so keyboard and screen-reader users are not
    // left behind on the grid.
    cardRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.removeAttribute('data-modal-open');
    };
  }, [onClose]);

  const started = hasAnyData(subject);

  return (
    <div
      className="modal-layer"
      role="dialog"
      aria-modal="true"
      aria-label={subject.subjectName}
    >
      {/* Tap anywhere outside to dismiss. aria-hidden because the close button
          already gives assistive tech an explicit way out. */}
      <div className="modal-scrim" onClick={onClose} aria-hidden />

      <div className="modal-card" ref={cardRef} tabIndex={-1}>
        {/* ---- head ---- */}
        <div className="modal-head border-b border-[--color-line] px-5 pb-4 pt-5">
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

                {subject.isExamSubject && (
                  <span className="chip chip-brand">Exam subject</span>
                )}
              </div>
            </div>

            <button onClick={onClose} aria-label="Close" className="modal-close">
              ✕
            </button>
          </div>

          {subject.isExcluded && (
            <p className="mt-3 text-xs leading-relaxed text-[--color-ink-muted]">
              This subject is excluded from your calculations. It is still being
              tracked — nothing has been deleted.
            </p>
          )}
        </div>

        {/* ---- body ----
            Each category is judged against ITS OWN threshold and says so. A
            student seeing "78%" beside "needs 80%" understands their position
            instantly; "78%" alone is meaningless. */}
        <div className="modal-body px-5 py-4">
          <div className="space-y-4">
            {subject.categories.map((c) => (
              <div
                key={c.category}
                className="border-t border-[--color-line] pt-4 first:border-0 first:pt-0"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-[--color-ink]">
                    {/* Same colour as the ring it refers to. This dot is the
                        entire legend — no separate key needed. */}
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: CATEGORY_VAR[c.category] }}
                      aria-hidden
                    />
                    {CATEGORY_LABEL[c.category]}
                  </span>

                  <span className="tnum text-sm">
                    {c.isEmpty ? (
                      <span className="text-[--color-ink-faint]">
                        No classes yet
                      </span>
                    ) : (
                      <>
                        <span className="text-[--color-ink-muted]">
                          {c.attended}/{c.conducted}
                        </span>
                        <span
                          className={`ml-2 text-base font-semibold ${BAND_CLASS[c.band]}`}
                        >
                          {c.percentDisplay}%
                        </span>
                      </>
                    )}
                  </span>
                </div>

                {/* The actionable sentence. "You can miss 3 more" or "attend 4
                    in a row" — never a bare number. */}
                <p className="mt-1.5 text-xs leading-relaxed text-[--color-ink-soft]">
                  {statusLine(c)}
                </p>

                <p className="mt-1 text-[0.6875rem] text-[--color-ink-faint]">
                  Needs {c.threshold}%
                  {c.isCustomThreshold ? ' — your setting' : ' — default'}
                </p>
              </div>
            ))}
          </div>

          {/* The one line that explains the whole visual language, placed where
              someone confused by the rings will actually be looking. */}
          <p className="mt-5 border-t border-[--color-line] pt-4 text-[0.6875rem] leading-relaxed text-[--color-ink-faint]">
            Each type is counted separately and judged against its own
            requirement. The notch on each ring marks the percentage you need.
          </p>
        </div>
      </div>
    </div>
  );
}
