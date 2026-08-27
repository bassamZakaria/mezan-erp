import type { ReactNode } from "react";
import { useFormat } from "../hooks/useFormat";
import { toArabicDigits, type NumeralSystem } from "../lib/format";
import { cn } from "../lib/cn";
import { Button } from "./atoms";
import { MicroBeam } from "./beams";

/**
 * ميزان — the signature instrument (design spec §1.5). Two kinds of truth,
 * one geometry:
 *
 *   equal   — these two must agree (cash close, trial balance, bank
 *             reconciliation, stock count, sub-ledger vs control account)
 *   ceiling — this must not exceed that (credit limit, budget, reorder point)
 *
 * The verdict sentence is chosen by MODE, never by the sign of the difference:
 * a ceiling that has not been reached is good news, and the first build of this
 * component read it as «ناقص بمقدار …» for a customer comfortably inside their
 * credit limit. The `ceiling` variant therefore takes `limit` and `used` by
 * name — a call site cannot silently swap the two — and the word «ناقص» is
 * unreachable from that branch.
 */

export type BalanceMode = "equal" | "ceiling";

export interface BalanceSide {
  /** Arabic name of this side, e.g. «المتوقع بالدفاتر». */
  label: string;
  /**
   * Exact decimal string as the API carries it ("312480.000000").
   * Money is a bigint at scale 1e-6 in this codebase and is parsed from a
   * string here too — a float would round the figure before it is even drawn.
   */
  value: string;
}

interface BalanceCommon {
  /** Arabic caption for the whole instrument, e.g. «تقفيل الخزينة — اليوم». */
  label: string;
  /** Wires the «أين الفرق؟» control, which appears only when the two sides do not agree. */
  onTrace?: () => void;
  traceLabel?: string;
  currencyLabel?: string;
  className?: string;
}

export interface BalanceEqualProps extends BalanceCommon {
  mode?: "equal";
  a: BalanceSide;
  b: BalanceSide;
  /** Decimal string; differences smaller than this count as agreement. Default half a piastre. */
  tolerance?: string;
}

export interface BalanceCeilingProps extends BalanceCommon {
  mode: "ceiling";
  /** The line that must not be crossed. */
  limit: BalanceSide;
  /** What has been consumed against it. */
  used: BalanceSide;
}

export type BalanceProps = BalanceEqualProps | BalanceCeilingProps;

type BalanceTone = "ok" | "warn" | "bad";

const MONEY_SCALE = 1_000_000n;
const CENTI = 10_000n;
const DEFAULT_TOLERANCE = "0.005";

/** Mirrors `Money.fromMajor` — string in, bigint at scale 1e-6 out, no float on the path. */
function parseMoney(value: string): bigint {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value.trim().replace(/[\s,٬]/g, ""));
  if (!match) return 0n;
  const whole = match[2] || "0";
  const frac = `${match[3] ?? ""}000000`.slice(0, 6);
  const scaled = BigInt(whole) * MONEY_SCALE + BigInt(frac);
  return match[1] === "-" ? -scaled : scaled;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** Scaled bigint → grouped two-decimal figure in the reader's own numeral system. */
function formatScaled(scaled: bigint, numerals: NumeralSystem): string {
  const negative = scaled < 0n;
  const rounded = (abs(scaled) + CENTI / 2n) / CENTI;
  const grouped = (rounded / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (rounded % 100n).toString().padStart(2, "0");
  const text = `${negative && rounded !== 0n ? "-" : ""}${grouped}.${cents}`;
  return numerals === "arabic" ? toArabicDigits(text) : text;
}

/** Bigint-only proportion, in tenths of a percent, for the beam's inline-size. */
function fillPercent(part: bigint, whole: bigint): string {
  if (whole <= 0n) return part > 0n ? "100" : "100";
  const tenths = (part * 1000n) / whole;
  const clamped = tenths < 0n ? 0n : tenths > 1000n ? 1000n : tenths;
  return `${clamped / 10n}.${clamped % 10n}`;
}

const trackToneClass: Record<BalanceTone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-danger",
};

const verdictToneClass: Record<BalanceTone, string> = {
  ok: "bg-success-soft text-success-ink",
  warn: "bg-warning-soft text-warning-ink",
  bad: "bg-danger-soft text-danger-ink",
};

function AlertGlyph() {
  return (
    <svg viewBox="0 0 16 14" width="16" height="14" aria-hidden className="flex-none">
      <path d="M8 1.3 15.2 13.1H0.8Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 5.8v3.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r="0.85" fill="currentColor" />
    </svg>
  );
}

function Fulcrum() {
  return (
    <svg viewBox="0 0 14 8" width="14" height="8" aria-hidden className="flex-none text-border-strong">
      <path d="M7 0 13.4 7.7H0.6Z" fill="currentColor" />
    </svg>
  );
}

function Figure({
  scaled,
  numerals,
  currencyLabel,
  strong = false,
}: {
  scaled: bigint;
  numerals: NumeralSystem;
  currencyLabel: string;
  strong?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-[5px]">
      <span className={cn("mz-num", strong ? "text-md font-semibold text-ink" : "text-[0.95em] font-semibold")}>
        {formatScaled(scaled, numerals)}
      </span>
      <span className="font-ar text-[0.8em] font-semibold text-ink-faint">{currencyLabel}</span>
    </span>
  );
}

function SideRow({
  side,
  scaled,
  numerals,
  currencyLabel,
  divider,
}: {
  side: BalanceSide;
  scaled: bigint;
  numerals: NumeralSystem;
  currencyLabel: string;
  divider: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-[14px] py-[8px] text-sm text-ink-muted",
        divider && "border-b border-border",
      )}
    >
      <span>{side.label}</span>
      <Figure scaled={scaled} numerals={numerals} currencyLabel={currencyLabel} strong />
    </div>
  );
}

