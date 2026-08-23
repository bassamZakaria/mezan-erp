import type { ReactNode } from "react";
import { Money } from "@mezan/ui";

/**
 * The KPI strip (spec §5/§6) — a tighter 8px data surface, a mono
 * `tabular-nums` figure, and a directional micro-beam so the trend reads
 * before the number does (the ambient third dose of the mizan motif).
 */

export type BeamDirection = "up" | "down" | "level";
export type DeltaTone = "good" | "bad" | "neutral";

const toneClass: Record<DeltaTone, string> = {
  good: "text-success-ink",
  bad: "text-danger-ink",
  neutral: "text-ink-faint",
};

export function MicroBeam({ direction, rtl }: { direction: BeamDirection; rtl: boolean }) {
  const magnitude = direction === "level" ? 0 : 13;
  const sign = direction === "up" ? (rtl ? 1 : -1) : rtl ? -1 : 1;
  return (
    <svg viewBox="0 0 20 13" width="20" height="13" aria-hidden className="flex-none overflow-visible">
      <g transform={`rotate(${magnitude * sign} 10 6)`}>
        <line x1="2.5" y1="6" x2="17.5" y2="6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </g>
      <line x1="10" y1="3.4" x2="10" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M7.6 12h4.8L10 7.6Z" fill="currentColor" />
    </svg>
  );
}

export interface KpiTileProps {
  readonly label: string;
  readonly value: number;
  readonly valueTone?: "default" | "good" | "bad";
  readonly direction: BeamDirection;
  readonly deltaTone: DeltaTone;
  readonly delta: ReactNode;
  readonly rtl: boolean;
}

export function KpiTile({ label, value, valueTone = "default", direction, deltaTone, delta, rtl }: KpiTileProps) {
  return (
    <div className="rounded-md border border-border bg-surface p-[14px_16px] shadow-1">
      <div className="text-xs font-semibold text-ink-muted">{label}</div>
      <div
        className={
          valueTone === "good"
            ? "mt-[6px] font-display text-2xl font-bold tracking-tight text-success-ink"
            : valueTone === "bad"
              ? "mt-[6px] font-display text-2xl font-bold tracking-tight text-danger-ink"
              : "mt-[6px] font-display text-2xl font-bold tracking-tight text-ink"
        }
      >
        <Money value={value} />
      </div>
      <div className={`mt-[7px] flex items-center gap-[6px] text-2xs ${toneClass[deltaTone]}`}>
        <MicroBeam direction={direction} rtl={rtl} />
        <span className="min-w-0 truncate">{delta}</span>
      </div>
    </div>
  );
}
