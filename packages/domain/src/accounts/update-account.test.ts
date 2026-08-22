import { describe, it, expect } from "vitest";
import { InMemoryAccountRepository } from "./test-helpers/in-memory-account-repository.js";
import { createAccount } from "./create-account.js";
import { updateAccount } from "./update-account.js";
import {
  AccountNotFoundError,
  CircularParentAccountError,
  HeaderAccountHasChildrenError,
  InvalidParentAccountError,
} from "./errors.js";

async function seedAssetsWithCash(repo: InMemoryAccountRepository) {
  await createAccount({ id: "1000", code: "1000", nameAr: "الأصول", type: "asset", naturalBalance: "debit", isHeader: true }, repo);
  await createAccount({ id: "1300", code: "1300", nameAr: "النقدية", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: true }, repo);
  await createAccount(
    { id: "1300-1", code: "1300-1", nameAr: "صندوق", type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false },
    repo,
  );
}

describe("updateAccount", () => {
  it("edits simple fields (name, status) without touching the hierarchy", async () => {
    const repo = new InMemoryAccountRepository();
    await seedAssetsWithCash(repo);
    const updated = await updateAccount("1300-1", { nameAr: "الصندوق الرئيسي", status: "inactive" }, repo);
    expect(updated.nameAr).toBe("الصندوق الرئيسي");
    expect(updated.status).toBe("inactive");
    expect(updated.parentId).toBe("1300"); // unchanged
  });

  it("throws for an unknown account id", async () => {
    const repo = new InMemoryAccountRepository();
    await expect(updateAccount("nope", { nameAr: "x" }, repo)).rejects.toThrow(AccountNotFoundError);
  });

  it("rejects reparenting onto a non-header account", async () => {
    const repo = new InMemoryAccountRepository();
    await seedAssetsWithCash(repo);
    await expect(updateAccount("1300-1", { parentId: "1300-1" }, repo)).rejects.toThrow(CircularParentAccountError);
  });

  it("rejects reparenting onto a detail (non-header) account", async () => {
    const repo = new InMemoryAccountRepository();
    await seedAssetsWithCash(repo);
    await expect(updateAccount("1000", { parentId: "1300-1" }, repo)).rejects.toThrow(InvalidParentAccountError);
  });

  it("rejects reparenting that would create a cycle (child becomes ancestor's parent)", async () => {
    const repo = new InMemoryAccountRepository();
    await seedAssetsWithCash(repo);
    // 1300's parent is 1000; try to make 1000's parent be 1300's own child chain -> cycle.
    await expect(updateAccount("1000", { parentId: "1300" }, repo)).rejects.toThrow(CircularParentAccountError);
  });

  it("rejects flipping a header account with children into a postable detail account", async () => {
    const repo = new InMemoryAccountRepository();
    await seedAssetsWithCash(repo);
    await expect(updateAccount("1300", { isHeader: false }, repo)).rejects.toThrow(HeaderAccountHasChildrenError);
  });

  it("allows flipping a childless header account into a detail account", async () => {
    const repo = new InMemoryAccountRepository();
    await createAccount({ id: "1250", code: "1250", nameAr: "إنتاج تحت التشغيل", type: "asset", naturalBalance: "debit", isHeader: true }, repo);
    const updated = await updateAccount("1250", { isHeader: false }, repo);
    expect(updated.isHeader).toBe(false);
  });

  it("moves an account to a new valid header parent", async () => {
    const repo = new InMemoryAccountRepository();
    await seedAssetsWithCash(repo);
    await createAccount({ id: "1500", code: "1500", nameAr: "أصول ثابتة", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: true }, repo);
    const moved = await updateAccount("1300-1", { parentId: "1500" }, repo);
    expect(moved.parentId).toBe("1500");
  });
});
