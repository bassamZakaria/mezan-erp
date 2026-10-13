import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const CLERK = ["sales.invoice.create", "sales.invoice.edit", "sales.invoice.view", "sales.quote.view"];
const OVERRIDE = "sales.price.override";

let kit: BackendKit;

const line = (over: Record<string, unknown> = {}) => ({
  lineId: "A", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", revenueAccountId: "4100", taxRateId: "VAT14", ...over,
});

const draft = (id: string, over: Record<string, unknown> = {}, permissions: readonly string[] = CLERK) =>
  kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200", lines: [line(over)],
  }, permissions);

const edit = (id: string, change: Record<string, unknown>, permissions: readonly string[] | undefined = CLERK) =>
  kit.call("PATCH", `/sales-invoices/${id}/lines/A`, change, permissions);

async function convertedQuote(tag: string): Promise<string> {
  const quoted = await kit.call("POST", "/sales-quotes", {
    id: `${tag}-Q`, date: TODAY, expiryDate: "2026-09-30", customerId: "CUST-DEMO-1", customerNameAr: "عميل", branchId: "BR-MAIN",
    lines: [{ lineId: "A", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", qty: "1", unitPrice: "100", taxRateId: "VAT14" }],
  });
  expect(quoted.status, JSON.stringify(quoted.body)).toBe(201);
  for (const action of ["send", "accept"]) expect((await kit.call("POST", `/sales-quotes/${tag}-Q/${action}`, {})).status).toBe(200);
  const converted = await kit.call("POST", `/sales-quotes/${tag}-Q/convert-to-invoice`, {
    id: `${tag}-I`, dueDate: "2026-09-30", warehouseId: "WH-MAIN", arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", isStock: false, revenueAccountId: "4100" }],
  });
  expect(converted.status, JSON.stringify(converted.body)).toBe(201);
  return `${tag}-I`;
}

beforeAll(async () => {
  kit = await bootBackendKit();
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("a draft line edit is judged by every guard a new invoice meets", () => {
  it.each([
    ["a zero price", { unitPrice: "0" }, {}],
    ["a discount that takes the whole line", { discountType: "percent", discountPercent: 100 }, null],
  ])("refuses %s at creation and through an edit alike, without the price-override permission", async (label, created, edited) => {
    const tag = `GUARD-${label.length}`;
    const atCreation = await draft(`${tag}-NEW`, created);
    expect([atCreation.status, atCreation.body.permission], JSON.stringify(atCreation.body)).toEqual([403, OVERRIDE]);
    if (edited === null) return;
    expect((await draft(`${tag}-OLD`)).status).toBe(201);
    const throughEdit = await edit(`${tag}-OLD`, created);
    expect([throughEdit.status, throughEdit.body.permission], JSON.stringify(throughEdit.body)).toEqual([403, OVERRIDE]);
    expect(throughEdit.body.message).toMatch(/[؀-ۿ]/);
    expect((await kit.call("GET", `/sales-invoices/${tag}-OLD`)).body.totals.grandTotal).toBe("114.000000");
    expect((await edit(`${tag}-OLD`, created, [...CLERK, OVERRIDE])).status).toBe(200);
  });

  it("refuses a stale edit: the version the screen read no longer stands", async () => {
    expect((await draft("GUARD-VER")).status).toBe(201);
    const version = (await kit.call("GET", "/sales-invoices/GUARD-VER")).body.version;
    expect((await edit("GUARD-VER", { qty: "2", expectedVersion: version })).status).toBe(200);
    const stale = await edit("GUARD-VER", { qty: "3", expectedVersion: version });
    expect([stale.status, stale.body.error], JSON.stringify(stale.body)).toEqual([409, "DOCUMENT_VERSION_CONFLICT"]);
  });
});

describe("a draft raised from a quote keeps to the quote", () => {
  it("refuses an edit that departs from the quote without the override permission, and audits one made with it", async () => {
    const id = await convertedQuote("SRC-1");
    const refused = await edit(id, { qty: "350" });
    expect([refused.status, refused.body.error, refused.body.permission], JSON.stringify(refused.body)).toEqual([403, "DRAFT_DEPARTS_FROM_SOURCE", OVERRIDE]);
    expect(refused.body.message).toMatch(/QT-\d+/);
    expect((await kit.call("GET", `/sales-invoices/${id}`)).body.totals.grandTotal).toBe("114.000000");

    const allowed = await edit(id, { qty: "350" }, [...CLERK, OVERRIDE]);
    expect([allowed.status, allowed.body.totals?.grandTotal], JSON.stringify(allowed.body)).toEqual([200, "39900.000000"]);
    const audited = await kit.auditRows("SALES_INVOICE", id, "EDIT_DRAFT_BEYOND_SOURCE");
    expect(audited.map((row) => row.details)).toEqual([
      expect.objectContaining({ lineId: "A", sourceDocumentId: "SRC-1-Q", source: expect.objectContaining({ qty: "1.000000" }), before: expect.objectContaining({ qty: "1.000000" }), after: expect.objectContaining({ qty: "350.000000" }) }),
    ]);
  });

  it("lets an edit that returns to the quote's own figures through for anyone who may edit", async () => {
    const id = await convertedQuote("SRC-2");
    expect((await edit(id, { qty: "5" }, [...CLERK, OVERRIDE])).status).toBe(200);
    expect((await edit(id, { qty: "1" })).status).toBe(200);
  });
});
