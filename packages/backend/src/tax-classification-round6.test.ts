import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const UNNAMED_ZERO = { taxRateId: null, taxRatePercent: 0 };
const EXEMPT_RATE = "VAT-EXEMPT";
const VAT_RATE = "VAT14";

let kit: BackendKit;

const serviceLine = (lineId: string, over: Record<string, unknown> = {}) => ({
  lineId, itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", revenueAccountId: "4100", ...over,
});

async function confirmedSale(id: string, lines: readonly Record<string, unknown>[]) {
  const created = await kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200", lines,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const confirmed = await kit.call("POST", `/sales-invoices/${id}/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
}

async function confirmedPurchase(id: string, lines: readonly Record<string, unknown>[]) {
  const created = await kit.call("POST", "/purchases/invoices", {
    id, supplierId: "SUPP-DEMO-1", date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: "WH-MAIN", lines,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const confirmed = await kit.call("POST", `/purchases/invoices/${id}/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
}

const classifySale = (id: string, lineId: string, taxRateId = EXEMPT_RATE) => kit.call("POST", `/sales-invoices/${id}/lines/${lineId}/classify-tax`, { taxRateId });
const namesOf = (lines: readonly { taxRateId: string | null }[]) => lines.map((line) => line.taxRateId);

beforeAll(async () => {
  kit = await bootBackendKit();
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("a 0% line that posted nothing can still be classified", () => {
  it("names a free line beside a taxed one, with no journal line to name", async () => {
    await confirmedSale("R6-FREE", [serviceLine("A", { taxRateId: VAT_RATE }), serviceLine("B", { ...UNNAMED_ZERO, unitPrice: "0" })]);
    const classified = await classifySale("R6-FREE", "B");
    expect([classified.status, classified.body.journalLinesNamed], JSON.stringify(classified.body)).toEqual([200, 0]);
    expect(namesOf((await kit.call("GET", "/sales-invoices/R6-FREE")).body.lines)).toEqual([VAT_RATE, EXEMPT_RATE]);
    expect(await kit.auditRows("SALES_INVOICE", "R6-FREE", "CLASSIFY_LINE_TAX")).toHaveLength(1);
  });

  it("names a fully discounted line the same way", async () => {
    await confirmedSale("R6-DISC", [serviceLine("A", { taxRateId: VAT_RATE }), serviceLine("B", { ...UNNAMED_ZERO, discountPercent: 100 })]);
    const classified = await classifySale("R6-DISC", "B");
    expect([classified.status, classified.body.journalLinesNamed], JSON.stringify(classified.body)).toEqual([200, 0]);
    expect(namesOf((await kit.call("GET", "/sales-invoices/R6-DISC")).body.lines)).toEqual([VAT_RATE, EXEMPT_RATE]);
  });

  it("does the same for a free purchase line", async () => {
    await confirmedPurchase("R6-PFREE", [
      { itemId: null, kind: "expense", description: "خدمة", qty: "1", unitCost: "200", taxRateId: VAT_RATE },
      { itemId: null, kind: "expense", description: "هدية", qty: "1", unitCost: "0", ...UNNAMED_ZERO },
    ]);
    const classified = await kit.call("POST", "/purchases/invoices/R6-PFREE/lines/1/classify-tax", { taxRateId: EXEMPT_RATE });
    expect([classified.status, classified.body.journalLinesNamed], JSON.stringify(classified.body)).toEqual([200, 0]);
    expect(namesOf((await kit.call("GET", "/purchases/invoices/R6-PFREE")).body.lines)).toEqual([VAT_RATE, EXEMPT_RATE]);
  });
});
