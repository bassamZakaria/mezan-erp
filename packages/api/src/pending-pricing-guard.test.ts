import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { ItemStatusCode, type Item } from "@mezan/domain";
import { ItemDocumentFamily, PENDING_ITEM_RULES, PendingItemRule, itemDocumentFamilyOf, itemReferencesNamedIn, pendingPricingGuard } from "./pending-pricing-guard.js";

const stored = (id: string, status: ItemStatusCode) => ({ id, code: `C-${id}`, nameAr: `صنف ${id}`, status }) as unknown as Item;
const ITEMS = [stored("PENDING", ItemStatusCode.PendingPricing), stored("PRICED", ItemStatusCode.Active)];
const repo = {
  findById: async (id: string) => ITEMS.find((item) => item.id === id) ?? null,
  findByCode: async (code: string) => ITEMS.find((item) => item.code === code) ?? null,
};

function app(authenticated = true) {
  const hono = new Hono();
  hono.use("*", pendingPricingGuard(repo, async () => ({ authenticated }) as never));
  hono.all("*", (c) => c.json({ reached: true }));
  return (method: string, path: string, body?: unknown) =>
    hono.fetch(new Request(`http://local${path}`, { method, headers: { "content-type": "text/plain" }, body: body === undefined ? undefined : JSON.stringify(body) }));
}

describe("itemReferencesNamedIn", () => {
  it("finds an item under any key that names one, at any depth, singular or plural, by id or by code", () => {
    const found = itemReferencesNamedIn({
      lines: [{ itemId: "A" }, { components: [{ componentItemId: "B" }] }],
      finishedItemId: "C",
      itemIds: ["D", "E"],
      rows: [{ itemCode: "X-1" }],
      itemId: "",
      note: "itemId",
    });
    expect([...found.ids].sort()).toEqual(["A", "B", "C", "D", "E"]);
    expect([...found.codes]).toEqual(["X-1"]);
  });
});

describe("pendingPricingGuard", () => {
  it.each([
    ["a line", { lines: [{ itemId: "PENDING" }] }],
    ["a nested component", { lines: [{ itemId: "PRICED", components: [{ componentItemId: "PENDING" }] }] }],
    ["a list of ids", { itemIds: ["PRICED", "PENDING"] }],
    ["a code", { rows: [{ itemCode: "C-PENDING" }] }],
  ])("refuses a write naming a pending item in %s, in Arabic, whatever the content type", async (_label, body) => {
    const res = await app()("POST", "/any/route/added/later", body);
    expect(res.status).toBe(409);
    const refusal = (await res.json()) as { error: string; message: string; itemIds: string[] };
    expect(refusal.error).toBe("ITEM_PENDING_PRICING");
    expect(refusal.message).toMatch(/[؀-ۿ]/);
    expect(refusal.message).toContain("بانتظار التسعير");
    expect(refusal.message).not.toContain("صنف PENDING");
    expect(refusal.itemIds).toEqual(["PENDING"]);
  });

  it("lets a write naming only priced or unknown items through", async () => {
    expect(await (await app()("POST", "/sales-invoices", { lines: [{ itemId: "PRICED" }, { itemId: "NOBODY" }] })).json()).toEqual({ reached: true });
    expect(await (await app()("PUT", "/sales-invoices/1", { notes: "x" })).json()).toEqual({ reached: true });
  });

  it("leaves the item master open, so head office can price it — a look-alike path is not the item master", async () => {
    expect((await app()("PATCH", "/items/PENDING", { itemId: "PENDING" })).status).toBe(200);
    expect((await app()("POST", "/items-archive", { itemId: "PENDING" })).status).toBe(409);
  });

  it.each([
    ["a sales quote", "/sales-quotes"],
    ["a sales invoice", "/sales-invoices"],
    ["a sales return", "/sales-returns/from-invoice"],
    ["a point-of-sale sale", "/pos/sales"],
    ["a van trip's load", "/field/van-trips"],
    ["a price list", "/price-lists"],
    ["a promotion", "/promotions"],
  ])("refuses a pending item on %s: it has no price to sell at", async (_label, path) => {
    expect((await app()("POST", path, { lines: [{ itemId: "PENDING" }] })).status).toBe(409);
  });

  it.each([
    ["a purchase order", "/purchases/orders"],
    ["a goods receipt", "/purchases/receipts"],
    ["a purchase invoice", "/purchases/invoices"],
    ["a purchase return", "/purchase-returns"],
    ["a request for quotation", "/rfqs"],
    ["a landed cost", "/landed-costs"],
    ["a stock transfer", "/inventory/stock-transfers/draft"],
    ["a stock adjustment", "/inventory/stock-adjustments/draft"],
    ["a physical count", "/inventory/physical-counts"],
  ])("lets a pending item onto %s: head office receives and counts stock before it prices it", async (_label, path) => {
    expect(await (await app()("POST", path, { lines: [{ itemId: "PENDING" }] })).json()).toEqual({ reached: true });
  });

  it("says, for every family it knows, whether a pending item may be named — and denies a route it does not know", () => {
    expect(Object.keys(PENDING_ITEM_RULES).sort()).toEqual(Object.values(ItemDocumentFamily).sort());
    expect(itemDocumentFamilyOf("/any/route/added/later")).toBe(ItemDocumentFamily.Unclassified);
    expect(PENDING_ITEM_RULES[ItemDocumentFamily.Unclassified]).toBe(PendingItemRule.Deny);
    expect(itemDocumentFamilyOf("/purchases")).toBe(ItemDocumentFamily.Purchasing);
    expect(itemDocumentFamilyOf("/purchases-archive")).toBe(ItemDocumentFamily.Unclassified);
    const sales = [ItemDocumentFamily.SalesQuote, ItemDocumentFamily.SalesInvoice, ItemDocumentFamily.SalesReturn, ItemDocumentFamily.PointOfSale, ItemDocumentFamily.VanSales, ItemDocumentFamily.PriceList, ItemDocumentFamily.Promotion];
    for (const family of sales) expect(PENDING_ITEM_RULES[family], family).toBe(PendingItemRule.Deny);
  });

  it("does not read a request it has nothing to refuse: a read, a delete, a body that is not JSON", async () => {
    expect((await app()("GET", "/sales-invoices?itemId=PENDING")).status).toBe(200);
    expect((await app()("DELETE", "/sales-invoices/1")).status).toBe(200);
    const raw = new Hono();
    raw.use("*", pendingPricingGuard(repo, async () => ({ authenticated: true }) as never));
    raw.all("*", (c) => c.json({ reached: true }));
    expect((await raw.fetch(new Request("http://local/x", { method: "POST", body: "itemId=PENDING" }))).status).toBe(200);
  });

  it("tells an unauthenticated caller nothing about any item — the route's own gate answers", async () => {
    expect((await app(false)("POST", "/sales-invoices", { lines: [{ itemId: "PENDING" }] })).status).toBe(200);
  });
});
