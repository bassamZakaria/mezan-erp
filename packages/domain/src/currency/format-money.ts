import { type Money, roundMoney } from "../money/index.js";
import { findCurrency } from "./currencies.js";

const DISPLAY_DECIMALS = 2;

// INVARIANT: the one place a Money becomes prose for a person — rounded half
// up to two places, thousands grouped, and its currency named when one is given.
export function formatMoney(amount: Money, currencyCode?: string | null): string {
  const text = roundMoney(amount, DISPLAY_DECIMALS, "HALF_UP").toString();
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const figure = `${negative ? "-" : ""}${grouped}.${fraction.slice(0, DISPLAY_DECIMALS).padEnd(DISPLAY_DECIMALS, "0")}`;
  if (!currencyCode) return figure;
  return `${figure} ${findCurrency(currencyCode)?.symbol ?? currencyCode}`;
}
