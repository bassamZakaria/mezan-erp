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
  createPayrollComponent,
  updatePayrollComponent,
  disburseEmployeeAdvance,
  disbursePayrollRun,
  employeeOutstandingBalance,
  rejectEmployeeAdvance,
  requestEmployeeAdvance,
  CashBalanceWouldGoNegativeError,
  DuplicatePayrollPeriodError,
  DuplicatePayrollComponentError,
  InvalidPayrollComponentError,
  EmployeeAdvanceNotFoundError,
  EmployeeNotFoundError,
  InvalidEmployeeAdvanceError,
  InvalidEmployeeAdvanceTransitionError,
  InvalidPayrollRunError,
  InvalidPayrollRunTransitionError,
  NegativeNetPayError,
  StatutoryRulesUnavailableError,
  InvalidGarnishmentError,
  GarnishmentNotFoundError,
  createGarnishment,
  createGarnishmentProvider,
  releaseGarnishment,
  listEgyptStatutoryTables,
  formatRateBp,
  totalShareBp,
  NoFiscalPeriodForDateError,
  NoPayableEmployeesError,
  PayrollRunNotFoundError,
  PeriodNotOpenForPostingError,
  TreasuryDisbursementHeldError,
  TreasuryDisbursementUnavailableError,
  UnbalancedEntryError,
  type EmployeeAdvance,
  type EmployeeAdvanceRepository,
  type EmployeeRepository,
  type GarnishmentProvider,
  type GarnishmentRecord,
  type GarnishmentRepository,
  type SocialInsuranceYearOverride,
  type StatutoryOverrideRepository,
  type LedgerRepository,
  type LeaveBalanceRepository,
  type LeavePolicyRepository,
  type HrProvisionKind,
  getHrProvisionDefinition,
  hrProvisionMovement,
  postHrProvision,
  createEndOfServiceProvisionReport,
  createLeaveLiabilityReport,
  runReport,
  type OvertimeHoursProvider,
  type PayrollDayDivisorBasis,
  type SettingsRepository,
  type WorkedTimeProvider,
  type ContractRepository,
  type JournalPostingDeps,
  type PayrollComponent,
  type PayrollComponentKind,
  type PayrollComponentRepository,
  type PayrollGlAccounts,
  type PayrollRun,
  type PayrollRunRepository,
  type Payslip,
  type PayslipRepository,
  type TreasuryDisbursementPort,
  type UnpaidLeaveDaysProvider,
} from "@mezan/domain";
import {
  createEmployeeAdvanceSchema,
  createPayrollRunSchema,
  createGarnishmentSchema,
  upsertSocialInsuranceYearSchema,
  createPayrollComponentSchema,
  updatePayrollComponentSchema,
  treasuryDisbursementSchema,
} from "@mezan/contracts";
import { createPermissionGate, getAuthContext, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * Payroll + employee-advance routes (docs/archive/catalog/06-crm-hr.md "الرواتب" and
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
  /** Bound to attendance; absent = no overtime is paid and the run says so. */
  readonly overtime?: OvertimeHoursProvider;
  /** Bound to attendance; required before an hourly or daily contract can be paid. */
  readonly workedTime?: WorkedTimeProvider;
  /**
   * The garnishment register (الحجز على الأجر). Supplying it mounts its routes,
   * feeds payroll's deduction seam and counts each order down as payroll
   * withholds — the three go together, so a register can never be half-wired.
   */
  readonly garnishmentRegister?: GarnishmentRepository;
  /** Overrides the register-derived provider; for tests and alternative sources. */
  readonly garnishments?: GarnishmentProvider;
  /**
   * Tenant settings, read PER CALCULATION rather than captured at wiring time —
   * a day-divisor changed in the settings screen has to reach the next run
   * without a restart, which is exactly the gap that made seven policy toggles
   * stored-but-never-read before.
   */
  readonly settings?: Pick<SettingsRepository, "get">;
  /**
   * Insurance limits an admin entered for a year the shipped tables predate.
   * Supplying it mounts the routes AND feeds the calculation — the two go
   * together, so the screen can never edit a figure payroll does not read.
   */
  readonly statutoryOverrides?: StatutoryOverrideRepository;
  /**
   * Read side of the two HR obligation provisions. Supplying `ledger` mounts
   * the provision routes: without the ledger there is no posted balance to
   * compare the computed obligation against, and posting the TOTAL rather than
   * the movement would double the liability every month.
   */
  readonly ledger?: Pick<LedgerRepository, "list">;
  readonly leave?: {
    readonly balances: Pick<LeaveBalanceRepository, "list">;
    readonly policies: Pick<LeavePolicyRepository, "list">;
  };
  /** Overrides the settings-derived basis; for tests. */
  readonly dayDivisorBasis?: PayrollDayDivisorBasis;
  readonly standardDailyHours?: number;
  /** The payroll-component registry (R10.7); absent = the component routes are not mounted and every line posts to the run defaults. */
  readonly payrollComponents?: PayrollComponentRepository;
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
    insurableWage: p.insurableWage.toString(),
    insurableWageCapped: p.insurableWageCapped,
    annualTaxableIncome: p.annualTaxableIncome.toString(),
    totalEmployerCost: p.totalEmployerCost.toString(),
    createdAt: p.createdAt,
  };
}

