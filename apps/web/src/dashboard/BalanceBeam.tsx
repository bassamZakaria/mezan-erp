import { useEffect, useId, useState } from "react";
import { useReducedMotion } from "./motion";

/**
 * ميزان — the dashboard hero (spec §4/§6). A real beam on a fulcrum: one pan
 * carries revenue, the other expenses, and the beam settles at a tilt
 * proportional to the period's net result. Profit tips the revenue pan down.
 *
 * Everything is drawn in inline SVG against design tokens; the pans hang level
 * (counter-rotated inside the rotating beam) the way a physical balance does.
 */

const PIVOT_X = 280;
const PIVOT_Y = 100;
const HALF_BEAM = 172;
const BOWL_RADIUS = 34;
const CORD_DROP = 34;
const MAX_TILT_DEG = 14;
const TILT_EXPONENT = 0.4;

const SWING = "transform 1150ms cubic-bezier(.22,1.28,.36,1)";

/**
 * Signed imbalance → degrees. The ratio `net / (revenue + expenses)` is
 * inherently bounded to [-1, 1], so even an all-revenue / all-expense period
 * cannot exceed MAX_TILT_DEG and the object always still reads as a beam. The
 * fractional exponent lifts ordinary single-digit margins into a tilt the eye
 * can actually see without ever inverting the ordering.
 */
export function beamTiltDegrees(revenue: number, expenses: number, net: number): number {
  const load = Math.abs(revenue) + Math.abs(expenses);
  if (load === 0 || net === 0) return 0;
  const ratio = Math.max(-1, Math.min(1, net / load));
  return MAX_TILT_DEG * Math.sign(ratio) * Math.abs(ratio) ** TILT_EXPONENT;
}

/** How full the pan looks — its share of the heavier side. A non-zero load always keeps a visible layer. */
function fillFraction(value: number, heaviest: number): number {
  if (heaviest <= 0 || value <= 0) return 0;
  return Math.max(0.12, value / heaviest);
}

function Pan({
  x,
  color,
  value,
  heaviest,
  counterRotation,
  transition,
  clipId,
}: {
  x: number;
  color: string;
  value: number;
  heaviest: number;
  counterRotation: number;
  transition: string | undefined;
  clipId: string;
}) {
  const rimY = PIVOT_Y + CORD_DROP;
  const bowl = `M${x - BOWL_RADIUS} ${rimY} A${BOWL_RADIUS} ${BOWL_RADIUS} 0 0 0 ${x + BOWL_RADIUS} ${rimY} Z`;
  const fraction = fillFraction(value, heaviest);
  const surfaceY = rimY + BOWL_RADIUS * (1 - fraction);
  return (
    <g
      style={{
        transform: `rotate(${counterRotation.toFixed(3)}deg)`,
        transformOrigin: `${x}px ${PIVOT_Y}px`,
        transformBox: "view-box",
        transition,
      }}
    >
      <clipPath id={clipId}>
        <path d={bowl} />
      </clipPath>
      <line x1={x} y1={PIVOT_Y} x2={x - BOWL_RADIUS * 0.82} y2={rimY} stroke={color} strokeOpacity={0.55} strokeWidth={1.4} />
      <line x1={x} y1={PIVOT_Y} x2={x + BOWL_RADIUS * 0.82} y2={rimY} stroke={color} strokeOpacity={0.55} strokeWidth={1.4} />
      <path d={bowl} fill="var(--surface-2)" />
      {fraction > 0 ? (
        <g clipPath={`url(#${clipId})`}>
          <rect x={x - BOWL_RADIUS} y={surfaceY} width={BOWL_RADIUS * 2} height={BOWL_RADIUS} fill={color} fillOpacity={0.85} />
        </g>
      ) : null}
      <path d={bowl} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
      <line x1={x - BOWL_RADIUS} y1={rimY} x2={x + BOWL_RADIUS} y2={rimY} stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </g>
  );
}

export interface BalanceBeamProps {
  readonly revenue: number;
  readonly expenses: number;
  /** The API's own net figure — displayed and used for the tilt, never recomputed. */
  readonly net: number;
  /** `true` when the revenue pan belongs on the inline-start (right) side, i.e. Arabic RTL. */
  readonly revenueAtEnd: boolean;
  readonly label: string;
}

export function BalanceBeam({ revenue, expenses, net, revenueAtEnd, label }: BalanceBeamProps) {
  const reduced = useReducedMotion();
  const clipPrefix = `mz-beam-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [settled, setSettled] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setSettled(true);
      return;
    }
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  const tilt = beamTiltDegrees(revenue, expenses, net);
  const revenueX = revenueAtEnd ? PIVOT_X + HALF_BEAM : PIVOT_X - HALF_BEAM;
  const expensesX = revenueAtEnd ? PIVOT_X - HALF_BEAM : PIVOT_X + HALF_BEAM;
  // Clockwise (positive) rotation lowers the far end, so the sign follows which
  // side the revenue pan actually sits on — the beam mirrors with the layout.
  const angle = settled ? (revenueAtEnd ? tilt : -tilt) : 0;
  const transition = reduced ? undefined : SWING;
  const heaviest = Math.max(Math.abs(revenue), Math.abs(expenses));

  return (
    <svg viewBox="0 50 560 192" width="100%" className="block h-[196px] w-full" role="img" aria-label={label}>
      <path d="M226 216 H334 L322 230 H238 Z" fill="var(--brand)" fillOpacity={0.85} />
      <line x1={210} y1={231} x2={350} y2={231} stroke="var(--border-strong)" strokeWidth={1.5} strokeLinecap="round" />
      <rect x={275} y={116} width={10} height={102} rx={3} fill="var(--brand)" fillOpacity={0.85} />
      <path d={`M${PIVOT_X} 92 L299 124 H261 Z`} fill="var(--accent)" />

      <g
        style={{
          transform: `rotate(${angle.toFixed(3)}deg)`,
          transformOrigin: `${PIVOT_X}px ${PIVOT_Y}px`,
          transformBox: "view-box",
          transition,
        }}
      >
        <line
          x1={PIVOT_X - HALF_BEAM}
          y1={PIVOT_Y}
          x2={PIVOT_X + HALF_BEAM}
          y2={PIVOT_Y}
          stroke="var(--brand-strong)"
          strokeWidth={6}
          strokeLinecap="round"
        />
        <Pan
          x={revenueX}
          color="var(--chart-1)"
          value={revenue}
          heaviest={heaviest}
          counterRotation={-angle}
          transition={transition}
          clipId={`${clipPrefix}-revenue`}
        />
        <Pan
          x={expensesX}
          color="var(--chart-2)"
          value={expenses}
          heaviest={heaviest}
          counterRotation={-angle}
          transition={transition}
          clipId={`${clipPrefix}-expenses`}
        />
        <circle cx={PIVOT_X} cy={PIVOT_Y} r={7.5} fill="var(--accent)" />
        <circle cx={PIVOT_X} cy={PIVOT_Y} r={3} fill="var(--accent-ink)" fillOpacity={0.55} />
      </g>
    </svg>
  );
}
