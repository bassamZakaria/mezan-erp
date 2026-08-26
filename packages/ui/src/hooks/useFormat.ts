import { createContext, createElement, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useUiTranslation } from "../i18n";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatQty,
  formatTime,
  type DateFormatStyle,
  type NumeralSystem,
} from "../lib/format";

/**
 * The tenant's numeral preference (settings §"عام" → نظام الأرقام). It is a
 * context rather than a prop because every screen calls `useFormat()` with no
 * arguments — without this the preference would have to be threaded through
 * hundreds of call sites, which is how it ended up being stored and never read.
 */
const NumeralsContext = createContext<NumeralSystem>("western");

export function NumeralsProvider({ numerals, children }: { numerals: NumeralSystem; children: ReactNode }) {
  return createElement(NumeralsContext.Provider, { value: numerals }, children);
}

export interface UseFormatOptions {
  /** Numeral system for both money and dates. Defaults to the tenant's own preference. */
  numerals?: NumeralSystem;
  /** Overrides the locale's own currency label (ج.م / EGP). */
  currencyLabel?: string;
}

export interface UseFormatResult {
  numerals: NumeralSystem;
  /** Figure only, e.g. "1,150.00" — wrap in <Money> to get the .mz-num isolation + currency label. */
  money: (value: number) => string;
  /** Figure only, e.g. "86,240" — wrap in <span className="mz-num"> for RTL-safe rendering. */
  number: (value: number) => string;
  /** Quantity, trailing zeros trimmed — the API carries six decimal places. */
  qty: (value: number) => string;
  date: (value: Date | string, style?: DateFormatStyle) => string;
  /** Clock time in the active locale. */
  time: (value: Date | string | number, withSeconds?: boolean) => string;
  /** Date and time together, in the active locale. */
  dateTime: (value: Date | string) => string;
  currencyLabel: string;
}

/**
 * Central formatting hook for the Mezan UI. Renders figures with correct RTL
 * negative-sign placement, in whichever numeral system the tenant chose —
 * western by default, Eastern Arabic-Indic when the tenant asked for it.
 */
export function useFormat(options: UseFormatOptions = {}): UseFormatResult {
  const tenantNumerals = useContext(NumeralsContext);
  const numerals = options.numerals ?? tenantNumerals;
  const { t, locale } = useUiTranslation();
  const currencyLabel = options.currencyLabel ?? t("ui.currency");

  const money = useCallback((value: number) => formatMoney(value, { numerals }), [numerals]);
  const number = useCallback((value: number) => formatNumber(value, { numerals }), [numerals]);
  const qty = useCallback((value: number) => formatQty(value, { numerals }), [numerals]);
  const date = useCallback(
    (value: Date | string, style: DateFormatStyle = "short") => formatDate(value, { numerals, style, locale }),
    [numerals, locale],
  );
  const time = useCallback(
    (value: Date | string | number, withSeconds = false) => formatTime(value, { numerals, locale, withSeconds }),
    [numerals, locale],
  );
  const dateTime = useCallback((value: Date | string) => formatDateTime(value, { numerals, locale }), [numerals, locale]);

  return useMemo(
    () => ({ numerals, money, number, qty, date, time, dateTime, currencyLabel }),
    [numerals, money, number, qty, date, time, dateTime, currencyLabel],
  );
}
