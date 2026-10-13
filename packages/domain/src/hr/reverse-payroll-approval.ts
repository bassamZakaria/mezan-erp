import { recordSensitiveEvent } from "../audit/index.js";
import { ReversalDateBeforeOriginalError, reverseJournalEntry, type JournalPostingDeps } from "../gl/index.js";
import { Money } from "../money/index.js";
import { reverseAdvanceRecovery, type EmployeeAdvanceRepository } from "./advance.js";
import { EmployeeAdvanceNotFoundError, GarnishmentNotFoundError, PayrollRunDisbursedError, PayrollRunHasTerminationAdjustmentError, PayrollRunNotApprovedError, PayrollRunNotFoundError } from "./errors.js";
import { reverseGarnishmentRecovery, type GarnishmentRepository } from "./garnishment.js";
import { PayrollRunStatusCode, PayslipLineSourceCode, type PayrollRun, type PayrollRunRepository, type Payslip, type PayslipRepository } from "./payroll-run.js";

export interface ReversePayrollApprovalDeps {
  readonly runs: PayrollRunRepository;
  readonly payslips: Pick<PayslipRepository, "listByRunId">;
  readonly advances: Pick<EmployeeAdvanceRepository, "findById" | "update">;
  readonly garnishments?: Pick<GarnishmentRepository, "findById" | "update">;
  readonly gl: JournalPostingDeps;
  readonly now?: () => string;
}

export interface ReversePayrollApprovalOptions {
  readonly reversalId: string;
  readonly date?: string;
  readonly memo?: string;
}

function withheldBy(payslips: readonly Payslip[], source: string): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const payslip of payslips) {
    for (const line of payslip.lines) {
      if (line.source !== source || line.referenceId === null) continue;
      totals.set(line.referenceId, (totals.get(line.referenceId) ?? 0n) + line.amount.scaled);
    }
  }
  return totals;
}

export async function reversePayrollRunApproval(runId: string, deps: ReversePayrollApprovalDeps, opts: ReversePayrollApprovalOptions): Promise<PayrollRun> {
  const run = await deps.runs.findById(runId);
  if (!run) throw new PayrollRunNotFoundError(runId);
  if (run.status === PayrollRunStatusCode.Disbursed) throw new PayrollRunDisbursedError(run.number, run.disbursementVoucherId);
  if (run.status !== PayrollRunStatusCode.Approved || !run.journalEntryId) throw new PayrollRunNotApprovedError(run.number, run.status);
  const entryId = run.journalEntryId;
  const payslips = await deps.payslips.listByRunId(run.id);
  if (payslips.some((payslip) => payslip.lines.some((line) => line.source === PayslipLineSourceCode.TerminationAdjustment))) {
    throw new PayrollRunHasTerminationAdjustmentError(run.number);
  }
  const original = await deps.gl.ledger.findById(entryId);
  const date = opts.date ?? original?.date.slice(0, 10);
  if (original && date !== undefined && date < original.date.slice(0, 10)) throw new ReversalDateBeforeOriginalError(entryId, date, original.date);

  return deps.gl.ledger.transaction(async () => {
    const { reversal } = await reverseJournalEntry(entryId, deps.gl, {
      reversalId: opts.reversalId,
      date,
      memo: opts.memo ?? `إلغاء اعتماد رواتب ${run.number}`,
    });
    for (const [advanceId, scaled] of withheldBy(payslips, PayslipLineSourceCode.AdvanceRecovery)) {
      const advance = await deps.advances.findById(advanceId);
      if (!advance) throw new EmployeeAdvanceNotFoundError(advanceId);
      await deps.advances.update(reverseAdvanceRecovery(advance, Money.fromScaled(scaled)));
    }
    if (deps.garnishments) {
      for (const [orderId, scaled] of withheldBy(payslips, PayslipLineSourceCode.Garnishment)) {
        const order = await deps.garnishments.findById(orderId);
        if (!order) throw new GarnishmentNotFoundError(orderId);
        await deps.garnishments.update(reverseGarnishmentRecovery(order, Money.fromScaled(scaled), deps.now));
      }
    }
    const calculated: PayrollRun = { ...run, status: PayrollRunStatusCode.Calculated, journalEntryId: null, approvedAt: null, approvedBy: null };
    await deps.runs.update(calculated);
    if (deps.gl.audit) {
      await recordSensitiveEvent(deps.gl.audit, {
        module: "hr",
        entityType: "PAYROLL_RUN",
        entityId: run.id,
        action: "REVERSE_APPROVAL",
        actor: deps.gl.actor ?? "system",
        severity: "WARNING",
        details: { runId: run.id, number: run.number, totalNet: run.totalNet.toString(), journalEntryId: entryId, reversalId: reversal.id, reversalNo: reversal.entryNo ?? null, date: reversal.date },
      });
    }
    return calculated;
  });
}

export async function unwindPayrollDisbursementVoucher(voucherId: string, deps: { readonly runs: Pick<PayrollRunRepository, "list" | "update"> }): Promise<boolean> {
  const run = (await deps.runs.list()).find((candidate) => candidate.disbursementVoucherId === voucherId && candidate.status === PayrollRunStatusCode.Disbursed);
  if (!run) return false;
  await deps.runs.update({ ...run, status: PayrollRunStatusCode.Approved, disbursementVoucherId: null, disbursedAt: null });
  return true;
}
