import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * The two ambient doses of the *mizan* motif that live on data surfaces
 * (spec §4): `MicroBeam` for a KPI delta line, `VarianceBeam` for a signed
 * variance inside a table cell — a 12px beam nudged up or down so direction
 * reads before the number does.
 *
 * Both mirror under RTL with `rtl:-scale-x-100`: a rise must lift the
 * inline-END of the beam in either direction, and the fulcrum is symmetric so
 * the flip is invisible apart from the tilt.
 */

export type BeamDirection = "up" | "down" | "level";

/** Signed value → beam direction. `epsilon` treats near-zero as level. */
export function beamDirectionOf(value: number, epsilon = 0): BeamDirection {
  if (value > epsilon) return "up";
  if (value < -epsilon) return "down";
  return "level";
}

export interface MicroBeamProps {
  direction: BeamDirection;
  className?: string;
}

/** 20×13 beam-on-a-fulcrum used on KPI delta lines. Inherits `currentColor`. */
export function MicroBeam({ direction, className }: MicroBeamProps) {
  const tilt = direction === "level" ? 0 : direction === "up" ? -13 : 13;
  return (
    <svg
      viewBox="0 0 20 13"
      width="20"
      height="13"
      aria-hidden
      className={cn("flex-none overflow-visible rtl:-scale-x-100", className)}
    >
      <g transform={`rotate(${tilt} 10 6)`}>
        <line x1="2.5" y1="6" x2="17.5" y2="6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </g>
      <line x1="10" y1="3.4" x2="10" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M7.6 12h4.8L10 7.6Z" fill="currentColor" />
    </svg>
  );
}

export interface VarianceBeamProps {
  /** The signed variance. Zero (within `epsilon`) renders a level beam. */
  value: number;
  /** When a rise is the bad outcome (expenses, shortages) — flips the tone, never the tilt. */
  invertTone?: boolean;
  epsilon?: number;
  /** The figure rendered beside the beam; inherits the variance tone. */
  children?: ReactNode;
  className?: string;
}

const varianceToneClass: Record<BeamDirection, string> = {
  up: "text-success-ink",
  down: "text-danger-ink",
  level: "text-ink-faint",
};

/**
 * Spec §4 dose 3 — a period-over-period (or any signed) variance drawn as a
 * tiny two-state tilt indicator: a 12px beam nudged up or down, tinted by
 * outcome, with the figure beside it.
 */
export function VarianceBeam({ value, invertTone = false, epsilon = 0, children, className }: VarianceBeamProps) {
  const direction = beamDirectionOf(value, epsilon);
  const tone = invertTone && direction !== "level" ? (direction === "up" ? "down" : "up") : direction;
  const tilt = direction === "level" ? 0 : direction === "up" ? -12 : 12;
  return (
    <span className={cn("inline-flex items-center gap-[6px] whitespace-nowrap", varianceToneClass[tone], className)}>
      <svg
        viewBox="0 0 14 11"
        width="14"
        height="11"
        aria-hidden
        className="flex-none overflow-visible rtl:-scale-x-100"
      >
        <g transform={`rotate(${tilt} 7 5)`}>
          <line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </g>
        <path d="M4.8 11h4.4L7 6.4Z" fill="currentColor" opacity="0.7" />
      </svg>
      {children}
    </span>
  );
}
