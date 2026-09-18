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

/** Executable checks for the hr module — see docs/TESTING.md §9. */

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
  const res = await ctx.req("PUT", "/users/USER-ADMIN", {
    // A full-replace PUT: every field the schema requires has to be echoed
    // back. Omitting one 400s, and the link this helper exists to make
    // silently does not happen.
    nameAr: cur.nameAr,
    nameEn: cur.nameEn ?? null,
    email: cur.email,
    phone: cur.phone,
    roleId: cur.roleId,
    isCompanyAdmin: cur.isCompanyAdmin,
    employeeId,
    branchScope: cur.branchScope,
    warehouseScope: cur.warehouseScope,
    status: cur.status,
  });
  // Asserted here, at the cause. This used to be fire-and-forget, so a refused
  // link showed up three assertions later as an unexplained zero balance.
  ctx.check(
    `linking USER-ADMIN to employee ${employeeId ?? "(none)"} succeeds`,
    res.status === 200,
    `${res.status}: ${JSON.stringify(res.body)}`,
  );
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
      "PR-10 — exactly 3 situational scope gaps (hourly/daily basis, pay frequency, multi-currency); garnishments are deducted now",
      situational.length === 3 && !situational.some((r) => r.code === "loans_garnishments"),
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
        `PR-08/D15 ${runId} — hourly employee excluded with a NAMED warning that reads in Arabic, not the raw code "hourly"`,
        !!hourlyWarning && hourlyWarning.includes("بالساعة") && !hourlyWarning.includes("hourly"),
        hourlyWarning ?? "no warning found naming the employee",
      );
      ctx.check(`PR-08 ${runId} — no payslip issued for the excluded hourly employee (not a zero payslip, not a blank row)`, !run.payslips.some((p: any) => p.employeeId === "EMP-DEMO-8"));
      ctx.check(
        `PR-13 ${runId} — no payslip line ever names tax/insurance/seniority/overtime/end-of-service`,
        run.payslips.every((p: any) => p.lines.every((l: any) => !/ضريبة|تأمين|أقدمية|إضافي|نهاية خدمة/.test(l.nameAr))),
      );
    }
  });

  await ctx.scenario("hr / garnishments — withheld before advances, counted down, and stopping when satisfied", async () => {
    const orders = ctx.rows((await ctx.req("GET", "/hr/payroll/garnishments")).body);
    ctx.check("GRN-01 — the register holds the seeded orders", orders.length >= 3, `got ${orders.length}`);

    for (const order of orders) {
      ctx.checkEq(`GRN-02 ${order.reference} — total always equals outstanding plus what has been recovered`, ctx.n(order.totalAmount), ctx.n(order.outstanding) + ctx.n(order.recovered));
      ctx.check(`GRN-03 ${order.reference} — an order is never left active with nothing left to collect`, !(order.active && ctx.n(order.outstanding) === 0), `active=${order.active} outstanding=${order.outstanding}`);
    }

    const withheld = orders.some((o: any) => ctx.n(o.recovered) > 0);
    ctx.check("GRN-04 — approving a run actually counted an order down (the seam is wired, not decorative)", withheld);

    // A court order outranks the employer's own loan, so on a payslip carrying
    // both, the garnishment line must precede the advance-recovery line.
    const run = (await ctx.req("GET", "/hr/payroll/runs/PR-DEMO-1")).body;
    for (const p of run.payslips) {
      const g = p.lines.findIndex((l: any) => l.source === "garnishment");
      const a = p.lines.findIndex((l: any) => l.source === "advance_recovery");
      if (g === -1 || a === -1) continue;
      ctx.check(`GRN-05 ${p.number} — the court order is taken before the employer's own advance`, g < a, `garnishment at ${g}, advance at ${a}`);
    }

    // The employee must be resolved against the real register: free text where
    // the reference picks an entity is money withheld from nobody.
    const bogus = await ctx.req("POST", "/hr/payroll/garnishments", {
      employeeId: "EMP-NOT-A-REAL-EMPLOYEE",
      kind: "court_order",
      reference: "TEST/9999",
      labelAr: "اختبار",
      totalAmount: "100",
      monthlyAmount: "50",
      currency: "EGP",
      startDate: "2026-01-01",
    });
    ctx.check("GRN-06 — an order against an employee id nobody holds is refused with 404", bogus.status === 404, `got ${bogus.status}`);

    const overInstalment = await ctx.req("POST", "/hr/payroll/garnishments", {
      employeeId: "EMP-DEMO-1",
      kind: "court_order",
      reference: "TEST/9998",
      labelAr: "اختبار",
      totalAmount: "100",
      monthlyAmount: "500",
      currency: "EGP",
      startDate: "2026-01-01",
    });
    ctx.check("GRN-07 — a monthly instalment larger than the order itself is refused", overInstalment.status === 422, `got ${overInstalment.status}`);
  });

  await ctx.scenario("hr / attendance summary — a workforce total, not four zeros over a full table", async () => {
    // The summary tiles rendered `?? 0` whenever no employee was picked, so
    // four zeros sat above forty-odd present days. A plausible zero is
    // indistinguishable from a bug; the honest figure was always available.
    const scoped = (await ctx.req("GET", "/hr/attendance/summary?employeeId=EMP-DEMO-1&from=2026-08-01&to=2026-08-31")).body;
    ctx.check("ATT-20 — a named employee still gets their own summary", scoped.employeeId === "EMP-DEMO-1", JSON.stringify(scoped.employeeId));

    const workforce = (await ctx.req("GET", "/hr/attendance/summary?from=2026-08-01&to=2026-08-31")).body;
    ctx.check("ATT-21 — omitting the employee answers for the WHOLE workforce instead of 400", workforce.employeeId === null, JSON.stringify(workforce.employeeId));
    ctx.check("ATT-22 — and its counts are non-zero where the attendance table has rows", workforce.daysPresent > 0, `daysPresent ${workforce.daysPresent}`);
    ctx.check(
      "ATT-23 — the workforce total covers at least the one employee's own days",
      workforce.daysPresent >= scoped.daysPresent,
      `${workforce.daysPresent} vs ${scoped.daysPresent}`,
    );
    ctx.check("ATT-24 — the attendance rate is a real percentage, not a placeholder", workforce.attendanceRatePercent > 0 && workforce.attendanceRatePercent <= 100, `${workforce.attendanceRatePercent}`);

    const missingDates = await ctx.req("GET", "/hr/attendance/summary?employeeId=EMP-DEMO-1");
    ctx.check("ATT-25 — the date range is still required", missingDates.status === 400, `got ${missingDates.status}`);
  });

  await ctx.scenario("hr / approved overtime — the manager's figure is captured and survives the round trip", async () => {
    const entries = ctx.rows((await ctx.req("GET", "/hr/attendance?employeeId=EMP-DEMO-6&from=2026-07-21&to=2026-07-21")).body);
    const day = entries[0];
    ctx.check("OT-01 — the approved-overtime field survives the round trip (a zod schema that omits it drops it silently)", day?.approvedOvertimeMinutes === 150, `got ${day?.approvedOvertimeMinutes}`);
    const plain = ctx.rows((await ctx.req("GET", "/hr/attendance?employeeId=EMP-DEMO-1&from=2026-07-20&to=2026-07-20")).body)[0];
    ctx.check("OT-02 — a day with no approval reads null, not zero", plain === undefined || plain.approvedOvertimeMinutes === null, `got ${plain?.approvedOvertimeMinutes}`);
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
    ctx.checkEq("PR-14 كريم عادل June — net = 8,150.00 (8,900 less the 750 court-order instalment)", ctx.n(kareem.netPay), 8150);
    ctx.check(
      "PR-14b — carries a garnishment line for GRN-DEMO-1 of exactly 750.00",
      kareem.lines.some((l: any) => l.source === "garnishment" && l.referenceId === "GRN-DEMO-1" && ctx.n(l.amount) === 750),
    );
    ctx.check(
      "PR-14 — carries an advance-recovery line for ADV-DEMO-1 of exactly 1,000.00",
      kareem.lines.some((l: any) => l.source === "advance_recovery" && l.referenceId === "ADV-DEMO-1" && ctx.n(l.amount) === 1000),
    );

    const mohamed = run.payslips.find((p: any) => p.employeeId === "EMP-DEMO-3");
    ctx.checkEq("PR-15 محمد الشهابي — gross = 22,000.00 (18,000 + 2,500 + 1,500)", ctx.n(mohamed.grossEarnings), 22000);
    ctx.check("PR-15 — no deduction line at all", mohamed.lines.every((l: any) => l.kind !== "deduction"));
    ctx.checkEq("PR-15 — net = gross (no deductions)", ctx.n(mohamed.netPay), 22000);

    const salma = run.payslips.find((p: any) => p.employeeId === "EMP-DEMO-2");
    ctx.checkEq("PR-19 سلمى فؤاد — the RENEWAL contract (ECT-DEMO-3) is picked: 7,800 + 600 = 8,400 gross, not ECT-DEMO-2's 7,000", ctx.n(salma.grossEarnings), 8400);

    const hoda = run.payslips.find((p: any) => p.employeeId === "EMP-DEMO-4");
    ctx.checkEq("PR-16 هدى مصطفى — «في إجازة» employee STATUS alone does not reduce pay: net = 8,100.00", ctx.n(hoda.netPay), 8100);
  });

  await ctx.scenario("hr / payslip arithmetic — an approved UNPAID-type leave prorates the deduction exactly (PR-17, PR-DEMO-2 July)", async () => {
    const run = (await ctx.req("GET", "/hr/payroll/runs/PR-DEMO-2")).body;
    const mostafa = run.payslips.find((p: any) => p.employeeId === "EMP-DEMO-6");
    const unpaidLine = mostafa.lines.find((l: any) => l.source === "unpaid_leave");
    ctx.check("PR-17 مصطفى رزق — July payslip carries an unpaid-leave deduction line (LR-DEMO-8, 2 days)", !!unpaidLine && unpaidLine.nameAr.includes("2"), unpaidLine?.nameAr);
    if (unpaidLine) {
      // The tenant's day divisor prices the day: FIXED_30 by default, so a
      // July day is the monthly wage ÷ 30, not ÷ 31.
      const settings = (await ctx.req("GET", "/settings")).body;
      const divisor = settings.payrollDayDivisorBasis === "CALENDAR_DAYS" ? mostafa.periodDays : 30;
      const monthly = mostafa.lines
        .filter((l: any) => l.source === "contract_basic" || l.source === "contract_allowance")
        .reduce((sum: number, l: any) => sum + ctx.n(l.amount), 0);
      const expected = allocate(Money.fromMajor(monthly.toFixed(6)), [2, divisor - 2])[0]!;
      ctx.checkEq("PR-17 — deduction is the monthly wage split by the tenant's day divisor over the unpaid days", ctx.n(unpaidLine.amount), ctx.n(expected.toString()));
    }
    ctx.checkEq("PR-17 — net still equals gross minus deductions", ctx.n(mostafa.grossEarnings) - ctx.n(mostafa.totalDeductions), ctx.n(mostafa.netPay));
  });

  await ctx.scenario("hr / contracts — a lapsed fixed-term contract keeps reporting status ساري (known behavior)", async () => {
    const c = (await ctx.req("GET", "/hr/contracts/ECT-DEMO-2")).body;
    ctx.check(
      "CT-02 — ECT-DEMO-2 ended 2026-01-14 (over 7 months ago) but is still status active, not auto-terminated by the passed date",
      c.status === "active" && c.endDate < "2026-08-24",
      `status=${c.status} endDate=${c.endDate}`,
    );
  });

  // The next two scenarios rely on PR-DEMO-1/2/3 still sitting at their seeded
  // disbursed/approved/calculated states — every refusal below must run BEFORE
  // "advance recovery" and "payroll disbursement" mutate PR-DEMO-3.
  await ctx.scenario("hr / payroll lifecycle — every transition is refused from the wrong state, in Arabic (D15)", async () => {
    const draft = await ctx.req("POST", "/hr/payroll/runs", { id: "SCN-PR-DRAFT-1", year: 2029, month: 5, branchId, currency: "EGP" });
    ctx.check("draft run created for the refusal test", draft.status === 201, `status ${draft.status}`);

    const approveUncalculated = await ctx.req("POST", `/hr/payroll/runs/${draft.body.id}/approve`, {});
    ctx.check("PR-26 — approving an uncalculated (مسودة) run is refused", approveUncalculated.status === 422, `status ${approveUncalculated.status}`);
    ctx.check(
      "D15 — the refusal reads in Arabic and names both states (مسودة → معتمد)",
      /لا يمكن نقل مسير الرواتب من "مسودة" إلى "معتمد"/.test(approveUncalculated.body?.message ?? ""),
      approveUncalculated.body?.message,
    );

    const recalcDisbursed = await ctx.req("POST", "/hr/payroll/runs/PR-DEMO-1/calculate", {});
    ctx.check("calculating an already-disbursed (مصروف) run is refused", recalcDisbursed.status === 422, `status ${recalcDisbursed.status}`);
    ctx.check(
      "D15 — the refusal names the real from/to states in Arabic (مصروف → محتسب)",
      /لا يمكن نقل مسير الرواتب من "مصروف" إلى "محتسب"/.test(recalcDisbursed.body?.message ?? ""),
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

  await ctx.scenario("hr / leave — R10.5: an admin files a request for another employee, and only with the approval permission", async () => {
    const created = await ctx.req("POST", "/hr/leave-requests", {
      employeeId: "EMP-DEMO-1",
      leaveType: "annual",
      startDate: "2029-04-02",
      endDate: "2029-04-04",
      reason: "R10.5 — نيابة عن الموظف",
    });
    ctx.check("R10.5 — the admin list can file a leave request for a named employee", created.status === 201, `${created.status}: ${JSON.stringify(created.body)}`);
    ctx.check("the stored request carries the picked employee's REAL id, not the caller's", created.body.employeeId === "EMP-DEMO-1", String(created.body.employeeId));

    const unknown = await ctx.req("POST", "/hr/leave-requests", { employeeId: "EMP-NOPE", leaveType: "annual", startDate: "2029-04-02", endDate: "2029-04-04" });
    ctx.check("filing for an employee that does not exist is refused", unknown.status === 404, `status ${unknown.status}`);

    const withoutApproval = await ctx.req(
      "POST",
      "/hr/leave-requests",
      { employeeId: "EMP-DEMO-2", leaveType: "annual", startDate: "2029-04-02", endDate: "2029-04-04" },
      { "x-permissions": "hr.leave.view,hr.leave.create", "x-role-codes": "hr" },
    );
    ctx.check(
      "filing on someone else's behalf needs hr.leave.approve — hr.leave.create alone is self-service only",
      withoutApproval.status === 403,
      `status ${withoutApproval.status}`,
    );
  });

  await ctx.scenario("hr / leave — cancelling an APPROVED request gives the consumed days back to the balance", async () => {
    const year = 2029;
    const grant = await ctx.req("POST", "/hr/leave-balances", { employeeId: "EMP-DEMO-5", leaveType: "casual", year, entitled: "6", carriedOver: "0" });
    ctx.check("an entitlement can be granted for the year", grant.status === 201 || grant.status === 200, `${grant.status}: ${JSON.stringify(grant.body)}`);

    const before = ctx.rows((await ctx.req("GET", `/hr/leave-balances?employeeId=EMP-DEMO-5&year=${year}`)).body).find((b: any) => b.leaveType === "casual");
    const request = await ctx.req("POST", "/hr/leave-requests", { employeeId: "EMP-DEMO-5", leaveType: "casual", startDate: "2029-05-04", endDate: "2029-05-05" });
    ctx.check("the request is filed", request.status === 201, `${request.status}: ${JSON.stringify(request.body)}`);
    await ctx.req("POST", `/hr/leave-requests/${request.body.id}/approve`, {});

    const consumed = ctx.rows((await ctx.req("GET", `/hr/leave-balances?employeeId=EMP-DEMO-5&year=${year}`)).body).find((b: any) => b.leaveType === "casual");
    ctx.checkEq("approving consumes the two days", ctx.n(consumed?.used) - ctx.n(before?.used), 2);

    const cancelled = await ctx.req("POST", `/hr/leave-requests/${request.body.id}/cancel`, {});
    ctx.check("an approver can cancel the request", cancelled.status === 200 && cancelled.body.status === "cancelled", `${cancelled.status}: ${JSON.stringify(cancelled.body)}`);

    const released = ctx.rows((await ctx.req("GET", `/hr/leave-balances?employeeId=EMP-DEMO-5&year=${year}`)).body).find((b: any) => b.leaveType === "casual");
    ctx.checkEq(
      "cancelling releases exactly those days — the matrix must not keep counting leave that was never taken",
      ctx.n(released?.used),
      ctx.n(before?.used),
    );
  });

  await ctx.scenario("hr / payroll — R10.7: a contract line's component decides which GL account the entry debits", async () => {
    const components = ctx.rows((await ctx.req("GET", "/hr/payroll/components")).body);
    ctx.check("the payroll-component registry is populated", components.length > 0, `${components.length} components`);
    const transport = components.find((c: any) => c.id === "PC-DEMO-TRANSPORT");
    ctx.check("the transport allowance is routed to its own account, not the salary account", transport?.glAccountId === "5121", JSON.stringify(transport));

    const contract = (await ctx.req("GET", "/hr/contracts/ECT-DEMO-1")).body;
    ctx.check(
      "every allowance line on the contract binds to a REAL component id, never free text alone",
      contract.allowances.length > 0 && contract.allowances.every((a: any) => typeof a.componentId === "string" && a.componentId.length > 0),
      JSON.stringify(contract.allowances),
    );

    const run = (await ctx.req("GET", "/hr/payroll/runs/PR-DEMO-1")).body;
    const entry = (await ctx.req("GET", `/gl/journal-entries/${run.journalEntryId}`)).body;
    const debits = new Map<string, number>();
    for (const line of entry.lines) debits.set(line.accountId, (debits.get(line.accountId) ?? 0) + ctx.n(line.debit));
    ctx.check("the payroll entry debits the allowance account 5121 separately from basic pay 5120", (debits.get("5121") ?? 0) > 0 && (debits.get("5120") ?? 0) > 0, JSON.stringify([...debits]));

    const payslips = run.payslips as any[];
    const allowanceTotal = payslips
      .flatMap((p) => p.lines)
      .filter((l: any) => l.source === "contract_allowance")
      .reduce((sum: number, l: any) => sum + ctx.n(l.amount), 0);
    ctx.checkEq("the 5121 debit equals the sum of the allowance lines to the cent", debits.get("5121") ?? 0, allowanceTotal);
    await assertBalancedEntry(ctx, "R10.7 payroll entry", run.journalEntryId);
  });

  await ctx.scenario("hr / employees — R10.2: re-hiring a terminated employee keeps the years already served", async () => {
    const code = `SCN-RH-${Date.now()}`;
    const created = await ctx.req("POST", "/hr/employees", {
      firstName: "Rehire",
      lastName: "Case",
      firstNameAr: "معاد",
      lastNameAr: "تعيينه",
      branchId,
      hireDate: "2020-01-01",
      priorServiceYears: 1,
    });
    ctx.check(`an employee can be created for the re-hire case (${code})`, created.status === 201, `${created.status}: ${JSON.stringify(created.body)}`);

    const stillActive = await ctx.req("POST", `/hr/employees/${created.body.id}/rehire`, { hireDate: "2026-01-01" });
    ctx.check("an employee who was never terminated cannot be re-hired", stillActive.status === 422, `status ${stillActive.status}`);

    await ctx.req("POST", `/hr/employees/${created.body.id}/terminate`, {});
    const rehired = await ctx.req("POST", `/hr/employees/${created.body.id}/rehire`, { hireDate: "2026-01-01" });
    ctx.check("R10.2 — a terminated employee can be re-hired", rehired.status === 200 && rehired.body.status === "active", `${rehired.status}: ${JSON.stringify(rehired.body)}`);
    ctx.check("the re-hire date becomes the new hire date", rehired.body.hireDate === "2026-01-01", String(rehired.body.hireDate));
    ctx.check("the termination stamp is cleared", rehired.body.terminatedAt === null, JSON.stringify(rehired.body.terminatedAt));
    ctx.check(
      "the previous spell survives as prior service (1 + ~6 years), never silently discarded",
      rehired.body.priorServiceYears >= 7,
      `priorServiceYears ${rehired.body.priorServiceYears}`,
    );
  });
}
