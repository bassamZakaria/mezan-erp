import type { Money } from "../money/index.js";
import { markEmployeeAdvanceDisbursed, type EmployeeAdvance, type EmployeeAdvanceRepository } from "./advance.js";
import { canTransitionPayrollRun, type PayrollGlAccounts, type PayrollRun, type PayrollRunRepository } from "./payroll-run.js";
import {
  EmployeeAdvanceNotFoundError,
  InvalidEmployeeAdvanceError,
  InvalidPayrollRunError,
  InvalidPayrollRunTransitionError,
  PayrollRunNotFoundError,
  TreasuryDisbursementUnavailableError,
} from "./errors.js";

/**
 * Cash going OUT for HR — an employee advance being paid, and an approved
 * payroll run being settled — moves through the EXISTING treasury voucher
 * engine, not a bespoke cash path: the voucher carries the cash-negative
 * guard, the CV- numbering, the workflow gate, the audit trail and the GL
 * posting every other treasury movement gets. This port is the seam; the
 * composition root binds it to a `VoucherService` (a "مصروف آخر" payment
 * voucher whose counterparty GL account is supplied here).
 *
 *   advance  : Dr 1160 سلف الموظفين  / Cr treasury  (an ASSET, never an expense
 *              — docs/catalog/06 "السلفة دين على الموظف (أصل)")
 *   payroll  : Dr 2170 رواتب مستحقة  / Cr treasury  (clears the accrued payable)
 */

export interface TreasuryDisbursementRequest {
  readonly id: string;
  readonly date: string;
  readonly memo: string;
  readonly amount: Money;
  /** The GL account debited against the treasury credit. */
  readonly counterpartyGlAccountId: string;
  readonly treasuryAccountId: string;
  readonly branchId: string;
  readonly paymentMethod?: "cash" | "bank" | "cheque" | "card" | "wallet";
  readonly referenceNo?: string | null;
}

export interface TreasuryDisbursementResult {
  readonly voucherId: string;
  readonly voucherNo: string | null;
  readonly journalEntryId: string | null;
}

export interface TreasuryDisbursementPort {
  disburse(request: TreasuryDisbursementRequest): Promise<TreasuryDisbursementResult>;
}

export interface DisbursementInput {
  readonly treasuryAccountId: string;
  readonly branchId: string;
  readonly date?: string;
  readonly paymentMethod?: TreasuryDisbursementRequest["paymentMethod"];
  readonly referenceNo?: string | null;
}

export interface DisburseAdvanceDeps {
  readonly advances: EmployeeAdvanceRepository;
  readonly treasury?: TreasuryDisbursementPort;
  readonly accounts: Pick<PayrollGlAccounts, "employeeAdvanceAccountId">;
  readonly idGen?: () => string;
  readonly now?: () => string;
}

function requirePort(port: TreasuryDisbursementPort | undefined): TreasuryDisbursementPort {
  if (!port) throw new TreasuryDisbursementUnavailableError();
  return port;
}

function validateInput(input: DisbursementInput): void {
  const reasons: string[] = [];
  if (input.treasuryAccountId.trim() === "") reasons.push("حساب الخزينة مطلوب");
  if (input.branchId.trim() === "") reasons.push("الفرع مطلوب");
  if (reasons.length > 0) throw new InvalidEmployeeAdvanceError(reasons);
}

/** Pays an approved advance out of treasury, recording the voucher on the advance. */
export async function disburseEmployeeAdvance(
  advanceId: string,
  input: DisbursementInput,
  deps: DisburseAdvanceDeps,
): Promise<EmployeeAdvance> {
  const advance = await deps.advances.findById(advanceId);
  if (!advance) throw new EmployeeAdvanceNotFoundError(advanceId);
  validateInput(input);
  const treasury = requirePort(deps.treasury);

  const now = deps.now?.() ?? new Date().toISOString();
  const result = await treasury.disburse({
    id: deps.idGen?.() ?? `ADV-CV:${advance.id}`,
    date: input.date ?? now.slice(0, 10),
    memo: `صرف سلفة ${advance.number}`,
    amount: advance.amount,
    counterpartyGlAccountId: deps.accounts.employeeAdvanceAccountId,
    treasuryAccountId: input.treasuryAccountId,
    branchId: input.branchId,
    paymentMethod: input.paymentMethod ?? "cash",
    referenceNo: input.referenceNo ?? advance.number,
  });

  const disbursed = markEmployeeAdvanceDisbursed(advance, {
    voucherId: result.voucherId,
    journalEntryId: result.journalEntryId,
    now,
  });
  await deps.advances.update(disbursed);
  return disbursed;
}

export interface DisbursePayrollRunDeps {
  readonly runs: PayrollRunRepository;
  readonly treasury?: TreasuryDisbursementPort;
  readonly accounts: Pick<PayrollGlAccounts, "salariesPayableAccountId">;
  readonly idGen?: () => string;
  readonly now?: () => string;
}

/** Settles an approved run's net pay out of treasury, clearing رواتب مستحقة. */
export async function disbursePayrollRun(
  runId: string,
  input: DisbursementInput,
  deps: DisbursePayrollRunDeps,
): Promise<PayrollRun> {
  const run = await deps.runs.findById(runId);
  if (!run) throw new PayrollRunNotFoundError(runId);
  if (!canTransitionPayrollRun(run.status, "disbursed")) {
    throw new InvalidPayrollRunTransitionError(run.status, "disbursed");
  }
  if (input.treasuryAccountId.trim() === "" || input.branchId.trim() === "") {
    throw new InvalidPayrollRunError(["حساب الخزينة والفرع مطلوبان"]);
  }
  if (run.totalNet.scaled <= 0n) {
    throw new InvalidPayrollRunError(["صافي الرواتب يجب أن يكون أكبر من صفر للصرف"]);
  }
  const treasury = requirePort(deps.treasury);

  const now = deps.now?.() ?? new Date().toISOString();
  const result = await treasury.disburse({
    id: deps.idGen?.() ?? `PAYROLL-CV:${run.id}`,
    date: input.date ?? run.periodEnd,
    memo: `صرف رواتب ${run.number}`,
    amount: run.totalNet,
    counterpartyGlAccountId: deps.accounts.salariesPayableAccountId,
    treasuryAccountId: input.treasuryAccountId,
    branchId: input.branchId,
    paymentMethod: input.paymentMethod ?? "bank",
    referenceNo: input.referenceNo ?? run.number,
  });

  const disbursed: PayrollRun = {
    ...run,
    status: "disbursed",
    disbursementVoucherId: result.voucherId,
    disbursedAt: now,
  };
  await deps.runs.update(disbursed);
  return disbursed;
}
