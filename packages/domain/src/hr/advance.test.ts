import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import {
  EMPLOYEE_ADVANCE_STATUS_DEFINITIONS,
  getEmployeeAdvanceStatusLabel,
  addMonths,
  buildInstallmentSchedule,
  requestEmployeeAdvance,
  approveEmployeeAdvance,
  rejectEmployeeAdvance,
  markEmployeeAdvanceDisbursed,
  installmentsDue,
  amountDueBy,
  applyAdvanceRecovery,
  advanceRecovered,
  advanceOutstanding,
  employeeOutstandingBalance,
  type EmployeeAdvance,
  type EmployeeAdvanceRepository,
  type EmployeeAdvanceStatus,
} from "./advance.js";
import { InvalidEmployeeAdvanceError, InvalidEmployeeAdvanceTransitionError } from "./errors.js";

function createInMemoryEmployeeAdvanceRepository(): EmployeeAdvanceRepository {
  const rows = new Map<string, EmployeeAdvance>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async listByEmployeeId(employeeId) {
      return [...rows.values()].filter((a) => a.employeeId === employeeId);
    },
    async create(advance) {
      rows.set(advance.id, advance);
    },
    async update(advance) {
      rows.set(advance.id, advance);
    },
  };
}

describe("getEmployeeAdvanceStatusLabel", () => {
  it("returns the Arabic label for every defined status", () => {
    for (const def of EMPLOYEE_ADVANCE_STATUS_DEFINITIONS) {
      expect(getEmployeeAdvanceStatusLabel(def.code)).toBe(def.labelAr);
    }
  });

  it("falls back to the raw code for an unknown status", () => {
    expect(getEmployeeAdvanceStatusLabel("bogus" as EmployeeAdvanceStatus)).toBe("bogus");
  });
});

