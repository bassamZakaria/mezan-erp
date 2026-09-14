import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useFormat } from "../hooks/useFormat";
import { useUiTranslation } from "../i18n";
import { MicroBeam } from "./beams";
import { Kbd } from "./Kbd";

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

export type ButtonVariant = "default" | "primary" | "ghost" | "danger-outline";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * The keystroke that does the same thing, shown as a chip after the label.
   *
   * This is the discoverability mechanism the UX spec names — "discoverable,
   * not folklore". A shortcut whose only advertisement is a cheat sheet you
   * must already know how to open is folklore. The chip is decoration only:
   * the key is bound by the global keymap, so a chip on a button the keymap
   * does not reach would be a lie.
   */
  shortcut?: string | readonly string[];
}

const buttonVariantClass: Record<ButtonVariant, string> = {
  default: "border-border-strong bg-surface text-ink hover:bg-surface-2",
  primary: "border-brand bg-brand text-brand-ink shadow-1 hover:bg-brand-strong hover:border-brand-strong",
  ghost: "border-transparent bg-transparent text-ink hover:bg-surface-2",
  "danger-outline": "border-danger bg-transparent text-danger-ink hover:bg-danger-soft",
};

/** Every size keeps a 44px minimum in its smallest dimension (ground rule §2.1) —
 *  padding alone made `sm` ~31px and `md` ~36px tall, so height is now explicit. */
const buttonSizeClass: Record<ButtonSize, string> = {
  sm: "min-h-[44px] px-[11px] py-[7px] text-xs",
  md: "min-h-[44px] px-[15px] py-[9px] text-[13px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", className, children, shortcut, ...props },
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
      {shortcut ? <Kbd keys={shortcut} className="opacity-70" /> : null}
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
        // 44px minimum in both dimensions — ground rule §2.1 (was 37px).
        "relative flex h-[44px] w-[44px] flex-none items-center justify-center rounded-md border border-transparent text-ink-muted transition-colors hover:border-border hover:bg-surface-2 hover:text-ink",
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
      className={cn("rounded-lg border border-border bg-surface", className)}
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
  /**
   * Most Chip rows are one mutually-exclusive choice (status, year, line
   * kind, …), so the default ARIA is `role="radio"` + `aria-checked` — the
   * caller wraps the row in `role="radiogroup"`, same contract as
   * `Segmented`. Pass `toggle` for a chip that is its own independent
   * on/off filter or one tag in a multi-select set (no mutual exclusion,
   * no group role needed): it gets `aria-pressed` instead.
   */
  toggle?: boolean;
}

/** Selected state is colour PLUS a check mark, never colour alone (ground rule §2.2). */
function ChipCheck() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-[12px] w-[12px] flex-none fill-current">
      <path d="M8.2 13.2 4.9 9.9l1.4-1.4 1.9 1.9 5.5-5.5 1.4 1.4z" />
    </svg>
  );
}

