/**
 * العهدة — money advanced to a person and settled later, seen from the safe.
 *
 * An employee advance is not an HR curiosity from where the cashier sits: it is
 * cash leaving the drawer against a name, and it must behave like every other
 * payment — an ASSET on 1160 سلف الموظفين rather than an expense, guarded by the
 * cash-negative rule, and with an outstanding balance that ties to its control
 * account after a PARTIAL settlement. The disbursement rides on the same
 * treasury-voucher engine (`createHrTreasuryDisbursementPort`), which is what
 * this file wires and drives.
 */

import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { buildTestService } from "./test-helpers/build-test-service.js";
import type { EmployeeAdvance, EmployeeAdvanceRepository } from "../hr/advance.js";
import {
  advanceOutstanding,
  advanceRecovered,
  approveEmployeeAdvance,
  employeeOutstandingBalance,
  rejectEmployeeAdvance,
  requestEmployeeAdvance,
} from "../hr/advance.js";
import { disburseEmployeeAdvance } from "../hr/hr-disbursement.js";
import type { TreasuryDisbursementPort } from "../hr/hr-disbursement.js";
import { InvalidEmployeeAdvanceTransitionError } from "../hr/errors.js";

const ADVANCE_ACCOUNT = "1160";
const SAFE = "1300-1";

