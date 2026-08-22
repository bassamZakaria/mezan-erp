import { describe, it, expect } from "vitest";
import { Money, type Cheque } from "@mezan/domain";
import { createSqliteChequeRepository } from "./cheque-repository.js";

function makeCheque(overrides: Partial<Cheque> = {}): Cheque {
  return {
    id: "chq-1",
    direction: "incoming",
    status: "pending",
    chequeNumber: "CHQ-5001",
    bankName: "بنك مصر",
    bankBranchName: null,
    bankAccountNumber: null,
    amount: Money.fromMajor("1000"),
    currency: "EGP",
    issueDate: "2026-08-01",
    dueDate: "2026-08-20",
    branchId: "b1",
    notes: null,
    partyId: "cust-1",
    counterpartyGlAccountId: "1100",
    controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
    bankTreasuryAccountId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    depositedAt: null,
    collectedAt: null,
    bouncedAt: null,
    replacesChequeId: null,
    replacedByChequeId: null,
    creationJournalEntryId: "je-1",
    collectionJournalEntryId: null,
    bounceJournalEntryId: null,
    ...overrides,
  };
}

describe("SqliteChequeRepository", () => {
  it("saves and retrieves a cheque by id, round-tripping Money and control accounts", async () => {
    const repo = createSqliteChequeRepository();
    try {
      await repo.save(makeCheque());
      const found = await repo.findById("chq-1");
      expect(found?.amount.toString()).toBe("1000.000000");
      expect(found?.controlAccounts).toEqual({ underCollectionAccountId: "1320", bouncedAccountId: "1360" });
      expect(found?.status).toBe("pending");
    } finally {
      repo.close();
    }
  });

  it("finds a cheque by direction + cheque number", async () => {
    const repo = createSqliteChequeRepository();
    try {
      await repo.save(makeCheque());
      expect(await repo.findByChequeNumber("incoming", "CHQ-5001")).toMatchObject({ id: "chq-1" });
      expect(await repo.findByChequeNumber("outgoing", "CHQ-5001")).toBeNull();
      expect(await repo.findByChequeNumber("incoming", "NOPE")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("enforces uniqueness of (direction, cheque_number)", async () => {
    const repo = createSqliteChequeRepository();
    try {
      await repo.save(makeCheque());
      await expect(repo.save(makeCheque({ id: "chq-2" }))).rejects.toThrow();
    } finally {
      repo.close();
    }
  });

  it("update() persists a status transition", async () => {
    const repo = createSqliteChequeRepository();
    try {
      await repo.save(makeCheque());
      await repo.update(makeCheque({ status: "deposited", bankTreasuryAccountId: "ta-bank1", depositedAt: "2026-08-10T00:00:00.000Z" }));
      const found = await repo.findById("chq-1");
      expect(found?.status).toBe("deposited");
      expect(found?.bankTreasuryAccountId).toBe("ta-bank1");
    } finally {
      repo.close();
    }
  });

  it("list() filters by direction, status, and due-date range", async () => {
    const repo = createSqliteChequeRepository();
    try {
      await repo.save(makeCheque({ id: "c1", chequeNumber: "N1", direction: "incoming", dueDate: "2026-08-10" }));
      await repo.save(makeCheque({ id: "c2", chequeNumber: "N2", direction: "outgoing", dueDate: "2026-08-15" }));
      await repo.save(makeCheque({ id: "c3", chequeNumber: "N3", direction: "incoming", status: "deposited", dueDate: "2026-08-20" }));

      expect((await repo.list({ direction: "incoming" })).map((c) => c.id).sort()).toEqual(["c1", "c3"]);
      expect((await repo.list({ status: "deposited" })).map((c) => c.id)).toEqual(["c3"]);
      expect((await repo.list({ fromDate: "2026-08-12" })).map((c) => c.id).sort()).toEqual(["c2", "c3"]);
      expect((await repo.list({ toDate: "2026-08-12" })).map((c) => c.id)).toEqual(["c1"]);
      expect((await repo.list()).length).toBe(3);
    } finally {
      repo.close();
    }
  });

  it("round-trips a null bouncedAccountId (outgoing control accounts)", async () => {
    const repo = createSqliteChequeRepository();
    try {
      await repo.save(makeCheque({ controlAccounts: { underCollectionAccountId: "2150", bouncedAccountId: null } }));
      const found = await repo.findById("chq-1");
      expect(found?.controlAccounts.bouncedAccountId).toBeNull();
    } finally {
      repo.close();
    }
  });
});
