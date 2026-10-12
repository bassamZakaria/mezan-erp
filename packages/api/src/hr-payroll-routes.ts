import { postingRefusalResponse } from "./posting-refusal.js";
import { readReversalRequest, reversalRefusalResponse, requireReversalReason } from "./document-reversal.js";
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  Money,
  advanceOutstanding,
  advanceRecovered,
  approveEmployeeAdvance,
  approvePayrollRun,
  PART_MONTH_TAX_NOTICE,
  isPartMonthTaxedPayslip,
  calculatePayrollRun,
  cancelPayrollRun,
  createEmployeeDirectory,
  createPayrollRun,
  createPayrollComponent,
  updatePayrollComponent,
  disburseEmployeeAdvance,
  disbursePayrollRun,
  repayEmployeeAdvance,
  AdvanceRepaymentExceedsOutstandingError,
  InvalidAdvanceRepaymentError,
  PendingAdvanceExistsError,
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
  NoFiscalPeriodForDateError,
  NoPayableEmployeesError,
  PayrollFxRateMissingError,
  PayrollRunNotFoundError,
  PeriodNotOpenForPostingError,
  TreasuryDisbursementHeldError,
  TreasuryDisbursementUnavailableError,
  UnbalancedEntryError,
  InvalidGarnishmentError,
  GarnishmentNotFoundError,
  createGarnishment,
  createGarnishmentProvider,
  releaseGarnishment,
  type GarnishmentRecord,
  type GarnishmentRepository,
  type PayrollDayDivisorBasis,
  type SettingsRepository,
  StatutoryRulesUnavailableError,
  listEgyptStatutoryTables,
  unverifiedStatutoryTableCodes,
  formatRateBp,
  totalShareBp,
  getHrProvisionDefinition,
  hrProvisionMovement,
  postHrProvision,
  listHrProvisionPostings,
  reversePayrollRunApproval,
  cancelEmployeeAdvance,
  PayrollRunDisbursedError,
  DisbursementTreasuryAccountNotFoundError,
  PayrollRunNotApprovedError,
  PayrollRunHasTerminationAdjustmentError,
  AdvancePartlyRepaidError,
  TerminationRecoveryAlreadyCollectedError,
  reverseHrProvision,
  HrProvisionPostingNotFoundError,
  HrProvisionLaterPostingError,
  createLeaveLiabilityReport,
  runReport,
  type AuditSink,
  type HrProvisionKind,
  type LedgerRepository,
  type LeaveBalanceRepository,
  type LeavePolicyRepository,
  type OvertimeHoursProvider,
  type PayrollExchangeRates,
  type WorkedTimeProvider,
  type PayrollStatutoryFlagRepository,
  type SocialInsuranceYearOverride,
  type StatutoryOverrideRepository,
  type EmployeeAdvance,
  type EmployeeAdvanceRepository,
  type EmployeeRepository,
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
  ReversalPermission,
  createEmployeeAdvanceSchema,
  createPayrollRunSchema,
  createPayrollComponentSchema,
  createGarnishmentSchema,
  setPayrollStatutoryFlagSchema,
  upsertSocialInsuranceYearSchema,
  updatePayrollComponentSchema,
  treasuryDisbursementSchema,
  repayEmployeeAdvanceSchema,
} from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { recordAdminEvent } from "./admin-audit.js";
import { tenantDay } from "./tenant-day.js";
import { tenantToday } from "./tenant-day.js";
import { MasterDataKind, refuseUnknownMasterData, type MasterDataChecks } from "./master-data-check.js";

/**
 * Payroll + employee-advance routes (docs/archive/catalog/06-crm-hr.md "الرواتب" and
 * "سلف الموظفين"). Paths are root-relative — a parent app mounts this router
 * under `/hr` alongside the master-data and time/leave HR routers.
 *
 * Gated on the existing `hr.advance.*` / `hr.payroll.*` permission codes from
 * `packages/domain/src/permissions/catalog.ts`.
 */
