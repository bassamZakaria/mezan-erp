import type { Ctx } from "./harness.js";
import {
  Money,
  allocate,
  buildInstallmentSchedule,
  applyAdvanceRecovery,
  calculatePayrollRun,
  PAYROLL_UNIMPLEMENTED_RULES,
  PAYROLL_GL_ACCOUNTS,
  InvalidEmployeeAdvanceError,
  type PayrollCalculationDeps,
} from "../../packages/domain/src/index.js";

/** Executable checks for the hr module — see docs/scenarios/05-hr.md. */

async function branchIdOf(ctx: Ctx): Promise<string> {
  const list = ctx.rows((await ctx.req("GET", "/hr/employees")).body);
  const kareem = list.find((e: any) => e.id === "EMP-DEMO-1");
  return kareem.branchId;
}

async function bankTreasuryAccount(ctx: Ctx): Promise<{ id: string; glAccountId: string }> {
  const list = ctx.rows((await ctx.req("GET", "/treasury-accounts")).body);
  const bank = list.find((a: any) => a.type === "bank");
  if (!bank?.glAccountId) throw new Error("[hr scenario] no bank treasury account with a GL account to disburse from.");
  return { id: bank.id, glAccountId: bank.glAccountId };
}

async function ledgerBalance(ctx: Ctx, accountId: string): Promise<number> {
  const res = await ctx.req("GET", `/gl/accounts/${accountId}/ledger`);
  return ctx.n(res.body.balance.balance);
}

async function assertBalancedEntry(ctx: Ctx, label: string, journalEntryId: string): Promise<void> {
  const entry = (await ctx.req("GET", `/gl/journal-entries/${journalEntryId}`)).body;
  const debit = entry.lines.reduce((s: number, l: any) => s + ctx.n(l.debit), 0);
  const credit = entry.lines.reduce((s: number, l: any) => s + ctx.n(l.credit), 0);
  ctx.checkEq(`${label} — journal entry balanced (debit = credit)`, debit, credit);
}

/** Self-service leave routes derive the employee from the CALLING user, never the payload — swap and restore USER-ADMIN's link to act as a given employee. */
async function linkAdmin(ctx: Ctx, employeeId: string | null): Promise<string | null> {
  const cur = (await ctx.req("GET", "/users/USER-ADMIN")).body;
  const previous = cur.employeeId;
  await ctx.req("PUT", "/users/USER-ADMIN", {
    fullName: cur.fullName,
    email: cur.email,
    phone: cur.phone,
    roleId: cur.roleId,
    isCompanyAdmin: cur.isCompanyAdmin,
    employeeId,
    branchScope: cur.branchScope,
    warehouseScope: cur.warehouseScope,
    status: cur.status,
  });
  return previous;
}

