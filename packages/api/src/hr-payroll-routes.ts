import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  Money,
  advanceOutstanding,
  advanceRecovered,
  approveEmployeeAdvance,
  approvePayrollRun,
  calculatePayrollRun,
  cancelPayrollRun,
  createEmployeeDirectory,
  createPayrollRun,
  disburseEmployeeAdvance,
  disbursePayrollRun,
  employeeOutstandingBalance,
  rejectEmployeeAdvance,
  requestEmployeeAdvance,
  CashBalanceWouldGoNegativeError,
  DuplicatePayrollPeriodError,
  EmployeeAdvanceNotFoundError,
  EmployeeNotFoundError,
  InvalidEmployeeAdvanceError,
  InvalidEmployeeAdvanceTransitionError,
  InvalidPayrollRunError,
  InvalidPayrollRunTransitionError,
  NegativeNetPayError,
  NoFiscalPeriodForDateError,
  NoPayableEmployeesError,
  PayrollRunNotFoundError,
  PeriodNotOpenForPostingError,
  TreasuryDisbursementUnavailableError,
  UnbalancedEntryError,
  type EmployeeAdvance,
  type EmployeeAdvanceRepository,
  type EmployeeRepository,
  type ContractRepository,
  type JournalPostingDeps,
  type PayrollGlAccounts,
  type PayrollRun,
  type PayrollRunRepository,
  type Payslip,
  type PayslipRepository,
  type TreasuryDisbursementPort,
  type UnpaidLeaveDaysProvider,
} from "@mezan/domain";
import { createEmployeeAdvanceSchema, createPayrollRunSchema, treasuryDisbursementSchema } from "@mezan/contracts";
import { createPermissionGate, getAuthContext, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * Payroll + employee-advance routes (docs/catalog/06-crm-hr.md "الرواتب" and
 * "سلف الموظفين"). Paths are root-relative — a parent app mounts this router
 * under `/hr` alongside the master-data and time/leave HR routers.
 *
 * Gated on the existing `hr.advance.*` / `hr.payroll.*` permission codes from
 * `packages/domain/src/permissions/catalog.ts`.
 */
export interface HrPayrollRoutesDeps {
  readonly advances: EmployeeAdvanceRepository;
  readonly runs: PayrollRunRepository;
  readonly payslips: PayslipRepository;
  readonly employees: EmployeeRepository;
  readonly contracts: ContractRepository;
  readonly gl: JournalPostingDeps;
  readonly accounts: PayrollGlAccounts;
  /** Same shape as `NextNumberService.next(code)`. */
  readonly numbering: { next(code: string): Promise<{ readonly formatted: string }> };
  /** Bound to the treasury voucher engine; absent = disbursement endpoints answer 409. */
  readonly treasury?: TreasuryDisbursementPort;
  /** Bound by the attendance/leave side of HR; absent = no unpaid-leave day is deducted. */
  readonly unpaidLeave?: UnpaidLeaveDaysProvider;
  readonly idGen?: () => string;
}

function serializeAdvance(a: EmployeeAdvance) {
  return {
    id: a.id,
    number: a.number,
    employeeId: a.employeeId,
    amount: a.amount.toString(),
    currency: a.currency,
    installmentCount: a.installmentCount,
    firstDeductionDate: a.firstDeductionDate,
    reason: a.reason,
    installments: a.installments.map((i) => ({
      seq: i.seq,
      dueDate: i.dueDate,
      amount: i.amount.toString(),
      recovered: i.recovered.toString(),
    })),
    outstanding: advanceOutstanding(a).toString(),
    recovered: advanceRecovered(a).toString(),
    status: a.status,
    requestedAt: a.requestedAt,
    decidedAt: a.decidedAt,
    decidedBy: a.decidedBy,
    disbursedAt: a.disbursedAt,
    disbursementVoucherId: a.disbursementVoucherId,
    disbursementJournalEntryId: a.disbursementJournalEntryId,
    repaidAt: a.repaidAt,
    createdAt: a.createdAt,
  };
}

function serializePayslip(p: Payslip) {
  return {
    id: p.id,
    number: p.number,
    runId: p.runId,
    employeeId: p.employeeId,
    contractId: p.contractId,
    currency: p.currency,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    periodDays: p.periodDays,
    paidDays: p.paidDays,
    lines: p.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      source: l.source,
      nameAr: l.nameAr,
      amount: l.amount.toString(),
      glAccountId: l.glAccountId,
      referenceId: l.referenceId,
    })),
    grossEarnings: p.grossEarnings.toString(),
    totalDeductions: p.totalDeductions.toString(),
    employerContributions: p.employerContributions.toString(),
    netPay: p.netPay.toString(),
    createdAt: p.createdAt,
  };
}

