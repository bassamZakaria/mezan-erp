import { describe, it, expect } from "vitest";
import { Money } from "@mezan/domain";
import {
  createSqliteEmployeeAdvanceRepository,
  createSqlitePayrollRunRepository,
  createSqlitePayslipRepository,
  createSqlitePayrollComponentRepository,
} from "./hr-payroll-store.js";

describe("SqliteEmployeeAdvanceRepository", () => {
  function baseAdvance() {
    return {
      id: "adv-1",
      number: "ADV-000001",
      employeeId: "emp-1",
      amount: Money.fromMajor("3000.000000"),
      currency: "EGP",
      installmentCount: 3,
      firstDeductionDate: "2026-02-01",
      reason: "ظروف عائلية",
      installments: [
        { seq: 1, dueDate: "2026-02-01", amount: Money.fromMajor("1000.000001"), recovered: Money.zero() },
        { seq: 2, dueDate: "2026-03-01", amount: Money.fromMajor("999.999999"), recovered: Money.fromMajor("500.000001") },
        { seq: 3, dueDate: "2026-04-01", amount: Money.fromMajor("1000.000000"), recovered: Money.zero() },
      ],
      status: "pending" as const,
      requestedAt: "2026-01-01T00:00:00.000Z",
      decidedAt: null,
      decidedBy: null,
      disbursedAt: null,
      disbursementVoucherId: null,
      disbursementJournalEntryId: null,
      repaidAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("round-trips the advance amount and each instalment's amount/recovered at scale 1e-6", async () => {
    const repo = createSqliteEmployeeAdvanceRepository();
    try {
      await repo.create(baseAdvance());
      const loaded = await repo.findById("adv-1");
      expect(loaded?.amount.toString()).toBe("3000.000000");
      expect(loaded!.installments[0]!.amount.toString()).toBe("1000.000001");
      expect(loaded!.installments[1]!.amount.toString()).toBe("999.999999");
      expect(loaded!.installments[1]!.recovered.toString()).toBe("500.000001");
      // The three parts sum EXACTLY back to the advance amount — largest-remainder
      // allocation must never lose or gain a micro-unit.
      const sum = loaded!.installments.reduce((acc, i) => acc + i.amount.scaled, 0n);
      expect(sum).toBe(loaded!.amount.scaled);
    } finally {
      repo.close();
    }
  });

  it("round-trips reason/decidedAt/decidedBy/disbursedAt as null (not empty string)", async () => {
    const repo = createSqliteEmployeeAdvanceRepository();
    try {
      await repo.create({ ...baseAdvance(), reason: null });
      const loaded = await repo.findById("adv-1");
      expect(loaded?.reason).toBeNull();
      expect(loaded?.decidedAt).toBeNull();
      expect(loaded?.decidedBy).toBeNull();
      expect(loaded?.disbursedAt).toBeNull();
      expect(loaded?.disbursementVoucherId).toBeNull();
      expect(loaded?.disbursementJournalEntryId).toBeNull();
      expect(loaded?.repaidAt).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("enforces uniqueness of the advance number", async () => {
    const repo = createSqliteEmployeeAdvanceRepository();
    try {
      await repo.create(baseAdvance());
      await expect(repo.create({ ...baseAdvance(), id: "adv-2" })).rejects.toThrow();
      expect(await repo.list()).toHaveLength(1);
    } finally {
      repo.close();
    }
  });

  it("listByEmployeeId filters by employee, and a non-matching employee returns an empty list", async () => {
    const repo = createSqliteEmployeeAdvanceRepository();
    try {
      await repo.create(baseAdvance());
      await repo.create({ ...baseAdvance(), id: "adv-2", number: "ADV-000002", employeeId: "emp-2" });
      const forEmp1 = await repo.listByEmployeeId("emp-1");
      expect(forEmp1.map((a) => a.id)).toEqual(["adv-1"]);
      expect(await repo.listByEmployeeId("emp-does-not-exist")).toEqual([]);
    } finally {
      repo.close();
    }
  });

  it("update() persists status/decision fields but the UPDATE SET clause leaves number/employeeId/requestedAt/createdAt untouched", async () => {
    const repo = createSqliteEmployeeAdvanceRepository();
    try {
      await repo.create(baseAdvance());
      await repo.update({
        ...baseAdvance(),
        number: "ADV-CHANGED",
        employeeId: "emp-changed",
        requestedAt: "2099-01-01T00:00:00.000Z",
        createdAt: "2099-01-01T00:00:00.000Z",
        status: "approved",
        decidedAt: "2026-01-02T00:00:00.000Z",
        decidedBy: "mgr-1",
      });
      const loaded = await repo.findById("adv-1");
      expect(loaded?.status).toBe("approved");
      expect(loaded?.decidedAt).toBe("2026-01-02T00:00:00.000Z");
      expect(loaded?.decidedBy).toBe("mgr-1");
      expect(loaded?.number).toBe("ADV-000001");
      expect(loaded?.employeeId).toBe("emp-1");
      expect(loaded?.requestedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(loaded?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    } finally {
      repo.close();
    }
  });

  it("list() orders by created_at DESC (newest first)", async () => {
    const repo = createSqliteEmployeeAdvanceRepository();
    try {
      await repo.create({ ...baseAdvance(), id: "adv-1", number: "ADV-000001", createdAt: "2026-01-01T00:00:00.000Z" });
      await repo.create({ ...baseAdvance(), id: "adv-2", number: "ADV-000002", createdAt: "2026-02-01T00:00:00.000Z" });
      const all = await repo.list();
      expect(all.map((a) => a.id)).toEqual(["adv-2", "adv-1"]);
    } finally {
      repo.close();
    }
  });
});

describe("SqlitePayrollRunRepository", () => {
  function baseRun() {
    return {
      id: "run-1",
      number: "PR-000001",
      year: 2026,
      month: 1,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      branchId: null,
      currency: "EGP",
      status: "draft" as const,
      employeeCount: 2,
      totalGross: Money.fromMajor("15000.500002"),
      totalDeductions: Money.fromMajor("2000.250002"),
      totalEmployerContributions: Money.fromMajor("1000.000003"),
      totalNet: Money.fromMajor("13000.250000"),
      unpaidLeaveSource: "none" as const,
      warnings: ["الموظف emp-3 بلا عقد فعّال"],
      journalEntryId: null,
      disbursementVoucherId: null,
      calculatedAt: null,
      approvedAt: null,
      approvedBy: null,
      disbursedAt: null,
      cancelledAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("round-trips every Money total at scale 1e-6, and Σ(deductions+net) equals gross exactly", async () => {
    const repo = createSqlitePayrollRunRepository();
    try {
      await repo.create(baseRun());
      const loaded = await repo.findById("run-1");
      expect(loaded?.totalGross.toString()).toBe("15000.500002");
      expect(loaded?.totalDeductions.toString()).toBe("2000.250002");
      expect(loaded?.totalEmployerContributions.toString()).toBe("1000.000003");
      expect(loaded?.totalNet.toString()).toBe("13000.250000");
      // gross = deductions + net, exactly, down to the micro-unit — a rounding
      // slip in the scaled-INTEGER round trip would break this.
      expect(loaded!.totalDeductions.scaled + loaded!.totalNet.scaled).toBe(loaded!.totalGross.scaled);
    } finally {
      repo.close();
    }
  });

  it("round-trips warnings as an array and journalEntryId/branchId as null", async () => {
    const repo = createSqlitePayrollRunRepository();
    try {
      await repo.create(baseRun());
      const loaded = await repo.findById("run-1");
      expect(loaded?.warnings).toEqual(["الموظف emp-3 بلا عقد فعّال"]);
      expect(loaded?.branchId).toBeNull();
      expect(loaded?.journalEntryId).toBeNull();
      expect(loaded?.disbursementVoucherId).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips an empty warnings array as empty, not omitted", async () => {
    const repo = createSqlitePayrollRunRepository();
    try {
      await repo.create({ ...baseRun(), warnings: [] });
      const loaded = await repo.findById("run-1");
      expect(loaded?.warnings).toEqual([]);
    } finally {
      repo.close();
    }
  });

  it("maps unpaid_leave_source anything other than 'provider' to 'none'", async () => {
    const repo = createSqlitePayrollRunRepository();
    try {
      await repo.create({ ...baseRun(), unpaidLeaveSource: "provider" });
      const loaded = await repo.findById("run-1");
      expect(loaded?.unpaidLeaveSource).toBe("provider");
    } finally {
      repo.close();
    }
  });

  it("enforces uniqueness of the payroll run number", async () => {
    const repo = createSqlitePayrollRunRepository();
    try {
      await repo.create(baseRun());
      await expect(repo.create({ ...baseRun(), id: "run-2" })).rejects.toThrow();
    } finally {
      repo.close();
    }
  });

  it("findByPeriod distinguishes a null branch from a specific branch, and returns null when nothing matches", async () => {
    const repo = createSqlitePayrollRunRepository();
    try {
      await repo.create({ ...baseRun(), id: "run-hq", number: "PR-HQ", branchId: null });
      await repo.create({ ...baseRun(), id: "run-br", number: "PR-BR", branchId: "branch-1" });
      expect((await repo.findByPeriod(2026, 1, null))?.id).toBe("run-hq");
      expect((await repo.findByPeriod(2026, 1, "branch-1"))?.id).toBe("run-br");
      expect(await repo.findByPeriod(2026, 1, "branch-does-not-exist")).toBeNull();
      expect(await repo.findByPeriod(2025, 12, null)).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("update() changes status/totals but the UPDATE SET clause leaves number/year/month/periodStart/branchId untouched", async () => {
    const repo = createSqlitePayrollRunRepository();
    try {
      await repo.create(baseRun());
      await repo.update({
        ...baseRun(),
        number: "PR-CHANGED",
        year: 2099,
        month: 12,
        periodStart: "2099-12-01",
        branchId: "branch-should-not-stick",
        status: "calculated",
        calculatedAt: "2026-01-02T00:00:00.000Z",
      });
      const loaded = await repo.findById("run-1");
      expect(loaded?.status).toBe("calculated");
      expect(loaded?.calculatedAt).toBe("2026-01-02T00:00:00.000Z");
      expect(loaded?.number).toBe("PR-000001");
      expect(loaded?.year).toBe(2026);
      expect(loaded?.month).toBe(1);
      expect(loaded?.periodStart).toBe("2026-01-01");
      expect(loaded?.branchId).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("list() orders by year DESC, month DESC", async () => {
    const repo = createSqlitePayrollRunRepository();
    try {
      await repo.create({ ...baseRun(), id: "run-jan", number: "PR-JAN", year: 2026, month: 1 });
      await repo.create({ ...baseRun(), id: "run-mar", number: "PR-MAR", year: 2026, month: 3 });
      await repo.create({ ...baseRun(), id: "run-old", number: "PR-OLD", year: 2025, month: 12 });
      const all = await repo.list();
      expect(all.map((r) => r.id)).toEqual(["run-mar", "run-jan", "run-old"]);
    } finally {
      repo.close();
    }
  });
});

describe("SqlitePayslipRepository", () => {
  function baseLine(overrides: Partial<{ id: string; amount: string; kind: "earning" | "deduction" | "employer_contribution" }> = {}) {
    return {
      id: overrides.id ?? "line-1",
      kind: overrides.kind ?? ("earning" as const),
      source: "contract_basic" as const,
      nameAr: "الراتب الأساسي",
      amount: Money.fromMajor(overrides.amount ?? "5000.000001"),
      glAccountId: null,
      referenceId: null,
      capped: false,
    };
  }

  function baseSlip() {
    return {
      id: "slip-1",
      number: "PS-000001",
      runId: "run-1",
      employeeId: "emp-1",
      contractId: "ctr-1",
      currency: "EGP",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      periodDays: 31,
      paidDays: 31,
      lines: [baseLine()],
      grossEarnings: Money.fromMajor("5000.000001"),
      totalDeductions: Money.zero(),
      employerContributions: Money.zero(),
      netPay: Money.fromMajor("5000.000001"),
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("round-trips lines (including glAccountId/referenceId as null) and Money totals at scale 1e-6", async () => {
    const repo = createSqlitePayslipRepository();
    try {
      await repo.create(baseSlip());
      const loaded = await repo.findById("slip-1");
      expect(loaded?.lines).toHaveLength(1);
      expect(loaded!.lines[0]!.amount.toString()).toBe("5000.000001");
      expect(loaded!.lines[0]!.glAccountId).toBeNull();
      expect(loaded!.lines[0]!.referenceId).toBeNull();
      expect(loaded?.grossEarnings.toString()).toBe("5000.000001");
      expect(loaded?.netPay.toString()).toBe("5000.000001");
    } finally {
      repo.close();
    }
  });

  it("enforces uniqueness of the payslip number", async () => {
    const repo = createSqlitePayslipRepository();
    try {
      await repo.create(baseSlip());
      await expect(repo.create({ ...baseSlip(), id: "slip-2" })).rejects.toThrow();
    } finally {
      repo.close();
    }
  });

  it("create() with an existing id re-upserts the totals/lines (recalculation), not a duplicate row", async () => {
    const repo = createSqlitePayslipRepository();
    try {
      await repo.create(baseSlip());
      await repo.create({
        ...baseSlip(),
        lines: [baseLine({ id: "line-2", amount: "6000.000000" })],
        grossEarnings: Money.fromMajor("6000.000000"),
        netPay: Money.fromMajor("6000.000000"),
      });
      const loaded = await repo.findById("slip-1");
      expect(loaded?.grossEarnings.toString()).toBe("6000.000000");
      expect(loaded?.lines).toHaveLength(1);
      expect(loaded!.lines[0]!.id).toBe("line-2");
      expect((await repo.listByRunId("run-1"))).toHaveLength(1);
    } finally {
      repo.close();
    }
  });

  it("listByRunId filters by run, and a run with no payslips returns an empty list", async () => {
    const repo = createSqlitePayslipRepository();
    try {
      await repo.create(baseSlip());
      await repo.create({ ...baseSlip(), id: "slip-2", number: "PS-000002", runId: "run-2" });
      expect((await repo.listByRunId("run-1")).map((s) => s.id)).toEqual(["slip-1"]);
      expect(await repo.listByRunId("run-does-not-exist")).toEqual([]);
    } finally {
      repo.close();
    }
  });

  it("listByEmployeeId filters by employee across runs, ordered by periodStart DESC", async () => {
    const repo = createSqlitePayslipRepository();
    try {
      await repo.create({ ...baseSlip(), id: "slip-jan", number: "PS-JAN", periodStart: "2026-01-01" });
      await repo.create({ ...baseSlip(), id: "slip-feb", number: "PS-FEB", periodStart: "2026-02-01" });
      await repo.create({ ...baseSlip(), id: "slip-other-emp", number: "PS-OTHER", employeeId: "emp-2", periodStart: "2026-03-01" });
      const forEmp1 = await repo.listByEmployeeId("emp-1");
      expect(forEmp1.map((s) => s.id)).toEqual(["slip-feb", "slip-jan"]);
    } finally {
      repo.close();
    }
  });

  it("deleteByRunId removes only that run's payslips, leaving other runs' payslips intact", async () => {
    const repo = createSqlitePayslipRepository();
    try {
      await repo.create(baseSlip());
      await repo.create({ ...baseSlip(), id: "slip-2", number: "PS-000002", runId: "run-2" });
      await repo.deleteByRunId("run-1");
      expect(await repo.listByRunId("run-1")).toEqual([]);
      expect((await repo.listByRunId("run-2")).map((s) => s.id)).toEqual(["slip-2"]);
      expect(await repo.findById("slip-1")).toBeNull();
    } finally {
      repo.close();
    }
  });
});

describe("SqlitePayrollComponentRepository", () => {
  function baseComponent() {
    return {
      id: "comp-1",
      code: "TRANSPORT",
      nameAr: "بدل مواصلات",
      nameEn: null,
      kind: "earning" as const,
      glAccountId: null,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("round-trips by id and by code, and nameEn/glAccountId as null", async () => {
    const repo = createSqlitePayrollComponentRepository();
    try {
      await repo.create(baseComponent());
      expect((await repo.findByCode("TRANSPORT"))?.id).toBe("comp-1");
      expect(await repo.findByCode("NOPE")).toBeNull();
      const loaded = await repo.findById("comp-1");
      expect(loaded?.nameEn).toBeNull();
      expect(loaded?.glAccountId).toBeNull();
      expect(loaded?.active).toBe(true);
    } finally {
      repo.close();
    }
  });

  it("enforces uniqueness of the component code", async () => {
    const repo = createSqlitePayrollComponentRepository();
    try {
      await repo.create(baseComponent());
      await expect(repo.create({ ...baseComponent(), id: "comp-2" })).rejects.toThrow();
    } finally {
      repo.close();
    }
  });

  it("update() changes code/active/updatedAt but createdAt (not in UPDATE SET) stays fixed", async () => {
    const repo = createSqlitePayrollComponentRepository();
    try {
      await repo.create(baseComponent());
      await repo.update({
        ...baseComponent(),
        code: "TRANSPORT-RENAMED",
        active: false,
        createdAt: "2099-01-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      });
      const loaded = await repo.findById("comp-1");
      expect(loaded?.code).toBe("TRANSPORT-RENAMED");
      expect(loaded?.active).toBe(false);
      expect(loaded?.updatedAt).toBe("2026-02-01T00:00:00.000Z");
      expect(loaded?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    } finally {
      repo.close();
    }
  });

  it("list(filter) narrows by kind and by active, and a filter matching nothing returns an empty list", async () => {
    const repo = createSqlitePayrollComponentRepository();
    try {
      await repo.create(baseComponent());
      await repo.create({ ...baseComponent(), id: "comp-2", code: "INSURANCE", kind: "deduction", active: false });
      await repo.create({ ...baseComponent(), id: "comp-3", code: "EMP_INSURANCE", kind: "employer_contribution" });

      expect((await repo.list({ kind: "deduction" })).map((c) => c.code)).toEqual(["INSURANCE"]);
      expect((await repo.list({ active: true })).map((c) => c.code).sort()).toEqual(["EMP_INSURANCE", "TRANSPORT"]);
      expect((await repo.list({ active: false })).map((c) => c.code)).toEqual(["INSURANCE"]);
      expect(await repo.list({ kind: "deduction", active: true })).toEqual([]);
      expect((await repo.list()).map((c) => c.code)).toHaveLength(3);
    } finally {
      repo.close();
    }
  });

  it("list() orders by kind then code", async () => {
    const repo = createSqlitePayrollComponentRepository();
    try {
      await repo.create({ ...baseComponent(), id: "comp-b", code: "B_EARNING", kind: "earning" });
      await repo.create({ ...baseComponent(), id: "comp-a", code: "A_EARNING", kind: "earning" });
      await repo.create({ ...baseComponent(), id: "comp-d", code: "D_DEDUCTION", kind: "deduction" });
      const all = await repo.list();
      expect(all.map((c) => c.code)).toEqual(["D_DEDUCTION", "A_EARNING", "B_EARNING"]);
    } finally {
      repo.close();
    }
  });
});
