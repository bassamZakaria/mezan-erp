import { earliestOpenDayFrom, namingEarliestOpenDay } from "../fiscal-periods/errors.js";
import type { FiscalPeriodRepository } from "../fiscal-periods/fiscal-period.js";
import type { LedgerRepository } from "../gl/ledger.js";
import { assertPeriodOpen } from "../gl/post.js";
import { earliestDayAfterRevaluation } from "../gl/revaluation-lock.js";
import { laterDay } from "./allocation.js";
import { AllocationMismatchError } from "./errors.js";

export class AllocationDateTooEarlyError extends AllocationMismatchError {
  override readonly code: string = "ALLOCATION_DATE_TOO_EARLY";
  readonly messageEn: string;
  constructor(
    readonly date: string,
    readonly earliestDate: string,
  ) {
    super(`تاريخ التخصيص ${date} أسبق من ${earliestDate}، وهو الأحدث من تاريخ السند وتاريخ الفاتورة؛ لا يُخصَّص مبلغ على فاتورة قبل وجودهما معاً.`);
    this.name = "AllocationDateTooEarlyError";
    this.messageEn = `Allocation date ${date} is before ${earliestDate}, the later of the money's date and the invoice's; money cannot settle an invoice before both exist.`;
  }
}

export interface LaterAllocationDayInput {
  readonly requested?: string | null;
  readonly moneyDay: string;
  readonly invoiceDay: string;
  readonly currencies: ReadonlySet<string>;
}

export interface LaterAllocationDayDeps {
  readonly periods: Pick<FiscalPeriodRepository, "findByDate"> & Partial<Pick<FiscalPeriodRepository, "list">>;
  readonly ledger: Pick<LedgerRepository, "list">;
}

// INVARIANT: only a day nobody chose falls forward (past a closed period, past a run that still stands for the currency); a day asked for by name is taken as sent or refused.
export async function laterAllocationDay(input: LaterAllocationDayInput, deps: LaterAllocationDayDeps): Promise<string> {
  const earliest = laterDay(input.moneyDay.slice(0, 10), input.invoiceDay.slice(0, 10));
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
