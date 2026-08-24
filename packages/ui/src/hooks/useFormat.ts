import { useCallback, useMemo } from "react";
import { useUiTranslation } from "../i18n";
import {
  formatDate,
  formatMoney,
  formatNumber,
  type DateFormatStyle,
  type NumeralSystem,
} from "../lib/format";

export interface UseFormatOptions {
  /** Numeral system for both money and dates. Defaults to "western". */
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
  date: (value: Date | string, style?: DateFormatStyle) => string;
  currencyLabel: string;
}

/**
 * Central formatting hook for the Mezan UI. Keeps money/number figures in
 * western tabular digits with correct RTL negative-sign placement, and lets
 * dates honor either western or Eastern Arabic-Indic numerals.
 */
export function useFormat(options: UseFormatOptions = {}): UseFormatResult {
  const numerals = options.numerals ?? "western";
  const { t } = useUiTranslation();
  const currencyLabel = options.currencyLabel ?? t("ui.currency");

  const money = useCallback((value: number) => formatMoney(value, { numerals }), [numerals]);
  const number = useCallback((value: number) => formatNumber(value, { numerals }), [numerals]);
  const date = useCallback(
    (value: Date | string, style: DateFormatStyle = "short") => formatDate(value, { numerals, style }),
    [numerals],
  );

  return useMemo(
    () => ({ numerals, money, number, date, currencyLabel }),
    [numerals, money, number, date, currencyLabel],
  );
}
