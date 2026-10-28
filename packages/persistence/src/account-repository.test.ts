import { describe, it, expect } from "vitest";
import { createAccount, seedStandardChartOfAccounts, buildAccountTree, STANDARD_COA_TEMPLATE, DuplicateAccountCodeError, DuplicateRecordIdError, type Account } from "@mezan/domain";
import { createSqliteAccountRepository } from "./account-repository.js";

describe("SqliteAccountRepository", () => {
  it("creates and retrieves an account by id and by code", async () => {
    const repo = createSqliteAccountRepository();
    try {
      await createAccount(
        { id: "1000", code: "1000", nameAr: "الأصول", type: "asset", naturalBalance: "debit", isHeader: true },
        repo,
      );
      expect(await repo.findById("1000")).toMatchObject({ code: "1000", nameAr: "الأصول", isHeader: true });
      expect(await repo.findByCode("1000")).toMatchObject({ id: "1000" });
      expect(await repo.findById("nope")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips a null parentId and a null nameEn correctly (not the string 'null')", async () => {
    const repo = createSqliteAccountRepository();
    try {
      const created = await createAccount(
        { id: "1000", code: "1000", nameAr: "الأصول", nameEn: null, type: "asset", naturalBalance: "debit", isHeader: true },
        repo,
      );
      expect(created.parentId).toBeNull();
      expect(created.nameEn).toBeNull();
      const reloaded = await repo.findById("1000");
      expect(reloaded?.parentId).toBeNull();
      expect(reloaded?.nameEn).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("update() persists a full replace (e.g. status flip)", async () => {
    const repo = createSqliteAccountRepository();
    try {
      const created = await createAccount(
        { id: "1300-1", code: "1300-1", nameAr: "صندوق", type: "asset", naturalBalance: "debit", isHeader: false },
        repo,
      );
      await repo.update({ ...created, status: "inactive" });
      expect((await repo.findById("1300-1"))?.status).toBe("inactive");
    } finally {
      repo.close();
    }
  });

  it("list() returns every persisted account", async () => {
    const repo = createSqliteAccountRepository();
    try {
      await createAccount({ id: "1000", code: "1000", nameAr: "الأصول", type: "asset", naturalBalance: "debit", isHeader: true }, repo);
      await createAccount({ id: "2000", code: "2000", nameAr: "الالتزامات", type: "liability", naturalBalance: "credit", isHeader: true }, repo);
      const all = await repo.list();
      expect(all.map((a) => a.code).sort()).toEqual(["1000", "2000"]);
    } finally {
      repo.close();
    }
  });

  it("drives seedStandardChartOfAccounts end to end and builds a real tree from the SQLite rows", async () => {
    const repo = createSqliteAccountRepository();
    try {
      await seedStandardChartOfAccounts(repo);
      const all = await repo.list();
      expect(all).toHaveLength(STANDARD_COA_TEMPLATE.length);
      const tree = buildAccountTree(all);
      expect(tree.map((n) => n.code)).toEqual(["1000", "2000", "3000", "4000", "5000", "9000"]);
    } finally {
      repo.close();
    }
  });

  it("create() refuses a taken id or a taken code without raising a constraint error, and keeps the first row", async () => {
    const repo = createSqliteAccountRepository();
    const leaf = (id: string, code: string, nameAr: string): Account => ({ id, code, nameAr, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" });
    try {
      await repo.create(leaf("a1", "1300-1", "الأول"));
      await expect(repo.create(leaf("a1", "1300-9", "مكرر"))).rejects.toBeInstanceOf(DuplicateRecordIdError);
      await expect(repo.create(leaf("a2", "1300-1", "مكرر"))).rejects.toBeInstanceOf(DuplicateAccountCodeError);
      expect(await repo.list()).toEqual([leaf("a1", "1300-1", "الأول")]);
    } finally {
      repo.close();
    }
  });
});
