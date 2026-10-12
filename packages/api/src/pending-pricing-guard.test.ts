import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { ItemStatusCode, type Item } from "@mezan/domain";
import { itemReferencesNamedIn, pendingPricingGuard } from "./pending-pricing-guard.js";

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
    expect(refusal.message).toContain("صنف PENDING");
    expect(refusal.itemIds).toEqual(["PENDING"]);
  });

  it("lets a write naming only priced or unknown items through", async () => {
    expect(await (await app()("POST", "/sales-invoices", { lines: [{ itemId: "PRICED" }, { itemId: "NOBODY" }] })).json()).toEqual({ reached: true });
    expect(await (await app()("PUT", "/sales-invoices/1", { notes: "x" })).json()).toEqual({ reached: true });
  });

  it("leaves the item master and its price lists open, so head office can price it", async () => {
    expect((await app()("PATCH", "/items/PENDING", { itemId: "PENDING" })).status).toBe(200);
    expect((await app()("POST", "/price-lists", { lines: [{ itemId: "PENDING" }] })).status).toBe(200);
    expect((await app()("POST", "/items-archive", { itemId: "PENDING" })).status).toBe(409);
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
