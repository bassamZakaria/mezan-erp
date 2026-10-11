import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, MODULE_CATALOG, createEntitlements } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createBackend, type BackendHandle } from "./create-backend.js";

/**
 * D79 round 5: an entry posted before journal lines carried a tax percent has
 * nothing the percent can find. Classifying its invoice line either names the
 * entry's base and tax lines too, or is refused — the line and its journal
 * never part ways.
 */

const TODAY = "2026-08-24";
const dbPath = join(mkdtempSync(join(tmpdir(), "mezan-legacy-tax-")), "t.db");

let backend: BackendHandle;
let token = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await backend.app.fetch(
    new Request(`http://local${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-branch-scope": "*", "x-warehouse-scope": "*" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function stripJournalTaxTags(entryId: string): void {
  const { sqlite } = openSqliteConnection(dbPath);
  sqlite.prepare(`UPDATE journal_line SET tax_rate_percent = NULL, tax_rate_id = NULL WHERE entry_id = ?`).run(entryId);
  sqlite.close();
}

function mergeRevenueLines(entryId: string): void {
  const { sqlite } = openSqliteConnection(dbPath);
  const lines = sqlite.prepare(`SELECT id, credit FROM journal_line WHERE entry_id = ? AND account_id = '4100' ORDER BY line_no`).all(entryId) as { id: number; credit: number }[];
  const [kept, ...merged] = lines;
  if (kept) {
    sqlite.prepare(`UPDATE journal_line SET credit = ? WHERE id = ?`).run(lines.reduce((sum, line) => sum + line.credit, 0), kept.id);
    for (const line of merged) sqlite.prepare(`DELETE FROM journal_line WHERE id = ?`).run(line.id);
  }
  sqlite.close();
}

const serviceLine = (lineId: string, taxRatePercent: number) => ({
  lineId, itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", revenueAccountId: "4100", taxRateId: null, taxRatePercent,
});

async function legacySale(id: string, lines: readonly Record<string, unknown>[]) {
  const created = await call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200", lines,
  });
  expect(created.status).toBe(201);
  expect((await call("POST", `/sales-invoices/${id}/confirm`, {})).status).toBe(200);
  stripJournalTaxTags(id);
}

const journalTags = async (entryId: string) =>
  ((await call("GET", `/gl/journal-entries/${encodeURIComponent(entryId)}`)).body.lines as { accountId: string; taxRatePercent: number | null; taxRateId: string | null }[]).map((l) => [l.accountId, l.taxRatePercent, l.taxRateId]);

beforeAll(async () => {
  backend = await createBackend({
    dbPath,
    seedDemoData: true,
    resolveEntitlements: () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null }),
  });
  token = backend.sessions.issue({ userId: "USER-ADMIN", permissions: ["*"], roleCode: "*", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
}, 120_000);

afterAll(async () => {
  await backend.drain();
  backend.close();
});

describe("classifying a line whose journal entry predates tax tags (D79 round 5)", () => {
  it("names percent and rate on the entry's revenue and VAT lines when the whole document is one classification", async () => {
    await legacySale("T-LEGACY-ONE", [serviceLine("L1", 14)]);
    expect(await journalTags("T-LEGACY-ONE")).toEqual([["1105", null, null], ["4100", null, null], ["2200", null, null]]);

    const done = await call("POST", "/sales-invoices/T-LEGACY-ONE/lines/L1/classify-tax", { taxRateId: "VAT14" });
    expect([done.status, done.body.journalLinesNamed]).toEqual([200, 2]);
    expect(await journalTags("T-LEGACY-ONE")).toEqual([["1105", null, null], ["4100", 14, "VAT14"], ["2200", 14, "VAT14"]]);
    expect((await call("GET", "/sales-invoices/T-LEGACY-ONE")).body.lines[0].taxRateId).toBe("VAT14");
  });

  it("names each percent group of a mixed legacy entry against the lines its own posting produced", async () => {
    await legacySale("T-LEGACY-MIXED", [serviceLine("L1", 14), serviceLine("L2", 0)]);

    const taxed = await call("POST", "/sales-invoices/T-LEGACY-MIXED/lines/L1/classify-tax", { taxRateId: "VAT14" });
    expect([taxed.status, taxed.body.journalLinesNamed]).toEqual([200, 2]);
    const zero = await call("POST", "/sales-invoices/T-LEGACY-MIXED/lines/L2/classify-tax", { taxRateId: "VAT-EXEMPT" });
    expect([zero.status, zero.body.journalLinesNamed]).toEqual([200, 1]);
    expect((await call("GET", "/sales-invoices/T-LEGACY-MIXED")).body.lines.map((l: { taxRateId: string | null }) => l.taxRateId)).toEqual(["VAT14", "VAT-EXEMPT"]);
    expect((await journalTags("T-LEGACY-MIXED")).slice().sort()).toEqual(
      [["1105", null, null], ["4100", 14, "VAT14"], ["4100", 0, "VAT-EXEMPT"], ["2200", 14, "VAT14"]].sort(),
    );
  });

  it("refuses, in Arabic and writing nothing, when the entry holds no line matching what the group posted", async () => {
    await legacySale("T-LEGACY-MERGED", [serviceLine("L1", 14), serviceLine("L2", 0)]);
    mergeRevenueLines("T-LEGACY-MERGED");

    const refused = await call("POST", "/sales-invoices/T-LEGACY-MERGED/lines/L2/classify-tax", { taxRateId: "VAT-EXEMPT" });
    expect([refused.status, refused.body.error]).toEqual([409, "TAX_CLASSIFICATION_JOURNAL_UNTAGGED"]);
    expect(refused.body.message).toContain("تسمية ضريبة سطر القيد");
    expect((await call("GET", "/sales-invoices/T-LEGACY-MERGED")).body.lines.map((l: { taxRateId: string | null }) => l.taxRateId)).toEqual([null, null]);
    expect((await journalTags("T-LEGACY-MERGED")).every(([, percent, rate]) => percent === null && rate === null)).toBe(true);
  });

  it("does the same on the purchase side: only the lines the invoice's own posting produced are named", async () => {
    const purchase = async (id: string, lines: readonly Record<string, unknown>[]) => {
      expect((await call("POST", "/purchases/invoices", { id, supplierId: "SUPP-DEMO-1", date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: "WH-MAIN", lines })).status).toBe(201);
      expect((await call("POST", `/purchases/invoices/${id}/confirm`, {})).status).toBe(200);
      stripJournalTaxTags(`PI-JE:${id}`);
    };
    const expense = (taxRatePercent: number) => ({ itemId: null, kind: "expense", description: "خدمة", qty: "1", unitCost: "200", taxRateId: null, taxRatePercent });

    await purchase("T-PI-LEGACY", [expense(14)]);
    const done = await call("POST", "/purchases/invoices/T-PI-LEGACY/lines/0/classify-tax", { taxRateId: "VAT14" });
    expect([done.status, done.body.journalLinesNamed]).toEqual([200, 2]);
    const tags = await journalTags("PI-JE:T-PI-LEGACY");
    expect(tags.filter(([, percent]) => percent !== null).map(([, percent, rate]) => [percent, rate])).toEqual([[14, "VAT14"], [14, "VAT14"]]);

    await purchase("T-PI-LEGACY-MIXED", [expense(14), expense(0)]);
    const zero = await call("POST", "/purchases/invoices/T-PI-LEGACY-MIXED/lines/1/classify-tax", { taxRateId: "VAT-EXEMPT" });
    expect([zero.status, zero.body.journalLinesNamed]).toEqual([200, 1]);
    const taxed = await call("POST", "/purchases/invoices/T-PI-LEGACY-MIXED/lines/0/classify-tax", { taxRateId: "VAT14" });
    expect([taxed.status, taxed.body.journalLinesNamed]).toEqual([200, 2]);
    expect((await call("GET", "/purchases/invoices/T-PI-LEGACY-MIXED")).body.lines.map((l: { taxRateId: string | null }) => l.taxRateId)).toEqual(["VAT14", "VAT-EXEMPT"]);
    const payable = (await journalTags("PI-JE:T-PI-LEGACY-MIXED")).filter(([, percent]) => percent === null);
    expect(payable).toHaveLength(1);
  });

  it("names a legacy return's own entry when its invoice line is classified, and reads a return line with no percent as unnamed, not as 0%", async () => {
    const stockLine = { lineId: "A", itemId: "ITEM-DEMO-2", itemNameAr: "صنف", isStock: true, qty: "2", unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: null, taxRatePercent: 0 };
    expect((await call("POST", "/sales-invoices", { id: "T-L4", date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200", lines: [stockLine] })).status).toBe(201);
    expect((await call("POST", "/sales-invoices/T-L4/confirm", {})).status).toBe(200);
    expect((await call("POST", "/sales-returns/from-invoice", { id: "T-L4-R", date: TODAY, memo: "", warehouseId: "WH-MAIN", sourceInvoiceId: "T-L4", reason: "DEFECTIVE", requested: [{ itemId: "ITEM-DEMO-2", sourceLineId: "A", qty: "1" }] })).status).toBe(201);
    const confirmed = await call("POST", "/sales-returns/T-L4-R/confirm", {});
    expect(confirmed.status).toBe(200);
    const returnEntryId = confirmed.body.document.journalEntryId as string;
    stripJournalTaxTags(returnEntryId);

    const classified = await call("POST", "/sales-invoices/T-L4/lines/A/classify-tax", { taxRateId: "VAT-EXEMPT" });
    expect(classified.status).toBe(200);
    const returned = (await call("GET", "/sales-returns/T-L4-R")).body;
    expect(returned.lines.map((l: { taxRateId: string | null }) => l.taxRateId)).toEqual(["VAT-EXEMPT"]);
    expect((await journalTags(returnEntryId)).filter(([, , rate]) => rate !== null).map(([, percent, rate]) => [percent, rate])).toEqual([[0, "VAT-EXEMPT"]]);
  });
});

describe("«تسمية ضريبة سطر القيد» — the accountant names the entry's lines by hand", () => {
  const sale = async (id: string, lines: readonly Record<string, unknown>[]) => {
    expect((await call("POST", "/sales-invoices", { id, date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200", lines })).status).toBe(201);
    expect((await call("POST", `/sales-invoices/${id}/confirm`, {})).status).toBe(200);
    stripJournalTaxTags(id);
  };
  const indexesOf = async (entryId: string, accountId: string) =>
    (await journalTags(entryId)).map(([account], index) => (account === accountId ? index : -1)).filter((index) => index >= 0);

  it("names the entry lines of a line that already names its rate, and audits the lines before and after", async () => {
    await sale("T-JT-NAMED", [serviceLine("A", 0), { ...serviceLine("B", 14), taxRateId: "VAT14" }]);
    const [revenueA, revenueB] = await indexesOf("T-JT-NAMED", "4100");
    const [vat] = await indexesOf("T-JT-NAMED", "2200");

    const wrong = await call("POST", "/sales-invoices/T-JT-NAMED/lines/B/journal-tax", { journalLineIndexes: [revenueB] });
    expect([wrong.status, wrong.body.error]).toEqual([422, "JOURNAL_TAX_LINES_MISMATCH"]);
    expect(wrong.body.message).toContain("2200");

    const named = await call("POST", "/sales-invoices/T-JT-NAMED/lines/B/journal-tax", { journalLineIndexes: [revenueB, vat] });
    expect([named.status, named.body.journalLinesNamed], JSON.stringify(named.body)).toEqual([200, 2]);
    const unnamedLine = await call("POST", "/sales-invoices/T-JT-NAMED/lines/A/journal-tax", { journalLineIndexes: [revenueA] });
    expect([unnamedLine.status, unnamedLine.body.error]).toEqual([422, "JOURNAL_TAX_LINE_UNCLASSIFIED"]);
    const classified = await call("POST", "/sales-invoices/T-JT-NAMED/lines/A/journal-tax", { journalLineIndexes: [revenueA], taxRateId: "VAT-EXEMPT" });
    expect([classified.status, classified.body.journalLinesNamed], JSON.stringify(classified.body)).toEqual([200, 1]);

    expect((await call("GET", "/sales-invoices/T-JT-NAMED")).body.lines.map((l: { taxRateId: string | null }) => l.taxRateId)).toEqual(["VAT-EXEMPT", "VAT14"]);
    expect((await journalTags("T-JT-NAMED")).filter(([account]) => account !== "1105").every(([, percent, rate]) => percent !== null && rate !== null)).toBe(true);
    const again = await call("POST", "/sales-invoices/T-JT-NAMED/lines/B/journal-tax", { journalLineIndexes: [revenueB, vat] });
    expect([again.status, again.body.error]).toEqual([409, "JOURNAL_TAX_LINE_ALREADY_NAMED"]);

    const events = (await call("GET", "/audit?stream=sensitive&entityType=SALES_INVOICE&entityId=T-JT-NAMED&action=NAME_JOURNAL_LINE_TAX")).body;
    const [event] = Array.isArray(events) ? events : (events.items ?? events.rows ?? events.events);
    expect(event.details.journalLines.before.map((line: { taxRateId: string | null }) => line.taxRateId)).toEqual([null, null]);
    expect(event.details.journalLines.after.map((line: { taxRateId: string | null }) => line.taxRateId)).toEqual(["VAT14", "VAT14"]);
  });

  it("is refused without the journal permission and in a month whose VAT return is filed, writing nothing", async () => {
    await sale("T-JT-GATE", [{ ...serviceLine("B", 14), taxRateId: "VAT14" }]);
    const [revenue] = await indexesOf("T-JT-GATE", "4100");
    const [vat] = await indexesOf("T-JT-GATE", "2200");
    const limited = backend.sessions.issue({ userId: "LIMITED", permissions: ["sales.invoice.classify_tax", "sales.invoice.view"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const refused = await backend.app.fetch(
      new Request("http://local/sales-invoices/T-JT-GATE/lines/B/journal-tax", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${limited}`, "x-branch-scope": "*", "x-warehouse-scope": "*" },
        body: JSON.stringify({ journalLineIndexes: [revenue, vat] }),
      }),
    );
    expect(refused.status).toBe(403);

    expect((await call("POST", "/gl/vat-filings", { id: "T-JT-VATF", periodFrom: "2026-08-01", periodTo: "2026-08-31", netAmount: "0.00" })).status).toBeLessThan(300);
    const filed = await call("POST", "/sales-invoices/T-JT-GATE/lines/B/journal-tax", { journalLineIndexes: [revenue, vat] });
    expect([filed.status, filed.body.error]).toEqual([422, "VAT_PERIOD_ALREADY_FILED"]);
    expect((await journalTags("T-JT-GATE")).every(([, percent, rate]) => percent === null && rate === null)).toBe(true);
  });
});