function serializeGarnishment(g: GarnishmentRecord) {
  return {
    id: g.id,
    employeeId: g.employeeId,
    kind: g.kind,
    reference: g.reference,
    labelAr: g.labelAr,
    totalAmount: g.totalAmount.toString(),
    monthlyAmount: g.monthlyAmount.toString(),
    outstanding: g.outstanding.toString(),
    recovered: g.recovered.toString(),
    currency: g.currency,
    startDate: g.startDate,
    endDate: g.endDate,
    notes: g.notes,
    active: g.active,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
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
    totalEmployerCost: r.totalEmployerCost.toString(),
    unpaidLeaveSource: r.unpaidLeaveSource,
    overtimeSource: r.overtimeSource,
    statutoryTableCodes: r.statutoryTableCodes,
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
  if (
    err instanceof EmployeeAdvanceNotFoundError ||
    err instanceof PayrollRunNotFoundError ||
    err instanceof EmployeeNotFoundError ||
    err instanceof GarnishmentNotFoundError
  ) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof TreasuryDisbursementUnavailableError) {
    return c.json({ error: err.code, message: "لم يتم إعداد مسار الصرف من الخزينة." }, 409);
  }
  if (err instanceof TreasuryDisbursementHeldError) {
    return c.json({ error: err.code, message: err.message, voucherId: err.voucherId }, 409);
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
    err instanceof NegativeNetPayError ||
    err instanceof StatutoryRulesUnavailableError ||
    err instanceof InvalidGarnishmentError ||
    err instanceof InvalidPayrollComponentError ||
    err instanceof DuplicatePayrollComponentError
  ) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

function actorOf(c: Context): string {
  return getAuthContext(c)?.userId ?? "system";
}

function serializeComponent(component: PayrollComponent) {
  return {
    id: component.id,
    code: component.code,
    nameAr: component.nameAr,
    nameEn: component.nameEn,
    kind: component.kind,
    glAccountId: component.glAccountId,
    active: component.active,
    createdAt: component.createdAt,
    updatedAt: component.updatedAt,
  };
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
    overtime: deps.overtime,
    workedTime: deps.workedTime,
    garnishments: deps.garnishments ?? (deps.garnishmentRegister ? createGarnishmentProvider(deps.garnishmentRegister) : undefined),
    payrollComponents: deps.payrollComponents,
    statutoryOverrides: deps.statutoryOverrides,
    idGen,
  };

  /** The calculation deps plus whatever the tenant's settings say right now. */
  async function currentCalculationDeps() {
    const settings = await deps.settings?.get();
    return {
      ...calculationDeps,
      dayDivisorBasis: deps.dayDivisorBasis ?? settings?.payrollDayDivisorBasis ?? "FIXED_30",
      standardDailyHours: deps.standardDailyHours ?? settings?.standardDailyWorkHours,
    };
  }

  // --- Payroll components (GL routing) -------------------------------------

  const components = deps.payrollComponents;
  if (components) {
    app.get("/payroll/components", gate("hr.payroll.view"), async (c) => {
      const kind = c.req.query("kind");
      const rows = await components.list(kind ? { kind: kind as PayrollComponentKind } : undefined);
      return c.json(rows.map(serializeComponent));
    });

    app.post("/payroll/components", gate("hr.payroll.create"), async (c) => {
      const parsed = createPayrollComponentSchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
      try {
        const existing = await components.findByCode(parsed.data.code.trim());
        if (existing) throw new DuplicatePayrollComponentError(parsed.data.code);
        const component = createPayrollComponent({ ...parsed.data, id: parsed.data.id ?? idGen() });
        await components.create(component);
        return c.json(serializeComponent(component), 201);
      } catch (err) {
        return handleDomainError(c, err);
      }
    });

    app.put("/payroll/components/:id", gate("hr.payroll.create"), async (c) => {
      const parsed = updatePayrollComponentSchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
      const current = await components.findById(c.req.param("id"));
      if (!current) return c.json({ error: "PAYROLL_COMPONENT_NOT_FOUND" }, 404);
      try {
        const next = updatePayrollComponent(current, parsed.data);
        await components.update(next);
        return c.json(serializeComponent(next));
      } catch (err) {
        return handleDomainError(c, err);
      }
    });
  }

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

  // --- HR provisions (ترحيل المخصصات) --------------------------------------

  /**
   * End-of-service gratuity and payable leave accrue every month and appear
   * NOWHERE in the ledger until somebody resigns. Their reports could compute
   * them exactly and still reconcile to zero forever — a report standing in for
   * a fact the books never recorded, and a balance sheet understated by the
   * whole obligation.
   *
   * These two routes post the MOVEMENT: the difference between the obligation
   * now and what the liability account already carries. The computed figure
   * comes from the SAME report definition the screen renders, so the entry and
   * the report are one number rather than two that ought to agree.
   */
  const ledger = deps.ledger;
  if (ledger) {
    const leave = deps.leave;

    async function provisionState(kind: HrProvisionKind, asOfDate: string) {
      const definition = getHrProvisionDefinition(kind);
      const entries = await ledger!.list({ status: "posted" });
      let balance = 0n;
      for (const entry of entries) {
        for (const line of entry.lines) {
          if (line.accountId !== definition.liabilityAccountId) continue;
          balance += line.credit.scaled - line.debit.scaled;
        }
      }
      const postedBalance = Money.fromScaled(balance);

      const employees = await deps.employees.list();
      const contracts = await deps.contracts.list();
      let computedTotal = Money.zero();
      if (kind === "end_of_service") {
        const outcome = runReport(createEndOfServiceProvisionReport(), { asOfDate }, { employees, contracts });
        if (outcome.ok) computedTotal = Money.fromMajor(outcome.rows.reduce((sum, row) => sum + row.provision, 0).toFixed(2));
      } else if (leave) {
        const outcome = runReport(createLeaveLiabilityReport(), { asOfDate }, {
          employees,
          contracts,
          balances: await leave.balances.list(),
          policies: await leave.policies.list(),
        });
        if (outcome.ok) computedTotal = Money.fromMajor(outcome.rows.reduce((sum, row) => sum + row.liability, 0).toFixed(2));
      }
      return { definition, postedBalance, computedTotal };
    }

    function parseKind(raw: string): HrProvisionKind | null {
      return raw === "end_of_service" || raw === "leave" ? raw : null;
    }

    app.get("/payroll/provisions/:kind/preview", gate("hr.payroll.view"), async (c) => {
      const kind = parseKind(c.req.param("kind"));
      if (!kind) return c.json({ error: "UNKNOWN_PROVISION", message: "نوع المخصص غير معروف." }, 404);
      if (kind === "leave" && !leave) return c.json({ error: "LEAVE_NOT_CONFIGURED", message: "لم تُضبط سياسات وأرصدة الإجازات بعد." }, 409);
      const asOfDate = c.req.query("asOfDate") ?? new Date().toISOString().slice(0, 10);
      const { definition, postedBalance, computedTotal } = await provisionState(kind, asOfDate);
      return c.json({
        kind,
        asOfDate,
        labelAr: definition.labelAr,
        expenseAccountId: definition.expenseAccountId,
        liabilityAccountId: definition.liabilityAccountId,
        computedTotal: computedTotal.toString(),
        postedBalance: postedBalance.toString(),
        movement: hrProvisionMovement(computedTotal, postedBalance).toString(),
      });
    });

    app.post("/payroll/provisions/:kind", gate("hr.payroll.approve"), async (c) => {
      const kind = parseKind(c.req.param("kind"));
      if (!kind) return c.json({ error: "UNKNOWN_PROVISION", message: "نوع المخصص غير معروف." }, 404);
      if (kind === "leave" && !leave) return c.json({ error: "LEAVE_NOT_CONFIGURED", message: "لم تُضبط سياسات وأرصدة الإجازات بعد." }, 409);
      const body = (await c.req.json().catch(() => ({}))) as { asOfDate?: string };
      const asOfDate = body.asOfDate ?? new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return c.json({ error: "VALIDATION_ERROR", message: "تاريخ غير صالح." }, 400);

      const { definition, postedBalance, computedTotal } = await provisionState(kind, asOfDate);
      try {
        const result = await postHrProvision({ kind, asOfDate, computedTotal, postedBalance }, { gl: deps.gl });
        return c.json({
          kind: result.kind,
          asOfDate: result.asOfDate,
          labelAr: definition.labelAr,
          computedTotal: result.computedTotal.toString(),
          previousBalance: result.previousBalance.toString(),
          movement: result.movement.toString(),
          journalEntryId: result.journalEntryId,
        });
      } catch (err) {
        if (
          err instanceof InvalidPayrollRunError ||
          err instanceof NoFiscalPeriodForDateError ||
          err instanceof PeriodNotOpenForPostingError ||
          err instanceof UnbalancedEntryError
        ) {
          return c.json({ error: err.code, message: err.message }, 422);
        }
        throw err;
      }
    });
  }

  // --- Garnishments (الحجز على الأجر) -------------------------------------

  const garnishmentRegister = deps.garnishmentRegister;
  if (garnishmentRegister) {
    app.get("/payroll/garnishments", gate("hr.payroll.view"), async (c) => {
      const employeeId = c.req.query("employeeId") ?? null;
      const activeParam = c.req.query("active");
      const rows = await garnishmentRegister.list({
        employeeId,
        active: activeParam === undefined ? null : activeParam === "true",
      });
      return c.json(rows.map(serializeGarnishment));
    });

    app.get("/payroll/garnishments/:id", gate("hr.payroll.view"), async (c) => {
      const row = await garnishmentRegister.findById(c.req.param("id"));
      if (!row) return c.json({ error: "GARNISHMENT_NOT_FOUND" }, 404);
      return c.json(serializeGarnishment(row));
    });

    app.post("/payroll/garnishments", gate("hr.payroll.create"), async (c) => {
      const parsed = createGarnishmentSchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
      // The employee is resolved against the real register before anything is
      // written: an order against an id nobody holds is a deduction nobody owns.
      if (!(await deps.employees.findById(parsed.data.employeeId))) {
        return c.json({ error: "EMPLOYEE_NOT_FOUND", message: "الموظف غير موجود." }, 404);
      }
      try {
        const record = createGarnishment({
          ...parsed.data,
          id: parsed.data.id ?? idGen(),
          totalAmount: Money.fromMajor(parsed.data.totalAmount),
          monthlyAmount: Money.fromMajor(parsed.data.monthlyAmount),
          endDate: parsed.data.endDate ?? null,
          notes: parsed.data.notes ?? null,
        });
        await garnishmentRegister.create(record);
        return c.json(serializeGarnishment(record), 201);
      } catch (err) {
        return handleDomainError(c, err);
      }
    });

    app.post("/payroll/garnishments/:id/release", gate("hr.payroll.create"), async (c) => {
      const current = await garnishmentRegister.findById(c.req.param("id"));
      if (!current) return c.json({ error: "GARNISHMENT_NOT_FOUND" }, 404);
      const next = releaseGarnishment(current);
      await garnishmentRegister.update(next);
      return c.json(serializeGarnishment(next));
    });
  }

  // The dated legal tables payroll computes against. Read-only and public to
  // anyone who can see payroll: an accountant must be able to check the ceiling
  // the system used against the gazette without opening the source.
  app.get("/payroll/statutory-tables", gate("hr.payroll.view"), async (c) => {
    const overrides = (await deps.statutoryOverrides?.list()) ?? [];
    const tables = listEgyptStatutoryTables(overrides);
    return c.json({
      incomeTax: tables.incomeTax.map((t) => ({
        code: t.code,
        effectiveFrom: t.effectiveFrom,
        effectiveTo: t.effectiveTo,
        citationAr: t.citationAr,
        annualPersonalExemption: t.annualPersonalExemption,
        brackets: t.brackets.map((b) => ({ upToAnnual: b.upToAnnual, ratePercent: formatRateBp(b.rateBp) })),
        eliminationTiers: t.eliminationTiers.map((e) => ({
          aboveAnnual: e.aboveAnnual,
          upToAnnual: e.upToAnnual,
          dropsLowestBrackets: e.dropsLowestBrackets,
        })),
      })),
      socialInsurance: tables.socialInsurance.map((t) => ({
        code: t.code,
        effectiveFrom: t.effectiveFrom,
        effectiveTo: t.effectiveTo,
        citationAr: t.citationAr,
        monthlyWageFloor: t.monthlyWageFloor,
        monthlyWageCeiling: t.monthlyWageCeiling,
        employeeTotalPercent: formatRateBp(totalShareBp(t.employeeShares)),
        employerTotalPercent: formatRateBp(totalShareBp(t.employerShares)),
        employeeShares: t.employeeShares.map((x) => ({ code: x.code, labelAr: x.labelAr, ratePercent: formatRateBp(x.rateBp) })),
        employerShares: t.employerShares.map((x) => ({ code: x.code, labelAr: x.labelAr, ratePercent: formatRateBp(x.rateBp) })),
      })),
      levies: tables.levies.map((t) => ({
        code: t.code,
        effectiveFrom: t.effectiveFrom,
        effectiveTo: t.effectiveTo,
        citationAr: t.citationAr,
        levies: t.levies.map((x) => ({ code: x.code, labelAr: x.labelAr, ratePercent: formatRateBp(x.rateBp), base: x.base, side: x.side })),
      })),
      overtime: tables.overtime.map((t) => ({
        code: t.code,
        effectiveFrom: t.effectiveFrom,
        effectiveTo: t.effectiveTo,
        citationAr: t.citationAr,
        dayPremiumPercent: formatRateBp(t.dayPremiumBp),
        nightPremiumPercent: formatRateBp(t.nightPremiumBp),
        restDayPremiumPercent: formatRateBp(t.restDayPremiumBp),
        standardDailyHours: t.standardDailyHours,
        standardWeeklyHours: t.standardWeeklyHours,
      })),
      endOfService: tables.endOfService.map((t) => ({
        code: t.code,
        effectiveFrom: t.effectiveFrom,
        effectiveTo: t.effectiveTo,
        citationAr: t.citationAr,
        minimumAnnualRaisePercent: formatRateBp(t.minimumAnnualRaiseBp),
        tiers: t.tiers.map((x) => ({ throughYears: x.throughYears, monthsPerYear: x.monthsPerYear })),
      })),
      insuranceYearOverrides: overrides,
    });
  });

  /**
   * حدود الأجر التأميني للسنة — the one statutory figure a tenant may enter.
   *
   * The floor and ceiling are republished every January and the app cannot ship
   * a number that has not been published yet; without this, payroll would stop
   * every New Year until a software update. The rates and the sub-fund split
   * are NOT editable: those are in the law and a typo in them would be silent.
   */
  const statutoryOverrides = deps.statutoryOverrides;
  if (statutoryOverrides) {
    app.put("/payroll/statutory-tables/insurance-years/:year", gate("hr.payroll.create"), async (c) => {
      const parsed = upsertSocialInsuranceYearSchema.safeParse({
        ...(await c.req.json().catch(() => ({}))),
        year: Number.parseInt(c.req.param("year"), 10),
      });
      if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
      if (Money.fromMajor(parsed.data.monthlyWageCeiling).scaled <= Money.fromMajor(parsed.data.monthlyWageFloor).scaled) {
        return c.json({ error: "INVALID_INSURANCE_LIMITS", message: "الحد الأقصى للأجر التأميني يجب أن يزيد عن الحد الأدنى." }, 422);
      }
      const override: SocialInsuranceYearOverride = {
        year: parsed.data.year,
        monthlyWageFloor: parsed.data.monthlyWageFloor,
        monthlyWageCeiling: parsed.data.monthlyWageCeiling,
        note: parsed.data.note ?? null,
        enteredBy: actorOf(c),
        enteredAt: new Date().toISOString(),
      };
      await statutoryOverrides.upsert(override);
      return c.json(override);
    });

    app.delete("/payroll/statutory-tables/insurance-years/:year", gate("hr.payroll.create"), async (c) => {
      await statutoryOverrides.remove(Number.parseInt(c.req.param("year"), 10));
      return c.body(null, 204);
    });
  }

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
      const run = await calculatePayrollRun(c.req.param("id"), await currentCalculationDeps());
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
        garnishments: deps.garnishmentRegister,
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
