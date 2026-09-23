import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { JournalEntry } from "../journal.js";
import type { PayrollRun, Payslip, PayslipLine, PayslipLineSource } from "../hr/payroll-run.js";
import { runReport } from "./engine.js";
import {
  createSalaryTaxReturnReport,
  createSocialInsuranceReturnReport,
  payrollCreditsByRunId,
  SALARY_TAX_CONTROL_ACCOUNT,
  SOCIAL_INSURANCE_CONTROL_ACCOUNT,
  type PayrollReportContext,
} from "./hr-payroll.js";

const m = (v: string) => Money.fromMajor(v);

function run(id: string, month: number): PayrollRun {
  return { id, number: id, year: 2026, month, branchId: null, status: "approved", statutoryTableCodes: ["EG_SALARY_TAX_2024"] } as unknown as PayrollRun;
}

function line(source: PayslipLineSource, amount: string): PayslipLine {
  return { id: `${source}-${amount}`, kind: source === "social_insurance_employer" ? "employer_contribution" : "deduction", source, nameAr: source, amount: m(amount), glAccountId: null, referenceId: null, capped: false };
}

function payslip(runId: string, tax: string, insuranceEmployee: string, insuranceEmployer: string): Payslip {
  return {
    id: `ps-${runId}`,
    runId,
    employeeId: "emp-1",
    lines: [line("income_tax", tax), line("social_insurance_employee", insuranceEmployee), line("social_insurance_employer", insuranceEmployer)],
    grossEarnings: m("10000"),
    insurableWage: m("10000"),
    insurableWageCapped: false,
    annualTaxableIncome: m("100000"),
  } as unknown as Payslip;
}

function entry(id: string, sourceDocType: string, sourceDocId: string, lines: { accountId: string; debit?: string; credit?: string }[], status: JournalEntry["status"] = "posted"): JournalEntry {
  return {
    id,
    date: "2026-01-31",
    memo: id,
    status,
    sourceDocType,
    sourceDocId,
    lines: lines.map((l) => ({ accountId: l.accountId, debit: m(l.debit ?? "0"), credit: m(l.credit ?? "0") })),
  };
}

// January and February payroll, the January liabilities remitted in between.
const JAN_TAX = "592.10";
const FEB_TAX = "605.20";
const ledger: JournalEntry[] = [
  entry("JE-JAN", "PAYROLL_RUN", "run-jan", [
    { accountId: SALARY_TAX_CONTROL_ACCOUNT, credit: JAN_TAX },
    { accountId: SOCIAL_INSURANCE_CONTROL_ACCOUNT, credit: "2975.10" },
  ]),
  entry("JE-REMIT", "VOUCHER", "v-1", [
    { accountId: SALARY_TAX_CONTROL_ACCOUNT, debit: JAN_TAX },
    { accountId: SOCIAL_INSURANCE_CONTROL_ACCOUNT, debit: "2975.10" },
  ]),
  entry("JE-FEB", "PAYROLL_RUN", "run-feb", [
    { accountId: SALARY_TAX_CONTROL_ACCOUNT, credit: FEB_TAX },
    { accountId: SOCIAL_INSURANCE_CONTROL_ACCOUNT, credit: "2975.20" },
  ]),
];

function context(entries: JournalEntry[] = ledger): PayrollReportContext {
  return {
    runs: [run("run-jan", 1), run("run-feb", 2)],
    payslips: [payslip("run-jan", JAN_TAX, "1100.10", "1875.00"), payslip("run-feb", FEB_TAX, "1100.20", "1875.00")],
    employees: [],
    payrollCreditsByAccountId: new Map([
      [SALARY_TAX_CONTROL_ACCOUNT, payrollCreditsByRunId(entries, SALARY_TAX_CONTROL_ACCOUNT)],
      [SOCIAL_INSURANCE_CONTROL_ACCOUNT, payrollCreditsByRunId(entries, SOCIAL_INSURANCE_CONTROL_ACCOUNT)],
    ]),
  };
}

function reconciliation(report: "tax" | "insurance", params: { year: number; month: number | null }, ctx = context()) {
  const definition = report === "tax" ? createSalaryTaxReturnReport() : createSocialInsuranceReturnReport();
  const outcome = runReport(definition as never, { ...params, branchId: null }, ctx);
  if (!outcome.ok) throw new Error("report refused its params");
  return outcome.reconciliation!;
}

describe("D189 — the statutory returns compare with the SAME runs' postings, not the account's all-time balance", () => {
  it("the second month ties to its own run's credit, not to both months' credits less the remittance", () => {
    const tax = reconciliation("tax", { year: 2026, month: 2 });
    expect(tax.reportTotal).toBe("605.200000");
    expect(tax.referenceTotal).toBe("605.200000");
    expect(tax.withinTolerance).toBe(true);
    const insurance = reconciliation("insurance", { year: 2026, month: 2 });
    expect(insurance.referenceTotal).toBe("2975.200000");
    expect(insurance.withinTolerance).toBe(true);
  });

  it("the whole year ties to both runs' credits although January's liability was remitted in between", () => {
    const tax = reconciliation("tax", { year: 2026, month: null });
    expect(tax.referenceTotal).toBe("1197.300000");
    expect(tax.diff).toBe("0.000000");
    expect(tax.withinTolerance).toBe(true);
    expect(reconciliation("insurance", { year: 2026, month: null }).withinTolerance).toBe(true);
  });

  it("a run posting that disagrees with its payslips is still caught, to the piastre", () => {
    const short = ledger.map((e) =>
      e.id === "JE-FEB" ? entry("JE-FEB", "PAYROLL_RUN", "run-feb", [{ accountId: SALARY_TAX_CONTROL_ACCOUNT, credit: "605.19" }]) : e,
    );
    const tax = reconciliation("tax", { year: 2026, month: 2 }, context(short));
    expect(tax.withinTolerance).toBe(false);
    expect(tax.diff).toBe("0.010000");
  });

  it("a reversed run posting nets to nothing, so the return no longer ties", () => {
    const reversed = [
      ...ledger.map((e) => (e.id === "JE-FEB" ? { ...e, status: "reversed" as const } : e)),
      entry("JE-FEB-REV", "PAYROLL_RUN", "run-feb", [{ accountId: SALARY_TAX_CONTROL_ACCOUNT, debit: FEB_TAX }]),
    ];
    expect(payrollCreditsByRunId(reversed, SALARY_TAX_CONTROL_ACCOUNT).get("run-feb")!.toString()).toBe("0.000000");
    expect(reconciliation("tax", { year: 2026, month: 2 }, context(reversed)).withinTolerance).toBe(false);
  });

  it("a draft entry and a remittance are never counted as a run's credit", () => {
    const credits = payrollCreditsByRunId(
      [...ledger, entry("JE-DRAFT", "PAYROLL_RUN", "run-jan", [{ accountId: SALARY_TAX_CONTROL_ACCOUNT, credit: "999" }], "draft")],
      SALARY_TAX_CONTROL_ACCOUNT,
    );
    expect(credits.get("run-jan")!.toString()).toBe("592.100000");
    expect(credits.has("v-1")).toBe(false);
  });

  it("with no postings wired (a branch-narrowed run) the banner is not rendered rather than failing against zero", () => {
    const definition = createSalaryTaxReturnReport();
    const outcome = runReport(definition, { year: 2026, month: 2, branchId: null }, { ...context(), payrollCreditsByAccountId: undefined });
    expect(outcome.ok && outcome.reconciliation).toBe(null);
  });
});
