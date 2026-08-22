import type { FiscalPeriod, FiscalPeriodRepository } from "./fiscal-period.js";
import { DuplicateFiscalPeriodError } from "./errors.js";

/** Last calendar day of `year`-`month` (1-indexed month), as a 2-digit day string. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Builds the 12 monthly periods for a fiscal year starting in January
 * (docs/catalog/04 "الفترات المالية": "إنشاء السنة التالية" — generates the
 * whole year pre-opened, "مفتوحة", up front rather than period-by-period).
 * Pure — does not touch a repository.
 */
export function buildFiscalYearPeriods(year: number, idFactory: (year: number, periodNumber: number) => string): FiscalPeriod[] {
  const periods: FiscalPeriod[] = [];
  for (let month = 1; month <= 12; month++) {
    const endDay = lastDayOfMonth(year, month);
    periods.push({
      id: idFactory(year, month),
      year,
      periodNumber: month,
      startDate: `${year}-${pad2(month)}-01`,
      endDate: `${year}-${pad2(month)}-${pad2(endDay)}`,
      status: "open",
    });
  }
  return periods;
}

/**
 * Generates and persists a full fiscal year's 12 periods. Rejects if any
 * period in the target year already exists (docs/catalog/04: generating a
 * year that's already been generated would silently double the period
 * count).
 */
export async function generateFiscalYear(
  year: number,
  repo: FiscalPeriodRepository,
  idFactory: (year: number, periodNumber: number) => string = (y, p) => `fp-${y}-${pad2(p)}`,
): Promise<FiscalPeriod[]> {
  const existing = await repo.listByYear(year);
  const firstExisting = existing[0];
  if (firstExisting) {
    throw new DuplicateFiscalPeriodError(year, firstExisting.periodNumber);
  }

  const periods = buildFiscalYearPeriods(year, idFactory);
  for (const period of periods) {
    await repo.create(period);
  }
  return periods;
}
