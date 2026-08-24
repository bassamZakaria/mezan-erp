/**
 * Pure formatting helpers behind `useFormat()`. Kept dependency-free and
 * side-effect-free so they're trivial to unit test without React.
 */

export type NumeralSystem = "western" | "arabic";

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

/** Formats a monetary amount with 2 decimal places by default. */
export function formatMoney(value: number, options: FormatMoneyOptions = {}): string {
  return formatNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  });
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
}

/** Formats a date honoring western or Eastern Arabic-Indic numerals. */
export function formatDate(value: Date | string, options: FormatDateOptions = {}): string {
  const { numerals = "western", style = "short" } = options;
  const date = typeof value === "string" ? new Date(value) : value;

  if (style === "short") {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = String(date.getFullYear());
    return applyNumerals(`${dd}/${mm}/${yyyy}`, numerals);
  }

  // "-u-nu-latn" pins western digits so we control the arabic-numeral
  // conversion ourselves (deterministic across ICU builds).
  const formatted = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  return applyNumerals(formatted, numerals);
}
