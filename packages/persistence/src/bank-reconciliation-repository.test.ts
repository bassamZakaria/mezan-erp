import { describe, it, expect } from "vitest";
import { BankStatementSource, Money, type BankStatement, type StatementColumnMapping, type StatementLine } from "@mezan/domain";
import { createSqliteBankReconciliationStore } from "./bank-reconciliation-repository.js";

function makeStatement(overrides: Partial<BankStatement> = {}): BankStatement {
  return {
    id: "stmt-1",
    treasuryAccountId: "ta-bank1",
    branchId: "BR-MAIN",
    currency: "EGP",
    importFingerprint: null,
    source: BankStatementSource.Csv,
    statementNumber: "ST-001",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    openingBalance: Money.zero(),
    closingBalance: Money.fromMajor("50"),
    status: "imported",
    importedAt: "2026-08-22T00:00:00.000Z",
    finalizedAt: null,
    ...overrides,
  };
}

function makeLine(overrides: Partial<StatementLine> = {}): StatementLine {
  return {
    id: "stmt-1:L0",
    statementId: "stmt-1",
    date: "2026-08-01",
    description: "Deposit",
    reference: "TX1",
    amount: Money.fromMajor("100"),
    status: "unmatched",
    matchedEntryId: null,
    matchedAt: null,
    ...overrides,
  };
}

function makeMapping(overrides: Partial<StatementColumnMapping> = {}): StatementColumnMapping {
  return {
    treasuryAccountId: "ta-bank1",
    dateColumn: "Date",
    descriptionColumn: "Description",
    amountColumn: "Amount",
    debitColumn: null,
    creditColumn: null,
    referenceColumn: "Ref",
    dateFormat: "YYYY-MM-DD",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("SqliteBankStatementRepository", () => {
  it("saves and retrieves a statement, round-tripping Money", async () => {
    const store = createSqliteBankReconciliationStore();
    try {
      await store.statements.save(makeStatement());
      const found = await store.statements.findById("stmt-1");
      expect(found?.closingBalance.toString()).toBe("50.000000");
      expect(found?.status).toBe("imported");
    } finally {
      store.close();
    }
  });

  it("update() persists a status/finalizedAt transition", async () => {
    const store = createSqliteBankReconciliationStore();
    try {
      await store.statements.save(makeStatement());
      await store.statements.update(makeStatement({ status: "completed", finalizedAt: "2026-08-23T00:00:00.000Z" }));
      const found = await store.statements.findById("stmt-1");
      expect(found?.status).toBe("completed");
      expect(found?.finalizedAt).toBe("2026-08-23T00:00:00.000Z");
    } finally {
      store.close();
    }
  });

  it("list() filters by treasury account and status", async () => {
    const store = createSqliteBankReconciliationStore();
    try {
      await store.statements.save(makeStatement({ id: "s1", treasuryAccountId: "ta-bank1", status: "imported" }));
      await store.statements.save(makeStatement({ id: "s2", treasuryAccountId: "ta-bank2", status: "completed" }));
      expect((await store.statements.list({ treasuryAccountId: "ta-bank1" })).map((s) => s.id)).toEqual(["s1"]);
      expect((await store.statements.list({ status: "completed" })).map((s) => s.id)).toEqual(["s2"]);
      expect((await store.statements.list()).length).toBe(2);
    } finally {
      store.close();
    }
  });

  it("saves lines in bulk and lists them for a statement", async () => {
    const store = createSqliteBankReconciliationStore();
    try {
      await store.statements.save(makeStatement());
      await store.statements.saveLines([makeLine({ id: "L0" }), makeLine({ id: "L1", date: "2026-08-02", amount: Money.fromMajor("-30") })]);
      const lines = await store.statements.listLines("stmt-1");
      expect(lines).toHaveLength(2);
      expect(lines[1]!.amount.toString()).toBe("-30.000000");
    } finally {
      store.close();
    }
  });

  it("updateLine() persists a match", async () => {
    const store = createSqliteBankReconciliationStore();
    try {
      await store.statements.save(makeStatement());
      await store.statements.saveLine(makeLine());
      await store.statements.updateLine(makeLine({ status: "matched", matchedEntryId: "je-1", matchedAt: "2026-08-22T00:00:00.000Z" }));
      const found = await store.statements.findLineById("stmt-1:L0");
      expect(found?.status).toBe("matched");
      expect(found?.matchedEntryId).toBe("je-1");
    } finally {
      store.close();
    }
  });
});

describe("SqliteColumnMappingRepository", () => {
  it("upserts and retrieves a mapping by treasury account", async () => {
    const store = createSqliteBankReconciliationStore();
    try {
      await store.mappings.upsert(makeMapping());
      const found = await store.mappings.findByTreasuryAccount("ta-bank1");
      expect(found).toMatchObject({ dateColumn: "Date", amountColumn: "Amount" });
      expect(await store.mappings.findByTreasuryAccount("nope")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("upsert() replaces the previous mapping for the same account", async () => {
    const store = createSqliteBankReconciliationStore();
    try {
      await store.mappings.upsert(makeMapping());
      await store.mappings.upsert(makeMapping({ amountColumn: null, debitColumn: "Debit", creditColumn: "Credit" }));
      const found = await store.mappings.findByTreasuryAccount("ta-bank1");
      expect(found?.amountColumn).toBeNull();
      expect(found?.debitColumn).toBe("Debit");
    } finally {
      store.close();
    }
  });
});