describe("tax rates a file already holds in a shape today's rules refuse (D79 round 5)", () => {
  function raw(sql: string, ...params: unknown[]): void {
    const { sqlite } = openSqliteConnection(dbPath);
    sqlite.prepare(sql).run(...params);
    sqlite.close();
  }

  it("lets a look-alike of the system rate that already exists be deactivated and renamed, and still refuses making one", async () => {
    raw(
      `INSERT INTO tax_rate (id, code, name, rate, calculation_type, is_default, output_tax_account_id, input_tax_account_id, eta_sub_type, status)
       VALUES ('OLD-LOOKALIKE', 'OLD-LOOKALIKE', 'غير خاضع', 0, 'exclusive', 0, NULL, NULL, 'V004', 'active')`,
    );
    const deactivated = await call("PATCH", "/tax-rates/OLD-LOOKALIKE", { status: "inactive" });
    expect([deactivated.status, deactivated.body.status]).toEqual([200, "inactive"]);
    const renamed = await call("PATCH", "/tax-rates/OLD-LOOKALIKE", { name: "غير خاضع — قديمة" });
    expect([renamed.status, renamed.body.name]).toEqual([200, "غير خاضع — قديمة"]);
    const back = await call("PATCH", "/tax-rates/OLD-LOOKALIKE", { name: "غير خاضع" });
    expect([back.status, back.body.error]).toEqual([409, "TAX_RATE_RESERVED"]);
  });

  it("refuses an inactive rate the request names on a customer card even when the card already holds it, and still saves an unrelated edit", async () => {
    expect((await call("POST", "/tax-rates", { id: "OLD-ZERO", code: "OLD-ZERO", name: "صفري قديم", rate: 0, etaSubType: "V002" })).status).toBe(201);
    expect((await call("POST", "/customers", { id: "OLD-CARD", code: "OLD-CARD", nameAr: "جهة", taxNumber: "311222333", etaBuyerType: "business", taxExempt: true, taxExemptionRateId: "OLD-ZERO" })).status).toBe(201);
    raw(`UPDATE tax_rate SET status = 'inactive' WHERE id = 'OLD-ZERO'`);

    const resent = await call("PATCH", "/customers/OLD-CARD", { taxExemptionRateId: "OLD-ZERO" });
    expect([resent.status, resent.body.error]).toEqual([422, "CUSTOMER_EXEMPTION_RATE_INVALID"]);
    const phone = await call("PATCH", "/customers/OLD-CARD", { phone: "01000000000" });
    expect([phone.status, phone.body.taxExemptionRateId]).toEqual([200, "OLD-ZERO"]);
  });
});