interface FrameProps {
  label: string;
  first: BalanceSide;
  firstScaled: bigint;
  second: BalanceSide;
  secondScaled: bigint;
  percent: string;
  tone: BalanceTone;
  headline: string;
  detail: ReactNode;
  numerals: NumeralSystem;
  currencyLabel: string;
  showTrace: boolean;
  traceLabel: string;
  onTrace?: () => void;
  className?: string;
}

function BalanceFrame({
  label,
  first,
  firstScaled,
  second,
  secondScaled,
  percent,
  tone,
  headline,
  detail,
  numerals,
  currencyLabel,
  showTrace,
  traceLabel,
  onTrace,
  className,
}: FrameProps) {
  return (
    <div role="group" aria-label={label} className={cn("w-full", className)}>
      <span className="mz-eyebrow block">{label}</span>

      <SideRow side={first} scaled={firstScaled} numerals={numerals} currencyLabel={currencyLabel} divider />

      <div className="my-[9px]">
        <div aria-hidden className="h-[6px] w-full overflow-hidden rounded-pill bg-surface-3">
          <div
            className={cn("h-full rounded-pill transition-[inline-size] duration-500 ease-out", trackToneClass[tone])}
            style={{ inlineSize: `${percent}%` }}
          />
        </div>
        <div className="flex justify-center">
          <Fulcrum />
        </div>
      </div>

      <SideRow side={second} scaled={secondScaled} numerals={numerals} currencyLabel={currencyLabel} divider={false} />

      <p
        className={cn(
          "mt-[10px] flex flex-wrap items-center gap-x-[8px] gap-y-[2px] rounded-md px-[12px] py-[10px] text-sm",
          verdictToneClass[tone],
        )}
      >
        {tone === "ok" ? <MicroBeam direction="level" className="flex-none" /> : <AlertGlyph />}
        <span className="font-semibold">{headline}</span>
        <span>{detail}</span>
      </p>

      {showTrace ? (
        <Button
          type="button"
          onClick={onTrace}
          aria-label={`${traceLabel} — ${label}`}
          className="mt-[10px] min-h-[44px] w-full justify-center"
        >
          {traceLabel}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The two sides of one fact, with the action attached. Use `equal` when the two
 * figures must agree and `ceiling` when the second must simply not pass the first.
 */
export function Balance(props: BalanceProps) {
  const format = useFormat({ currencyLabel: props.currencyLabel });
  const numerals = format.numerals;
  const currencyLabel = format.currencyLabel;
  const traceLabel = props.traceLabel ?? "أين الفرق؟";

  if (props.mode === "ceiling") {
    const limitScaled = parseMoney(props.limit.value);
    const usedScaled = parseMoney(props.used.value);
    const remaining = limitScaled - usedScaled;
    const tone: BalanceTone = remaining > 0n ? "ok" : remaining === 0n ? "warn" : "bad";

    // Never «ناقص»: an unreached ceiling is headroom, not a shortfall.
    const headline = remaining > 0n ? "ضمن الحد" : remaining === 0n ? "بلغ الحد تمامًا" : "تجاوز الحد";
    const detail: ReactNode =
      remaining > 0n ? (
        <>
          متبقٍ <Figure scaled={remaining} numerals={numerals} currencyLabel={currencyLabel} />
        </>
      ) : remaining === 0n ? (
        "لم يتبقَّ شيء من الحد المسموح"
      ) : (
        <>
          بمقدار <Figure scaled={-remaining} numerals={numerals} currencyLabel={currencyLabel} />
        </>
      );

    return (
      <BalanceFrame
        label={props.label}
        first={props.limit}
        firstScaled={limitScaled}
        second={props.used}
        secondScaled={usedScaled}
        percent={fillPercent(abs(usedScaled), abs(limitScaled))}
        tone={tone}
        headline={headline}
        detail={detail}
        numerals={numerals}
        currencyLabel={currencyLabel}
        showTrace={remaining < 0n && props.onTrace !== undefined}
        traceLabel={traceLabel}
        onTrace={props.onTrace}
        className={props.className}
      />
    );
  }

  const aScaled = parseMoney(props.a.value);
  const bScaled = parseMoney(props.b.value);
  const difference = aScaled - bScaled;
  const tolerance = abs(parseMoney(props.tolerance ?? DEFAULT_TOLERANCE));
  const agrees = difference === 0n || abs(difference) < tolerance;

  const heavier = difference > 0n ? props.a : props.b;
  const headline = agrees ? "متزن" : "غير متزن";
  const detail: ReactNode = agrees ? (
    "الطرفان متطابقان"
  ) : (
    <>
      {heavier.label} أكبر بمقدار <Figure scaled={abs(difference)} numerals={numerals} currencyLabel={currencyLabel} />
    </>
  );

  const heaviest = abs(aScaled) > abs(bScaled) ? abs(aScaled) : abs(bScaled);
  const lightest = abs(aScaled) > abs(bScaled) ? abs(bScaled) : abs(aScaled);

  return (
    <BalanceFrame
      label={props.label}
      first={props.a}
      firstScaled={aScaled}
      second={props.b}
      secondScaled={bScaled}
      percent={fillPercent(lightest, heaviest)}
      tone={agrees ? "ok" : "bad"}
      headline={headline}
      detail={detail}
      numerals={numerals}
      currencyLabel={currencyLabel}
      showTrace={!agrees && props.onTrace !== undefined}
      traceLabel={traceLabel}
      onTrace={props.onTrace}
      className={props.className}
    />
  );
}
