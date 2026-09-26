// =============================================================================
// app/attendance/components/AttendanceRing.tsx
// -----------------------------------------------------------------------------
// Concentric attendance rings. Presentational ONLY â€” no store, no calculator,
// no Tailwind. Give it numbers, it draws them.
//
// DESIGN RULES
//  1. The coloured arc IS the attended fraction. An empty category
//     (conducted === 0) draws NO arc â€” just the track.
//  2. Track is always visible underneath. The grey remainder is the story.
//  3. Round caps on the ARC ONLY. No glow, no drop shadow, no halo.
//  4. Outer ring = theory. Inner ring = practical/clinical. Fixed, always.
//
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  âš  WHY THE RINGS DID NOT LOOK CIRCULAR â€” 25 Sep 2026
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  The geometry was always mathematically perfect. Three details broke the
//  SILHOUETTE, which is what the eye actually judges:
//
//  1. THE NOTCH OVERHUNG THE TRACK.
//     It ran from radiusâˆ’STROKE/2+1 to radius+STROKE/2âˆ’1, but round caps add
//     ~half the line width beyond each endpoint. Net result: a stub sticking
//     out past the rim at the threshold angle. A circle with a bump on it is
//     not read as a circle. The notch is now INSET well within the stroke and
//     uses butt caps, so it is a mark ON the ring, never a spur off it.
//
//  2. THE EMPTY TRACK WAS DOTTED ('1 7' + round caps).
//     That gives a beaded, scalloped rim rather than a clean edge. An empty
//     ring is now a SOLID, very light track. Lightness says "nothing here";
//     it does not need texture to say it, and texture costs the outline.
//
//  3. THE ARC SEAMED AT 12 O'CLOCK.
//     A round start-cap sat on top of the track edge. Now the arc is inset by
//     a hair at both ends so the cap curve completes inside the stroke band.
//
//  Also: thicker stroke, tighter gap, larger radii. Thin hoops with a big hole
//  read as wireframe. Apple's Activity rings are ~22% of the radius â€” that
//  weight is most of why they look solid and expensive.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

'use client';

import { useId } from 'react';

// -----------------------------------------------------------------------------
// Geometry. One source of truth â€” change here, everything follows.
// -----------------------------------------------------------------------------

const BOX = 120;              // viewBox units; scales to any rendered size
const C = BOX / 2;            // centre
const STROKE = 13;            // ring thickness (was 11 â€” too thin to feel solid)
const GAP = 5;                // breathing room between the two rings
const R_OUTER = 51;           // outer edge lands at 57.5, inside the 60 box
const R_INNER = R_OUTER - STROKE - GAP;   // 33

const TRACK = '#E6E6EB';      // iOS systemGray5, neutral. GREY = NOT ATTENDED.
const TRACK_EMPTY = '#F0F0F4';// lighter still â€” "nothing scheduled"
const NOTCH = 'rgba(60,60,67,0.30)';

/** Band â†’ gradient stops. Two stops only; three starts looking like a toy. */
const BAND_COLORS: Record<string, [string, string]> = {
  safe:     ['#34C759', '#30B0C7'],
  warning:  ['#FFCC00', '#FF9500'],
  danger:   ['#FF9500', '#FF3B30'],
  critical: ['#FF3B30', '#D70015'],
};

/** Category tint â€” hue tells you WHAT the class is, not how you are doing. */
const CATEGORY_COLORS: Record<string, [string, string]> = {
  theory:    ['#AF52DE', '#5E5CE6'],
  practical: ['#0A84FF', '#30B0C7'],
  clinical:  ['#30B0C7', '#32ADE6'],
};

export type RingTone = 'band' | 'category';

export interface RingSpec {
  /** 0â€“1, exact. Pass attended/conducted. Never a rounded percentage. */
  ratio: number;
  /** True when conducted === 0. Draws track only. */
  isEmpty: boolean;
  band: string;
  category: string;
  /** Pass mark, 0â€“100. Draws the notch. Omit to hide it. */
  threshold?: number;
  isExcluded?: boolean;
}

export interface AttendanceRingProps {
  outer: RingSpec;
  inner: RingSpec | null;
  size?: number;
  tone?: RingTone;
  children?: React.ReactNode;
}

// -----------------------------------------------------------------------------

function arcLength(r: number): number {
  return 2 * Math.PI * r;
}

function colorsFor(spec: RingSpec, tone: RingTone): [string, string] {
  const table = tone === 'category' ? CATEGORY_COLORS : BAND_COLORS;
  const key = tone === 'category' ? spec.category : spec.band;
  return table[key] ?? BAND_COLORS.safe;
}