function serializeRun(r: PayrollRun) {
  return {
    id: r.id,
    number: r.number,
    year: r.year,
    month: r.month,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    branchId: r.branchId,
    currency: r.currency,
    status: r.status,
    employeeCount: r.employeeCount,
    totalGross: r.totalGross.toString(),
    totalDeductions: r.totalDeductions.toString(),
    totalEmployerContributions: r.totalEmployerContributions.toString(),
    totalNet: r.totalNet.toString(),
    unpaidLeaveSource: r.unpaidLeaveSource,
    warnings: r.warnings,
    journalEntryId: r.journalEntryId,
    disbursementVoucherId: r.disbursementVoucherId,
    calculatedAt: r.calculatedAt,
    approvedAt: r.approvedAt,
    approvedBy: r.approvedBy,
    disbursedAt: r.disbursedAt,
    cancelledAt: r.cancelledAt,
    createdAt: r.createdAt,
  };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof EmployeeAdvanceNotFoundError || err instanceof PayrollRunNotFoundError || err instanceof EmployeeNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof TreasuryDisbursementUnavailableError) {
    return c.json({ error: err.code, message: "لم يتم إعداد مسار الصرف من الخزينة." }, 409);
  }
  if (
    err instanceof CashBalanceWouldGoNegativeError ||
    err instanceof NoFiscalPeriodForDateError ||
    err instanceof PeriodNotOpenForPostingError ||
    err instanceof UnbalancedEntryError ||
    err instanceof InvalidEmployeeAdvanceError ||
    err instanceof InvalidEmployeeAdvanceTransitionError ||
    err instanceof InvalidPayrollRunError ||
    err instanceof InvalidPayrollRunTransitionError ||
    err instanceof DuplicatePayrollPeriodError ||
    err instanceof NoPayableEmployeesError ||
    err instanceof NegativeNetPayError
  ) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

function actorOf(c: Context): string {
  return getAuthContext(c)?.userId ?? "system";
}

