/**
 * Pure formatting helpers behind `useFormat()`. Kept dependency-free and
 * side-effect-free so they're trivial to unit test without React.
 */

import { DEFAULT_LOCALE, type Locale } from "../i18n/locale";

export type NumeralSystem = "western" | "arabic";

/**
 * `Intl` needs a REGION to pick Egyptian month names and a 12-hour clock; the
 * app's locale codes carry only the language.
 */
const INTL_LOCALE: Record<Locale, string> = { ar: "ar-EG", en: "en-GB" };

const EASTERN_ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"] as const;

/** Converts every ASCII digit in `input` to its Eastern Arabic-Indic form. */
export function toArabicDigits(input: string): string {
  return input.replace(/[0-9]/g, (digit) => EASTERN_ARABIC_DIGITS[Number(digit)] ?? digit);
}

function applyNumerals(value: string, numerals: NumeralSystem): string {
  return numerals === "arabic" ? toArabicDigits(value) : value;
}

export interface FormatNumberOptions {
  numerals?: NumeralSystem;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

/**
 * Formats a plain number with western grouping/decimal punctuation
 * (comma thousands, period decimal) regardless of UI locale — this matches
 * the approved mockup, which always renders figures LTR-isolated even in
 * the Arabic RTL layout (see `.mz-num` in tokens.css).
 */
export function formatNumber(value: number, options: FormatNumberOptions = {}): string {
  const { numerals = "western", minimumFractionDigits = 0, maximumFractionDigits = 2 } = options;
  const isNegative = value < 0 || Object.is(value, -0);
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(abs);
  const digits = applyNumerals(formatted, numerals);
  // The minus sign is placed at the very start of the LTR-isolated run so it
  // binds visually to the figure instead of being reordered by surrounding
  // RTL text — this is the "correct RTL negatives" requirement.
  return isNegative && abs !== 0 ? `-${digits}` : digits;
}

export interface FormatMoneyOptions extends FormatNumberOptions {
  /** Fraction digits default to 2 for money (vs. 0 for plain numbers). */
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

/**
 * Formats a monetary amount with 2 decimal places by default. An exact decimal
 * string — money as the wire carries it (D126) — is rounded and grouped by
 * string arithmetic, never through a float.
 */
export function formatMoney(value: number | string, options: FormatMoneyOptions = {}): string {
  const merged = { minimumFractionDigits: 2, maximumFractionDigits: 2, ...options };
  if (typeof value === "string") return formatDecimalString(value, merged);
  return formatNumber(value, merged);
}

const DECIMAL_STRING = /^(-?)(\d+)(?:\.(\d+))?$/;

function formatDecimalString(value: string, options: FormatNumberOptions): string {
  const { numerals = "western", minimumFractionDigits = 0, maximumFractionDigits = 2 } = options;
  const match = DECIMAL_STRING.exec(value.trim());
  if (!match) return value;
  const [, sign = "", whole = "0", fraction = ""] = match;
  const scale = 10n ** BigInt(maximumFractionDigits);
  const digits = BigInt(whole + fraction.padEnd(maximumFractionDigits, "0").slice(0, maximumFractionDigits));
  const roundUp = fraction.length > maximumFractionDigits && Number(fraction[maximumFractionDigits]) >= 5;
  const scaled = digits + (roundUp ? 1n : 0n);
  const intPart = (scaled / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let fracPart = maximumFractionDigits > 0 ? (scaled % scale).toString().padStart(maximumFractionDigits, "0") : "";
  while (fracPart.length > minimumFractionDigits && fracPart.endsWith("0")) fracPart = fracPart.slice(0, -1);
  const formatted = applyNumerals(fracPart ? `${intPart}.${fracPart}` : intPart, numerals);
  return sign === "-" && scaled !== 0n ? `-${formatted}` : formatted;
}

/**
 * Formats a quantity. The API carries quantities at six decimal places, so a
 * raw render reads "40.000000" next to a money column that reads "12,756.60".
 * Fractional quantities are real (2.5 kg), so this keeps up to three decimals
 * and drops the trailing zeros rather than fixing the width.
 */
export function formatQty(value: number, options: FormatNumberOptions = {}): string {
  return formatNumber(value, { minimumFractionDigits: 0, maximumFractionDigits: 3, ...options });
}

export type DateFormatStyle = "short" | "long";

export interface FormatDateOptions {
  numerals?: NumeralSystem;
  /** "short" = 10/08/2026 (numeric, matches document metadata in the mockup). "long" = الجمعة، ٢١ أغسطس ٢٠٢٦ */
  style?: DateFormatStyle;
  locale?: Locale;
}

/** Formats a date honoring western or Eastern Arabic-Indic numerals. */
export function formatDate(value: Date | string, options: FormatDateOptions = {}): string {
  const { numerals = "western", style = "short", locale = DEFAULT_LOCALE } = options;
  const date = typeof value === "string" ? new Date(value) : value;

  if (style === "short") {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = String(date.getFullYear());
    return applyNumerals(`${dd}/${mm}/${yyyy}`, numerals);
  }

  // "-u-nu-latn" pins western digits so we control the arabic-numeral
  // conversion ourselves (deterministic across ICU builds).
  const formatted = new Intl.DateTimeFormat(`${INTL_LOCALE[locale]}-u-nu-latn`, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  return applyNumerals(formatted, numerals);
}

export interface FormatDateTimeOptions {
  numerals?: NumeralSystem;
  locale?: Locale;
  /** Adds the seconds field — for a "last checked at" style readout. */
  withSeconds?: boolean;
}

/** A clock time in the active locale, e.g. "7:08:33 PM" / "٧:٠٨:٣٣ م". */
export function formatTime(value: Date | string | number, options: FormatDateTimeOptions = {}): string {
  const { numerals = "western", locale = DEFAULT_LOCALE, withSeconds = false } = options;
  const date = typeof value === "string" || typeof value === "number" ? new Date(value) : value;
  const formatted = new Intl.DateTimeFormat(`${INTL_LOCALE[locale]}-u-nu-latn`, {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
  }).format(date);
  return applyNumerals(formatted, numerals);
}

/** A date and a time together, e.g. "10 Aug 2026, 7:08 PM". */
export function formatDateTime(value: Date | string, options: FormatDateTimeOptions = {}): string {
  const { numerals = "western", locale = DEFAULT_LOCALE } = options;
  const date = typeof value === "string" ? new Date(value) : value;
  const formatted = new Intl.DateTimeFormat(`${INTL_LOCALE[locale]}-u-nu-latn`, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
  return applyNumerals(formatted, numerals);
}