export interface HrPayrollRoutesDeps {
  readonly masterData?: MasterDataChecks;
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
  /** The payroll-component registry (R10.7); absent = the component routes are not mounted and every line posts to the run defaults. */
  readonly payrollComponents?: PayrollComponentRepository;
  /**
   * The garnishment register (الحجز على الأجر). Supplying it mounts its routes,
   * feeds payroll's deduction seam and counts each order down as payroll
   * withholds — the three go together, so a register can never be half-wired.
   */
  readonly garnishmentRegister?: GarnishmentRepository;
  /**
   * Tenant settings, read PER CALCULATION rather than captured at wiring time,
   * so a day divisor changed in the settings screen reaches the next run
   * without a restart.
   */
  readonly settings?: Pick<SettingsRepository, "get">;
  /** Overrides the settings-derived basis; for tests. */
  readonly dayDivisorBasis?: PayrollDayDivisorBasis;
  /**
   * The tenant's `hr.payroll.statutory` switch, read per calculation. Absent =
   * statutory computation is unavailable and every run computes with it off.
   */
  readonly statutoryFlag?: PayrollStatutoryFlagRepository;
  /**
   * Insurance limits an admin entered for a year the shipped tables do not
   * carry. Supplying it mounts the routes AND feeds the calculation, so the
   * screen can never edit a figure payroll does not read.
   */
  readonly statutoryOverrides?: StatutoryOverrideRepository;
  /** Bound to attendance; read only when statutory computation is on. */
  readonly overtime?: OvertimeHoursProvider;
  /** Bound to attendance and leave; absent = hourly and daily contracts are excluded. */
  readonly workedTime?: WorkedTimeProvider;
  /** The approved exchange rates; absent = a contract in another currency is excluded. */
  readonly exchangeRates?: PayrollExchangeRates;
  /**
   * Read side of the leave provision. Supplying `ledger` and `leave` mounts the
   * provision routes: without the ledger there is no posted balance to compare
   * the computed obligation against.
   */
  readonly ledger?: Pick<LedgerRepository, "list">;
  readonly leave?: {
    readonly balances: Pick<LeaveBalanceRepository, "list">;
    readonly policies: Pick<LeavePolicyRepository, "list">;
  };
  /** Forensic trail for the statutory switch and the admin-entered legal figures. */
  readonly audit?: AuditSink;
  readonly idGen?: () => string;
}

export function serializeAdvance(a: EmployeeAdvance) {
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
    repayments: (a.repayments ?? []).map((r) => ({
      id: r.id,
      date: r.date,
      amount: r.amount.toString(),
      paymentMethod: r.paymentMethod,
      treasuryAccountId: r.treasuryAccountId,
      voucherId: r.voucherId,
      voucherNo: r.voucherNo,
      journalEntryId: r.journalEntryId,
      note: r.note,
      recordedBy: r.recordedBy,
      recordedAt: r.recordedAt,
    })),
  };
}

export function serializePayslip(p: Payslip) {
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
    partMonthTaxNotice: isPartMonthTaxedPayslip(p) ? PART_MONTH_TAX_NOTICE.ar : null,
    partMonthTaxNoticeEn: isPartMonthTaxedPayslip(p) ? PART_MONTH_TAX_NOTICE.en : null,
    lines: p.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      source: l.source,
      nameAr: l.nameAr,
      amount: l.amount.toString(),
      glAccountId: l.glAccountId,
      referenceId: l.referenceId,
      capped: l.capped,
    })),
    grossEarnings: p.grossEarnings.toString(),
    totalDeductions: p.totalDeductions.toString(),
    employerContributions: p.employerContributions.toString(),
    netPay: p.netPay.toString(),
    insurableWage: p.insurableWage.toString(),
    insurableWageCapped: p.insurableWageCapped,
    annualTaxableIncome: p.annualTaxableIncome.toString(),
    totalEmployerCost: p.totalEmployerCost === null ? null : p.totalEmployerCost.toString(),
    basis: p.basis
      ? {
          payBasis: p.basis.payBasis,
          quantity: p.basis.quantity,
          rate: p.basis.rate.toString(),
          contractCurrency: p.basis.contractCurrency,
          fxRate: p.basis.fxRate,
          fxRateDate: p.basis.fxRateDate,
          grossInContractCurrency: p.basis.grossInContractCurrency?.toString() ?? null,
          netInContractCurrency: p.basis.netInContractCurrency?.toString() ?? null,
        }
      : null,
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