describe("addMonths", () => {
  it("adds whole months within a year", () => {
    expect(addMonths("2026-01-15", 1)).toBe("2026-02-15");
  });

  it("rolls over a year boundary", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });

  it("clamps the day to the target month's length (Jan 31 + 1 month, non-leap year)", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("clamps to Feb 29 in a leap year", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("supports adding zero months (identity)", () => {
    expect(addMonths("2026-05-10", 0)).toBe("2026-05-10");
  });
});

describe("buildInstallmentSchedule", () => {
  it("splits the amount so installments sum EXACTLY to the total, remainder to the first (lowest index)", () => {
    const schedule = buildInstallmentSchedule(Money.fromMajor("1000.00"), 3, "2026-01-01");
    expect(schedule).toHaveLength(3);
    expect(schedule[0]!.amount.toString()).toBe("333.333334");
    expect(schedule[1]!.amount.toString()).toBe("333.333333");
    expect(schedule[2]!.amount.toString()).toBe("333.333333");
    const sum = schedule.reduce((acc, i) => acc + i.amount.scaled, 0n);
    expect(sum).toBe(Money.fromMajor("1000.00").scaled);
  });

  it("assigns sequential seq numbers and monthly due dates from firstDeductionDate", () => {
    const schedule = buildInstallmentSchedule(Money.fromMajor("300.00"), 3, "2026-01-15");
    expect(schedule.map((i) => i.seq)).toEqual([1, 2, 3]);
    expect(schedule.map((i) => i.dueDate)).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
    expect(schedule.every((i) => i.recovered.scaled === 0n)).toBe(true);
  });

  it("a single installment gets the whole amount", () => {
    const schedule = buildInstallmentSchedule(Money.fromMajor("500.00"), 1, "2026-01-01");
    expect(schedule).toHaveLength(1);
    expect(schedule[0]!.amount.toString()).toBe("500.000000");
  });
});

describe("requestEmployeeAdvance", () => {
  const base = {
    id: "adv-1",
    number: "ADV-000001",
    employeeId: "emp-1",
    amount: Money.fromMajor("1500.00"),
    installmentCount: 3,
    firstDeductionDate: "2026-02-01",
    now: () => "2026-01-10T00:00:00.000Z",
  };

  it("creates a pending advance with a full recovery schedule", async () => {
    const repo = createInMemoryEmployeeAdvanceRepository();
    const advance = await requestEmployeeAdvance(base, repo);
    expect(advance.status).toBe("pending");
    expect(advance.currency).toBe("EGP");
    expect(advance.installments).toHaveLength(3);
    expect(advance.decidedAt).toBeNull();
    expect(advance.disbursedAt).toBeNull();
    expect(advance.repaidAt).toBeNull();
    expect(await repo.findById("adv-1")).toEqual(advance);
  });

  it("rejects a missing employee", async () => {
    const repo = createInMemoryEmployeeAdvanceRepository();
    await expect(requestEmployeeAdvance({ ...base, employeeId: "" }, repo)).rejects.toThrow(InvalidEmployeeAdvanceError);
  });

  it("rejects a zero or negative amount", async () => {
    const repo = createInMemoryEmployeeAdvanceRepository();
    await expect(requestEmployeeAdvance({ ...base, amount: Money.zero() }, repo)).rejects.toThrow(InvalidEmployeeAdvanceError);
    await expect(requestEmployeeAdvance({ ...base, amount: Money.fromMajor("-1.00") }, repo)).rejects.toThrow(InvalidEmployeeAdvanceError);
  });

  it("rejects a non-integer or non-positive installment count", async () => {
    const repo = createInMemoryEmployeeAdvanceRepository();
    await expect(requestEmployeeAdvance({ ...base, installmentCount: 0 }, repo)).rejects.toThrow(InvalidEmployeeAdvanceError);
    await expect(requestEmployeeAdvance({ ...base, installmentCount: 1.5 }, repo)).rejects.toThrow(InvalidEmployeeAdvanceError);
  });

  it("rejects a malformed first-deduction date", async () => {
    const repo = createInMemoryEmployeeAdvanceRepository();
    await expect(requestEmployeeAdvance({ ...base, firstDeductionDate: "not-a-date" }, repo)).rejects.toThrow(InvalidEmployeeAdvanceError);
  });
});

async function pendingAdvance(overrides: Partial<Parameters<typeof requestEmployeeAdvance>[0]> = {}): Promise<{
  advance: EmployeeAdvance;
  repo: EmployeeAdvanceRepository;
}> {
  const repo = createInMemoryEmployeeAdvanceRepository();
  const advance = await requestEmployeeAdvance(
    {
      id: "adv-1",
      number: "ADV-000001",
      employeeId: "emp-1",
      amount: Money.fromMajor("900.00"),
      installmentCount: 3,
      firstDeductionDate: "2026-02-01",
      ...overrides,
    },
    repo,
  );
  return { advance, repo };
}

describe("approveEmployeeAdvance / rejectEmployeeAdvance", () => {
  it("approves a pending advance", async () => {
    const { advance } = await pendingAdvance();
    const approved = approveEmployeeAdvance(advance, "user-1", "2026-01-11T00:00:00.000Z");
    expect(approved.status).toBe("approved");
    expect(approved.decidedBy).toBe("user-1");
    expect(approved.decidedAt).toBe("2026-01-11T00:00:00.000Z");
  });

  it("rejects a pending advance", async () => {
    const { advance } = await pendingAdvance();
    const rejected = rejectEmployeeAdvance(advance, "user-1");
    expect(rejected.status).toBe("rejected");
  });

  it("cannot approve twice", async () => {
    const { advance } = await pendingAdvance();
    const approved = approveEmployeeAdvance(advance, "user-1");
    expect(() => approveEmployeeAdvance(approved, "user-1")).toThrow(InvalidEmployeeAdvanceTransitionError);
  });

  it("cannot reject an already-approved advance (terminal states are one-way)", async () => {
    const { advance } = await pendingAdvance();
    const approved = approveEmployeeAdvance(advance, "user-1");
    expect(() => rejectEmployeeAdvance(approved, "user-1")).toThrow(InvalidEmployeeAdvanceTransitionError);
  });

  it("rejected and repaid are terminal", async () => {
    const { advance } = await pendingAdvance();
    const rejected = rejectEmployeeAdvance(advance, "user-1");
    expect(() => approveEmployeeAdvance(rejected, "user-1")).toThrow(InvalidEmployeeAdvanceTransitionError);
  });
});

describe("markEmployeeAdvanceDisbursed", () => {
  it("disburses an approved advance, recording the voucher", async () => {
    const { advance } = await pendingAdvance();
    const approved = approveEmployeeAdvance(advance, "user-1");
    const disbursed = markEmployeeAdvanceDisbursed(approved, { voucherId: "cv-1", journalEntryId: "je-1", now: "2026-01-12T00:00:00.000Z" });
    expect(disbursed.status).toBe("disbursed");
    expect(disbursed.disbursementVoucherId).toBe("cv-1");
    expect(disbursed.disbursementJournalEntryId).toBe("je-1");
    expect(disbursed.disbursedAt).toBe("2026-01-12T00:00:00.000Z");
  });

  it("cannot disburse a pending (not yet approved) advance", async () => {
    const { advance } = await pendingAdvance();
    expect(() => markEmployeeAdvanceDisbursed(advance, { voucherId: "cv-1", journalEntryId: null })).toThrow(
      InvalidEmployeeAdvanceTransitionError,
    );
  });
});

describe("installmentsDue / amountDueBy", () => {
  it("is empty/zero for any status other than disbursed", async () => {
    const { advance } = await pendingAdvance();
    expect(installmentsDue(advance, "2026-12-31")).toEqual([]);
    expect(amountDueBy(advance, "2026-12-31").scaled).toBe(0n);
  });

  it("includes an installment due exactly on periodEnd, excludes one due the day after", async () => {
    const { advance } = await pendingAdvance();
    const approved = approveEmployeeAdvance(advance, "user-1");
    const disbursed = markEmployeeAdvanceDisbursed(approved, { voucherId: "cv-1", journalEntryId: null });
    // installments due 2026-02-01, 2026-03-01, 2026-04-01
    const due = installmentsDue(disbursed, "2026-03-01");
    expect(due.map((i) => i.seq)).toEqual([1, 2]);
    expect(amountDueBy(disbursed, "2026-03-01").toString()).toBe(
      disbursed.installments
        .filter((i) => i.seq <= 2)
        .reduce((acc, i) => acc.add(i.amount), Money.zero())
        .toString(),
    );
  });

  it("excludes an installment already fully recovered", async () => {
    const { advance } = await pendingAdvance();
    const approved = approveEmployeeAdvance(advance, "user-1");
    const disbursed = markEmployeeAdvanceDisbursed(approved, { voucherId: "cv-1", journalEntryId: null });
    const afterFirstRecovery = applyAdvanceRecovery(disbursed, disbursed.installments[0]!.amount);
    const due = installmentsDue(afterFirstRecovery, "2026-02-01");
    expect(due).toEqual([]);
  });
});

describe("applyAdvanceRecovery", () => {
  it("a zero or negative amount is a no-op, even on an advance that is not disbursed", async () => {
    const { advance } = await pendingAdvance();
    expect(applyAdvanceRecovery(advance, Money.zero())).toEqual(advance);
    expect(applyAdvanceRecovery(advance, Money.fromMajor("-1.00"))).toEqual(advance);
  });

  it("rejects recovering against an advance that is not disbursed", async () => {
    const { advance } = await pendingAdvance();
    expect(() => applyAdvanceRecovery(advance, Money.fromMajor("100.00"))).toThrow(InvalidEmployeeAdvanceTransitionError);
  });

  it("rejects recovering more than the outstanding balance (one micro-unit over)", async () => {
    const { advance } = await pendingAdvance();
    const approved = approveEmployeeAdvance(advance, "user-1");
    const disbursed = markEmployeeAdvanceDisbursed(approved, { voucherId: "cv-1", journalEntryId: null });
    const outstanding = advanceOutstanding(disbursed);
    expect(() => applyAdvanceRecovery(disbursed, Money.fromScaled(outstanding.scaled + 1n))).toThrow(InvalidEmployeeAdvanceError);
  });

  it("recovering exactly the outstanding balance is accepted and flips to repaid", async () => {
    const { advance } = await pendingAdvance();
    const approved = approveEmployeeAdvance(advance, "user-1");
    const disbursed = markEmployeeAdvanceDisbursed(approved, { voucherId: "cv-1", journalEntryId: null });
    const outstanding = advanceOutstanding(disbursed);
    const repaid = applyAdvanceRecovery(disbursed, outstanding, "2026-04-01T00:00:00.000Z");
    expect(repaid.status).toBe("repaid");
    expect(repaid.repaidAt).toBe("2026-04-01T00:00:00.000Z");
    expect(advanceOutstanding(repaid).scaled).toBe(0n);
  });

  it("fills the oldest unpaid instalment first, exactly, and keeps the advance disbursed until fully repaid", async () => {
    const { advance } = await pendingAdvance();
    const approved = approveEmployeeAdvance(advance, "user-1");
    const disbursed = markEmployeeAdvanceDisbursed(approved, { voucherId: "cv-1", journalEntryId: null });
    const first = disbursed.installments[0]!;
    const partial = applyAdvanceRecovery(disbursed, Money.fromScaled(first.amount.scaled - 1n));
    expect(partial.status).toBe("disbursed");
    expect(partial.installments[0]!.recovered.scaled).toBe(first.amount.scaled - 1n);
    expect(partial.installments[1]!.recovered.scaled).toBe(0n);
  });

  it("a recovery that exceeds one instalment spills into the next, still exact", async () => {
    const { advance } = await pendingAdvance();
    const approved = approveEmployeeAdvance(advance, "user-1");
    const disbursed = markEmployeeAdvanceDisbursed(approved, { voucherId: "cv-1", journalEntryId: null });
    const first = disbursed.installments[0]!;
    const spillAmount = Money.fromScaled(first.amount.scaled + 10n);
    const after = applyAdvanceRecovery(disbursed, spillAmount);
    expect(after.installments[0]!.recovered.scaled).toBe(first.amount.scaled);
    expect(after.installments[1]!.recovered.scaled).toBe(10n);
    // recovered + outstanding must always reconcile to the original amount, exactly.
    expect(advanceRecovered(after).scaled + advanceOutstanding(after).scaled).toBe(disbursed.amount.scaled);
  });

  it("advanceRecovered + advanceOutstanding always equals the original amount exactly, at every step", async () => {
    const { advance } = await pendingAdvance({ amount: Money.fromMajor("1000.00"), installmentCount: 3 });
    const approved = approveEmployeeAdvance(advance, "user-1");
    let disbursed = markEmployeeAdvanceDisbursed(approved, { voucherId: "cv-1", journalEntryId: null });
    for (const step of [Money.fromMajor("100.00"), Money.fromMajor("233.333334"), Money.fromMajor("666.666666")]) {
      disbursed = applyAdvanceRecovery(disbursed, step);
      expect(advanceRecovered(disbursed).scaled + advanceOutstanding(disbursed).scaled).toBe(Money.fromMajor("1000.00").scaled);
    }
    expect(disbursed.status).toBe("repaid");
  });
});

describe("employeeOutstandingBalance", () => {
  it("sums outstanding only across disbursed advances, excluding pending/approved/repaid/rejected", async () => {
    const repo = createInMemoryEmployeeAdvanceRepository();
    const pending = await requestEmployeeAdvance(
      { id: "adv-1", number: "ADV-000001", employeeId: "emp-1", amount: Money.fromMajor("100.00"), installmentCount: 1, firstDeductionDate: "2026-02-01" },
      repo,
    );
    const approvedOnly = approveEmployeeAdvance(
      await requestEmployeeAdvance(
        { id: "adv-2", number: "ADV-000002", employeeId: "emp-1", amount: Money.fromMajor("200.00"), installmentCount: 1, firstDeductionDate: "2026-02-01" },
        repo,
      ),
      "user-1",
    );
    const disbursedOne = markEmployeeAdvanceDisbursed(
      approveEmployeeAdvance(
        await requestEmployeeAdvance(
          { id: "adv-3", number: "ADV-000003", employeeId: "emp-1", amount: Money.fromMajor("300.00"), installmentCount: 1, firstDeductionDate: "2026-02-01" },
          repo,
        ),
        "user-1",
      ),
      { voucherId: "cv-1", journalEntryId: null },
    );
    const rejected = rejectEmployeeAdvance(
      await requestEmployeeAdvance(
        { id: "adv-4", number: "ADV-000004", employeeId: "emp-1", amount: Money.fromMajor("400.00"), installmentCount: 1, firstDeductionDate: "2026-02-01" },
        repo,
      ),
      "user-1",
    );

    const total = employeeOutstandingBalance([pending, approvedOnly, disbursedOne, rejected]);
    expect(total.toString()).toBe("300.000000");
  });

  it("is zero with no advances", () => {
    expect(employeeOutstandingBalance([]).scaled).toBe(0n);
  });
});
