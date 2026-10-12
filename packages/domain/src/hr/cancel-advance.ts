import { recordSensitiveEvent } from "../audit/index.js";
import type { JournalPostingDeps } from "../gl/index.js";
import { EmployeeAdvanceStatusCode, advanceRecovered, type EmployeeAdvance, type EmployeeAdvanceRepository } from "./advance.js";
import { AdvancePartlyRepaidError, EmployeeAdvanceNotFoundError, InvalidEmployeeAdvanceTransitionError, TreasuryDisbursementUnavailableError } from "./errors.js";
import type { TreasuryDisbursementPort } from "./hr-disbursement.js";
import { isTerminationRecoveryEntry, undoTerminationRecovery, type TerminationRecoveryUndoDeps } from "./termination-recovery.js";

export interface CancelEmployeeAdvanceDeps {
  readonly advances: EmployeeAdvanceRepository;
  readonly treasury?: TreasuryDisbursementPort;
  readonly terminationRecovery: Omit<TerminationRecoveryUndoDeps, "advances" | "gl">;
  readonly gl: JournalPostingDeps;
}

export interface CancelEmployeeAdvanceOptions {
  readonly reversalId: string;
  readonly date?: string;
  readonly today: string;
}

function toPiasters(scaled: bigint): string {
  const whole = scaled / 1_000_000n;
  return `${whole}.${String((scaled % 1_000_000n) / 10_000n).padStart(2, "0")}`;
}

const CANCELLABLE_UNPAID: ReadonlySet<string> = new Set([EmployeeAdvanceStatusCode.Pending, EmployeeAdvanceStatusCode.Approved]);

export async function cancelEmployeeAdvance(advanceId: string, deps: CancelEmployeeAdvanceDeps, opts: CancelEmployeeAdvanceOptions): Promise<EmployeeAdvance> {
  const advance = await deps.advances.findById(advanceId);
  if (!advance) throw new EmployeeAdvanceNotFoundError(advanceId);
  const unpaid = CANCELLABLE_UNPAID.has(advance.status);
  if (!unpaid && advance.status !== EmployeeAdvanceStatusCode.Disbursed) {
    throw new InvalidEmployeeAdvanceTransitionError(advance.status, EmployeeAdvanceStatusCode.Cancelled);
  }
  const recovered = advanceRecovered(advance).scaled;
  if (recovered > 0n) throw new AdvancePartlyRepaidError(advance.number, toPiasters(recovered));
  const voucherId = advance.disbursementVoucherId;
  const raisedByTermination = !voucherId && isTerminationRecoveryEntry(advance.disbursementJournalEntryId);
  if (!unpaid && !voucherId && !raisedByTermination) throw new InvalidEmployeeAdvanceTransitionError(advance.status, EmployeeAdvanceStatusCode.Cancelled);
  const reverseVoucher = voucherId ? deps.treasury?.reverse : undefined;
  if (voucherId && !reverseVoucher) throw new TreasuryDisbursementUnavailableError();

  return deps.gl.ledger.transaction(async () => {
    if (voucherId && reverseVoucher) {
      await reverseVoucher(voucherId, { reversalId: opts.reversalId, date: opts.date, memo: `إلغاء السلفة ${advance.number}` });
    } else if (raisedByTermination) {
      await undoTerminationRecovery(advance.id, advance.employeeId, opts.today, { ...deps.terminationRecovery, advances: deps.advances, gl: deps.gl }, `إلغاء السلفة ${advance.number} — عكس تسوية أجر إنهاء الخدمة`);
    }
    const cancelled: EmployeeAdvance = {
      ...((await deps.advances.findById(advance.id)) ?? advance),
      status: EmployeeAdvanceStatusCode.Cancelled,
      disbursedAt: voucherId ? null : advance.disbursedAt,
      disbursementVoucherId: null,
      disbursementJournalEntryId: voucherId ? null : advance.disbursementJournalEntryId,
    };
    await deps.advances.update(cancelled);
    if (deps.gl.audit) {
      await recordSensitiveEvent(deps.gl.audit, {
        module: "hr",
        entityType: "EMPLOYEE_ADVANCE",
        entityId: advance.id,
        action: "CANCEL",
        actor: deps.gl.actor ?? "system",
        severity: "WARNING",
        details: { advanceId: advance.id, number: advance.number, employeeId: advance.employeeId, amount: advance.amount.toString(), from: advance.status, disbursementVoucherId: voucherId, disbursementJournalEntryId: advance.disbursementJournalEntryId },
      });
    }
    return cancelled;
  });
}
