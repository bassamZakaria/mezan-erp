/**
 * "List due depreciation runs with a link to DepreciationRunsScreen" (plan
 * §2 E2-02) — a cross-reference into the existing Fixed Assets depreciation
 * engine (`fixed-assets/depreciation-run.ts`), not a second one. This only
 * asks: which of the last `lookbackMonths` calendar months has no
 * (non-cancelled) company-wide depreciation run yet, given the tenant
 * actually holds depreciable assets.
 */
export interface DueDepreciationPeriodsDeps {
  readonly hasDepreciableAssets: () => Promise<boolean>;
  readonly hasRunForPeriod: (period: string) => Promise<boolean>;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** The last `lookbackMonths` "YYYY-MM" periods ending at `asOfDate`, oldest first. */
function trailingMonthPeriods(asOfDate: string, lookbackMonths: number): string[] {
  const [yearStr, monthStr] = asOfDate.split("-");
  let year = Number(yearStr);
  let month = Number(monthStr);
  const periods: string[] = [];
  for (let i = lookbackMonths - 1; i >= 0; i -= 1) {
    let y = year;
    let m = month - i;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    periods.push(`${y}-${pad2(m)}`);
  }
  return periods;
}

export async function dueDepreciationPeriods(
  deps: DueDepreciationPeriodsDeps,
  asOfDate: string,
  lookbackMonths = 3,
): Promise<string[]> {
  if (!(await deps.hasDepreciableAssets())) return [];
  const due: string[] = [];
  for (const period of trailingMonthPeriods(asOfDate, lookbackMonths)) {
    if (!(await deps.hasRunForPeriod(period))) due.push(period);
  }
  return due;
}
