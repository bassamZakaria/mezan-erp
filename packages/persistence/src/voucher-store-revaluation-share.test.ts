import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { FxOpenItemType, Money } from "@mezan/domain";
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
    CREATE TABLE fx_revaluation_share (
      entry_id TEXT NOT NULL, item_id TEXT NOT NULL, account_id TEXT NOT NULL, kind TEXT NOT NULL, party_id TEXT NOT NULL, currency TEXT NOT NULL, amount INTEGER NOT NULL,
      PRIMARY KEY (entry_id, item_id)
    );
    INSERT INTO fx_revaluation_share (entry_id, item_id, account_id, kind, party_id, currency, amount) VALUES ('run-0', 'inv-0', '1105', 'sales', 'cust-0', 'USD', 9000000);
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
      expect(old).toMatchObject({ voucherId: "v-1", invoiceId: "inv-1", status: "active", fxEntryId: "FXR:al-old", date: "2026-08-26", revaluationShare: null, moneyRevaluationShare: null });
      expect(old?.amount.toString()).toBe("5000.000000");
      expect(old?.invoiceAmount?.toString()).toBe("4800.000000");
      expect(await store.revaluationShares.listItems()).toEqual([{ id: "inv-0", type: FxOpenItemType.Invoice }]);
      expect((await store.revaluationShares.listByItem({ id: "inv-0", type: FxOpenItemType.Invoice })).map((share) => `${share.itemType} ${share.amount.toString()}`)).toEqual(["invoice 9.000000"]);
      store.close();
    }
  });

  it("keeps what a new allocation took of a revaluation, signed, and each run's share of an item", async () => {
    const store = createSqliteVoucherStore(oldShapeBooks());
    await store.allocations.save({ id: "al-new", voucherId: "v-2", invoiceId: "inv-1", amount: Money.fromMajor("47300"), invoiceAmount: Money.fromMajor("48000"), revaluationShare: Money.fromMajor("-450"), status: "active", createdAt: "2026-09-10T09:00:00.000Z", reversedAt: null });
    expect((await store.allocations.findById("al-new"))?.revaluationShare?.toString()).toBe("-450.000000");

    await store.revaluationShares.saveAll([
      { entryId: "run-1", accountId: "1105", itemId: "inv-1", itemType: FxOpenItemType.Invoice, kind: "sales", partyId: "cust-1", currency: "USD", amount: Money.fromMajor("450") },
      { entryId: "run-1", accountId: "1105", itemId: "inv-2", itemType: FxOpenItemType.Invoice, kind: "sales", partyId: "cust-2", currency: "USD", amount: Money.fromMajor("-12.5") },
    ]);
    expect((await store.revaluationShares.listByItem({ id: "inv-1", type: FxOpenItemType.Invoice })).map((share) => `${share.entryId} ${share.amount.toString()}`)).toEqual(["run-1 450.000000"]);
    expect((await store.revaluationShares.listByEntry("run-1")).map((share) => share.itemId)).toEqual(["inv-1", "inv-2"]);
    store.close();
  });

  it("keeps the share of money held on account apart from an invoice's, and what an allocation took of the money's own restatement", async () => {
    const store = createSqliteVoucherStore(oldShapeBooks());
    await store.revaluationShares.saveAll([
      { entryId: "run-2", accountId: "1105", itemId: "v-held", itemType: FxOpenItemType.Money, kind: "sales", partyId: "cust-1", currency: "USD", amount: Money.fromMajor("-135") },
    ]);
    await store.allocations.save({ id: "al-money", voucherId: "v-held", invoiceId: "inv-9", amount: Money.fromMajor("48000"), invoiceAmount: Money.fromMajor("48700"), moneyRevaluationShare: Money.fromMajor("-135"), status: "active", createdAt: "2026-09-10T09:00:00.000Z", reversedAt: null });

    expect(await store.revaluationShares.listItems()).toEqual([{ id: "inv-0", type: FxOpenItemType.Invoice }, { id: "v-held", type: FxOpenItemType.Money }]);
    expect(await store.revaluationShares.listByItem({ id: "v-held", type: FxOpenItemType.Invoice })).toEqual([]);
    expect((await store.revaluationShares.listByItem({ id: "v-held", type: FxOpenItemType.Money })).map((share) => share.amount.toString())).toEqual(["-135.000000"]);
    expect((await store.allocations.findById("al-money"))?.moneyRevaluationShare?.toString()).toBe("-135.000000");
    store.close();
  });
});
