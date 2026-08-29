/**
 * أسعار الصرف — Exchange Rates master data (docs/archive/catalog/04). A rate quotes a
 * foreign currency against the base currency (EGP): `rate` base units per one
 * foreign unit (e.g. 50.25 EGP per 1 USD). Rates are effective-dated and go
 * through a pending → approved (and lockable) lifecycle mirroring the catalog's
 * "بانتظار الاعتماد" / "مقفل" status tabs. The FX revaluation reads the latest
 * approved rate on/before its posting date.
 */

export const BASE_CURRENCY = "EGP";

export type ExchangeRateType = "standard" | "buy" | "sell";
export type ExchangeRateSource = "manual" | "api";
export type ExchangeRateStatus = "pending" | "approved" | "locked";

export interface ExchangeRate {
  readonly id: string;
  /** ISO 4217 foreign currency code, e.g. "USD". Never the base currency. */
  readonly currency: string;
  /** Base units per one foreign unit, as an exact decimal string (≤6 dp), e.g. "50.250000". */
  readonly rate: string;
  /** ISO date (YYYY-MM-DD) the rate takes effect. */
  readonly effectiveDate: string;
  readonly rateType: ExchangeRateType;
  readonly source: ExchangeRateSource;
  readonly status: ExchangeRateStatus;
}

/** Persistence port for exchange rates. The domain depends on this interface only — no SQL. */
export interface ExchangeRateRepository {
  findById(id: string): Promise<ExchangeRate | null>;
  list(): Promise<ExchangeRate[]>;
  /**
   * The latest APPROVED (or locked) rate for `currency` effective on/before
   * `asOfDate` — the rate the FX revaluation and multi-currency posting use.
   * Returns null when no usable rate exists (drives the strict
   * fx-rate-missing policy).
   */
  findRate(currency: string, asOfDate: string): Promise<ExchangeRate | null>;
  create(rate: ExchangeRate): Promise<void>;
  update(rate: ExchangeRate): Promise<void>;
}
