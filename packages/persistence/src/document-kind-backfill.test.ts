import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { InvoiceDocumentKind, RETENTION_RELEASE_ITEM_ID } from "@mezan/domain";
import { createSqliteContractingControlsStore } from "./contracting-controls-store.js";
import { createSqliteSubcontractStore } from "./contracting-subcontracts-store.js";
import { createSqlitePurchaseInvoiceStore } from "./purchasing-stores.js";
import { createSqliteSalesInvoiceStore } from "./sales-invoice-store.js";

const REAL_SALES_RELEASE = "REL-1-INV";
const SALE_CARRYING_RELEASE_ITEM = "NORMAL-SALE";
const PLAIN_SALE = "PLAIN-SALE";
const REAL_PURCHASE_RELEASE = "SUB-1-REL-1";
const PURCHASE_NAMED_LIKE_A_RELEASE = "SC-RET-WALL-1-PINV";
const PLAIN_PURCHASE = "PLAIN-PI";

function booksPath(): string {
  return join(mkdtempSync(join(tmpdir(), "mezan-kind-")), "books.db");
}

function insertSale(raw: Database.Database, id: string, itemId: string): void {
  const columns = (raw.prepare("PRAGMA table_info(sales_invoice)").all() as { name: string; notnull: number; type: string; dflt_value: unknown }[])
    .filter((column) => column.notnull === 1 && column.dflt_value === null && column.name !== "id");
  const values = columns.map((column) => (column.type === "INTEGER" ? 0 : column.name === "status" ? "confirmed" : "x"));
  raw.prepare(`INSERT INTO sales_invoice (id, ${columns.map((c) => c.name).join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})`).run(id, ...values);
  const lineColumns = (raw.prepare("PRAGMA table_info(sales_invoice_line)").all() as { name: string; notnull: number; type: string; dflt_value: unknown }[])
    .filter((column) => column.notnull === 1 && column.dflt_value === null && !["invoice_id", "item_id"].includes(column.name));
  const lineValues = lineColumns.map((column) => (column.type === "INTEGER" ? 0 : "x"));
  raw
    .prepare(`INSERT INTO sales_invoice_line (invoice_id, item_id, ${lineColumns.map((c) => c.name).join(", ")}) VALUES (?, ?, ${lineColumns.map(() => "?").join(", ")})`)
    .run(id, itemId, ...lineValues);
}

function insertPurchase(raw: Database.Database, id: string): void {
  const columns = (raw.prepare("PRAGMA table_info(purchase_invoice)").all() as { name: string; notnull: number; type: string; dflt_value: unknown }[])
    .filter((column) => column.notnull === 1 && column.dflt_value === null && column.name !== "id");
  const values = columns.map((column) =>
    column.name === "lines" ? "[]" : column.name === "status" ? "confirmed" : column.name === "number" ? `N-${id}` : column.type === "INTEGER" ? 0 : "x",
  );
  raw.prepare(`INSERT INTO purchase_invoice (id, ${columns.map((c) => c.name).join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})`).run(id, ...values);
}

const kindOf = (raw: Database.Database, table: string, id: string) =>
  (raw.prepare(`SELECT document_kind FROM ${table} WHERE id = ?`).get(id) as { document_kind: string }).document_kind;

describe("an invoice raised before its kind was stored is marked from the release registers alone", () => {
  it("marks the sales invoice a retention release names, and not a sale that merely carries the release item", () => {
    const path = booksPath();
    createSqliteSalesInvoiceStore(path).close();
    createSqliteContractingControlsStore(path).close();
    const raw = new Database(path);
    raw.pragma("foreign_keys = OFF");
    insertSale(raw, REAL_SALES_RELEASE, RETENTION_RELEASE_ITEM_ID);
    insertSale(raw, SALE_CARRYING_RELEASE_ITEM, RETENTION_RELEASE_ITEM_ID);
    insertSale(raw, PLAIN_SALE, "ITEM-1");
    raw
      .prepare(
        `INSERT INTO contracting_retention_release (id, doc_no, contract_id, contract_doc_no, project_id, customer_id, kind, date, amount, status, invoice_id, created_at)
         VALUES ('REL-1', 'REL-000001', 'C1', 'CTR-1', 'P1', 'CU1', 'provisional', '2026-01-01', 100, 'released', ?, '2026-01-01T00:00:00.000Z')`,
      )
      .run(REAL_SALES_RELEASE);
    raw.exec("ALTER TABLE sales_invoice DROP COLUMN document_kind");
    raw.close();

    createSqliteSalesInvoiceStore(path).close();

    const after = new Database(path, { readonly: true });
    expect([REAL_SALES_RELEASE, SALE_CARRYING_RELEASE_ITEM, PLAIN_SALE].map((id) => kindOf(after, "sales_invoice", id))).toEqual([
      InvoiceDocumentKind.RetentionRelease,
      InvoiceDocumentKind.Standard,
      InvoiceDocumentKind.Standard,
    ]);
    after.close();
  });

  it("marks the purchase invoice a subcontract release names, and not one whose id only looks like a release", () => {
    const path = booksPath();
    createSqlitePurchaseInvoiceStore(path).close();
    createSqliteSubcontractStore(path).close();
    const raw = new Database(path);
    raw.pragma("foreign_keys = OFF");
    for (const id of [REAL_PURCHASE_RELEASE, PURCHASE_NAMED_LIKE_A_RELEASE, PLAIN_PURCHASE]) insertPurchase(raw, id);
    raw
      .prepare(
        `INSERT INTO subcontract_retention_release (id, subcontract_id, date, amount, journal_entry_id, invoice_id, sort_order)
         VALUES ('R1', 'SUB-1', '2026-01-01', 100, 'JE-1', ?, 0)`,
      )
      .run(REAL_PURCHASE_RELEASE);
    raw.exec("ALTER TABLE purchase_invoice DROP COLUMN document_kind");
    raw.close();

    createSqlitePurchaseInvoiceStore(path).close();

    const after = new Database(path, { readonly: true });
    expect([REAL_PURCHASE_RELEASE, PURCHASE_NAMED_LIKE_A_RELEASE, PLAIN_PURCHASE].map((id) => kindOf(after, "purchase_invoice", id))).toEqual([
      InvoiceDocumentKind.RetentionRelease,
      InvoiceDocumentKind.Standard,
      InvoiceDocumentKind.Standard,
    ]);
    after.close();
  });

  it("marks nothing in a books file that never held a release register", () => {
    const path = booksPath();
    createSqliteSalesInvoiceStore(path).close();
    const raw = new Database(path);
    raw.pragma("foreign_keys = OFF");
    insertSale(raw, SALE_CARRYING_RELEASE_ITEM, RETENTION_RELEASE_ITEM_ID);
    raw.exec("ALTER TABLE sales_invoice DROP COLUMN document_kind");
    raw.close();
    createSqliteSalesInvoiceStore(path).close();
    const after = new Database(path, { readonly: true });
    expect(kindOf(after, "sales_invoice", SALE_CARRYING_RELEASE_ITEM)).toBe(InvoiceDocumentKind.Standard);
    after.close();
  });
});