export function Chip({ active, count, toggle = false, className, children, ...props }: ChipProps) {
  return (
    <button
      type="button"
      role={toggle ? undefined : "radio"}
      aria-checked={toggle ? undefined : Boolean(active)}
      aria-pressed={toggle ? Boolean(active) : undefined}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-[7px] rounded-pill border px-[16px] py-[10px] text-[12.5px] font-semibold transition-colors",
        active
          ? "border-brand bg-brand text-brand-ink"
          : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink",
        className,
      )}
      {...props}
    >
      {active ? <ChipCheck /> : null}
      {children}
      {count !== undefined ? <span className="mz-num font-mono text-[11px] opacity-90">{count}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented — single-select switch (matches DateRangeFilter's preset) */
/* ------------------------------------------------------------------ */

export interface SegmentedOption {
  key: string;
  label: string;
}

export interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onChange: (key: string) => void;
  "aria-label"?: string;
  className?: string;
}

/** Single-select `role="radiogroup"` switch for a screen keeping a status toggle instead of view tabs. */
export function Segmented({ options, value, onChange, className, ...props }: SegmentedProps) {
  return (
    <div
      role="radiogroup"
      aria-label={props["aria-label"]}
      className={cn("inline-flex flex-wrap gap-[2px] rounded-md border border-border bg-surface-2 p-[3px]", className)}
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={value === option.key}
          onClick={() => onChange(option.key)}
          className={cn(
            "inline-flex min-h-[44px] items-center justify-center rounded-[6px] px-[14px] text-[12.5px] font-semibold text-ink-muted transition-colors",
            value === option.key && "bg-surface text-ink shadow-1",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
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
    // flex-wrap + min-w-0 let a large figure's currency unit drop to its own
    // line instead of being clipped by an ancestor's overflow-hidden (a stat
    // tile at a 7-digit value) — the figure itself never breaks mid-number.
    <span className={cn("inline-flex min-w-0 flex-wrap items-baseline gap-x-[5px] gap-y-[1px]", className)}>
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
    // Depth comes from the hairline border, not a drop shadow, and a card does
    // not lift on hover: design spec §3.4. The lift also moved a row under the
    // cursor mid-click on a dense list.
    //
    // min-w-0: a grid item's default min-width is its content's intrinsic
    // width, which for a long money figure is wider than the column — without
    // this the card refuses to shrink and the figure's tail (the currency
    // unit) is clipped by overflow-hidden instead of wrapping.
    <Card className="relative min-w-0 overflow-hidden rounded-md p-[15px_16px] transition-colors duration-150 hover:border-border-strong">
      <div className="text-xs font-semibold text-ink-muted">{label}</div>
      <div
        className={cn(
          "mt-[6px] flex min-w-0 flex-wrap items-baseline gap-x-[5px] gap-y-[2px] font-mono text-[19px] font-semibold tabular-nums tracking-[-0.02em] min-[420px]:text-[24px]",
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

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

export type EmptyStateVariant = "empty" | "no-results";

export interface EmptyStateProps {
  /** Omit to take the variant's own wording — never render a bare blank box. */
  title?: string;
  description?: string;
  /** `no-results` is a search or filter that matched nothing, not a screen with no data yet. */
  variant?: EmptyStateVariant;
  /** The SAME action the list's own toolbar offers — an empty state is not a second, disconnected button (R1.10). */
  action?: { label: string; onClick: () => void };
  icon?: ReactNode;
  className?: string;
}

/**
 * A list with zero rows carries a call to action (R1.10), not just a message —
 * "لا توجد فواتير بعد — ابدأ بإنشاء…" plus the create button. Callers pass this
 * to `DocumentList`'s `emptyState` prop; a caller with nothing to create yet
 * (a read-only feed, a report with no matches) omits `action` and gets the
 * plain message.
 *
 * `action` is left optional rather than required: dozens of existing callers
 * legitimately have none — a `no-results` variant (a search/filter matched
 * nothing) and read-only feeds (e.g. the audit log) have no create action to
 * offer, and making the prop required would force every one of those call
 * sites to fabricate one. It is nonetheless STRONGLY ENCOURAGED for every
 * `variant="empty"` instance: that variant means the underlying data set is
 * genuinely empty, not filtered, and R1.10 requires the button that creates
 * the first row. Reach for `variant="no-results"` (or omit `action`
 * deliberately) only when there is truly nothing to create from this screen.
 */
export function EmptyState({ title, description, action, icon, className, variant = "empty" }: EmptyStateProps) {
  const { t } = useUiTranslation();
  const resolvedTitle = title ?? t(variant === "no-results" ? "ui.empty.searchTitle" : "ui.empty.title");
  const resolvedDescription = description ?? (variant === "no-results" ? t("ui.empty.searchHint") : undefined);
  return (
    <div className={cn("flex flex-col items-center gap-[10px] px-[24px] py-[36px] text-center", className)}>
      {icon ? (
        <div aria-hidden className="text-ink-faint">
          {icon}
        </div>
      ) : null}
      <p className="text-[13px] font-semibold text-ink">{resolvedTitle}</p>
      {resolvedDescription ? <p className="max-w-[42ch] text-[12px] text-ink-muted">{resolvedDescription}</p> : null}
      {action ? (
        <Button variant="primary" size="sm" className="mt-[4px]" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
