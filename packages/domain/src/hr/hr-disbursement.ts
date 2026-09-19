import { Money } from "../money/index.js";
import {
  advanceOutstanding,
  applyManualAdvanceRepayment,
  canTransitionAdvance,
  markEmployeeAdvanceDisbursed,
  type EmployeeAdvance,
  type EmployeeAdvanceRepository,
} from "./advance.js";
import { canTransitionPayrollRun, type PayrollGlAccounts, type PayrollRun, type PayrollRunRepository } from "./payroll-run.js";
import {
  AdvanceRepaymentExceedsOutstandingError,
  InvalidAdvanceRepaymentError,
  EmployeeAdvanceNotFoundError,
  InvalidEmployeeAdvanceError,
  InvalidEmployeeAdvanceTransitionError,
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
 *              — docs/archive/catalog/06 "السلفة دين على الموظف (أصل)")
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
  /** Money coming IN through a receipt voucher: Dr treasury / Cr the counterparty account. */
  receive?(request: TreasuryDisbursementRequest): Promise<TreasuryDisbursementResult>;
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
  // The state check must precede the treasury call: disbursing first and
  // asserting after paid an unapproved (or already-paid) advance out of the
  // safe and only then refused, leaving the cash gone and the advance reusable.
  if (!canTransitionAdvance(advance.status, "disbursed")) {
    throw new InvalidEmployeeAdvanceTransitionError(advance.status, "disbursed");
  }
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

function toPiasters(amount: Money): string {
  const [whole, fraction = ""] = amount.toString().split(".");
  return `${whole}.${fraction.slice(0, 2).padEnd(2, "0")}`;
}

export interface AdvanceRepaymentInput extends DisbursementInput {
  /** Caller-chosen idempotency key: a retry after a held voucher is approved must not repay twice. */
  readonly repaymentId: string;
  readonly amount: Money;
  readonly note?: string | null;
  readonly recordedBy: string;
}

export interface RepayAdvanceDeps {
  readonly advances: EmployeeAdvanceRepository;
  readonly treasury?: TreasuryDisbursementPort;
  readonly accounts: Pick<PayrollGlAccounts, "employeeAdvanceAccountId">;
  /** What calculated-but-unapproved payroll runs already deduct from this advance; approval re-applies it and must not exceed the balance. */
  readonly pendingPayrollRecovery?: (advanceId: string) => Promise<Money>;
  readonly now?: () => string;
}

/** Repays part or all of a disbursed advance in cash or by bank, outside payroll, through a receipt voucher (Dr treasury / Cr 1160). */
export async function repayEmployeeAdvance(advanceId: string, input: AdvanceRepaymentInput, deps: RepayAdvanceDeps): Promise<EmployeeAdvance> {
  const advance = await deps.advances.findById(advanceId);
  if (!advance) throw new EmployeeAdvanceNotFoundError(advanceId);
  if ((advance.repayments ?? []).some((r) => r.id === input.repaymentId)) return advance;
  if (advance.status !== "disbursed") throw new InvalidEmployeeAdvanceTransitionError(advance.status, "repaid");
  validateInput(input);
  if (input.amount.scaled <= 0n) {
    throw new InvalidAdvanceRepaymentError("مبلغ السداد يجب أن يكون أكبر من صفر.", "The repayment amount must be greater than zero.");
  }

  const outstanding = advanceOutstanding(advance);
  const pending = (await deps.pendingPayrollRecovery?.(advance.id)) ?? Money.zero();
  const repayable = Money.fromScaled(outstanding.scaled - pending.scaled > 0n ? outstanding.scaled - pending.scaled : 0n);
  if (input.amount.scaled > repayable.scaled) {
    throw new AdvanceRepaymentExceedsOutstandingError(
      toPiasters(input.amount),
      toPiasters(repayable),
      pending.scaled > 0n ? toPiasters(pending) : null,
    );
  }

  const treasury = requirePort(deps.treasury);
  if (!treasury.receive) throw new TreasuryDisbursementUnavailableError();
  const now = deps.now?.() ?? new Date().toISOString();
  const date = input.date ?? now.slice(0, 10);
  const result = await treasury.receive({
    id: `ADV-RV:${advance.id}:${input.repaymentId}`,
    date,
    memo: `سداد سلفة ${advance.number} خارج الرواتب`,
    amount: input.amount,
    counterpartyGlAccountId: deps.accounts.employeeAdvanceAccountId,
    treasuryAccountId: input.treasuryAccountId,
    branchId: input.branchId,
    paymentMethod: input.paymentMethod ?? "cash",
    referenceNo: input.referenceNo ?? advance.number,
  });

  const current = (await deps.advances.findById(advanceId)) ?? advance;
  if ((current.repayments ?? []).some((r) => r.id === input.repaymentId)) return current;
  const next = applyManualAdvanceRepayment(current, {
    id: input.repaymentId,
    date,
    amount: input.amount,
    paymentMethod: input.paymentMethod ?? "cash",
    treasuryAccountId: input.treasuryAccountId,
    voucherId: result.voucherId,
    voucherNo: result.voucherNo,
    journalEntryId: result.journalEntryId,
    note: input.note?.trim() ? input.note.trim() : null,
    recordedBy: input.recordedBy,
    recordedAt: now,
  });
  await deps.advances.update(next);
  return next;
}