export function createHrPayrollRoutes(deps: HrPayrollRoutesDeps, resolveAuthContext: AuthContextResolver = headerAuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? randomUUID;
  const directory = createEmployeeDirectory(deps.employees);

  const calculationDeps = {
    runs: deps.runs,
    payslips: deps.payslips,
    employees: directory,
    contracts: deps.contracts,
    advances: deps.advances,
    numbering: deps.numbering,
    unpaidLeave: deps.unpaidLeave,
    idGen,
  };

  // --- Employee advances ---------------------------------------------------

  app.get("/advances", gate("hr.advance.view"), async (c) => {
    const employeeId = c.req.query("employeeId");
    const rows = employeeId ? await deps.advances.listByEmployeeId(employeeId) : await deps.advances.list();
    return c.json(rows.map(serializeAdvance));
  });

  app.get("/advances/outstanding", gate("hr.advance.view"), async (c) => {
    const all = await deps.advances.list();
    const byEmployee = new Map<string, EmployeeAdvance[]>();
    for (const advance of all) {
      const bucket = byEmployee.get(advance.employeeId);
      if (bucket) bucket.push(advance);
      else byEmployee.set(advance.employeeId, [advance]);
    }
    return c.json(
      [...byEmployee.entries()].map(([employeeId, rows]) => ({
        employeeId,
        outstanding: employeeOutstandingBalance(rows).toString(),
        advanceCount: rows.filter((r) => r.status === "disbursed").length,
      })),
    );
  });

  app.get("/advances/:id", gate("hr.advance.view"), async (c) => {
    const advance = await deps.advances.findById(c.req.param("id"));
    if (!advance) return c.json({ error: "EMPLOYEE_ADVANCE_NOT_FOUND" }, 404);
    return c.json(serializeAdvance(advance));
  });

  app.post("/advances", gate("hr.advance.create"), async (c) => {
    const parsed = createEmployeeAdvanceSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const employee = await deps.employees.findById(parsed.data.employeeId);
      if (!employee) throw new EmployeeNotFoundError(parsed.data.employeeId);
      const number = (await deps.numbering.next("EMPLOYEE_ADVANCE")).formatted;
      const advance = await requestEmployeeAdvance(
        {
          id: parsed.data.id ?? idGen(),
          number,
          employeeId: parsed.data.employeeId,
          amount: Money.fromMajor(parsed.data.amount),
          currency: parsed.data.currency,
          installmentCount: parsed.data.installmentCount,
          firstDeductionDate: parsed.data.firstDeductionDate,
          reason: parsed.data.reason ?? null,
        },
        deps.advances,
      );
      return c.json(serializeAdvance(advance), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/advances/:id/approve", gate("hr.advance.approve"), async (c) => {
    const advance = await deps.advances.findById(c.req.param("id"));
    if (!advance) return c.json({ error: "EMPLOYEE_ADVANCE_NOT_FOUND" }, 404);
    try {
      const next = approveEmployeeAdvance(advance, actorOf(c));
      await deps.advances.update(next);
      return c.json(serializeAdvance(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/advances/:id/reject", gate("hr.advance.approve"), async (c) => {
    const advance = await deps.advances.findById(c.req.param("id"));
    if (!advance) return c.json({ error: "EMPLOYEE_ADVANCE_NOT_FOUND" }, 404);
    try {
      const next = rejectEmployeeAdvance(advance, actorOf(c));
      await deps.advances.update(next);
      return c.json(serializeAdvance(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/advances/:id/disburse", gate("hr.advance.approve"), async (c) => {
    const parsed = treasuryDisbursementSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const advance = await disburseEmployeeAdvance(c.req.param("id"), parsed.data, {
        advances: deps.advances,
        treasury: deps.treasury,
        accounts: deps.accounts,
        idGen,
      });
      return c.json(serializeAdvance(advance));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Payroll runs --------------------------------------------------------

  app.get("/payroll/runs", gate("hr.payroll.view"), async (c) => {
    return c.json((await deps.runs.list()).map(serializeRun));
  });

  app.get("/payroll/payslips", gate("hr.payroll.view"), async (c) => {
    const runId = c.req.query("runId");
    const employeeId = c.req.query("employeeId");
    if (runId) return c.json((await deps.payslips.listByRunId(runId)).map(serializePayslip));
    if (employeeId) return c.json((await deps.payslips.listByEmployeeId(employeeId)).map(serializePayslip));
    const runs = await deps.runs.list();
    const rows: Payslip[] = [];
    for (const run of runs) rows.push(...(await deps.payslips.listByRunId(run.id)));
    return c.json(rows.map(serializePayslip));
  });

  app.get("/payroll/runs/:id", gate("hr.payroll.view"), async (c) => {
    const run = await deps.runs.findById(c.req.param("id"));
    if (!run) return c.json({ error: "PAYROLL_RUN_NOT_FOUND" }, 404);
    const payslips = await deps.payslips.listByRunId(run.id);
    return c.json({ ...serializeRun(run), payslips: payslips.map(serializePayslip) });
  });

  app.post("/payroll/runs", gate("hr.payroll.create"), async (c) => {
    const parsed = createPayrollRunSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const run = await createPayrollRun(
        {
          id: parsed.data.id ?? idGen(),
          year: parsed.data.year,
          month: parsed.data.month,
          branchId: parsed.data.branchId ?? null,
          currency: parsed.data.currency,
        },
        { runs: deps.runs, numbering: deps.numbering },
      );
      return c.json(serializeRun(run), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/payroll/runs/:id/calculate", gate("hr.payroll.calculate"), async (c) => {
    try {
      const run = await calculatePayrollRun(c.req.param("id"), calculationDeps);
      const payslips = await deps.payslips.listByRunId(run.id);
      return c.json({ ...serializeRun(run), payslips: payslips.map(serializePayslip) });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/payroll/runs/:id/approve", gate("hr.payroll.approve"), async (c) => {
    try {
      const run = await approvePayrollRun(c.req.param("id"), actorOf(c), {
        runs: deps.runs,
        payslips: deps.payslips,
        advances: deps.advances,
        gl: deps.gl,
        accounts: deps.accounts,
      });
      return c.json(serializeRun(run));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/payroll/runs/:id/disburse", gate("hr.payroll.pay"), async (c) => {
    const parsed = treasuryDisbursementSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const run = await disbursePayrollRun(c.req.param("id"), parsed.data, {
        runs: deps.runs,
        treasury: deps.treasury,
        accounts: deps.accounts,
        idGen,
      });
      return c.json(serializeRun(run));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/payroll/runs/:id/cancel", gate("hr.payroll.void"), async (c) => {
    try {
      const run = await cancelPayrollRun(c.req.param("id"), { runs: deps.runs, payslips: deps.payslips });
      return c.json(serializeRun(run));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
