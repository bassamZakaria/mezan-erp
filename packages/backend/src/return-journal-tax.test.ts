import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, MODULE_CATALOG, createEntitlements } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createBackend, type BackendHandle } from "./create-backend.js";

const TODAY = "2026-08-24";
const WAREHOUSE = "WH-MAIN";
const dbPath = join(mkdtempSync(join(tmpdir(), "mezan-return-journal-tax-")), "t.db");

let backend: BackendHandle;
let admin = "";

async function call(method: string, path: string, body?: unknown, permissions?: readonly string[], warehouseScope: readonly string[] | typeof ALL_SCOPE = ALL_SCOPE) {
  const bearer = permissions ? backend.sessions.issue({ userId: "LIMITED", permissions, roleCode: null, branchScope: ALL_SCOPE, warehouseScope }) : admin;
  const res = await backend.app.fetch(
    new Request(`http://local${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, "x-branch-scope": "*", "x-warehouse-scope": "*" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  try {
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, body: { text } };
  }
}

function stripJournalTaxTags(entryId: string): void {
  const { sqlite } = openSqliteConnection(dbPath);
  sqlite.prepare(`UPDATE journal_line SET tax_rate_percent = NULL, tax_rate_id = NULL WHERE entry_id = ?`).run(entryId);
  sqlite.close();
}

type TaggedLine = { accountId: string; debit: string; credit: string; taxRatePercent: number | null; taxRateId: string | null };
const journal = async (entryId: string) => (await call("GET", `/gl/journal-entries/${encodeURIComponent(entryId)}`)).body.lines as TaggedLine[];
const indexesOf = (lines: readonly TaggedLine[], accounts: readonly string[]) => lines.flatMap((line, index) => (accounts.includes(line.accountId) ? [index] : []));

async function legacySalesReturn(tag: string, line: Record<string, unknown>) {
  const created = await call("POST", "/sales-invoices", {
    id: tag, date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: WAREHOUSE, branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", itemId: "ITEM-DEMO-2", itemNameAr: "صنف", isStock: true, qty: "2", unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", ...line }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await call("POST", `/sales-invoices/${tag}/confirm`, {})).status).toBe(200);
  const drafted = await call("POST", "/sales-returns/from-invoice", {
    id: `${tag}-R`, date: TODAY, memo: "", warehouseId: WAREHOUSE, sourceInvoiceId: tag, reason: "DEFECTIVE", requested: [{ itemId: "ITEM-DEMO-2", sourceLineId: "A", qty: "1" }],
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  const confirmed = await call("POST", `/sales-returns/${tag}-R/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  const entryId = confirmed.body.document.journalEntryId as string;
  stripJournalTaxTags(entryId);
  return { returnId: `${tag}-R`, entryId };
}

beforeAll(async () => {
  backend = await createBackend({
    dbPath,
    seedDemoData: true,
    resolveEntitlements: () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null }),
  });
  admin = backend.sessions.issue({ userId: "USER-ADMIN", permissions: ["*"], roleCode: "*", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
}, 120_000);

afterAll(async () => {
  await backend.drain();
  backend.close();
});

describe("«تسمية ضريبة سطر القيد» on a sales return whose entry carries no tax tag", () => {
  it("names the chosen journal lines under the rate the return's line already names, audited, and refuses lines that are not the line's own", async () => {
    const { returnId, entryId } = await legacySalesReturn("RJT-S-1", { taxRateId: "VAT14" });
    expect((await call("GET", `/sales-returns/${returnId}`)).body.lines[0].taxRateId).toBe("VAT14");
    const before = await journal(entryId);
    expect(before.every((line) => line.taxRateId === null)).toBe(true);

    const wrong = await call("POST", `/sales-returns/${returnId}/lines/0/journal-tax`, { journalLineIndexes: indexesOf(before, ["1105"]) });
    expect([wrong.status, wrong.body.error], JSON.stringify(wrong.body)).toEqual([422, "JOURNAL_TAX_LINES_MISMATCH"]);
    expect(wrong.body.message).toMatch(/[؀-ۿ]/);
    expect((await journal(entryId)).every((line) => line.taxRateId === null)).toBe(true);

    const own = indexesOf(before, ["4100", "2200"]);
    const named = await call("POST", `/sales-returns/${returnId}/lines/0/journal-tax`, { journalLineIndexes: own });
    expect([named.status, named.body.journalLinesNamed, named.body.taxRateId], JSON.stringify(named.body)).toEqual([200, own.length, "VAT14"]);
    const after = await journal(entryId);
    expect(after.map((line, index) => (own.includes(index) ? [line.taxRatePercent, line.taxRateId] : line.taxRateId))).toEqual(
      before.map((_line, index) => (own.includes(index) ? [14, "VAT14"] : null)),
    );
    expect(after.map((line) => [line.accountId, line.debit, line.credit])).toEqual(before.map((line) => [line.accountId, line.debit, line.credit]));
    const audit = (await call("GET", `/audit?stream=sensitive&entityType=SALES_RETURN&entityId=${returnId}&action=NAME_JOURNAL_LINE_TAX`)).body;
    expect((audit.items ?? audit.events ?? audit).length).toBe(1);

    const again = await call("POST", `/sales-returns/${returnId}/lines/0/journal-tax`, { journalLineIndexes: own });
    expect([again.status, again.body.error]).toEqual([409, "JOURNAL_TAX_LINE_ALREADY_NAMED"]);
  });

  it("needs the classify permission, the journal and the return itself", async () => {
    const { returnId, entryId } = await legacySalesReturn("RJT-S-2", { taxRateId: "VAT14" });
    const body = { journalLineIndexes: indexesOf(await journal(entryId), ["4100", "2200"]) };
    const path = `/sales-returns/${returnId}/lines/0/journal-tax`;
    expect((await call("POST", path, body, ["sales.return.view", "accounting.journal.view"])).status).toBe(403);
    expect((await call("POST", path, body, ["sales.invoice.classify_tax", "sales.return.view"])).status).toBe(403);
    expect((await call("POST", path, body, ["sales.invoice.classify_tax", "accounting.journal.view"])).status).toBe(404);
    expect((await call("POST", path, body, ["sales.invoice.classify_tax", "accounting.journal.view", "sales.return.view_own"], ["WH-ELSEWHERE"])).status).toBe(404);
    expect((await call("POST", "/sales-returns/NOPE/lines/0/journal-tax", body)).status).toBe(404);
    expect((await call("POST", `/sales-returns/${returnId}/lines/7/journal-tax`, body)).status).toBe(404);
    expect((await journal(entryId)).every((line) => line.taxRateId === null)).toBe(true);
  });

  it("names an unnamed return line and its journal line together, and a later classification of the invoice under another rate is refused", async () => {
    const { returnId, entryId } = await legacySalesReturn("RJT-S-3", { taxRateId: null, taxRatePercent: 0 });
    const base = indexesOf(await journal(entryId), ["4100"]);
    const unnamed = await call("POST", `/sales-returns/${returnId}/lines/0/journal-tax`, { journalLineIndexes: base });
    expect([unnamed.status, unnamed.body.error], JSON.stringify(unnamed.body)).toEqual([422, "JOURNAL_TAX_LINE_UNCLASSIFIED"]);
    const named = await call("POST", `/sales-returns/${returnId}/lines/0/journal-tax`, { journalLineIndexes: base, taxRateId: "VAT-EXEMPT" });
    expect([named.status, named.body.taxRateId], JSON.stringify(named.body)).toEqual([200, "VAT-EXEMPT"]);
    expect((await call("GET", `/sales-returns/${returnId}`)).body.lines[0].taxRateId).toBe("VAT-EXEMPT");
    expect((await journal(entryId)).filter((line) => line.taxRateId === "VAT-EXEMPT").length).toBe(1);

    const other = await call("POST", "/sales-invoices/RJT-S-3/lines/A/classify-tax", { taxRateId: "VAT-EXPORT" });
    expect([other.status, other.body.error], JSON.stringify(other.body)).toEqual([409, "TAX_CLASSIFICATION_RETURN_DISAGREES"]);
    expect(other.body.message).toMatch(/[؀-ۿ]/);
    expect((await call("GET", "/sales-invoices/RJT-S-3")).body.lines[0].taxRateId).toBeNull();
    const same = await call("POST", "/sales-invoices/RJT-S-3/lines/A/classify-tax", { taxRateId: "VAT-EXEMPT" });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
  });
});

describe("«تسمية ضريبة سطر القيد» on a purchase return", () => {
  it("names the chosen journal lines under the return line's rate, behind the purchase classify permission, and is refused once the month's VAT return is filed", async () => {
    await call("POST", "/purchases/invoices", { id: "RJT-P-1", supplierId: "SUPP-DEMO-1", date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: WAREHOUSE, lines: [{ itemId: "ITEM-DEMO-2", kind: "inventory", qty: "4", unitCost: "72", taxRateId: "VAT14" }] });
    expect((await call("POST", "/purchases/invoices/RJT-P-1/confirm", {})).status).toBe(200);
    const drafted = await call("POST", "/purchase-returns", { id: "RJT-P-1-R", date: TODAY, memo: "", lines: [{ itemId: "ITEM-DEMO-2", warehouseId: WAREHOUSE, supplierId: "SUPP-DEMO-1", sourceInvoiceId: "RJT-P-1", sourceInvoiceNumber: null, sourceLineId: "0", reason: "DEFECTIVE", qty: "1" }] });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    const confirmed = await call("POST", "/purchase-returns/RJT-P-1-R/confirm", {});
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const entryId = confirmed.body.document.journalEntryId as string;
    stripJournalTaxTags(entryId);
    const before = await journal(entryId);
    const own = indexesOf(before, ["1200", "1400"]);
    const path = "/purchase-returns/RJT-P-1-R/lines/0/journal-tax";
    expect((await call("POST", path, { journalLineIndexes: own }, ["purchases.return.view", "accounting.journal.view"])).status).toBe(403);

    const filed = await call("POST", "/gl/vat-filings", { id: "RJT-FILING", periodFrom: "2026-08-01", periodTo: "2026-08-31", netAmount: "0" });
    expect(filed.status, JSON.stringify(filed.body)).toBe(201);
    const refused = await call("POST", path, { journalLineIndexes: own });
    expect([refused.status, refused.body.error], JSON.stringify(refused.body)).toEqual([422, "VAT_PERIOD_ALREADY_FILED"]);
    expect((await journal(entryId)).every((line) => line.taxRateId === null)).toBe(true);
    expect((await call("POST", "/gl/vat-filings/RJT-FILING/amend", { reason: "اختبار" })).status).toBeLessThan(300);

    const named = await call("POST", path, { journalLineIndexes: own }, ["purchases.invoice.classify_tax", "purchases.return.view", "accounting.journal.view"]);
    expect([named.status, named.body.journalLinesNamed], JSON.stringify(named.body)).toEqual([200, own.length]);
    expect((await journal(entryId)).filter((line) => line.taxRateId === "VAT14").length).toBe(own.length);
  });
});