export function serializeRun(r: PayrollRun) {
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
    totalEmployerCost: r.totalEmployerCost === null ? null : r.totalEmployerCost.toString(),
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

function withMessageEn(err: { readonly code: string; readonly message: string; readonly messageEn?: string }) {
  return { error: err.code, message: err.message, ...(err.messageEn ? { messageEn: err.messageEn } : {}) };
}

function handleDomainError(c: Context, err: unknown): Response {
  const reversalRefusal = reversalRefusalResponse(c, err);
  if (reversalRefusal) return reversalRefusal;
  if (err instanceof HrProvisionPostingNotFoundError) return c.json(withMessageEn(err), 404);
  if (err instanceof HrProvisionLaterPostingError) return c.json(withMessageEn(err), 409);
  if (err instanceof DisbursementTreasuryAccountNotFoundError) return c.json(withMessageEn(err), 422);
  if (err instanceof PayrollRunDisbursedError) return c.json({ ...withMessageEn(err), disbursementVoucherId: err.disbursementVoucherId }, 409);
  if (
    err instanceof PayrollRunNotApprovedError ||
    err instanceof PayrollRunHasTerminationAdjustmentError ||
    err instanceof AdvancePartlyRepaidError ||
    err instanceof TerminationRecoveryAlreadyCollectedError
  ) {
    return c.json(withMessageEn(err), 409);
  }
  if (
    err instanceof EmployeeAdvanceNotFoundError ||
    err instanceof PayrollRunNotFoundError ||
    err instanceof EmployeeNotFoundError ||
    err instanceof GarnishmentNotFoundError
  ) {
    return c.json(withMessageEn(err), 404);
  }
  if (err instanceof TreasuryDisbursementUnavailableError) {
    return c.json({ error: err.code, message: "لم يتم إعداد مسار الصرف من الخزينة." }, 409);
  }
  if (err instanceof PayrollFxRateMissingError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, currency: err.currency, date: err.asOfDate }, 422);
  }
  if (err instanceof TreasuryDisbursementHeldError) {
    return c.json({ error: err.code, message: err.message, messageEn: "The voucher is awaiting approval — the payment is not complete until it is approved.", voucherId: err.voucherId }, 409);
  }
  if (err instanceof AdvanceRepaymentExceedsOutstandingError || err instanceof PendingAdvanceExistsError) {
    return c.json(withMessageEn(err), 409);
  }
  if (err instanceof InvalidAdvanceRepaymentError) {
    return c.json(withMessageEn(err), 422);
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
    err instanceof StatutoryRulesUnavailableError ||
    err instanceof InvalidGarnishmentError ||
    err instanceof InvalidPayrollComponentError ||
    err instanceof DuplicatePayrollComponentError
  ) {
    return c.json(withMessageEn(err), 422);
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

export function createHrPayrollRoutes(deps: HrPayrollRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
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
    garnishments: deps.garnishmentRegister ? createGarnishmentProvider(deps.garnishmentRegister) : undefined,
    payrollComponents: deps.payrollComponents,
    statutoryOverrides: deps.statutoryOverrides,
    overtime: deps.overtime,
    workedTime: deps.workedTime,
    exchangeRates: deps.exchangeRates,
    idGen,
  };

  async function currentCalculationDeps() {
    const [settings, flag] = await Promise.all([deps.settings?.get(), deps.statutoryFlag?.get()]);
    return {
      ...calculationDeps,
      dayDivisorBasis: deps.dayDivisorBasis ?? settings?.payrollDayDivisorBasis ?? "FIXED_30",
      statutoryEnabled: flag?.enabled === true,
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

  app.post("/advances/:id/cancel", gate(ReversalPermission.EmployeeAdvance), async (c) => {
    try {
      const { date } = await readReversalRequest(c);
      const advance = await cancelEmployeeAdvance(
        c.req.param("id"),
        {
          advances: deps.advances,
          treasury: deps.treasury,
          terminationRecovery: { runs: deps.runs, payslips: deps.payslips },
          gl: { ...deps.gl, actor: actorOf(c) },
        },
        { reversalId: idGen(), date, today: await tenantToday(c) },
      );
      return c.json(serializeAdvance(advance));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/advances/:id/disburse", gate("hr.advance.approve"), async (c) => {
    const parsed = treasuryDisbursementSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const disburseBranchRefusal = await refuseUnknownMasterData(c, deps.masterData, [{ kind: MasterDataKind.Branch, ids: [parsed.data.branchId] }]);
    if (disburseBranchRefusal) return disburseBranchRefusal;
    try {
      const advance = await disburseEmployeeAdvance(c.req.param("id"), { ...parsed.data, date: await tenantDay(c, parsed.data.date) }, {
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

  const advanceLocks = new Map<string, Promise<unknown>>();
  async function withAdvanceLock<T>(advanceId: string, work: () => Promise<T>): Promise<T> {
    const previous = advanceLocks.get(advanceId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    advanceLocks.set(advanceId, run);
    try {
      return await run;
    } finally {
      if (advanceLocks.get(advanceId) === run) advanceLocks.delete(advanceId);
    }
  }

  async function pendingPayrollRecovery(advanceId: string): Promise<Money> {
    const calculated = (await deps.runs.list()).filter((r) => r.status === "calculated");
    let scaled = 0n;
    for (const run of calculated) {
      for (const payslip of await deps.payslips.listByRunId(run.id)) {
        for (const line of payslip.lines) {
          if (line.source === "advance_recovery" && line.referenceId === advanceId) scaled += line.amount.scaled;
        }
      }
    }
    return Money.fromScaled(scaled);
  }

  app.get("/advances/:id/repayable", gate("hr.advance.view"), async (c) => {
    const advance = await deps.advances.findById(c.req.param("id"));
    if (!advance) return c.json({ error: "EMPLOYEE_ADVANCE_NOT_FOUND" }, 404);
    const outstanding = advanceOutstanding(advance);
    const pending = await pendingPayrollRecovery(advance.id);
    const repayable = outstanding.scaled > pending.scaled ? Money.fromScaled(outstanding.scaled - pending.scaled) : Money.zero();
    return c.json({ advanceId: advance.id, outstanding: outstanding.toString(), pendingPayrollRecovery: pending.toString(), repayable: repayable.toString() });
  });

  app.post("/advances/:id/repay", gate("hr.advance.approve"), async (c) => {
    const parsed = repayEmployeeAdvanceSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const advanceId = c.req.param("id");
    const repayBranchRefusal = await refuseUnknownMasterData(c, deps.masterData, [{ kind: MasterDataKind.Branch, ids: [parsed.data.branchId] }]);
    if (repayBranchRefusal) return repayBranchRefusal;
    try {
      const before = await deps.advances.findById(advanceId);
      const advance = await withAdvanceLock(advanceId, async () =>
        repayEmployeeAdvance(
          advanceId,
          {
            treasuryAccountId: parsed.data.treasuryAccountId,
            branchId: parsed.data.branchId,
            date: await tenantDay(c, parsed.data.date),
            paymentMethod: parsed.data.paymentMethod,
            referenceNo: parsed.data.referenceNo ?? null,
            repaymentId: parsed.data.repaymentId,
            amount: Money.fromMajor(parsed.data.amount),
            note: parsed.data.note ?? null,
            recordedBy: actorOf(c),
          },
          { advances: deps.advances, treasury: deps.treasury, accounts: deps.accounts, pendingPayrollRecovery },
        ),
      );
      const recorded = advance.repayments?.find((r) => r.id === parsed.data.repaymentId);
      const newlyRecorded = recorded !== undefined && !(before?.repayments ?? []).some((r) => r.id === parsed.data.repaymentId);
      if (newlyRecorded) {
        await recordAdminEvent(deps.audit, c, {
          module: "hr",
          entityType: "employee_advance",
          entityId: advance.id,
          action: "manual_repayment",
          details: {
            advanceNumber: advance.number,
            employeeId: advance.employeeId,
            repaymentId: recorded.id,
            amount: recorded.amount.toString(),
            paymentMethod: recorded.paymentMethod,
            treasuryAccountId: recorded.treasuryAccountId,
            voucherId: recorded.voucherId,
            voucherNo: recorded.voucherNo,
            outstandingAfter: advanceOutstanding(advance).toString(),
            status: advance.status,
          },
        });
      }
      return c.json(serializeAdvance(advance));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

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
        if (await garnishmentRegister.findById(record.id)) {
          return c.json({ error: "DUPLICATE_GARNISHMENT", message: "يوجد سند حجز بنفس المعرّف." }, 409);
        }
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

  // --- Statutory tables, the admin-entered insurance years, and the switch ---

  async function unverifiedCodes(): Promise<readonly string[]> {
    return unverifiedStatutoryTableCodes((await deps.statutoryOverrides?.list()) ?? []);
  }

  app.get("/payroll/statutory-tables", gate("hr.payroll.view"), async (c) => {
    const overrides = (await deps.statutoryOverrides?.list()) ?? [];
    const tables = listEgyptStatutoryTables(overrides);
    const provenance = (t: { source: string; verified: boolean }) => ({ source: t.source, verified: t.verified });
    return c.json({
      incomeTax: tables.incomeTax.map((t) => ({
        code: t.code,
        effectiveFrom: t.effectiveFrom,
        effectiveTo: t.effectiveTo,
        citationAr: t.citationAr,
        ...provenance(t),
        annualPersonalExemption: t.annualPersonalExemption,
        disabilityExemptionMultiplierPercent: formatRateBp(t.disabilityExemptionMultiplierBp),
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
        ...provenance(t),
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
        ...provenance(t),
        levies: t.levies.map((x) => ({
          code: x.code,
          labelAr: x.labelAr,
          ratePercent: formatRateBp(x.rateBp),
          base: x.base,
          side: x.side,
          exemptPayBases: x.exemptPayBases,
        })),
      })),
      overtime: tables.overtime.map((t) => ({
        code: t.code,
        effectiveFrom: t.effectiveFrom,
        effectiveTo: t.effectiveTo,
        citationAr: t.citationAr,
        ...provenance(t),
        dayPremiumPercent: formatRateBp(t.dayPremiumBp),
        nightPremiumPercent: formatRateBp(t.nightPremiumBp),
        restDayExtraDayWagePercent: formatRateBp(t.restDayExtraDayWageBp),
        holidayExtraDayWagePercent: formatRateBp(t.holidayExtraDayWageBp),
        restDayReplacementWithinDays: t.restDayReplacementWithinDays,
        holidaySubstituteDayAllowed: t.holidaySubstituteDayAllowed,
        standardDailyHours: t.standardDailyHours,
        standardWeeklyHours: t.standardWeeklyHours,
      })),
      endOfService: tables.endOfService.map((t) => ({
        code: t.code,
        effectiveFrom: t.effectiveFrom,
        effectiveTo: t.effectiveTo,
        citationAr: t.citationAr,
        ...provenance(t),
        minimumAge: t.minimumAge,
        minimumAnnualRaisePercent: formatRateBp(t.minimumAnnualRaiseBp),
        tiers: t.tiers.map((x) => ({ throughYears: x.throughYears, monthsPerYear: x.monthsPerYear })),
      })),
      insuranceYearOverrides: overrides,
    });
  });

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
      const previous = await statutoryOverrides.findByYear(parsed.data.year);
      const override: SocialInsuranceYearOverride = {
        year: parsed.data.year,
        monthlyWageFloor: parsed.data.monthlyWageFloor,
        monthlyWageCeiling: parsed.data.monthlyWageCeiling,
        note: parsed.data.note ?? null,
        enteredBy: actorOf(c),
        enteredAt: new Date().toISOString(),
      };
      await statutoryOverrides.upsert(override);
      await recordAdminEvent(deps.audit, c, {
        module: "hr",
        entityType: "payroll_insurance_year",
        entityId: String(override.year),
        action: previous ? "update" : "create",
        details: { before: previous, after: override },
      });
      return c.json(override);
    });

    app.delete("/payroll/statutory-tables/insurance-years/:year", gate("hr.payroll.create"), async (c) => {
      const year = Number.parseInt(c.req.param("year"), 10);
      const previous = await statutoryOverrides.findByYear(year);
      await statutoryOverrides.remove(year);
      if (previous) {
        await recordAdminEvent(deps.audit, c, {
          module: "hr",
          entityType: "payroll_insurance_year",
          entityId: String(year),
          action: "delete",
          details: { before: previous },
        });
      }
      return c.body(null, 204);
    });
  }

  const statutoryFlag = deps.statutoryFlag;
  if (statutoryFlag) {
    app.get("/payroll/statutory-flag", gate("hr.payroll.view"), async (c) => {
      return c.json({ ...(await statutoryFlag.get()), unverifiedTableCodes: await unverifiedCodes() });
    });

    // Tenant admin only, whatever payroll permissions the caller holds: turning
    // this on makes the product compute legal figures nobody has verified, and
    // that decision belongs to whoever answers for the books.
    app.put("/payroll/statutory-flag", gate("hr.payroll.view"), async (c) => {
      if (!getAuthContext(c)?.permissions.has("*")) {
        return c.json({ error: "TENANT_ADMIN_REQUIRED", message: "تفعيل احتساب الضريبة والتأمينات يقتصر على مدير النظام." }, 403);
      }
      const parsed = setPayrollStatutoryFlagSchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
      if (parsed.data.enabled && parsed.data.acknowledged !== true) {
        return c.json(
          {
            error: "ACKNOWLEDGEMENT_REQUIRED",
            message: "يجب الإقرار بأن الأرقام القانونية غير مُتحقَّق منها قبل تفعيل احتسابها.",
          },
          422,
        );
      }
      const before = await statutoryFlag.get();
      const unverified = await unverifiedCodes();
      const next = {
        enabled: parsed.data.enabled,
        changedBy: actorOf(c),
        changedAt: new Date().toISOString(),
        acknowledged: parsed.data.enabled ? true : before.acknowledged,
      };
      await statutoryFlag.set(next);
      await recordAdminEvent(deps.audit, c, {
        module: "hr",
        entityType: "payroll_statutory_flag",
        entityId: "hr.payroll.statutory",
        action: parsed.data.enabled ? "enable" : "disable",
        severity: "CRITICAL",
        details: { before: before.enabled, after: next.enabled, acknowledged: parsed.data.acknowledged === true, unverifiedTableCodes: unverified },
      });
      return c.json({ ...next, unverifiedTableCodes: unverified });
    });
  }

  // --- Leave provision (ترحيل مخصص الإجازات) ---------------------------------

  // Posts the MOVEMENT — the obligation now less what 2180 already carries —
  // computed from the same report definition the screen renders.
  const ledger = deps.ledger;
  const leave = deps.leave;
  if (ledger && leave) {
    async function provisionState(kind: HrProvisionKind, asOfDate: string) {
      const definition = getHrProvisionDefinition(kind);
      const balance = -(await deps.gl.ledger.accountBalance(definition.liabilityAccountId)).balance.scaled;
      const outcome = runReport(createLeaveLiabilityReport(), { asOfDate }, {
        employees: await deps.employees.list(),
        contracts: await deps.contracts.list(),
        balances: await leave!.balances.list(),
        policies: await leave!.policies.list(),
      });
      // Each row's figure is re-read as the exact six-decimal amount it was
      // rendered from and summed as bigint, never added up as floats.
      const computedScaled = outcome.ok
        ? outcome.rows.reduce((sum, row) => sum + Money.fromMajor(row.liability.toFixed(6)).scaled, 0n)
        : 0n;
      return { definition, postedBalance: Money.fromScaled(balance), computedTotal: Money.fromScaled(computedScaled) };
    }

    function parseKind(raw: string): HrProvisionKind | null {
      return raw === "leave" ? raw : null;
    }

    app.get("/payroll/provisions/:kind/preview", gate("hr.payroll.view"), async (c) => {
      const kind = parseKind(c.req.param("kind"));
      if (!kind) return c.json({ error: "UNKNOWN_PROVISION", message: "نوع المخصص غير معروف." }, 404);
      const asOfDate = c.req.query("asOfDate") ?? (await tenantToday(c));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return c.json({ error: "VALIDATION_ERROR", message: "تاريخ غير صالح." }, 400);
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
      const body = (await c.req.json().catch(() => ({}))) as { asOfDate?: string };
      const asOfDate = body.asOfDate ?? (await tenantToday(c));
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
        const postingRefusal = postingRefusalResponse(c, err);
        if (postingRefusal) return postingRefusal;
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

    app.get("/payroll/provisions/:kind/postings", gate("hr.payroll.view"), async (c) => {
      const kind = parseKind(c.req.param("kind"));
      if (!kind) return c.json({ error: "UNKNOWN_PROVISION", message: "نوع المخصص غير معروف.", messageEn: "Unknown provision kind." }, 404);
      const postings = await listHrProvisionPostings(kind, { ledger: deps.gl.ledger });
      const latestStanding = postings.find((posting) => posting.entry.status === "posted")?.asOfDate ?? null;
      const { liabilityAccountId } = getHrProvisionDefinition(kind);
      return c.json({
        postings: postings.map((posting) => ({
          kind,
          asOfDate: posting.asOfDate,
          journalEntryId: posting.entry.id,
          journalEntryNo: posting.entry.entryNo ?? null,
          status: posting.entry.status,
          movement: Money.fromScaled(posting.entry.lines.reduce((sum, line) => (line.accountId === liabilityAccountId ? sum + line.credit.scaled - line.debit.scaled : sum), 0n)).toString(),
          reversible: posting.entry.status === "posted" && posting.asOfDate === latestStanding,
          reversalEntryId: posting.reversal?.id ?? null,
          reversalEntryNo: posting.reversal?.entryNo ?? null,
          reversalDate: posting.reversal?.date ?? null,
        })),
      });
    });

    app.post("/payroll/provisions/:kind/:asOfDate/reverse", gate(ReversalPermission.HrLeaveProvision), requireReversalReason, async (c) => {
      const kind = parseKind(c.req.param("kind"));
      if (!kind) return c.json({ error: "UNKNOWN_PROVISION", message: "نوع المخصص غير معروف.", messageEn: "Unknown provision kind." }, 404);
      const asOfDate = c.req.param("asOfDate");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return c.json({ error: "VALIDATION_ERROR", message: "تاريخ غير صالح.", messageEn: "Invalid date." }, 400);
      try {
        const { date, memo } = await readReversalRequest(c);
        const result = await reverseHrProvision(kind, asOfDate, { gl: { ...deps.gl, actor: getAuthContext(c)?.userId ?? "system" } }, { reversalId: idGen(), date, memo });
        return c.json({ kind, asOfDate, journalEntryId: result.journalEntryId, reversalEntryId: result.reversal.id, reversalEntryNo: result.reversal.entryNo ?? null, reversalDate: result.reversal.date }, 201);
      } catch (err) {
        return handleDomainError(c, err);
      }
    });
  }

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
    const runBranchRefusal = await refuseUnknownMasterData(c, deps.masterData, [{ kind: MasterDataKind.Branch, ids: [parsed.data.branchId] }]);
    if (runBranchRefusal) return runBranchRefusal;
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
        employees: directory,
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
    const disburseBranchRefusal = await refuseUnknownMasterData(c, deps.masterData, [{ kind: MasterDataKind.Branch, ids: [parsed.data.branchId] }]);
    if (disburseBranchRefusal) return disburseBranchRefusal;
    try {
      const run = await disbursePayrollRun(c.req.param("id"), { ...parsed.data, date: await tenantDay(c, parsed.data.date) }, {
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

  app.post("/payroll/runs/:id/reverse-approval", gate(ReversalPermission.PayrollRun), requireReversalReason, async (c) => {
    try {
      const { date, memo } = await readReversalRequest(c);
      const run = await reversePayrollRunApproval(
        c.req.param("id"),
        { runs: deps.runs, payslips: deps.payslips, advances: deps.advances, garnishments: deps.garnishmentRegister, gl: { ...deps.gl, actor: actorOf(c) } },
        { reversalId: idGen(), date, memo },
      );
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
