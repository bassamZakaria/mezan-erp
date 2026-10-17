import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Money, Qty, type JournalEntry, type SalesInvoice, type SalesInvoiceLine, type SalesQuote, type SalesQuoteLine } from "@mezan/domain";
import { createSqliteLedgerStore } from "./ledger-store.js";
import { createSqliteSalesInvoiceStore } from "./sales-invoice-store.js";
import { createSqliteSalesQuoteStore } from "./sales-quote-store.js";


const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function booksFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "mezan-d79-"));
  dirs.push(dir);
  return join(dir, "books.db");
}

function columnsOf(path: string, table: string): string[] {
  const db = new Database(path);
  try {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  } finally {
    db.close();
  }
}

function dropColumn(path: string, table: string, column: string): void {
  const db = new Database(path);
  try {
    const indexes = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`).all(table) as { name: string; sql: string | null }[];
    for (const index of indexes) {
      if (index.sql?.includes(column)) db.exec(`DROP INDEX ${index.name}`);
    }
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  } finally {
    db.close();
  }
}

function invoiceLine(overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return {
    lineId: "L1",
    itemId: "item-1",
    itemNameAr: "صنف",
    isStock: false,
    qty: Qty.fromMajor("1"),
    unitCode: "",
    unitFactor: 1,
    baseQty: Qty.fromMajor("1"),
    unitPrice: Money.fromMajor("100"),
    discountType: "percent",
    discountPercent: 0,
    discountAmount: Money.zero(),
    taxRatePercent: 0,
    taxRateId: null,
    revenueAccountId: "4100",
    cogsAccountId: null,
    inventoryAccountId: null,
    costCenterId: null,
    unitCost: null,
    ...overrides,
  };
}

function invoice(id: string, lines: SalesInvoiceLine[]): SalesInvoice {
  return {
    id,
    docType: "SALES_INVOICE",
    docNo: null,
    status: "draft",
    date: "2026-08-22",
    dueDate: "2026-09-21",
    customerId: "cust-1",
    customerNameAr: "عميل",
    customerTaxExempt: false,
    taxInclusive: false,
    warehouseId: "wh-1",
    branchId: "branch-1",
    salespersonId: null,
    salespersonNameAr: null,
    projectId: null,
    couponCode: null,
    appliedPromotion: null,
    currency: "EGP",
    notes: null,
    internalNotes: null,
    discount: { type: "percent", percent: 0 },
    arAccountId: "1105",
    taxAccountId: "2200",
    lines,
    amountPaid: Money.zero(),
    createdAt: "2026-08-22T10:00:00.000Z",
    confirmedAt: null,
    journalEntryId: null,
    workflowRequestId: null,
    reversesInvoiceId: null,
    reversedByInvoiceId: null,
  };
}

function quoteLine(overrides: Partial<SalesQuoteLine> = {}): SalesQuoteLine {
  return {
    lineId: "L1",
    itemId: "item-1",
    itemNameAr: "صنف",
    qty: Qty.fromMajor("1"),
    unitPrice: Money.fromMajor("100"),
    discountPercent: 0,
    taxRatePercent: 0,
    taxRateId: null,
    ...overrides,
  };
}

function quote(id: string, lines: SalesQuoteLine[]): SalesQuote {
  return {
    id,
    docType: "SALES_QUOTE",
    docNo: null,
    status: "draft",
    date: "2026-08-22",
    expiryDate: "2026-09-21",
    customerId: "cust-1",
    customerNameAr: "عميل",
    customerTaxExempt: false,
    branchId: "branch-1",
    opportunityId: null,
    currency: "EGP",
    notes: null,
    internalNotes: null,
    discount: { type: "percent", percent: 0 },
    priceListId: null,
    couponCode: null,
    lines,
    createdAt: "2026-08-22T10:00:00.000Z",
    sentAt: null,
    respondedAt: null,
    convertedAt: null,
    convertedInvoiceId: null,
  };
}

function entry(id: string, taxRateId: string | null): JournalEntry {
  return {
    id,
    date: "2026-08-22",
    memo: "قيد",
    status: "posted",
    lines: [
      { accountId: "1105", debit: Money.fromMajor("100"), credit: Money.zero() },
      { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("100"), taxRatePercent: 0, taxRateId },
    ],
  };
}

describe("sales_invoice_line.tax_rate_id on an existing books file (D79)", () => {
  it("adds the column, reads a pre-existing line as NULL, and keeps a new line's id", async () => {
    const path = booksFile();
    const before = createSqliteSalesInvoiceStore(path);
    await before.save(invoice("inv-old", [invoiceLine({ taxRateId: "VAT-EXEMPT" })]));
    before.close();
    dropColumn(path, "sales_invoice_line", "tax_rate_id");
    expect(columnsOf(path, "sales_invoice_line")).not.toContain("tax_rate_id");

    const after = createSqliteSalesInvoiceStore(path);
    try {
      expect(columnsOf(path, "sales_invoice_line")).toContain("tax_rate_id");
      const legacy = await after.findById("inv-old");
      expect(legacy?.lines[0]?.taxRateId).toBeNull();
      expect(legacy?.lines[0]?.taxRatePercent).toBe(0);

      await after.save(invoice("inv-new", [invoiceLine({ taxRateId: "VAT-EXEMPT" }), invoiceLine({ lineId: "L2", taxRateId: "VAT-EXPORT" })]));
      const fresh = await after.findById("inv-new");
      expect(fresh?.lines.map((l) => l.taxRateId)).toEqual(["VAT-EXEMPT", "VAT-EXPORT"]);

      const listed = await after.list({});
      expect(listed.find((i) => i.id === "inv-old")?.lines[0]?.taxRateId).toBeNull();
      expect(listed.find((i) => i.id === "inv-new")?.lines.map((l) => l.taxRateId)).toEqual(["VAT-EXEMPT", "VAT-EXPORT"]);
    } finally {
      after.close();
    }
  });

  it("is idempotent — opening an already-migrated file a second time changes nothing", async () => {
    const path = booksFile();
    const first = createSqliteSalesInvoiceStore(path);
    await first.save(invoice("inv-1", [invoiceLine({ taxRateId: "VAT-EXPORT" })]));
    first.close();
    const second = createSqliteSalesInvoiceStore(path);
    try {
      expect((await second.findById("inv-1"))?.lines[0]?.taxRateId).toBe("VAT-EXPORT");
      expect(columnsOf(path, "sales_invoice_line").filter((c) => c === "tax_rate_id")).toHaveLength(1);
    } finally {
      second.close();
    }
  });
});

describe("sales_quote_line.tax_rate_id on an existing books file (D79)", () => {
  it("adds the column, reads a pre-existing line as NULL, and keeps a new line's id", async () => {
    const path = booksFile();
    const before = createSqliteSalesQuoteStore(path);
    await before.save(quote("qt-old", [quoteLine({ taxRateId: "VAT-EXEMPT" })]));
    before.close();
    dropColumn(path, "sales_quote_line", "tax_rate_id");

    const after = createSqliteSalesQuoteStore(path);
    try {
      expect(columnsOf(path, "sales_quote_line")).toContain("tax_rate_id");
      expect((await after.findById("qt-old"))?.lines[0]?.taxRateId).toBeNull();
      await after.save(quote("qt-new", [quoteLine({ taxRateId: "VAT-EXPORT" })]));
      expect((await after.findById("qt-new"))?.lines[0]?.taxRateId).toBe("VAT-EXPORT");
      const listed = await after.list({});
      expect(listed.find((q) => q.id === "qt-new")?.lines[0]?.taxRateId).toBe("VAT-EXPORT");
    } finally {
      after.close();
    }
  });
});

describe("journal_line.tax_rate_id on an existing books file (D79)", () => {
  it("adds the column, reads a pre-existing posted line as NULL, and keeps a new line's id", async () => {
    const path = booksFile();
    const before = createSqliteLedgerStore(path);
    await before.save(entry("je-old", "VAT-EXEMPT"));
    before.close();
    dropColumn(path, "journal_line", "tax_rate_id");

    const after = createSqliteLedgerStore(path);
    try {
      expect(columnsOf(path, "journal_line")).toContain("tax_rate_id");
      const legacy = await after.findById("je-old");
      expect(legacy?.lines[1]?.taxRateId ?? null).toBeNull();
      expect(legacy?.lines[1]?.taxRatePercent).toBe(0);

      await after.save(entry("je-new", "VAT-EXPORT"));
      expect((await after.findById("je-new"))?.lines[1]?.taxRateId).toBe("VAT-EXPORT");
      const listed = await after.list({});
      expect(listed.find((e) => e.id === "je-new")?.lines[1]?.taxRateId).toBe("VAT-EXPORT");
      expect(listed.find((e) => e.id === "je-old")?.lines[1]?.taxRateId ?? null).toBeNull();
    } finally {
      after.close();
    }
  });
});
