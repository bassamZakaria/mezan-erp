import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

const EGP = 1_000_000n;

interface Slip {
  readonly days: bigint;
  readonly gross: bigint;
  readonly net: bigint;
  readonly lines: Record<string, bigint>;
}

function slipOf(employeeId: string): Slip {
  const row = world.sqlite
    .prepare(`SELECT paid_days AS days, gross_earnings AS gross, net_pay AS net, lines_json AS lines FROM hr_payslip WHERE run_id = 'PSP-RUN' AND employee_id = ?`)
    .safeIntegers()
    .get(employeeId) as { days: bigint; gross: bigint; net: bigint; lines: string };
  const lines: Record<string, bigint> = {};
  const stored = world.sqlite
    .prepare(`SELECT json_extract(line.value, '$.source') AS source, CAST(json_extract(line.value, '$.amount') AS INTEGER) AS amount FROM json_each(?) AS line`)
    .safeIntegers()
    .all(row.lines) as { source: string; amount: bigint }[];
  for (const line of stored) lines[line.source] = (lines[line.source] ?? 0n) + line.amount;
  return { days: row.days, gross: row.gross, net: row.net, lines };
}

async function hire(id: string, hireDate: string): Promise<void> {
  expect((await world.request("POST", "/hr/employees", { id, firstName: "موظف", lastName: id, branchId: "BR-MAIN", hireDate })).status).toBe(201);
  expect((await world.request("POST", "/hr/contracts", { id: `ct-${id}`, employeeId: id, type: "indefinite", startDate: hireDate, monthlySalary: "9000", currency: "EGP" })).status).toBe(201);
}

beforeAll(async () => {
  world = await seededWorld();
  expect((await world.request("PUT", "/hr/payroll/statutory-flag", { enabled: true, acknowledged: true })).status).toBe(200);
  await hire("psp-full", "2026-01-01");
  await hire("psp-leaver", "2026-01-01");
  await hire("psp-joiner", "2026-09-16");
  await hire("psp-leaver-advance", "2026-01-01");
  expect((await world.request("POST", "/hr/advances", { id: "PSP-ADV", employeeId: "psp-leaver-advance", amount: "3000", installmentCount: 3, firstDeductionDate: "2026-09-30", reason: "سلفة" })).status).toBe(201);
  expect((await world.request("POST", "/hr/advances/PSP-ADV/approve", {})).status).toBe(200);
  expect((await world.request("POST", "/hr/advances/PSP-ADV/disburse", { treasuryAccountId: "TR-DEMO-CASH", branchId: "BR-MAIN", date: "2026-09-01" })).status).toBe(200);
  expect((await world.request("POST", "/hr/employees/psp-leaver/terminate", { effectiveDate: "2026-09-12" })).status).toBe(200);
  expect((await world.request("POST", "/hr/employees/psp-leaver-advance/terminate", { effectiveDate: "2026-09-12" })).status).toBe(200);
  expect((await world.request("POST", "/hr/payroll/runs", { id: "PSP-RUN", year: 2026, month: 9 })).status).toBe(201);
  expect((await world.request("POST", "/hr/payroll/runs/PSP-RUN/calculate", {})).status).toBe(200);
}, 120_000);

afterAll(() => world?.close());

describe("September payroll with statutory deductions on a 9,000 monthly wage", () => {
  it("a full month: insurance on the whole wage, income tax on the annualised wage, and the martyrs' levy", () => {
    expect(slipOf("psp-full")).toEqual({
      days: 30n,
      gross: 9_000n * EGP,
      net: 7_591n * EGP,
      lines: { contract_basic: 9_000n * EGP, social_insurance_employee: 990n * EGP, social_insurance_employer: 1_687_500_000n, income_tax: 414_500_000n, statutory_levy: 4_500_000n },
    });
  });

  it("a leaver on the twelfth: pay and both insurance shares are twelve thirtieths, and the engine withholds no income tax on the part month", () => {
    expect(slipOf("psp-leaver")).toEqual({
      days: 12n,
      gross: 3_600n * EGP,
      net: 3_202_200_000n,
      lines: { contract_basic: 3_600n * EGP, social_insurance_employee: 396n * EGP, social_insurance_employer: 675n * EGP, statutory_levy: 1_800_000n },
    });
  });

  it("a joiner on the sixteenth: fifteen thirtieths of pay and insurance, and no income tax on the part month", () => {
    expect(slipOf("psp-joiner")).toEqual({
      days: 15n,
      gross: 4_500n * EGP,
      net: 4_002_750_000n,
      lines: { contract_basic: 4_500n * EGP, social_insurance_employee: 495n * EGP, social_insurance_employer: 843_750_000n, statutory_levy: 2_250_000n },
    });
  });

  it("a leaver who still owes an advance: the final payslip recovers a tenth of the part-month wage, and the rest stands on the end-of-service statement", async () => {
    expect(slipOf("psp-leaver-advance")).toEqual({
      days: 12n,
      gross: 3_600n * EGP,
      net: 2_842_200_000n,
      lines: { contract_basic: 3_600n * EGP, social_insurance_employee: 396n * EGP, social_insurance_employer: 675n * EGP, statutory_levy: 1_800_000n, advance_recovery: 360n * EGP },
    });

    expect((await world.request("POST", "/hr/payroll/runs/PSP-RUN/approve", {})).status).toBe(200);

    const settlement = await world.request("GET", "/hr/employees/psp-leaver-advance/end-of-service");
    expect(`${settlement.status} ${settlement.body.outstandingAdvances}`).toBe("200 2640.000000");
    const entry = world.sqlite.prepare(`SELECT SUM(debit) AS debit, SUM(credit) AS credit FROM journal_line WHERE entry_id = 'PAYROLL-JE:PSP-RUN'`).safeIntegers().get() as { debit: bigint; credit: bigint };
    expect(entry.debit).toBe(entry.credit);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("income tax on a part-month payslip is not settled by the engine, and the product says so", () => {
  const NOTICE = "ضريبة كسب العمل على هذا الكشف احتُسبت على أجر جزء من الشهر محوَّلاً إلى سنة كاملة، فقد تقل عن المستحق أو تكون صفراً. الفرق يُسوّى في التسوية الضريبية السنوية، والنظام لا يجريها.";

  it("each part-month payslip carries the warning; a full-month payslip does not", async () => {
    const payslips = (await world.request("GET", "/hr/payroll/runs/PSP-RUN")).body.payslips as { employeeId: string; partMonthTaxNotice: string | null }[];
    const notice = (employeeId: string) => payslips.find((p) => p.employeeId === employeeId)?.partMonthTaxNotice;
    expect(notice("psp-full")).toBeNull();
    expect(notice("psp-leaver")).toBe(NOTICE);
    expect(notice("psp-joiner")).toBe(NOTICE);
  });

  it("the run names each of them among its warnings", async () => {
    const warnings = (await world.request("GET", "/hr/payroll/runs/PSP-RUN")).body.warnings as string[];
    const taxWarnings = warnings.filter((w) => w.includes("ضريبة كسب العمل"));
    expect(taxWarnings).toHaveLength(3);
    expect(taxWarnings.every((w) => w.includes("التسوية الضريبية السنوية"))).toBe(true);
  });

  it("September's close shows them as a finding that does not block the close", async () => {
    const checks = (await world.request("GET", "/period-close/fp-2026-09/checks")).body.checks as { code: string; findings: { kind: string; passed: boolean; count: number | null }[] }[];
    const finding = checks.flatMap((c) => c.findings).find((f) => f.kind === "payroll_part_month_tax");
    expect(finding).toMatchObject({ passed: true, count: 3 });
  });
});