// Colours are resolved by the parent and arrive as a gradient id, so Ring
// never needs the tone. It used to take one and ignore it.
function Ring(props: {
  spec: RingSpec;
  radius: number;
  gradientId: string;
}) {
  const { spec, radius, gradientId } = props;


  const circumference = arcLength(radius);
  const ratio = Math.max(0, Math.min(1, spec.ratio));

  // â˜… Empty means NO arc. A ring with nothing in it must never read as full.
  const showArc = !spec.isEmpty && ratio > 0;

  // Round caps extend half the stroke past each endpoint. Trimming that much
  // off the dash keeps the visible arc exactly proportional AND stops the
  // start cap from mounting the track edge at 12 o'clock.
  const capBleed = STROKE / 2;
  const rawDash = circumference * ratio;
  const dash = showArc
    ? Math.min(
        Math.max(rawDash - capBleed, STROKE * 0.35),  // floor: 2% still visible
        circumference - capBleed,                      // ceiling: never laps
      )
    : 0;

  // Notch lives strictly INSIDE the stroke band. This is the fix for the
  // "bumpy circle" â€” nothing may cross the rim.
  const notchAngle =
    spec.threshold !== undefined && spec.threshold > 0 && spec.threshold < 100
      ? ((spec.threshold / 100) * 360 - 90) * (Math.PI / 180)
      : null;

  const notchInset = STROKE / 2 - 2.5;

  return (
    <g opacity={spec.isExcluded ? 0.35 : 1}>
      {/* TRACK â€” the unattended remainder. Solid. No dashes, no caps:
          a full circle needs neither, and both cost the clean outline. */}
      <circle
        cx={C}
        cy={C}
        r={radius}
        fill="none"
        stroke={spec.isEmpty ? TRACK_EMPTY : TRACK}
        strokeWidth={STROKE}
      />

      {/* THRESHOLD NOTCH â€” a mark ON the ring, never a spur off it. */}
      {notchAngle !== null && !spec.isEmpty && (
        <line
          x1={C + (radius - notchInset) * Math.cos(notchAngle)}
          y1={C + (radius - notchInset) * Math.sin(notchAngle)}
          x2={C + (radius + notchInset) * Math.cos(notchAngle)}
          y2={C + (radius + notchInset) * Math.sin(notchAngle)}
          stroke={NOTCH}
          strokeWidth={1.5}
          strokeLinecap="butt"
        />
      )}

      {/* PROGRESS ARC â€” starts at 12 o'clock, sweeps clockwise. */}
      {showArc && (
        <circle
          cx={C}
          cy={C}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${C} ${C})`}
          style={{
            transition: 'stroke-dasharray 620ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      )}
    </g>
  );
}

export default function AttendanceRing({
  outer,
  inner,
  size = 132,
  tone = 'band',
  children,
}: AttendanceRingProps) {
  // useId keeps gradient ids unique. Duplicate ids make every ring on the page
  // inherit the first one's colours â€” a classic SVG trap.
  const uid = useId().replace(/:/g, '');
  const outerGrad = `og-${uid}`;
  const innerGrad = `ig-${uid}`;

  const [o1, o2] = colorsFor(outer, tone);
  const [i1, i2] = inner ? colorsFor(inner, tone) : ['#000', '#000'];

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${BOX} ${BOX}`}
      role="img"
      /* geometricPrecision stops the renderer snapping curve points to the
         pixel grid, which is what makes a small circle look slightly polygonal.
         flex-shrink:0 stops a narrow grid column squashing it into an oval. */
      style={{
        display: 'block',
        flexShrink: 0,
        shapeRendering: 'geometricPrecision',
      }}
    >
      <defs>
        {/* Diagonal gradient. A flat fill looks cheap; a 45Â° sweep reads as
            depth without any shadow or glow. */}
        <linearGradient id={outerGrad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={o1} />
          <stop offset="100%" stopColor={o2} />
        </linearGradient>
        <linearGradient id={innerGrad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={i1} />
          <stop offset="100%" stopColor={i2} />
        </linearGradient>
      </defs>

      <Ring spec={outer} radius={R_OUTER} gradientId={outerGrad} />

      {inner && (
        <Ring spec={inner} radius={R_INNER} gradientId={innerGrad} />
      )}

      {children && (
        <foreignObject
          x={C - R_INNER + STROKE}
          y={C - R_INNER + STROKE}
          width={(R_INNER - STROKE) * 2}
          height={(R_INNER - STROKE) * 2}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
            }}
          >
            {children}
          </div>
        </foreignObject>
      )}
    </svg>
  );
}
