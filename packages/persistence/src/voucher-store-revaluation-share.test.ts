import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { Money } from "@mezan/domain";
import { createSqliteVoucherStore } from "./voucher-store.js";

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function oldShapeBooks(): string {
  dir = mkdtempSync(path.join(tmpdir(), "mezan-voucher-old-"));
  const file = path.join(dir, "books.db");
  const sqlite = new Database(file);
  sqlite.exec(`
    CREATE TABLE voucher_allocation (
      id TEXT PRIMARY KEY, voucher_id TEXT NOT NULL, invoice_id TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, reversed_at TEXT, invoice_amount INTEGER, fx_entry_id TEXT, date TEXT, reversed_on TEXT
    );
    INSERT INTO voucher_allocation (id, voucher_id, invoice_id, amount, status, created_at, invoice_amount, fx_entry_id, date)
    VALUES ('al-old', 'v-1', 'inv-1', 5000000000, 'active', '2026-08-26T09:00:00.000Z', 4800000000, 'FXR:al-old', '2026-08-26');
  `);
  sqlite.close();
  return file;
}

describe("voucher store — the revaluation an allocation consumed", () => {
  it("books written before the column keep every allocation as it was, with nothing consumed, however often they are opened", async () => {
    const file = oldShapeBooks();
    for (let opened = 0; opened < 2; opened += 1) {
      const store = createSqliteVoucherStore(file);
      const old = await store.allocations.findById("al-old");
      expect(old).toMatchObject({ voucherId: "v-1", invoiceId: "inv-1", status: "active", fxEntryId: "FXR:al-old", date: "2026-08-26", revaluationShare: null });
      expect(old?.amount.toString()).toBe("5000.000000");
      expect(old?.invoiceAmount?.toString()).toBe("4800.000000");
      store.close();
    }
  });

  it("keeps what a new allocation took of a revaluation, signed, and each run's share of an item", async () => {
    const store = createSqliteVoucherStore(oldShapeBooks());
    await store.allocations.save({ id: "al-new", voucherId: "v-2", invoiceId: "inv-1", amount: Money.fromMajor("47300"), invoiceAmount: Money.fromMajor("48000"), revaluationShare: Money.fromMajor("-450"), status: "active", createdAt: "2026-09-10T09:00:00.000Z", reversedAt: null });
    expect((await store.allocations.findById("al-new"))?.revaluationShare?.toString()).toBe("-450.000000");

    await store.revaluationShares.saveAll([
      { entryId: "run-1", accountId: "1105", itemId: "inv-1", kind: "sales", partyId: "cust-1", currency: "USD", amount: Money.fromMajor("450") },
      { entryId: "run-1", accountId: "1105", itemId: "inv-2", kind: "sales", partyId: "cust-2", currency: "USD", amount: Money.fromMajor("-12.5") },
    ]);
    expect((await store.revaluationShares.listByItem("inv-1")).map((share) => `${share.entryId} ${share.amount.toString()}`)).toEqual(["run-1 450.000000"]);
    expect((await store.revaluationShares.listByEntry("run-1")).map((share) => share.itemId)).toEqual(["inv-1", "inv-2"]);
    store.close();
  });
});
