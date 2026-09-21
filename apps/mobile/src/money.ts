const GROUP_SIZE = 3;
const DISPLAY_DECIMALS = 2;

function splitDecimal(value: string): { sign: string; whole: string; fraction: string } {
  const sign = value.startsWith("-") ? "-" : "";
  const unsigned = sign ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  return { sign, whole, fraction };
}

function group(whole: string): string {
  let out = "";
  for (let index = whole.length; index > 0; index -= GROUP_SIZE) {
    out = whole.slice(Math.max(0, index - GROUP_SIZE), index) + (out ? "," + out : "");
  }
  return out || "0";
}

/** Half-up on the digit after the last shown one, carried through the string — never through a float. */
function roundHalfUp(whole: string, fraction: string, decimals: number): { whole: string; fraction: string } {
  const padded = fraction + "0".repeat(decimals + 1);
  const kept = padded.slice(0, decimals);
  const next = padded.charAt(decimals);
  if (next < "5") return { whole, fraction: kept };

  const digits = (whole + kept).split("");
  let index = digits.length - 1;
  while (index >= 0) {
    const raised = Number(digits[index]) + 1;
    if (raised < 10) {
      digits[index] = String(raised);
      break;
    }
    digits[index] = "0";
    index -= 1;
  }
  const carried = index < 0 ? ["1", ...digits] : digits;
  const cut = carried.length - decimals;
  return { whole: carried.slice(0, cut).join(""), fraction: carried.slice(cut).join("") };
}

/**
 * Money crosses the wire as an exact decimal string and is rendered by string
 * arithmetic only. Passing it through Number() loses cents on large figures —
 * that is how a notification once rendered 478.8 for 478.80.
 */
export function formatMoney(value: string, decimals = DISPLAY_DECIMALS): string {
  const parts = splitDecimal(value);
  const rounded = roundHalfUp(parts.whole, parts.fraction, decimals);
  const sign = parts.sign && /[1-9]/.test(rounded.whole + rounded.fraction) ? "-" : "";
  return `${sign}${group(rounded.whole)}${decimals > 0 ? "." + rounded.fraction : ""}`;
}

export function formatAmountWithCurrency(value: string, currencySymbol = "ج.م"): string {
  return `${formatMoney(value)} ${currencySymbol}`;
}

export function isNegative(value: string): boolean {
  return value.startsWith("-") && /[1-9]/.test(value);
}

const POSITIVE_DECIMAL = /^\d+(\.\d+)?$/;

/**
 * A plain, strictly-positive decimal string — the client-side gate on a
 * quantity or a price field before it is sent as-is on the wire. Never
 * routes the value through `Number()`; a string that fails this is refused
 * without ever being parsed as a float.
 */
export function isPositiveDecimal(value: string): boolean {
  const trimmed = value.trim();
  if (!POSITIVE_DECIMAL.test(trimmed)) return false;
  return !/^0+(\.0+)?$/.test(trimmed);
}

/**
 * A wire decimal as a figure a person edits: `615.600000` → `615.60`.
 * EXACT, never rounded — digits past the second place are dropped only when
 * every one of them is a zero, because this string is posted as the amount.
 */
export function toAmountInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const parts = splitDecimal(trimmed);
  if (!/^\d+$/.test(parts.whole) || !/^\d*$/.test(parts.fraction)) return trimmed;
  if (/[1-9]/.test(parts.fraction.slice(DISPLAY_DECIMALS))) return trimmed;
  return `${parts.sign}${parts.whole}.${parts.fraction.slice(0, DISPLAY_DECIMALS).padEnd(DISPLAY_DECIMALS, "0")}`;
}

const WIRE_SCALE = 6;

function toScaled(value: string): bigint {
  const parts = splitDecimal(value.trim());
  const fraction = (parts.fraction + "0".repeat(WIRE_SCALE)).slice(0, WIRE_SCALE);
  const magnitude = BigInt(`${parts.whole === "" ? "0" : parts.whole}${fraction}`);
  return parts.sign ? -magnitude : magnitude;
}

function fromScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(WIRE_SCALE + 1, "0");
  const cut = digits.length - WIRE_SCALE;
  return `${negative ? "-" : ""}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

/** Exact sum of wire decimals at the wire's own scale, through BigInt — never a float. */
export function sumDecimals(values: readonly string[]): string {
  return fromScaled(values.reduce((total, value) => total + toScaled(value), 0n));
}

const MAX_EXACT_SIGNIFICANT_DIGITS = 15;

export interface WireNumberDecimal {
  readonly decimal: string;
  readonly exact: boolean;
}

function expandExponent(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (!match) return text;
  const [, sign = "", whole = "", fraction = "", exponentText = "0"] = match;
  const digits = whole + fraction;
  const point = whole.length + Number.parseInt(exponentText, 10);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * A money figure a report route still sends as a JSON number (D345), turned
 * into a decimal string by TEXT, never by arithmetic: `String(n)` is the
 * shortest decimal that round-trips to the double, which is exactly the text
 * JSON.stringify put on the wire. It is `exact` only when that text can be the
 * true figure — at most six decimals and fifteen significant digits, beyond
 * which a double may already have dropped a cent. An inexact figure is shown
 * as it arrived, never rounded.
 */
export function decimalFromWireNumber(value: number): WireNumberDecimal {
  if (!Number.isFinite(value)) return { decimal: String(value), exact: false };
  const decimal = expandExponent(String(value));
  const { whole, fraction } = splitDecimal(decimal);
  const significant = (whole + fraction).replace(/^0+/, "").length;
  return { decimal, exact: fraction.length <= WIRE_SCALE && significant <= MAX_EXACT_SIGNIFICANT_DIGITS };
}

export function formatWireNumber(value: number, currencySymbol = "ج.م"): string {
  const converted = decimalFromWireNumber(value);
  if (!converted.exact) return `${converted.decimal} ${currencySymbol}`;
  return formatAmountWithCurrency(converted.decimal, currencySymbol);
}
