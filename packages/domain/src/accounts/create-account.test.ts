import { describe, it, expect } from "vitest";
import { InMemoryAccountRepository } from "./test-helpers/in-memory-account-repository.js";
import { createAccount, validateNewAccount } from "./create-account.js";
import { DuplicateAccountCodeError, InvalidParentAccountError } from "./errors.js";

describe("createAccount", () => {
  it("creates a root header account", async () => {
    const repo = new InMemoryAccountRepository();
    const account = await createAccount(
      { id: "1000", code: "1000", nameAr: "الأصول", type: "asset", naturalBalance: "debit", isHeader: true },
      repo,
    );
    expect(account).toMatchObject({ id: "1000", code: "1000", parentId: null, isHeader: true, status: "active" });
    expect(await repo.findById("1000")).toEqual(account);
  });

  it("creates a detail account under a header parent", async () => {
    const repo = new InMemoryAccountRepository();
    await createAccount(
      { id: "1300", code: "1300", nameAr: "النقدية", type: "asset", naturalBalance: "debit", isHeader: true },
      repo,
    );
    const leaf = await createAccount(
      {
        id: "1300-1",
        code: "1300-1",
        nameAr: "صندوق نقدي الفرع الرئيسي",
        type: "asset",
        naturalBalance: "debit",
        parentId: "1300",
        isHeader: false,
      },
      repo,
    );
    expect(leaf.parentId).toBe("1300");
    expect(leaf.isHeader).toBe(false);
  });

  it("rejects a duplicate account code", async () => {
    const repo = new InMemoryAccountRepository();
    await createAccount(
      { id: "1000", code: "1000", nameAr: "الأصول", type: "asset", naturalBalance: "debit", isHeader: true },
      repo,
    );
    await expect(
      createAccount(
        { id: "1000-dup", code: "1000", nameAr: "نسخة", type: "asset", naturalBalance: "debit", isHeader: true },
        repo,
      ),
    ).rejects.toThrow(DuplicateAccountCodeError);
  });

  it("rejects a parent that does not exist", async () => {
    const repo = new InMemoryAccountRepository();
    await expect(
      createAccount(
        {
          id: "1300-1",
          code: "1300-1",
          nameAr: "صندوق",
          type: "asset",
          naturalBalance: "debit",
          parentId: "does-not-exist",
          isHeader: false,
        },
        repo,
      ),
    ).rejects.toThrow(InvalidParentAccountError);
  });

  it("rejects a parent that is itself a detail (non-header) account", async () => {
    const repo = new InMemoryAccountRepository();
    await createAccount(
      { id: "1200", code: "1200", nameAr: "المخزون", type: "asset", naturalBalance: "debit", isHeader: false },
      repo,
    );
    await expect(
      createAccount(
        {
          id: "1200-1",
          code: "1200-1",
          nameAr: "فرعي",
          type: "asset",
          naturalBalance: "debit",
          parentId: "1200",
          isHeader: false,
        },
        repo,
      ),
    ).rejects.toThrow(InvalidParentAccountError);
  });

  it("validateNewAccount is a pure pre-check that does not persist anything", () => {
    expect(() =>
      validateNewAccount(
        { id: "x", code: "9999", nameAr: "n", type: "asset", naturalBalance: "debit", isHeader: true },
        [],
      ),
    ).not.toThrow();
  });
});
