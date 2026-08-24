import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useFormat } from "../hooks/useFormat";
import { MicroBeam } from "./beams";

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

export type ButtonVariant = "default" | "primary" | "ghost" | "danger-outline";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const buttonVariantClass: Record<ButtonVariant, string> = {
  default: "border-border-strong bg-surface text-ink hover:bg-surface-2",
  primary: "border-brand bg-brand text-brand-ink shadow-1 hover:bg-brand-strong hover:border-brand-strong",
  ghost: "border-transparent bg-transparent text-ink hover:bg-surface-2",
  "danger-outline": "border-danger bg-transparent text-danger-ink hover:bg-danger-soft",
};

const buttonSizeClass: Record<ButtonSize, string> = {
  sm: "px-[11px] py-[7px] text-xs",
  md: "px-[15px] py-[9px] text-[13px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center gap-[7px] rounded-md border font-semibold transition-colors disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-3 disabled:text-ink-faint disabled:shadow-none",
        buttonVariantClass[variant],
        buttonSizeClass[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* IconButton                                                          */
/* ------------------------------------------------------------------ */

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "relative flex h-[37px] w-[37px] flex-none items-center justify-center rounded-md border border-transparent text-ink-muted transition-colors hover:border-border hover:bg-surface-2 hover:text-ink",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Card                                                                 */
/* ------------------------------------------------------------------ */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-surface shadow-1", className)}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Status pill                                                         */
/* ------------------------------------------------------------------ */

export type PillTone = "neutral" | "info" | "success" | "warning" | "danger";

const pillToneClass: Record<PillTone, string> = {
  neutral: "bg-surface-3 text-ink-muted",
  info: "bg-info-soft text-info-ink",
  success: "bg-success-soft text-success-ink",
  warning: "bg-warning-soft text-warning-ink",
  danger: "bg-danger-soft text-danger-ink",
};

export interface StatusPillProps {
  label: string;
  tone?: PillTone;
  className?: string;
}

/** Small dot + label pill used for document/journal status everywhere (matches `.pill` in the mockup). */
export function StatusPill({ label, tone = "neutral", className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[6px] whitespace-nowrap rounded-pill px-[11px] py-[4px] text-[11.5px] font-semibold",
        pillToneClass[tone],
        className,
      )}
    >
      <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-current" />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Filter chip                                                         */
/* ------------------------------------------------------------------ */

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  count?: number;
}

export function Chip({ active, count, className, children, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-[7px] rounded-pill border px-[14px] py-[7px] text-[12.5px] font-semibold transition-colors",
        active
          ? "border-brand bg-brand text-brand-ink"
          : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined ? <span className="mz-num font-mono text-[11px] opacity-90">{count}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Money — formatted figure + RTL-safe currency unit                   */
/* ------------------------------------------------------------------ */

export interface MoneyProps {
  value: number;
  /** Overrides useFormat()'s default currency label (ج.م). */
  currencyLabel?: string;
  showUnit?: boolean;
  className?: string;
  numFontClassName?: string;
}

export function Money({ value, currencyLabel, showUnit = true, className, numFontClassName }: MoneyProps) {
  const format = useFormat({ currencyLabel });
  return (
    <span className={cn("inline-flex items-baseline gap-[5px]", className)}>
      <span className={cn("mz-num", numFontClassName)}>{format.money(value)}</span>
      {showUnit ? <span className="font-ar text-[0.85em] font-semibold text-ink-faint">{format.currencyLabel}</span> : null}
    </span>
  );
}

export interface QtyProps {
  /** Accepts the API's string form ("40.000000") as well as a number. */
  value: number | string;
  className?: string;
}

/** A quantity, LTR-isolated like every other figure, with trailing zeros trimmed. */
export function Qty({ value, className }: QtyProps) {
  const format = useFormat();
  return <span className={cn("mz-num", className)}>{format.qty(typeof value === "string" ? Number(value) : value)}</span>;
}

/* ------------------------------------------------------------------ */
/* Stat card — used by the KPI/stat strip                              */
/* ------------------------------------------------------------------ */

export interface StatCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  subTone?: "up" | "down" | "neutral";
  valueTone?: "default" | "danger";
}

const statSubToneClass = {
  up: "text-success-ink",
  down: "text-danger-ink",
  neutral: "text-ink-muted",
} as const;

/**
 * Spec §5 — a data surface, so the tighter 8px radius (not the 14px chrome
 * radius): muted label, large mono `tabular-nums` value, and a delta line led
 * by a directional micro-beam so the trend reads before the number.
 */
export function StatCard({ label, value, sub, subTone = "neutral", valueTone = "default" }: StatCardProps) {
  return (
    <Card className="relative overflow-hidden rounded-md p-[15px_16px] transition-[transform,box-shadow] duration-150 hover:-translate-y-[2px] hover:shadow-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="text-xs font-semibold text-ink-muted">{label}</div>
      <div
        className={cn(
          "mt-[6px] flex items-baseline gap-[5px] font-mono text-[24px] font-semibold tabular-nums tracking-[-0.02em]",
          valueTone === "danger" ? "text-danger-ink" : "text-ink",
        )}
      >
        {value}
      </div>
      {sub ? (
        <div className={cn("mt-[7px] flex items-center gap-[6px] text-xs font-semibold", statSubToneClass[subTone])}>
          <MicroBeam direction={subTone === "neutral" ? "level" : subTone} />
          <span className="min-w-0 truncate">{sub}</span>
        </div>
      ) : null}
    </Card>
  );
}
