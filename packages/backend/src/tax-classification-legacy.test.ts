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

  it("refuses, in Arabic and writing nothing, when the entry has no line the classification can name", async () => {
    await legacySale("T-LEGACY-MIXED", [serviceLine("L1", 14), serviceLine("L2", 0)]);

    const refused = await call("POST", "/sales-invoices/T-LEGACY-MIXED/lines/L1/classify-tax", { taxRateId: "VAT14" });
    expect([refused.status, refused.body.error]).toEqual([409, "TAX_CLASSIFICATION_JOURNAL_UNTAGGED"]);
    expect(refused.body.message).toMatch(/[؀-ۿ]/);
    expect((await call("GET", "/sales-invoices/T-LEGACY-MIXED")).body.lines.map((l: { taxRateId: string | null }) => l.taxRateId)).toEqual([null, null]);
    expect((await journalTags("T-LEGACY-MIXED")).every(([, percent, rate]) => percent === null && rate === null)).toBe(true);
  });

  it("does the same on the purchase side: the cost and input-VAT lines are named, or the classification is refused", async () => {
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
    const refused = await call("POST", "/purchases/invoices/T-PI-LEGACY-MIXED/lines/0/classify-tax", { taxRateId: "VAT14" });
    expect([refused.status, refused.body.error]).toEqual([409, "TAX_CLASSIFICATION_JOURNAL_UNTAGGED"]);
    expect((await call("GET", "/purchases/invoices/T-PI-LEGACY-MIXED")).body.lines.map((l: { taxRateId: string | null }) => l.taxRateId)).toEqual([null, null]);
  });
});