function inMemoryAdvances(): EmployeeAdvanceRepository {
  const rows = new Map<string, EmployeeAdvance>();
  return {
    async findById(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
    async listByEmployeeId(employeeId) { return [...rows.values()].filter((a) => a.employeeId === employeeId); },
    async create(advance) { rows.set(advance.id, advance); },
    async update(advance) { rows.set(advance.id, advance); },
  };
}

type Harness = ReturnType<typeof buildTestService>;

/** The same binding the composition root uses: a مصروف آخر payment voucher. */
function treasuryPort(h: Harness): TreasuryDisbursementPort {
  return {
    async disburse(request) {
      await h.service.createVoucher({
        id: request.id,
        date: request.date,
        memo: request.memo,
        voucherType: "other_expense",
        amount: request.amount,
        branchId: request.branchId,
        paymentMethod: request.paymentMethod ?? "cash",
        treasuryAccountId: request.treasuryAccountId,
        treasuryGlAccountId: SAFE,
        counterpartyGlAccountId: request.counterpartyGlAccountId,
        referenceNo: request.referenceNo ?? null,
      });
      const { document } = await h.service.confirmVoucher(request.id);
      return { voucherId: document.id, voucherNo: document.docNo, journalEntryId: document.journalEntryId };
    },
  };
}

async function openSafe(): Promise<Harness> {
  const h = buildTestService();
  await h.seedCashBalance(SAFE, "25000.00");
  return h;
}

async function pendingAdvance(repo: EmployeeAdvanceRepository, id = "adv-1", employeeId = "emp-1"): Promise<EmployeeAdvance> {
  return requestEmployeeAdvance(
    {
      id,
      number: "ADV-000001",
      employeeId,
      amount: Money.fromMajor("5000.00"),
      installmentCount: 3,
      firstDeductionDate: "2026-09-01",
      now: () => "2026-08-22T09:00:00.000Z",
    },
    repo,
  );
}


describe("paying an عهدة out of the safe", () => {
  it("splits into instalments that sum EXACTLY to the advance", async () => {
    const repo = inMemoryAdvances();
    const advance = await pendingAdvance(repo);
    expect(Money.sum(advance.installments.map((i) => i.amount)).toString()).toBe("5000.000000");
    expect(advance.installments.map((i) => i.amount.toString())).toEqual([
      "1666.666667",
      "1666.666667",
      "1666.666666",
    ]);
    expect(advance.installments.map((i) => i.dueDate)).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
  });

  it("debits 1160 سلف الموظفين as an ASSET and credits the safe, exactly", async () => {
    const h = await openSafe();
    const repo = inMemoryAdvances();
    await repo.update(approveEmployeeAdvance(await pendingAdvance(repo), "manager", "2026-08-22T09:30:00.000Z"));

    const disbursed = await disburseEmployeeAdvance(
      "adv-1",
      { treasuryAccountId: "ta-cash1", branchId: "b1", date: "2026-08-22" },
      { advances: repo, treasury: treasuryPort(h), accounts: { employeeAdvanceAccountId: ADVANCE_ACCOUNT }, idGen: () => "cv-adv-1", now: () => "2026-08-22T10:00:00.000Z" },
    );

    expect(disbursed.status).toBe("disbursed");
    expect(disbursed.disbursementVoucherId).toBe("cv-adv-1");
    const entry = (await h.ledger.findById("cv-adv-1"))!;
    expect(entry.lines.map((l) => ({ accountId: l.accountId, debit: l.debit.toString(), credit: l.credit.toString() }))).toEqual([
      { accountId: ADVANCE_ACCOUNT, debit: "5000.000000", credit: "0.000000" },
      { accountId: SAFE, debit: "0.000000", credit: "5000.000000" },
    ]);
    expect((await h.ledger.accountBalance(SAFE)).balance.toString()).toBe("20000.000000");
    expect((await h.ledger.accountBalance(ADVANCE_ACCOUNT)).balance.toString()).toBe("5000.000000");
    expect((await h.ledger.accountBalance("5910")).balance.toString()).toBe("0.000000");
  });

  it("is refused when the safe cannot cover it, and no cash leaves", async () => {
    const h = buildTestService();
    await h.seedCashBalance(SAFE, "1000.00");
    const repo = inMemoryAdvances();
    await repo.update(approveEmployeeAdvance(await pendingAdvance(repo), "manager", "2026-08-22T09:30:00.000Z"));

    await expect(
      disburseEmployeeAdvance(
        "adv-1",
        { treasuryAccountId: "ta-cash1", branchId: "b1", date: "2026-08-22" },
        { advances: repo, treasury: treasuryPort(h), accounts: { employeeAdvanceAccountId: ADVANCE_ACCOUNT }, idGen: () => "cv-adv-1" },
      ),
    ).rejects.toThrow();

    expect((await h.ledger.accountBalance(SAFE)).balance.toString()).toBe("1000.000000");
    expect((await repo.findById("adv-1"))!.status).toBe("approved");
  });
});


describe("settling an عهدة partway, and tying it to its control account", () => {
  async function disbursed() {
    const h = await openSafe();
    const repo = inMemoryAdvances();
    await repo.update(approveEmployeeAdvance(await pendingAdvance(repo), "manager", "2026-08-22T09:30:00.000Z"));
    await disburseEmployeeAdvance(
      "adv-1",
      { treasuryAccountId: "ta-cash1", branchId: "b1", date: "2026-08-22" },
      { advances: repo, treasury: treasuryPort(h), accounts: { employeeAdvanceAccountId: ADVANCE_ACCOUNT }, idGen: () => "cv-adv-1", now: () => "2026-08-22T10:00:00.000Z" },
    );
    return { h, repo };
  }

  it("the outstanding after two of three instalments is exact, and equals the 1160 balance", async () => {
    const { h, repo } = await disbursed();
    const advance = (await repo.findById("adv-1"))!;
    const recovered = Money.sum(advance.installments.slice(0, 2).map((i) => i.amount));
    expect(recovered.toString()).toBe("3333.333334");

    // The recovery credits the advances asset back down — the only path the
    // product offers today is a treasury receipt booked against 1160.
    await h.service.createVoucher({
      id: "cv-recover", date: "2026-08-25", voucherType: "other_income", amount: recovered,
      branchId: "b1", paymentMethod: "cash", treasuryAccountId: "ta-cash1", treasuryGlAccountId: SAFE,
      counterpartyGlAccountId: ADVANCE_ACCOUNT,
    });
    await h.service.confirmVoucher("cv-recover");

    const settled: EmployeeAdvance = {
      ...advance,
      installments: advance.installments.map((i, idx) => (idx < 2 ? { ...i, recovered: i.amount } : i)),
    };
    await repo.update(settled);

    expect(advanceRecovered(settled).toString()).toBe("3333.333334");
    expect(advanceOutstanding(settled).toString()).toBe("1666.666666");
    // The two numbers that must agree: sub-ledger outstanding vs its control.
    expect((await h.ledger.accountBalance(ADVANCE_ACCOUNT)).balance.toString()).toBe("1666.666666");
    expect((await h.ledger.accountBalance(SAFE)).balance.toString()).toBe("23333.333334");
  });

  it("only advances actually paid out count toward the outstanding custody balance", async () => {
    const { h, repo } = await disbursed();
    const other = await pendingAdvance(repo, "adv-2", "emp-2");
    await repo.update(rejectEmployeeAdvance(other, "manager", "2026-08-22T11:00:00.000Z"));

    const all = await repo.list();
    expect(employeeOutstandingBalance(all).toString()).toBe("5000.000000");
    expect((await h.ledger.accountBalance(ADVANCE_ACCOUNT)).balance.toString()).toBe("5000.000000");
    expect((await repo.findById("adv-2"))!.disbursementVoucherId).toBeNull();
  });
});


describe("approval must come before the money leaves the safe", () => {
  it("refuses to disburse an advance nobody approved, and no cash leaves the drawer", async () => {
    const h = await openSafe();
    const repo = inMemoryAdvances();
    await pendingAdvance(repo);
    expect((await repo.findById("adv-1"))!.status).toBe("pending");

    await expect(
      disburseEmployeeAdvance(
        "adv-1",
        { treasuryAccountId: "ta-cash1", branchId: "b1", date: "2026-08-22" },
        { advances: repo, treasury: treasuryPort(h), accounts: { employeeAdvanceAccountId: ADVANCE_ACCOUNT }, idGen: () => "cv-adv-1" },
      ),
    ).rejects.toBeInstanceOf(InvalidEmployeeAdvanceTransitionError);

    expect((await h.ledger.accountBalance(SAFE)).balance.toString()).toBe("25000.000000");
    expect((await h.ledger.accountBalance(ADVANCE_ACCOUNT)).balance.toString()).toBe("0.000000");
    expect(await h.service.findById("cv-adv-1")).toBeNull();
    expect((await repo.findById("adv-1"))!.status).toBe("pending");
  });

  it("refuses to disburse a rejected advance, and no cash leaves the drawer", async () => {
    const h = await openSafe();
    const repo = inMemoryAdvances();
    await repo.update(rejectEmployeeAdvance(await pendingAdvance(repo), "manager", "2026-08-22T09:30:00.000Z"));

    await expect(
      disburseEmployeeAdvance(
        "adv-1",
        { treasuryAccountId: "ta-cash1", branchId: "b1", date: "2026-08-22" },
        { advances: repo, treasury: treasuryPort(h), accounts: { employeeAdvanceAccountId: ADVANCE_ACCOUNT }, idGen: () => "cv-adv-1" },
      ),
    ).rejects.toBeInstanceOf(InvalidEmployeeAdvanceTransitionError);

    expect((await h.ledger.accountBalance(SAFE)).balance.toString()).toBe("25000.000000");
    expect(await h.service.findById("cv-adv-1")).toBeNull();
  });

  it("refuses to disburse the same advance twice, so the money cannot go out again", async () => {
    const h = await openSafe();
    const repo = inMemoryAdvances();
    await repo.update(approveEmployeeAdvance(await pendingAdvance(repo), "manager", "2026-08-22T09:30:00.000Z"));
    const deps = { advances: repo, treasury: treasuryPort(h), accounts: { employeeAdvanceAccountId: ADVANCE_ACCOUNT }, idGen: () => "cv-adv-1", now: () => "2026-08-22T10:00:00.000Z" };
    await disburseEmployeeAdvance("adv-1", { treasuryAccountId: "ta-cash1", branchId: "b1", date: "2026-08-22" }, deps);

    await expect(
      disburseEmployeeAdvance("adv-1", { treasuryAccountId: "ta-cash1", branchId: "b1", date: "2026-08-22" }, deps),
    ).rejects.toBeInstanceOf(InvalidEmployeeAdvanceTransitionError);

    expect((await h.ledger.accountBalance(SAFE)).balance.toString()).toBe("20000.000000");
  });
});

