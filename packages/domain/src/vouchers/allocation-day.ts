import { earliestOpenDayFrom, namingEarliestOpenDay } from "../fiscal-periods/errors.js";
import type { FiscalPeriodRepository } from "../fiscal-periods/fiscal-period.js";
import type { LedgerRepository } from "../gl/ledger.js";
import { assertPeriodOpen } from "../gl/post.js";
import { PostingBeforeRevaluationError, latestStandingRevaluation, nextDay } from "../gl/revaluation-lock.js";
import { laterDay, type VoucherAllocation } from "./allocation.js";
import { AllocationMismatchError } from "./errors.js";

export class AllocationDateTooEarlyError extends AllocationMismatchError {
  override readonly code: string = "ALLOCATION_DATE_TOO_EARLY";
  readonly messageEn: string;
  constructor(
    readonly date: string,
    readonly earliestDate: string,
  ) {
    super(`تاريخ التخصيص ${date} أسبق من ${earliestDate}، وهو أول يوم يتاح فيه المبلغ والفاتورة معاً: الأحدث من تاريخ السند وتاريخ الفاتورة ويوم إلغاء أي تخصيص سابق عليهما.`);
    this.name = "AllocationDateTooEarlyError";
    this.messageEn = `Allocation date ${date} is before ${earliestDate}, the first day the money and the invoice are both free: the latest of the money's date, the invoice's date and the day any earlier allocation on either was undone.`;
  }
}

export interface LaterAllocationDayInput {
  readonly requested?: string | null;
  readonly moneyDay: string;
  readonly invoiceDay: string;
  readonly currencies: ReadonlySet<string>;
  readonly earlierAllocations: readonly VoucherAllocation[];
}

export interface LaterAllocationDayDeps {
  readonly periods: Pick<FiscalPeriodRepository, "findByDate"> & Partial<Pick<FiscalPeriodRepository, "list">>;
  readonly ledger: Pick<LedgerRepository, "list">;
  readonly vatFilings?: { findCovering(date: string): Promise<readonly { readonly status: string }[]> };
}

// INVARIANT: only a day nobody chose falls forward (past a closed period, past a month whose VAT return is filed, past a run that still stands for the currency); a day asked for by name is taken as sent or refused — by the standing run too, whether or not the allocation posts an entry of its own.
export async function laterAllocationDay(input: LaterAllocationDayInput, deps: LaterAllocationDayDeps): Promise<string> {
  const undone = input.earlierAllocations.flatMap((allocation) => (allocation.status === "reversed" ? [allocation.reversedOn ?? allocation.reversedAt?.slice(0, 10) ?? ""] : []));
  const earliest = undone.reduce(laterDay, laterDay(input.moneyDay.slice(0, 10), input.invoiceDay.slice(0, 10)));
  const standing = await latestStandingRevaluation(input.currencies, deps.ledger);
  const runDay = standing?.run.date.slice(0, 10) ?? "";
  if (input.requested) {
    const requested = input.requested.slice(0, 10);
    if (requested < earliest) throw new AllocationDateTooEarlyError(requested, earliest);
    await namingEarliestOpenDay(deps.periods, earliest, () => assertPeriodOpen(requested, deps.periods));
    if (standing && requested <= runDay) throw new PostingBeforeRevaluationError(requested, standing.currency, standing.run.entryNo ?? standing.run.id, runDay, nextDay(runDay));
    return requested;
  }
  const periods = deps.periods.list ? await deps.periods.list() : null;
  let day = standing ? laterDay(earliest, nextDay(runDay)) : earliest;
  for (;;) {
    day = (periods ? earliestOpenDayFrom(periods, day) : null) ?? day;
    const filed = (await deps.vatFilings?.findCovering(day))?.some((filing) => filing.status === "filed");
    if (!filed) return day;
    day = nextDay(day);
  }
}
