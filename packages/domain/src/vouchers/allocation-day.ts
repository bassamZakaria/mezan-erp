import { earliestOpenDayFrom, namingEarliestOpenDay } from "../fiscal-periods/errors.js";
import type { FiscalPeriodRepository } from "../fiscal-periods/fiscal-period.js";
import type { LedgerRepository } from "../gl/ledger.js";
import { assertPeriodOpen } from "../gl/post.js";
import { earliestDayAfterRevaluation } from "../gl/revaluation-lock.js";
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
}

// INVARIANT: only a day nobody chose falls forward (past a closed period, past a run that still stands for the currency); a day asked for by name is taken as sent or refused.
export async function laterAllocationDay(input: LaterAllocationDayInput, deps: LaterAllocationDayDeps): Promise<string> {
  const undone = input.earlierAllocations.flatMap((allocation) => (allocation.status === "reversed" ? [allocation.reversedOn ?? allocation.reversedAt?.slice(0, 10) ?? ""] : []));
  const earliest = undone.reduce(laterDay, laterDay(input.moneyDay.slice(0, 10), input.invoiceDay.slice(0, 10)));
  if (input.requested) {
    const requested = input.requested.slice(0, 10);
    if (requested < earliest) throw new AllocationDateTooEarlyError(requested, earliest);
    await namingEarliestOpenDay(deps.periods, earliest, () => assertPeriodOpen(requested, deps.periods));
    return requested;
  }
  const restated = laterDay(earliest, await earliestDayAfterRevaluation(input.currencies, deps.ledger));
  const open = deps.periods.list ? earliestOpenDayFrom(await deps.periods.list(), restated) : null;
  return open ?? restated;
}
