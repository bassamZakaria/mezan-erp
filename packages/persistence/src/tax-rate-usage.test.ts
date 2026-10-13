import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { Money, Qty, type JournalEntry, type PurchaseReturnLine } from "@mezan/domain";
import { createSqliteLedgerStore } from "./ledger-store.js";
import { createSqlitePurchaseReturnStore } from "./purchase-return-store.js";
import { createSqliteTaxRateUsage } from "./tax-rate-usage.js";

const connections: Database.Database[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) db.close();
});

function books(): Database.Database {
  const db = new Database(":memory:");
  connections.push(db);
  return db;
}

const entry = (taxRateId: string | null): JournalEntry => ({
  id: "je-1",
  date: "2026-08-22",
  memo: "قيد",
  status: "posted",
  lines: [
    { accountId: "1105", debit: Money.fromMajor("100"), credit: Money.zero() },
    { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("100"), taxRatePercent: 0, taxRateId },
  ],
});

const returnLine = (taxRateId: string | null): PurchaseReturnLine => ({
  itemId: "item-1",
  warehouseId: "wh-1",
  supplierId: "sup-1",
  sourceInvoiceId: "pi-1",
  sourceInvoiceNumber: "PI-000001",
  reason: "DEFECTIVE",
  availableQty: Qty.fromMajor("1"),
  qty: Qty.fromMajor("1"),
  unitCost: Money.fromMajor("10"),
  taxAmount: Money.zero(),
  taxRatePercent: 0,
  taxRateId,
});

describe("createSqliteTaxRateUsage — which tax rates stored lines name (D79)", () => {
  it("answers no on a books file where no store has created a table yet", async () => {
    expect(await createSqliteTaxRateUsage(books()).isReferenced("VAT14")).toBe(false);
  });

  it("finds a rate a posted journal line names, and only that rate", async () => {
    const db = books();
    await createSqliteLedgerStore(db).save(entry("VAT-EXEMPT"));
    const usage = createSqliteTaxRateUsage(db);
    expect(await usage.isReferenced("VAT-EXEMPT")).toBe(true);
    expect(await usage.isReferenced("VAT-EXPORT")).toBe(false);
    expect(await usage.isReferenced("VAT")).toBe(false);
  });

  it("finds a rate named only inside a document whose lines are stored as JSON", async () => {
    const db = books();
    await createSqlitePurchaseReturnStore(db).save({
      id: "pr-1",
      docType: "PURCHASE_RETURN",
      docNo: null,
      date: "2026-08-22",
      memo: "",
      status: "draft",
      lines: [returnLine("VAT-EXPORT")],
      createdAt: "2026-08-22T00:00:00.000Z",
      confirmedAt: null,
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    });
    const usage = createSqliteTaxRateUsage(db);
    expect(await usage.isReferenced("VAT-EXPORT")).toBe(true);
    expect(await usage.isReferenced("VAT-EXPO")).toBe(false);
  });
});
