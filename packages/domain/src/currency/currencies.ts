/**
 * العملات المدعومة — the currency registry (R1.15). Eleven ISO 4217 codes a
 * document may be denominated in: the Egyptian base plus the Gulf and major
 * trading currencies an Egyptian SMB actually invoices in.
 *
 * This is reference data, not tenant data: which of these a given tenant may
 * use is the `secondaryCurrencies` setting, and what one is worth on a given
 * day is an approved exchange rate. The registry only says the code exists and
 * what to call it in each locale — four screens were each carrying their own
 * hardcoded, differently-ordered subset before it did.
 */

export interface CurrencyDefinition {
  /** ISO 4217 alphabetic code. */
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  /** Display symbol; falls back to the code where no short symbol is customary. */
  readonly symbol: string;
}

export const SUPPORTED_CURRENCIES: readonly CurrencyDefinition[] = [
  { code: "EGP", nameAr: "جنيه مصري", nameEn: "Egyptian Pound", symbol: "ج.م" },
  { code: "SAR", nameAr: "ريال سعودي", nameEn: "Saudi Riyal", symbol: "ر.س" },
  { code: "AED", nameAr: "درهم إماراتي", nameEn: "UAE Dirham", symbol: "د.إ" },
  { code: "QAR", nameAr: "ريال قطري", nameEn: "Qatari Riyal", symbol: "ر.ق" },
  { code: "KWD", nameAr: "دينار كويتي", nameEn: "Kuwaiti Dinar", symbol: "د.ك" },
  { code: "BHD", nameAr: "دينار بحريني", nameEn: "Bahraini Dinar", symbol: "د.ب" },
  { code: "OMR", nameAr: "ريال عماني", nameEn: "Omani Rial", symbol: "ر.ع" },
  { code: "JOD", nameAr: "دينار أردني", nameEn: "Jordanian Dinar", symbol: "د.أ" },
  { code: "USD", nameAr: "دولار أمريكي", nameEn: "US Dollar", symbol: "$" },
  { code: "EUR", nameAr: "يورو", nameEn: "Euro", symbol: "€" },
  { code: "GBP", nameAr: "جنيه إسترليني", nameEn: "Pound Sterling", symbol: "£" },
] as const;

export const SUPPORTED_CURRENCY_CODES: readonly string[] = SUPPORTED_CURRENCIES.map((c) => c.code);

export function findCurrency(code: string): CurrencyDefinition | null {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code) ?? null;
}

export function isSupportedCurrency(code: string | null | undefined): boolean {
  return code != null && SUPPORTED_CURRENCY_CODES.includes(code);
}

/** The registry minus `baseCurrency` — the foreign codes a rate can be quoted for. */
export function foreignCurrencies(baseCurrency: string): readonly CurrencyDefinition[] {
  return SUPPORTED_CURRENCIES.filter((c) => c.code !== baseCurrency);
}
