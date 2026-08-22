import { describe, it, expect } from "vitest";
import { createTreasuryAccount } from "@mezan/domain";
import { createSqliteTreasuryAccountRepository } from "./treasury-account-repository.js";

describe("SqliteTreasuryAccountRepository", () => {
  it("creates and retrieves a treasury account by id and by code", async () => {
    const repo = createSqliteTreasuryAccountRepository();
    try {
      await createTreasuryAccount({ id: "ta1", code: "CASH-001", name: "صندوق نقدي", branchId: "b1" }, repo);
      expect(await repo.findById("ta1")).toMatchObject({ code: "CASH-001", branchId: "b1" });
      expect(await repo.findByCode("CASH-001")).toMatchObject({ id: "ta1" });
      expect(await repo.findById("nope")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips the exact opening balance (Money, scaled INTEGER column) and a null glAccountId", async () => {
    const repo = createSqliteTreasuryAccountRepository();
    try {
      await createTreasuryAccount(
        { id: "ta1", code: "CASH-002", name: "صندوق نقدي الفرع الرئيسي", branchId: "b1", openingBalance: "338.00" },
        repo,
      );
      const reloaded = await repo.findById("ta1");
      expect(reloaded?.openingBalance.toString()).toBe("338.000000");
      expect(reloaded?.glAccountId).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("update() persists a full replace (e.g. status flip)", async () => {
    const repo = createSqliteTreasuryAccountRepository();
    try {
      const created = await createTreasuryAccount({ id: "ta1", code: "CASH-001", name: "صندوق", branchId: "b1" }, repo);
      await repo.update({ ...created, status: "inactive" });
      expect((await repo.findById("ta1"))?.status).toBe("inactive");
    } finally {
      repo.close();
    }
  });

  it("list() returns every persisted treasury account", async () => {
    const repo = createSqliteTreasuryAccountRepository();
    try {
      await createTreasuryAccount({ id: "ta1", code: "CASH-001", name: "صندوق ١", branchId: "b1" }, repo);
      await createTreasuryAccount({ id: "ta2", code: "CASH-002", name: "صندوق ٢", branchId: "b1" }, repo);
      const all = await repo.list();
      expect(all.map((a) => a.code).sort()).toEqual(["CASH-001", "CASH-002"]);
    } finally {
      repo.close();
    }
  });
});