export async function run(ctx: Ctx): Promise<void> {
  const branchId = await branchIdOf(ctx);
  const treasury = await bankTreasuryAccount(ctx);

  await ctx.scenario("hr / payroll scope notice — unimplemented-rule set matches employee count", async () => {
    const universal = PAYROLL_UNIMPLEMENTED_RULES.filter((r) => r.appliesToEveryPayslip);
    const situational = PAYROLL_UNIMPLEMENTED_RULES.filter((r) => !r.appliesToEveryPayslip);
    const universalCodes = ["income_tax", "social_insurance", "seniority_bonus", "overtime", "end_of_service"];
    ctx.check(
      "PR-09 — exactly 5 universal scope gaps: tax, social insurance, Article 47 seniority, overtime, end-of-service",
      universal.length === 5 && universalCodes.every((code) => universal.some((r) => r.code === code)),
      universal.map((r) => r.code).join(", "),
    );
    ctx.check(
      "PR-10 — exactly 4 situational scope gaps (hourly/daily basis, pay frequency, multi-currency, loans/garnishments)",
      situational.length === 4,
      situational.map((r) => r.code).join(", "),
    );

    const amr = (await ctx.req("GET", "/hr/employees/EMP-DEMO-8")).body;
    const amrName = [amr.firstNameAr, amr.lastNameAr].filter(Boolean).join(" ").trim() || `${amr.firstName} ${amr.lastName}`;

    for (const runId of ["PR-DEMO-1", "PR-DEMO-2", "PR-DEMO-3"]) {
      const run = (await ctx.req("GET", `/hr/payroll/runs/${runId}`)).body;
      ctx.checkEq(`${runId} — the count in the scope notice equals the run's actual employeeCount`, run.employeeCount, run.payslips.length);
      ctx.check(`PR-04 ${runId} — employeeCount excludes the hourly contract (7, not 8 or 9)`, run.employeeCount === 7, `got ${run.employeeCount}`);

      const hourlyWarning = (run.warnings as string[]).find((w) => w.includes(amrName) && w.includes(amr.code));
      ctx.check(
        `PR-08/D15 ${runId} — hourly employee excluded with a NAMED warning embedding the raw, untranslated string "hourly"`,
        !!hourlyWarning && hourlyWarning.includes('"hourly"'),
        hourlyWarning ?? "no warning found naming the employee",
      );
      ctx.check(`PR-08 ${runId} — no payslip issued for the excluded hourly employee (not a zero payslip, not a blank row)`, !run.payslips.some((p: any) => p.employeeId === "EMP-DEMO-8"));
      ctx.check(
        `PR-13 ${runId} — no payslip line ever names tax/insurance/seniority/overtime/end-of-service`,
        run.payslips.every((p: any) => p.lines.every((l: any) => !/ضريبة|تأمين|أقدمية|إضافي|نهاية خدمة/.test(l.nameAr))),
      );
    }
  });

  await ctx.scenario("hr / payslip arithmetic — gross minus deductions equals net, per payslip and run total (PR-DEMO-1, June, مصروف)", async () => {
    const run = (await ctx.req("GET", "/hr/payroll/runs/PR-DEMO-1")).body;
    for (const p of run.payslips) {
      ctx.checkEq(`payslip ${p.number} (${p.employeeId}) — gross - deductions = net`, ctx.n(p.grossEarnings) - ctx.n(p.totalDeductions), ctx.n(p.netPay));
    }
    ctx.checkEq("PR-DEMO-1 — run totalGross = sum of payslip grossEarnings", ctx.n(run.totalGross), run.payslips.reduce((s: number, p: any) => s + ctx.n(p.grossEarnings), 0));
    ctx.checkEq("PR-DEMO-1 — run totalDeductions = sum of payslip totalDeductions", ctx.n(run.totalDeductions), run.payslips.reduce((s: number, p: any) => s + ctx.n(p.totalDeductions), 0));
    ctx.checkEq("PR-DEMO-1 — run totalNet = sum of payslip netPay", ctx.n(run.totalNet), run.payslips.reduce((s: number, p: any) => s + ctx.n(p.netPay), 0));

    const kareem = run.payslips.find((p: any) => p.employeeId === "EMP-DEMO-1");
    ctx.checkEq("PR-14 كريم عادل June — net = 8,900.00", ctx.n(kareem.netPay), 8900);
    ctx.check(
      "PR-14 — carries an advance-recovery line for ADV-DEMO-1 of exactly 1,000.00",
      kareem.lines.some((l: any) => l.source === "advance_recovery" && l.referenceId === "ADV-DEMO-1" && ctx.n(l.amount) === 1000),
    );

    const mohamed = run.payslips.find((p: any) => p.employeeId === "EMP-DEMO-3");
    ctx.checkEq("PR-15 محمد الشهابي — gross = 22,000.00 (18,000 + 2,500 + 1,500)", ctx.n(mohamed.grossEarnings), 22000);
    ctx.check("PR-15 — no deduction line at all", mohamed.lines.every((l: any) => l.kind !== "deduction"));
    ctx.checkEq("PR-15 — net = gross (no deductions)", ctx.n(mohamed.netPay), 22000);

    const salma = run.payslips.find((p: any) => p.employeeId === "EMP-DEMO-2");
    ctx.checkEq("PR-19 سلمى فؤاد — the RENEWAL contract (CTR-DEMO-3) is picked: 7,800 + 600 = 8,400 gross, not CTR-DEMO-2's 7,000", ctx.n(salma.grossEarnings), 8400);

    const hoda = run.payslips.find((p: any) => p.employeeId === "EMP-DEMO-4");
    ctx.checkEq("PR-16 هدى مصطفى — «في إجازة» employee STATUS alone does not reduce pay: net = 8,100.00", ctx.n(hoda.netPay), 8100);
  });

  await ctx.scenario("hr / payslip arithmetic — an approved UNPAID-type leave prorates the deduction exactly (PR-17, PR-DEMO-2 July)", async () => {
    const run = (await ctx.req("GET", "/hr/payroll/runs/PR-DEMO-2")).body;
    const mostafa = run.payslips.find((p: any) => p.employeeId === "EMP-DEMO-6");
    const unpaidLine = mostafa.lines.find((l: any) => l.source === "unpaid_leave");
    ctx.check("PR-17 مصطفى رزق — July payslip carries an unpaid-leave deduction line (LR-DEMO-8, 2 days)", !!unpaidLine && unpaidLine.nameAr.includes("2"), unpaidLine?.nameAr);
    if (unpaidLine) {
      const expected = allocate(Money.fromMajor(mostafa.grossEarnings), [2, mostafa.paidDays - 2])[0]!;
      ctx.checkEq("PR-17 — deduction is the exact largest-remainder split of gross over unpaid/paid days", ctx.n(unpaidLine.amount), ctx.n(expected.toString()));
    }
    ctx.checkEq("PR-17 — net still equals gross minus deductions", ctx.n(mostafa.grossEarnings) - ctx.n(mostafa.totalDeductions), ctx.n(mostafa.netPay));
  });

  await ctx.scenario("hr / contracts — a lapsed fixed-term contract keeps reporting status ساري (known behavior)", async () => {
    const c = (await ctx.req("GET", "/hr/contracts/CTR-DEMO-2")).body;
    ctx.check(
      "CT-02 — CTR-DEMO-2 ended 2026-01-14 (over 7 months ago) but is still status active, not auto-terminated by the passed date",
      c.status === "active" && c.endDate < "2026-08-24",
      `status=${c.status} endDate=${c.endDate}`,
    );
  });

  // The next two scenarios rely on PR-DEMO-1/2/3 still sitting at their seeded
  // disbursed/approved/calculated states — every refusal below must run BEFORE
  // "advance recovery" and "payroll disbursement" mutate PR-DEMO-3.
  await ctx.scenario("hr / payroll lifecycle — every transition is refused from the wrong state (D15: refusal is English)", async () => {
    const draft = await ctx.req("POST", "/hr/payroll/runs", { id: "SCN-PR-DRAFT-1", year: 2029, month: 5, branchId, currency: "EGP" });
    ctx.check("draft run created for the refusal test", draft.status === 201, `status ${draft.status}`);

    const approveUncalculated = await ctx.req("POST", `/hr/payroll/runs/${draft.body.id}/approve`, {});
    ctx.check("PR-26 — approving an uncalculated (مسودة) run is refused", approveUncalculated.status === 422, `status ${approveUncalculated.status}`);
    ctx.check(
      'D15 — refusal surfaces in English inside the Arabic UI: `Cannot transition payroll run from "draft" to "approved".`',
      /Cannot transition payroll run from "draft" to "approved"/.test(approveUncalculated.body?.message ?? ""),
      approveUncalculated.body?.message,
    );

    const recalcDisbursed = await ctx.req("POST", "/hr/payroll/runs/PR-DEMO-1/calculate", {});
    ctx.check("calculating an already-disbursed (مصروف) run is refused", recalcDisbursed.status === 422, `status ${recalcDisbursed.status}`);
    ctx.check(
      'D15 — message names the real from/to states in English: `Cannot transition payroll run from "disbursed" to "calculated".`',
      /Cannot transition payroll run from "disbursed" to "calculated"/.test(recalcDisbursed.body?.message ?? ""),
      recalcDisbursed.body?.message,
    );

    const recalcApproved = await ctx.req("POST", "/hr/payroll/runs/PR-DEMO-2/calculate", {});
    ctx.check("calculating an already-approved (معتمد) run is refused — recalculation is only allowed while محتسب", recalcApproved.status === 422, `status ${recalcApproved.status}`);

    const disburseCalculated = await ctx.req("POST", "/hr/payroll/runs/PR-DEMO-3/disburse", { treasuryAccountId: treasury.id, branchId });
    ctx.check("PR-29 — disbursing a run that is only محتسب (not yet معتمد) is refused", disburseCalculated.status === 422, `status ${disburseCalculated.status}`);

    const cancelDisbursed = await ctx.req("POST", "/hr/payroll/runs/PR-DEMO-1/cancel", {});
    ctx.check("PR-31 — cancelling a مصروف run is refused", cancelDisbursed.status === 422, `status ${cancelDisbursed.status}`);

    const cancelApproved = await ctx.req("POST", "/hr/payroll/runs/PR-DEMO-2/cancel", {});
    ctx.check("PR-31 — cancelling a معتمد run is refused", cancelApproved.status === 422, `status ${cancelApproved.status}`);

    const cancelDraft = await ctx.req("POST", `/hr/payroll/runs/${draft.body.id}/cancel`, {});
    ctx.check("throwaway draft run cleans up: cancelling a مسودة run succeeds", cancelDraft.status === 200 && cancelDraft.body.status === "cancelled");
  });

  await ctx.scenario("hr / payroll negative path — an employee with no active contract is excluded, not failed", async () => {
    const emp = await ctx.req("POST", "/hr/employees", { id: "SCN-EMP-NOCTR", firstName: "Scenario", lastName: "NoContract", branchId, hireDate: "2020-01-01" });
    ctx.check("SCN employee (no contract) created", emp.status === 201, `status ${emp.status}`);

    const draft = await ctx.req("POST", "/hr/payroll/runs", { id: "SCN-PR-NOCTR", year: 2029, month: 6, branchId, currency: "EGP" });
    ctx.check("fresh draft run created for the exclusion test", draft.status === 201, `status ${draft.status}`);

    const calc = await ctx.req("POST", `/hr/payroll/runs/${draft.body.id}/calculate`, {});
    ctx.check("calculation succeeds even though one active employee has no contract at all", calc.status === 200, `status ${calc.status}`);
    const warning = (calc.body.warnings as string[]).find((w: string) => w.includes(emp.body.code));
    ctx.check(
      "an employee with no active contract is excluded with a NAMED warning, not a hard failure",
      !!warning && warning.includes("لا يوجد عقد ساري خلال الفترة"),
      warning ?? "no warning found naming the employee",
    );
    ctx.check("the excluded employee gets no payslip at all", !calc.body.payslips.some((p: any) => p.employeeId === emp.body.id));

    const cancel = await ctx.req("POST", `/hr/payroll/runs/${draft.body.id}/cancel`, {});
    ctx.check("PR-30 — cancelling a محتسب run succeeds with no confirmation step", cancel.status === 200 && cancel.body.status === "cancelled");
    ctx.checkEq("PR-30 — cancelled run's employeeCount resets to 0", cancel.body.employeeCount, 0);
    ctx.checkEq("PR-30 — cancelled run's totalNet resets to 0", ctx.n(cancel.body.totalNet), 0);
  });

  await ctx.scenario("hr / advance recovery — approving the payroll run recovers exactly one instalment (ADV-DEMO-2, PR-DEMO-3)", async () => {
    const before = (await ctx.req("GET", "/hr/advances/ADV-DEMO-2")).body;
    ctx.checkEq("ADV-DEMO-2 pre-approval — outstanding is still the full 4,000.00", ctx.n(before.outstanding), 4000);
    ctx.check("ADV-DEMO-2 pre-approval — 0 of 4 instalments recovered", before.installments.every((i: any) => ctx.n(i.recovered) === 0));

    const runBefore = (await ctx.req("GET", "/hr/payroll/runs/PR-DEMO-3")).body;
    const ahmedSlip = runBefore.payslips.find((p: any) => p.employeeId === "EMP-DEMO-5");
    const recoveryLine = ahmedSlip.lines.find((l: any) => l.source === "advance_recovery" && l.referenceId === "ADV-DEMO-2");
    ctx.check("PR-18/PR-25 — August's محتسب preview already shows the سداد سلفة line before approval", !!recoveryLine && ctx.n(recoveryLine.amount) === 1000, recoveryLine?.amount);

    const approve = await ctx.req("POST", "/hr/payroll/runs/PR-DEMO-3/approve", {});
    ctx.check("PR-24 — approving a محتسب run succeeds and posts a journal entry", approve.status === 200 && !!approve.body.journalEntryId, `status ${approve.status}`);
    if (approve.body.journalEntryId) await assertBalancedEntry(ctx, "PR-DEMO-3 approval", approve.body.journalEntryId);

    const after = (await ctx.req("GET", "/hr/advances/ADV-DEMO-2")).body;
    ctx.checkEq(
      "PR-25 — recovery applies only at approval: outstanding falls by exactly the instalment amount",
      ctx.n(before.outstanding) - ctx.n(after.outstanding),
      recoveryLine ? ctx.n(recoveryLine.amount) : NaN,
    );
    ctx.checkEq("ADV-DEMO-2 — outstanding after approval is 3,000.00", ctx.n(after.outstanding), 3000);
    ctx.checkEq("ADV-DEMO-2 — instalment #1 fully recovered (1,000.00)", ctx.n(after.installments[0].recovered), 1000);
  });

  await ctx.scenario("hr / payroll disbursement — balanced journal entry, treasury reduced by exactly the net (PR-DEMO-3)", async () => {
    const missing = await ctx.req("POST", "/hr/payroll/runs/PR-DEMO-3/disburse", {});
    ctx.check("PR-27 — disburse without treasury/branch is refused before any posting", missing.status === 400, `status ${missing.status}`);

    const run = (await ctx.req("GET", "/hr/payroll/runs/PR-DEMO-3")).body;
    const treasuryBefore = await ledgerBalance(ctx, treasury.glAccountId);

    const disburse = await ctx.req("POST", "/hr/payroll/runs/PR-DEMO-3/disburse", { treasuryAccountId: treasury.id, branchId, paymentMethod: "bank" });
    ctx.check("PR-28 — disburse succeeds from معتمد", disburse.status === 200 && disburse.body.status === "disbursed", `status ${disburse.status}`);
    ctx.check("PR-28 — a disbursement voucher id is recorded on the run", !!disburse.body.disbursementVoucherId);

    if (disburse.body.disbursementVoucherId) {
      const voucher = (await ctx.req("GET", `/vouchers/${disburse.body.disbursementVoucherId}`)).body;
      ctx.check("PR-28 — the disbursement voucher posted its own journal entry", !!voucher.journalEntryId);
      if (voucher.journalEntryId) await assertBalancedEntry(ctx, "PR-DEMO-3 disbursement voucher", voucher.journalEntryId);
    }

    const treasuryAfter = await ledgerBalance(ctx, treasury.glAccountId);
    ctx.checkEq("PR-28 — treasury account reduced by exactly the run's net pay", treasuryBefore - treasuryAfter, ctx.n(run.totalNet));

    const redisburse = await ctx.req("POST", "/hr/payroll/runs/PR-DEMO-3/disburse", { treasuryAccountId: treasury.id, branchId });
    ctx.check("disbursing an already-مصروف run is refused", redisburse.status === 422, `status ${redisburse.status}`);
  });

  await ctx.scenario("hr / advance lifecycle — بانتظار الاعتماد → معتمدة → مصروفة → مسددة (SCN-ADV-1)", async () => {
    const create = await ctx.req("POST", "/hr/advances", {
      id: "SCN-ADV-1",
      employeeId: "EMP-DEMO-1",
      amount: "3000",
      currency: "EGP",
      installmentCount: 3,
      firstDeductionDate: "2029-07-01",
      reason: "سيناريو اختبار",
    });
    ctx.check("advance created — بانتظار الاعتماد", create.status === 201 && create.body.status === "pending", `status ${create.status}`);

    const approve = await ctx.req("POST", "/hr/advances/SCN-ADV-1/approve", {});
    ctx.check("AD-09 — approving a pending advance — معتمدة", approve.status === 200 && approve.body.status === "approved");

    const treasuryBefore = await ledgerBalance(ctx, treasury.glAccountId);
    const disburse = await ctx.req("POST", "/hr/advances/SCN-ADV-1/disburse", { treasuryAccountId: treasury.id, branchId, paymentMethod: "bank" });
    ctx.check("AD-11 — disbursing an approved advance — مصروفة", disburse.status === 200 && disburse.body.status === "disbursed");

    if (disburse.body.disbursementVoucherId) {
      const voucher = (await ctx.req("GET", `/vouchers/${disburse.body.disbursementVoucherId}`)).body;
      if (voucher.journalEntryId) {
        await assertBalancedEntry(ctx, "SCN-ADV-1 disbursement voucher", voucher.journalEntryId);
        const entry = (await ctx.req("GET", `/gl/journal-entries/${voucher.journalEntryId}`)).body;
        ctx.check(
          "AD-11 — debit hits 1160 سلف الموظفين (an ASSET), never an expense account",
          entry.lines.some((l: any) => l.accountId === PAYROLL_GL_ACCOUNTS.employeeAdvanceAccountId && ctx.n(l.debit) === 3000),
        );
      }
    }

    const treasuryAfter = await ledgerBalance(ctx, treasury.glAccountId);
    ctx.checkEq("AD-11 — treasury reduced by exactly the advance amount", treasuryBefore - treasuryAfter, 3000);

    const disbursed = (await ctx.req("GET", "/hr/advances/SCN-ADV-1")).body;
    // AD-13/AD-14: the live seed never reaches مسددة within 3 monthly runs, so
    // this asserts the domain rule directly against the just-disbursed advance
    // instead — no live backend state is mutated below.
    const advanceForDomain = {
      ...disbursed,
      amount: Money.fromMajor(disbursed.amount),
      installments: disbursed.installments.map((i: any) => ({ ...i, amount: Money.fromMajor(i.amount), recovered: Money.fromMajor(i.recovered) })),
    };
    const repaid = applyAdvanceRecovery(advanceForDomain as any, Money.fromMajor("3000"));
    ctx.check("AD-13 — recovering the full outstanding flips the advance to مسددة (domain rule)", repaid.status === "repaid" && !!repaid.repaidAt);

    let overRecoveryRefused = false;
    try {
      applyAdvanceRecovery(advanceForDomain as any, Money.fromMajor("3000.01"));
    } catch (e) {
      overRecoveryRefused = e instanceof InvalidEmployeeAdvanceError;
    }
    ctx.check("AD-14 — recovering more than the outstanding balance is refused (domain rule)", overRecoveryRefused);
  });

  await ctx.scenario("hr / advance installment schedule — largest-remainder split always sums exactly (AD-07, AD-08)", async () => {
    const even = buildInstallmentSchedule(Money.fromMajor("6000"), 6, "2026-06-01");
    ctx.check("AD-07 — 6,000 / 6 installments = 1,000.00 each", even.every((i) => ctx.n(i.amount.toString()) === 1000));
    ctx.checkEq("AD-07 — installments sum exactly to the advance", even.reduce((s, i) => s + ctx.n(i.amount.toString()), 0), 6000);

    const uneven = buildInstallmentSchedule(Money.fromMajor("1000"), 3, "2026-06-01");
    ctx.checkEq("AD-08 — 1,000 / 3 installments still sum exactly (no cumulative rounding drift)", uneven.reduce((s, i) => s + ctx.n(i.amount.toString()), 0), 1000);
    ctx.check("AD-08 — no installment differs from another by more than one rounding unit", new Set(uneven.map((i) => i.amount.toString())).size <= 2);
  });

  await ctx.scenario("hr / payroll domain rules — mid-period proration exact split, multi-currency advance skipped (PR-20, AD-15)", async () => {
    const created: any[] = [];
    let updatedRun: any = null;
    const draftRun = {
      id: "SCN-PRORATE-RUN",
      number: "SCN-PRORATE-RUN",
      year: 2029,
      month: 8,
      periodStart: "2029-08-01",
      periodEnd: "2029-08-31",
      branchId: null,
      currency: "EGP",
      status: "draft",
      employeeCount: 0,
      totalGross: Money.zero(),
      totalDeductions: Money.zero(),
      totalEmployerContributions: Money.zero(),
      totalNet: Money.zero(),
      unpaidLeaveSource: "none",
      warnings: [],
      journalEntryId: null,
      disbursementVoucherId: null,
      calculatedAt: null,
      approvedAt: null,
      approvedBy: null,
      disbursedAt: null,
      cancelledAt: null,
      createdAt: "2029-08-01T00:00:00.000Z",
    };
    const employee = {
      id: "SCN-PRORATE-EMP",
      code: "SCN-0001",
      fullNameAr: "موظف اختبار التناسب",
      fullNameEn: "Prorate Test",
      departmentId: null,
      jobTitleId: null,
      branchId: "BR-TEST",
      managerId: null,
      hireDate: "2029-08-16",
      status: "active",
      workerCategory: "staff",
      overtimeEligibility: "not_eligible",
      standardWorkHours: null,
      probationEndDate: null,
      priorServiceYears: 0,
      requireSelfieAtClockIn: false,
      requireBiometricAtClockIn: false,
    };
    const contract = {
      id: "SCN-PRORATE-CTR",
      number: "SCN-PRORATE-CTR",
      employeeId: employee.id,
      type: "indefinite",
      payBasis: "monthly",
      payFrequency: "monthly",
      startDate: "2029-08-16",
      endDate: null,
      monthlySalary: Money.fromMajor("1000"),
      currency: "EGP",
      leaveEntitlement: { annualLeaveDays: null, sickLeaveDays: null, personalLeaveDays: null },
      allowances: [],
      deductions: [{ id: "SCN-D1", name: "خصم اختبار ثابت", amount: Money.fromMajor("50") }],
      status: "active",
      terminatedAt: null,
      createdAt: "2029-08-01T00:00:00.000Z",
    };
    const mismatchedAdvance = {
      id: "SCN-PRORATE-ADV",
      number: "SCN-PRORATE-ADV",
      employeeId: employee.id,
      amount: Money.fromMajor("500"),
      currency: "USD",
      installmentCount: 1,
      firstDeductionDate: "2029-08-01",
      reason: null,
      installments: [{ seq: 1, dueDate: "2029-08-01", amount: Money.fromMajor("500"), recovered: Money.zero() }],
      status: "disbursed",
      requestedAt: "2029-07-01T00:00:00.000Z",
      decidedAt: null,
      decidedBy: null,
      disbursedAt: "2029-07-01T00:00:00.000Z",
      disbursementVoucherId: null,
      disbursementJournalEntryId: null,
      repaidAt: null,
      createdAt: "2029-07-01T00:00:00.000Z",
    };

    const deps = {
      runs: {
        findById: async (id: string) => (id === draftRun.id ? (updatedRun ?? draftRun) : null),
        findByPeriod: async () => null,
        list: async () => [updatedRun ?? draftRun],
        create: async () => {},
        update: async (r: any) => {
          updatedRun = r;
        },
      },
      payslips: {
        findById: async () => null,
        listByRunId: async () => created,
        listByEmployeeId: async () => [],
        create: async (p: any) => {
          created.push(p);
        },
        deleteByRunId: async () => {
          created.length = 0;
        },
      },
      employees: {
        findById: async (id: string) => (id === employee.id ? employee : null),
        list: async () => [employee],
        listActive: async () => [employee],
      },
      contracts: { listByEmployeeId: async (id: string) => (id === employee.id ? [contract] : []) },
      advances: { listByEmployeeId: async (id: string) => (id === employee.id ? [mismatchedAdvance] : []) },
      numbering: { next: async (code: string) => ({ formatted: `${code}-SCN` }) },
      idGen: (() => {
        let n = 0;
        return () => `SCN-LINE-${++n}`;
      })(),
      now: () => "2029-08-31T00:00:00.000Z",
    };

    // This calculatePayrollRun call runs entirely against the fakes above —
    // it never touches the live backend spun up by boot(), so it needs no
    // scenario()-style books check and cannot affect any other assertion here.
    const calculated = await calculatePayrollRun(draftRun.id, deps as unknown as PayrollCalculationDeps);
    const slip = created[0];

    ctx.checkEq("PR-20 — paid days = 16 of 31 (contract/hire started mid-period)", slip.paidDays, 16);
    const expectedBasic = allocate(Money.fromMajor("1000"), [16, 15])[0]!;
    ctx.checkEq(
      "PR-20 — basic salary prorated by the exact largest-remainder split",
      ctx.n(slip.lines.find((l: any) => l.source === "contract_basic").amount.toString()),
      ctx.n(expectedBasic.toString()),
    );
    ctx.checkEq(
      "PR-20 — the fixed deduction is NOT prorated, taken in full regardless of paid days",
      ctx.n(slip.lines.find((l: any) => l.source === "contract_deduction").amount.toString()),
      50,
    );
    ctx.check(
      "PR-20 — the proration warning names the employee and the paid/period day split",
      calculated.warnings.some((w) => w.includes(employee.code) && w.includes("16") && w.includes("31")),
    );

    ctx.check(
      "AD-15 — an advance in a currency different from the run's is skipped with a named warning",
      calculated.warnings.some((w) => w.includes(mismatchedAdvance.number) && w.includes("USD") && w.includes("لم تُخصم")),
    );
    ctx.check("AD-15 — the mismatched-currency advance recovers nothing this run", !slip.lines.some((l: any) => l.referenceId === mismatchedAdvance.id));
  });

  await ctx.scenario("hr / leave — D11: a request exceeding the available balance is refused (LB-06)", async () => {
    const emp = await ctx.req("POST", "/hr/employees", { id: "SCN-EMP-LEAVE", firstName: "Scenario", lastName: "Leave", branchId, hireDate: "2020-01-01" });
    ctx.check("SCN employee for D11 created", emp.status === 201, `status ${emp.status}`);

    const original = await linkAdmin(ctx, emp.body.id);
    try {
      const submit = await ctx.req("POST", "/hr/leave-requests", { leaveType: "annual", startDate: "2029-10-01", endDate: "2029-10-10", reason: "سيناريو D11" });
      ctx.check("leave request submitted (self-service, no entitlement checked at submit time)", submit.status === 201, `status ${submit.status}`);
      ctx.checkEq("submitted request is 10 inclusive days, against a zero balance", submit.body.days, 10);

      const decide = await ctx.req("POST", `/hr/leave-requests/${submit.body.id}/approve`, {});
      ctx.check(
        "D11 — approving a request that exceeds the (zero) available balance is REFUSED",
        decide.status === 422 && decide.body?.error === "LEAVE_BALANCE_EXCEEDED",
        `${decide.status}: ${JSON.stringify(decide.body)}`,
      );
      ctx.check(
        "D11 — the refusal names both the requested days and what is actually available",
        typeof decide.body?.message === "string" && decide.body.message.includes("10") && decide.body.message.includes("0"),
        decide.body?.message,
      );

      const mine = ctx.rows((await ctx.req("GET", `/hr/leave-requests?employeeId=${emp.body.id}`)).body);
      const after = mine.find((r: any) => r.id === submit.body.id);
      ctx.check("D11 — the refused request stays بانتظار الموافقة, it is not half-approved", after?.status === "pending", JSON.stringify(after?.status));

      const balances = ctx.rows((await ctx.req("GET", `/hr/leave-balances?employeeId=${emp.body.id}&year=2029`)).body);
      const annual = balances.find((b: any) => b.leaveType === "annual");
      ctx.check("D11 — no balance was consumed by the refused approval", !annual || ctx.n(annual.used) === 0, JSON.stringify(annual));

      // Unpaid leave draws on no entitlement, so the same zero balance must not block it.
      const unpaid = await ctx.req("POST", "/hr/leave-requests", { leaveType: "unpaid", startDate: "2029-11-01", endDate: "2029-11-03", reason: "سيناريو D11 بدون أجر" });
      ctx.check("an unpaid-leave request submits", unpaid.status === 201, `status ${unpaid.status}`);
      const unpaidDecide = await ctx.req("POST", `/hr/leave-requests/${unpaid.body.id}/approve`, {});
      ctx.check(
        "D11 — unpaid leave is exempt from the balance guard and still approves",
        unpaidDecide.status === 200 && unpaidDecide.body.request.status === "approved",
        `${unpaidDecide.status}: ${JSON.stringify(unpaidDecide.body)}`,
      );

      // Grant the entitlement the request needs, and the same approval goes through.
      const grant = await ctx.req("POST", "/hr/leave-balances", { employeeId: emp.body.id, leaveType: "annual", year: 2029, entitled: "21", carriedOver: "0" });
      ctx.check("an annual entitlement can be granted for the year", grant.status === 201, `${grant.status}: ${JSON.stringify(grant.body)}`);
      const retry = await ctx.req("POST", `/hr/leave-requests/${submit.body.id}/approve`, {});
      ctx.check("D11 — with the entitlement in place the same request approves", retry.status === 200 && retry.body.request.status === "approved", `${retry.status}: ${JSON.stringify(retry.body)}`);

      const afterBalances = ctx.rows((await ctx.req("GET", `/hr/leave-balances?employeeId=${emp.body.id}&year=2029`)).body);
      const annualAfter = afterBalances.find((b: any) => b.leaveType === "annual");
      ctx.checkEq("the approved request consumes exactly its 10 days (21 − 10 = 11 available)", ctx.n(annualAfter?.available), 11);
    } finally {
      await linkAdmin(ctx, original);
    }
  });
}
