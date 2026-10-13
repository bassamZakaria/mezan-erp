import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { createCustomer, Money, SYSTEM_NOT_SUBJECT_TAX_RATE_ID } from "@mezan/domain";
import { createSqliteCustomerRepository } from "./customer-repository.js";

describe("SqliteCustomerRepository", () => {
  it("creates and retrieves a customer by id and by code", async () => {
    const repo = createSqliteCustomerRepository();
    try {
      const customer = createCustomer({ id: "c1", code: "C000001", nameAr: "شركة الأمل للتجارة" });
      await repo.save(customer);
      expect(await repo.findById("c1")).toMatchObject({ code: "C000001", nameAr: "شركة الأمل للتجارة" });
      expect(await repo.findByCode("C000001")).toMatchObject({ id: "c1" });
      expect(await repo.findById("nope")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips Money fields exactly (credit limit, opening balance) and nulls (not the string 'null')", async () => {
    const repo = createSqliteCustomerRepository();
    try {
      const customer = createCustomer({
        id: "c1",
        code: "C1",
        nameAr: "عميل",
        nameEn: null,
        creditLimit: Money.fromMajor("12345.678900"),
        openingBalance: Money.fromMajor("-500.50"),
      });
      await repo.save(customer);
      const reloaded = await repo.findById("c1");
      expect(reloaded?.nameEn).toBeNull();
      expect(reloaded?.creditLimit.toString()).toBe("12345.678900");
      expect(reloaded?.openingBalance.toString()).toBe("-500.500000");
    } finally {
      repo.close();
    }
  });

  it("save() persists a full replace (e.g. deactivate)", async () => {
    const repo = createSqliteCustomerRepository();
    try {
      const customer = createCustomer({ id: "c1", code: "C1", nameAr: "عميل" });
      await repo.save(customer);
      await repo.save({ ...customer, active: false });
      expect((await repo.findById("c1"))?.active).toBe(false);
    } finally {
      repo.close();
    }
  });

  it("findAll() returns every persisted customer, ordered by code", async () => {
    const repo = createSqliteCustomerRepository();
    try {
      await repo.save(createCustomer({ id: "c2", code: "C002", nameAr: "ب" }));
      await repo.save(createCustomer({ id: "c1", code: "C001", nameAr: "أ" }));
      const all = await repo.findAll();
      expect(all.map((c) => c.code)).toEqual(["C001", "C002"]);
    } finally {
      repo.close();
    }
  });
});

describe("an exemption card left holding the system's not-subject rate", () => {
  it("is cleared when the books are opened, and a card holding the tenant's own rate is left alone", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "mezan-cust-")), "books.db");
    const before = createSqliteCustomerRepository(path);
    await before.save(createCustomer({ id: "C-SYS", code: "C-SYS", nameAr: "جهة", taxExempt: true, taxExemptionRateId: "OWN-EXEMPT" }));
    await before.save(createCustomer({ id: "C-OWN", code: "C-OWN", nameAr: "جهة", taxExempt: true, taxExemptionRateId: "OWN-EXEMPT" }));
    before.close();
    const raw = new Database(path);
    raw.prepare("UPDATE customer SET tax_exemption_rate_id = ? WHERE id = 'C-SYS'").run(SYSTEM_NOT_SUBJECT_TAX_RATE_ID);
    raw.close();

    const after = createSqliteCustomerRepository(path);
    expect((await after.findById("C-SYS"))?.taxExemptionRateId).toBeNull();
    expect((await after.findById("C-SYS"))?.taxExempt).toBe(true);
    expect((await after.findById("C-OWN"))?.taxExemptionRateId).toBe("OWN-EXEMPT");
    after.close();
  });
});
