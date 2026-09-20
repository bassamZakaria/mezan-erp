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
