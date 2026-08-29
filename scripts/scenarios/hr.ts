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

  // Several scenarios below open payroll runs in 2029 to stay clear of the
  // seeded 2026 ones. The app ships insurance limits only for years that have
  // actually been published, so 2029 is entered here the way an admin would —
  // which also means every one of those scenarios is exercising the override
  // path rather than assuming it works.
  await ctx.req("PUT", "/hr/payroll/statutory-tables/insurance-years/2029", {
    monthlyWageFloor: "4100",
    monthlyWageCeiling: "25400",
    note: "مُدخلة للسيناريوهات",
  });

  await ctx.scenario("hr / payroll scope notice — the remaining gaps are the ones that are actually still gaps", async () => {
    // Flipped when Egyptian statutory payroll landed. This block used to assert
    // that NO payslip line ever named tax, insurance, seniority, overtime or
    // end-of-service — a faithful guard while the engine computed none of them,
    // and a guard pointing the wrong way the moment it did.
    const universal = PAYROLL_UNIMPLEMENTED_RULES.filter((r) => r.appliesToEveryPayslip);
    const situational = PAYROLL_UNIMPLEMENTED_RULES.filter((r) => !r.appliesToEveryPayslip);
    ctx.check(
      "PR-09 — the only universal gap left is the December annual tax settlement",
      universal.length === 1 && universal[0]?.code === "annual_tax_settlement",
      universal.map((r) => r.code).join(", "),
    );
    ctx.check(
      "PR-10 — two situational gaps remain: in-kind benefits and the FX difference on a foreign-currency contract",
      situational.length === 2,
      situational.map((r) => r.code).join(", "),
    );
    ctx.check(
      "PR-09b — nothing still claims tax, insurance, overtime or end-of-service are uncalculated",
      !PAYROLL_UNIMPLEMENTED_RULES.some((r) => ["income_tax", "social_insurance", "overtime", "end_of_service", "seniority_bonus"].includes(r.code)),
      PAYROLL_UNIMPLEMENTED_RULES.map((r) => r.code).join(", "),
    );

    const amr = (await ctx.req("GET", "/hr/employees/EMP-DEMO-8")).body;
    const amrName = [amr.firstNameAr, amr.lastNameAr].filter(Boolean).join(" ").trim() || `${amr.firstName} ${amr.lastName}`;

    for (const runId of ["PR-DEMO-1", "PR-DEMO-2", "PR-DEMO-3"]) {
      const run = (await ctx.req("GET", `/hr/payroll/runs/${runId}`)).body;
      ctx.checkEq(`${runId} — the count in the scope notice equals the run's actual employeeCount`, run.employeeCount, run.payslips.length);
      ctx.check(`PR-04 ${runId} — employeeCount excludes the hourly contract with no attendance (7, not 8 or 9)`, run.employeeCount === 7, `got ${run.employeeCount}`);

      // An employee can attract more than one warning (pay frequency AND pay
      // basis), so this looks through ALL of them: matching only the first
      // asserted whichever happened to be pushed earliest.
      const named = (run.warnings as string[]).filter((w) => w.includes(amrName) && w.includes(amr.code));
      ctx.check(
        `PR-08/D15 ${runId} — hourly employee excluded with a NAMED warning that reads in Arabic, not the raw code "hourly"`,
        named.some((w) => w.includes("بالساعة") && w.includes("استبعاده")) && !named.some((w) => w.includes("hourly")),
        named.join(" | ") || "no warning found naming the employee",
      );
      ctx.check(`PR-08 ${runId} — no payslip issued for the excluded hourly employee (not a zero payslip, not a blank row)`, !run.payslips.some((p: any) => p.employeeId === "EMP-DEMO-8"));
      ctx.check(
        `PR-13 ${runId} — every payslip now carries BOTH statutory deductions, and the run records which dated tables produced them`,
        run.statutoryTableCodes.length === 5 &&
          run.payslips.every((p: any) => {
            const sources = p.lines.map((l: any) => l.source);
            return sources.includes("social_insurance_employee") && sources.includes("social_insurance_employer");
          }),
        `tables ${run.statutoryTableCodes.join(", ")}`,
      );
    }
  });

  await ctx.scenario("hr / statutory payroll — the Egyptian figures, checked against the law not against themselves", async () => {
    const tables = (await ctx.req("GET", "/hr/payroll/statutory-tables")).body;
    const si2026 = tables.socialInsurance.find((t: any) => t.code === "EG_SOCIAL_INSURANCE_2026");
    ctx.check("PR-20 — the 2026 insurance floor is 2,700 and the ceiling 16,700 (Law 148/2019)", si2026?.monthlyWageFloor === "2700" && si2026?.monthlyWageCeiling === "16700", JSON.stringify(si2026?.monthlyWageFloor));
    ctx.check("PR-21 — the shares are 11% employee and 18.75% employer", si2026?.employeeTotalPercent === "11" && si2026?.employerTotalPercent === "18.75");
    const tax = tables.incomeTax[0];
    ctx.check("PR-22 — the personal exemption is 20,000 a year and the top band is 27.5%", tax?.annualPersonalExemption === "20000" && tax?.brackets.at(-1)?.ratePercent === "27.5");

    const run = (await ctx.req("GET", "/hr/payroll/runs/PR-DEMO-1")).body;

    // A salary above the ceiling contributes on the ceiling, NOT on gross. This
    // is the single most common Egyptian payroll error, so it is asserted on a
    // seeded salary chosen to exceed it rather than left to chance.
    const capped = run.payslips.find((p: any) => p.insurableWageCapped);
    ctx.check("PR-23 — a salary above the ceiling is capped at 16,700, not contributed on gross", !!capped && ctx.n(capped.insurableWage) === 16700, capped ? `insurable ${capped.insurableWage}` : "no capped payslip in the run");
    if (capped) {
      const employee = capped.lines.find((l: any) => l.source === "social_insurance_employee");
      const employer = capped.lines.find((l: any) => l.source === "social_insurance_employer");
      ctx.checkEq("PR-24 — the employee share is 11% OF THE CEILING (1,837.00)", ctx.n(employee.amount), 1837);
      ctx.checkEq("PR-25 — the employer share is 18.75% of the ceiling (3,131.25)", ctx.n(employer.amount), 3131.25);
    }

    // The brackets are ANNUAL. Walking them on one month's pay would put every
    // employee in the 0% band and withhold nothing, so the check recomputes the
    // annualisation by hand rather than trusting the engine's own figure.
    for (const p of run.payslips) {
      const insurance = p.lines.filter((l: any) => l.source === "social_insurance_employee").reduce((s: number, l: any) => s + ctx.n(l.amount), 0);
      const taxLine = p.lines.find((l: any) => l.source === "income_tax");
      const annual = Math.max((ctx.n(p.grossEarnings) - insurance) * 12 - 20000, 0);
      ctx.checkEq(`PR-26 ${p.number} — the annual taxable income is (gross − insurance) × 12 − 20,000`, ctx.n(p.annualTaxableIncome), annual);

      let expected = 0;
      const bands: [number, number][] = [[40000, 0], [55000, 0.1], [70000, 0.15], [200000, 0.2], [400000, 0.225], [1200000, 0.25]];
      let lower = 0;
      for (const [upper, rate] of bands) {
        expected += Math.max(Math.min(annual, upper) - lower, 0) * rate;
        lower = upper;
      }
      expected += Math.max(annual - 1200000, 0) * 0.275;
      ctx.checkEq(`PR-27 ${p.number} — the withheld tax is the annual bracket walk divided by twelve`, taxLine ? ctx.n(taxLine.amount) : 0, Math.round((expected / 12) * 100) / 100);
    }

    // Every payslip's parts must sum to its own whole, and the run's totals to
    // the payslips'. Two figures that must agree beat either alone.
    let runGross = 0;
    let runNet = 0;
    for (const p of run.payslips) {
      const earnings = p.lines.filter((l: any) => l.kind === "earning").reduce((s: number, l: any) => s + ctx.n(l.amount), 0);
      const deductions = p.lines.filter((l: any) => l.kind === "deduction").reduce((s: number, l: any) => s + ctx.n(l.amount), 0);
      const employer = p.lines.filter((l: any) => l.kind === "employer_contribution").reduce((s: number, l: any) => s + ctx.n(l.amount), 0);
      ctx.checkEq(`PR-28 ${p.number} — gross is exactly the sum of its earning lines`, ctx.n(p.grossEarnings), earnings);
      ctx.checkEq(`PR-29 ${p.number} — net is exactly gross less every deduction line`, ctx.n(p.netPay), earnings - deductions);
      ctx.checkEq(`PR-30 ${p.number} — employer cost is gross plus the employer contributions, and never touches net`, ctx.n(p.totalEmployerCost), earnings + employer);
      runGross += earnings;
      runNet += earnings - deductions;
    }
    ctx.checkEq("PR-31 — the run's totalGross is the sum of its payslips", ctx.n(run.totalGross), runGross);
    ctx.checkEq("PR-32 — the run's totalNet is the sum of its payslips", ctx.n(run.totalNet), runNet);
  });

  await ctx.scenario("hr / statutory returns — each one ties to the GL account it is filed against", async () => {
    // A return that does not agree with the ledger will not survive an
    // inspection. Both reports carry a reconciliation banner for exactly this,
    // and the banner is worth nothing if nothing ever checks it.
    for (const [label, path, account] of [
      ["social insurance", "/reports/hr/social-insurance-return?year=2026", "2192"],
      ["salary tax", "/reports/hr/salary-tax-return?year=2026", "2191"],
    ] as const) {
      const report = (await ctx.req("GET", path)).body;
      ctx.check(`PR-33 — the ${label} return renders a reconciliation banner`, report.reconciliation != null, JSON.stringify(report.reconciliation));
      if (report.reconciliation) {
        ctx.checkEq(
          `PR-34 — the ${label} return agrees with control account ${account}`,
          ctx.n(report.reconciliation.reportTotal),
          ctx.n(report.reconciliation.referenceTotal),
        );
      }
    }

    const register = (await ctx.req("GET", "/reports/hr/payroll-register?year=2026")).body;
    const runs = ctx.rows((await ctx.req("GET", "/hr/payroll/runs")).body).filter((r: any) => r.status === "approved" || r.status === "disbursed");
    ctx.checkEq(
      "PR-35 — the register's net equals the nets of the runs actually in the books, and counts no draft run",
      register.rows.reduce((s: number, r: any) => s + ctx.n(r.netPay), 0),
      runs.reduce((s: number, r: any) => s + ctx.n(r.totalNet), 0),
    );
  });

  await ctx.scenario("hr / an unpublished year is REFUSED, then unblocked by entering its limits — never computed on a stale ceiling", async () => {
    // The insurance floor and ceiling rise every 1 January. Falling back to last
    // year's table would produce a net that looks right and is legally wrong,
    // so the run refuses — and, because an ERP that stops every New Year until
    // a software update is broken, an admin can enter the published figures and
    // carry on. Both halves are asserted, because either alone is a defect.
    const created = await ctx.req("POST", "/hr/payroll/runs", { year: 2028, month: 1, branchId, currency: "EGP" });
    ctx.check("PR-36 — a run can still be OPENED for an unpublished year (the refusal belongs at calculation)", created.status === 201, `got ${created.status}`);

    const refused = await ctx.req("POST", `/hr/payroll/runs/${created.body.id}/calculate`, {});
    ctx.check("PR-37 — calculating it is refused with 422 rather than computed on 2026's ceiling", refused.status === 422, `got ${refused.status}`);
    ctx.check(
      "PR-38 — and the refusal names the missing year in Arabic and says where to fix it, not a raw code",
      refused.body?.error === "STATUTORY_RULES_UNAVAILABLE" && /2028/.test(String(refused.body?.message)) && /الأجر التأميني/.test(String(refused.body?.message)),
      JSON.stringify(refused.body),
    );

    const bad = await ctx.req("PUT", "/hr/payroll/statutory-tables/insurance-years/2028", { monthlyWageFloor: "5000", monthlyWageCeiling: "4000" });
    ctx.check("PR-39 — a ceiling below the floor is refused, so a transposed pair cannot be saved", bad.status === 422, `got ${bad.status}`);

    const entered = await ctx.req("PUT", "/hr/payroll/statutory-tables/insurance-years/2028", {
      monthlyWageFloor: "3600",
      monthlyWageCeiling: "22100",
      note: "قرار حدود الأجر التأميني لعام 2028",
    });
    ctx.check("PR-40 — an admin can enter the published limits for the year", entered.status === 200, `got ${entered.status}`);

    const calculated = await ctx.req("POST", `/hr/payroll/runs/${created.body.id}/calculate`, {});
    ctx.check("PR-41 — and the SAME run then calculates, with no restart and no application update", calculated.status === 200, `got ${calculated.status}`);
    ctx.check(
      "PR-42 — the run records that it used the entered table, so a reprint can say where its figures came from",
      (calculated.body.statutoryTableCodes as string[]).includes("EG_SOCIAL_INSURANCE_2028_OVERRIDE"),
      (calculated.body.statutoryTableCodes ?? []).join(", "),
    );
    const capped = calculated.body.payslips.find((p: any) => p.insurableWageCapped);
    ctx.check("PR-43 — and the ENTERED ceiling is the one that binds, not the shipped 16,700", !capped || ctx.n(capped.insurableWage) === 22100, capped ? `insurable ${capped.insurableWage}` : "nobody hit the 2028 ceiling");

    await ctx.req("POST", `/hr/payroll/runs/${created.body.id}/cancel`, {});
    await ctx.req("DELETE", "/hr/payroll/statutory-tables/insurance-years/2028", {});
    const afterRemoval = await ctx.req("GET", "/hr/payroll/statutory-tables");
    ctx.check(
      "PR-44 — removing the entered year takes it back out of the resolved tables",
      !(afterRemoval.body.insuranceYearOverrides as any[]).some((o) => o.year === 2028),
      JSON.stringify(afterRemoval.body.insuranceYearOverrides),
    );
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

  await ctx.scenario("hr / provisions — the accruing obligations reach the LEDGER, not just a report", async () => {
    // Before this existed, the end-of-service report could compute 419,210 of
    // liability and account 2181 could sit at zero forever: a report standing
    // in for a fact the books never recorded, and a balance sheet understated
    // by the whole obligation.
    const asOfDate = "2026-08-31";

    for (const kind of ["end_of_service", "leave"] as const) {
      const before = (await ctx.req("GET", `/hr/payroll/provisions/${kind}/preview?asOfDate=${asOfDate}`)).body;
      ctx.checkEq(
        `PRV-01 ${kind} — the movement offered is owed MINUS booked, never the total`,
        ctx.n(before.movement),
        ctx.n(before.computedTotal) - ctx.n(before.postedBalance),
      );
      if (ctx.n(before.movement) === 0) continue;

      const posted = await ctx.req("POST", `/hr/payroll/provisions/${kind}`, { asOfDate });
      ctx.check(`PRV-02 ${kind} — posting succeeds and returns its journal entry`, posted.status === 200 && !!posted.body.journalEntryId, `status ${posted.status}`);
      await assertBalancedEntry(ctx, `PRV-03 ${kind}`, posted.body.journalEntryId);

      const after = (await ctx.req("GET", `/hr/payroll/provisions/${kind}/preview?asOfDate=${asOfDate}`)).body;
      ctx.checkEq(`PRV-04 ${kind} — the liability account now carries exactly what is owed`, ctx.n(after.postedBalance), ctx.n(before.computedTotal));
      ctx.checkEq(`PRV-05 ${kind} — and there is nothing left to post`, ctx.n(after.movement), 0);

      // Posting again must not double the liability. This is the whole reason
      // the movement is posted rather than the total.
      const again = await ctx.req("POST", `/hr/payroll/provisions/${kind}`, { asOfDate });
      ctx.check(`PRV-06 ${kind} — posting a second time is REFUSED rather than doubling the provision`, again.status === 422, `status ${again.status}`);
      const stillAfter = (await ctx.req("GET", `/hr/payroll/provisions/${kind}/preview?asOfDate=${asOfDate}`)).body;
      ctx.checkEq(`PRV-07 ${kind} — and the balance is unchanged by the refused attempt`, ctx.n(stillAfter.postedBalance), ctx.n(after.postedBalance));
    }

    // The report and the ledger must now agree — which is the point of all of it.
    const eos = (await ctx.req("GET", `/reports/hr/end-of-service-provision?asOfDate=${asOfDate}`)).body;
    ctx.check("PRV-08 — the end-of-service report still renders its reconciliation banner", eos.reconciliation != null);
    if (eos.reconciliation) {
      ctx.checkEq("PRV-09 — and it now TIES: the computed provision equals account 2181", ctx.n(eos.reconciliation.reportTotal), ctx.n(eos.reconciliation.referenceTotal));
    }
  });

  await ctx.scenario("hr / end-of-service settlement — the statutory tiers, and a running employee refused", async () => {
    const settlement = (await ctx.req("GET", "/hr/employees/EMP-DEMO-9/end-of-service")).body;
    ctx.check("EOS-01 — a terminated employee gets a settlement statement", settlement.serviceYears > 0, JSON.stringify(settlement.serviceYears));
    ctx.checkEq(
      "EOS-02 — net settlement is gratuity plus payable leave less outstanding advances",
      ctx.n(settlement.netSettlement),
      Math.max(ctx.n(settlement.gratuity) + ctx.n(settlement.leavePayout) - ctx.n(settlement.outstandingAdvances), 0),
    );
    ctx.check("EOS-03 — the gratuity is broken down by the statutory tier it came from, not shown as one opaque figure", settlement.gratuityBreakdown.length > 0);
    ctx.check("EOS-04 — the statement cites the law it was computed under", /14 لسنة 2025/.test(String(settlement.citationAr)), settlement.citationAr);

    // Half a month per year for the first five years: an employee under five
    // years must never be credited a full month.
    if (settlement.serviceYears < 5) {
      ctx.checkEq("EOS-05 — under five years earns half a month per year, not a full one", ctx.n(settlement.monthsEarned), Math.round(settlement.serviceYears * 0.5 * 100) / 100);
    }

    const stillEmployed = await ctx.req("GET", "/hr/employees/EMP-DEMO-1/end-of-service");
    ctx.check("EOS-06 — a serving employee is refused, not quoted a settlement", stillEmployed.status === 422 && stillEmployed.body?.error === "EMPLOYEE_STILL_EMPLOYED", `got ${stillEmployed.status}`);
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

  await ctx.scenario("hr / overtime — approved minutes pay, at the statutory premium for the hour worked", async () => {
    // The clock on EMP-DEMO-6's 2026-07-21 shift implies more overtime than was
    // authorised. Payroll must pay the APPROVED figure: a clock records
    // presence, not authorised work.
    const entries = ctx.rows((await ctx.req("GET", "/hr/attendance?employeeId=EMP-DEMO-6&from=2026-07-21&to=2026-07-21")).body);
    const day = entries[0];
    ctx.check("OT-01 — the approved-overtime field survives the round trip (a zod schema that omits it drops it silently)", day?.approvedOvertimeMinutes === 150, `got ${day?.approvedOvertimeMinutes}`);
    ctx.check("OT-02 — and it is LOWER than the clock implies, so the test proves approval wins over derivation", day.workedMinutes - 480 > 150, `worked ${day.workedMinutes} minutes`);

    const july = (await ctx.req("GET", "/hr/payroll/runs/PR-DEMO-2")).body;
    const slip = july.payslips.find((p: any) => p.employeeId === "EMP-DEMO-6");
    const overtime = slip?.lines.filter((l: any) => l.source === "overtime") ?? [];
    ctx.check("OT-03 — the July run pays an overtime line for that employee", overtime.length > 0, `${overtime.length} overtime lines`);
    ctx.check("OT-04 — the line says how many hours it paid for, so the figure can be checked", overtime.every((l: any) => /ساعة/.test(l.nameAr)), overtime.map((l: any) => l.nameAr).join(" | "));
    ctx.check("OT-05 — the run records that an overtime source was bound at all", july.overtimeSource === "provider", july.overtimeSource);
  });

  await ctx.scenario("hr / payslip arithmetic — gross minus deductions equals net, per payslip and run total (PR-DEMO-1, June, مصروف)", async () => {
    const run = (await ctx.req("GET", "/hr/payroll/runs/PR-DEMO-1")).body;
    for (const p of run.payslips) {
      ctx.checkEq(`payslip ${p.number} (${p.employeeId}) — gross - deductions = net`, ctx.n(p.grossEarnings) - ctx.n(p.totalDeductions), ctx.n(p.netPay));
    }
    ctx.checkEq("PR-DEMO-1 — run totalGross = sum of payslip grossEarnings", ctx.n(run.totalGross), run.payslips.reduce((s: number, p: any) => s + ctx.n(p.grossEarnings), 0));
    ctx.checkEq("PR-DEMO-1 — run totalDeductions = sum of payslip totalDeductions", ctx.n(run.totalDeductions), run.payslips.reduce((s: number, p: any) => s + ctx.n(p.totalDeductions), 0));
    ctx.checkEq("PR-DEMO-1 — run totalNet = sum of payslip netPay", ctx.n(run.totalNet), run.payslips.reduce((s: number, p: any) => s + ctx.n(p.netPay), 0));

    // Flipped when statutory payroll landed: these nets were 8,900 / 22,000 /
    // 8,100 while nothing was withheld. Each figure below is the same gross
    // less the insurance, salary tax and Martyrs Fund the engine now computes,
    // checked by hand against the 2026 tables before being written down.
    const kareem = run.payslips.find((p: any) => p.employeeId === "EMP-DEMO-1");
    ctx.checkEq("PR-14 كريم عادل June — gross 10,000 less 3,547.50 of deductions = 6,452.50", ctx.n(kareem.netPay), 6452.5);
    ctx.checkEq("PR-14b — insurance is 11% of the full 10,000 (under the ceiling)", ctx.n(kareem.lines.find((l: any) => l.source === "social_insurance_employee").amount), 1100);
    ctx.checkEq("PR-14c — salary tax is 592.50, the annual bracket walk on (10,000 − 1,100) × 12 − 20,000", ctx.n(kareem.lines.find((l: any) => l.source === "income_tax").amount), 592.5);
    ctx.check(
      "PR-14 — carries an advance-recovery line for ADV-DEMO-1 of exactly 1,000.00",
      kareem.lines.some((l: any) => l.source === "advance_recovery" && l.referenceId === "ADV-DEMO-1" && ctx.n(l.amount) === 1000),
    );

    const mohamed = run.payslips.find((p: any) => p.employeeId === "EMP-DEMO-3");
    ctx.checkEq("PR-15 محمد الشهابي — gross = 22,000.00 (18,000 + 2,500 + 1,500)", ctx.n(mohamed.grossEarnings), 22000);
    ctx.check(
      "PR-15 — the highest-paid employee now carries insurance, tax and the levy (he previously carried no deduction at all)",
      ["social_insurance_employee", "income_tax", "statutory_levy"].every((src) => mohamed.lines.some((l: any) => l.source === src)),
      mohamed.lines.map((l: any) => l.source).join(", "),
    );
    ctx.checkEq("PR-15 — net = 17,261.16: gross 22,000 less 1,837 insurance, 2,890.84 tax and 11 levy", ctx.n(mohamed.netPay), 17261.16);

    const salma = run.payslips.find((p: any) => p.employeeId === "EMP-DEMO-2");
    ctx.checkEq("PR-19 سلمى فؤاد — the RENEWAL contract (CTR-DEMO-3) is picked: 7,800 + 600 = 8,400 gross, not CTR-DEMO-2's 7,000", ctx.n(salma.grossEarnings), 8400);

    const hoda = run.payslips.find((p: any) => p.employeeId === "EMP-DEMO-4");
    ctx.checkEq("PR-16 هدى مصطفى — «في إجازة» employee STATUS alone still does not reduce PAY; only the statutory withholdings do: net = 6,936.10", ctx.n(hoda.netPay), 6936.1);
    ctx.checkEq("PR-16b — her gross is untouched by the status, exactly as before", ctx.n(hoda.grossEarnings), 8100);
  });

  await ctx.scenario("hr / payslip arithmetic — an approved UNPAID-type leave prorates the deduction exactly (PR-17, PR-DEMO-2 July)", async () => {
    const run = (await ctx.req("GET", "/hr/payroll/runs/PR-DEMO-2")).body;
    const mostafa = run.payslips.find((p: any) => p.employeeId === "EMP-DEMO-6");
    const unpaidLine = mostafa.lines.find((l: any) => l.source === "unpaid_leave");
    ctx.check("PR-17 مصطفى رزق — July payslip carries an unpaid-leave deduction line (LR-DEMO-8, 2 days)", !!unpaidLine && unpaidLine.nameAr.includes("2"), unpaidLine?.nameAr);
    if (unpaidLine) {
      // The base is the CONTRACTUAL earnings — basic plus allowances — not
      // gross. Gross now includes overtime worked on other days, and deducting
      // an overtime-inflated day for a day not worked overpays the deduction.
      const contractual = mostafa.lines
        .filter((l: any) => l.source === "contract_basic" || l.source === "contract_allowance")
        .reduce((sum: number, l: any) => sum + ctx.n(l.amount), 0);
      const expected = allocate(Money.fromMajor(contractual.toFixed(6)), [2, mostafa.paidDays - 2])[0]!;
      ctx.checkEq("PR-17 — deduction is the exact largest-remainder split of the CONTRACTUAL wage over unpaid/paid days", ctx.n(unpaidLine.amount), ctx.n(expected.toString()));
      ctx.check("PR-17b — and it is smaller than the same split of gross, because overtime is excluded from it", ctx.n(unpaidLine.amount) < ctx.n(allocate(Money.fromMajor(mostafa.grossEarnings), [2, mostafa.paidDays - 2])[0]!.toString()));
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
      // This scenario drives the engine directly with in-memory fakes, so it
      // supplies its own insurance limits for 2029 the same way the tenant
      // store does over HTTP. Without them the engine refuses the period, which
      // is the behaviour PR-37 asserts.
      statutoryOverrides: {
        list: async () => [
          {
            year: 2029,
            monthlyWageFloor: "4100",
            monthlyWageCeiling: "25400",
            note: null,
            enteredBy: "scenario",
            enteredAt: "2029-01-01T00:00:00.000Z",
          },
        ],
      },
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

    const contract = (await ctx.req("GET", "/hr/contracts/CTR-DEMO-1")).body;
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
