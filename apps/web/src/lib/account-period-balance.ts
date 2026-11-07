/**
 * رصيد أول المدة / حركة الفترة / رصيد نهاية المدة for one account, from its
 * posted ledger lines. The period is the fiscal year that contains today (or,
 * when today falls in no defined year, the latest one), so a company whose
 * history was imported shows what that history did to the account.
 *
 * Amounts are summed in micro-units (the ledger's own scale) so a long ledger
 * never drifts the way float addition would. All figures are debit − credit,
 * the same sign the movements table under the tiles uses.
 */
export interface PeriodBalance {
  readonly opening: number;
  readonly movement: number;
  readonly closing: number;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}

interface LedgerLine {
  readonly date: string;
  readonly debit: string;
  readonly credit: string;
}

interface FiscalPeriod {
  readonly year: number;
  readonly startDate: string;
  readonly endDate: string;
}

function micro(amount: string): bigint {
  const text = amount.trim();
  if (text === "") return 0n;
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = text.replace(/^[-+]/, "").split(".");
  const value = BigInt(whole || "0") * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  return negative ? -value : value;
}

const major = (value: bigint): number => Number(value) / 1_000_000;

export function currentFiscalYearRange(periods: readonly FiscalPeriod[], today: string): { start: string; end: string } | null {
  if (periods.length === 0) return null;
  const containing = periods.find((p) => p.startDate <= today && today <= p.endDate);
  const year = containing?.year ?? Math.max(...periods.map((p) => p.year));
  const ofYear = periods.filter((p) => p.year === year);
  return {
    start: ofYear.map((p) => p.startDate).sort()[0]!,
    end: ofYear.map((p) => p.endDate).sort().at(-1)!,
  };
}

export function accountPeriodBalance(lines: readonly LedgerLine[], range: { start: string; end: string } | null): PeriodBalance {
  let opening = 0n;
  let movement = 0n;
  for (const line of lines) {
    const net = micro(line.debit) - micro(line.credit);
    if (range && line.date < range.start) opening += net;
    else if (!range || line.date <= range.end) movement += net;
  }
  return { opening: major(opening), movement: major(movement), closing: major(opening + movement), periodStart: range?.start ?? null, periodEnd: range?.end ?? null };
}
