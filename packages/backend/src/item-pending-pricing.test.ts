import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, ItemStatusCode } from "@mezan/domain";
import { createBackend, type BackendHandle } from "./create-backend.js";

const ARABIC = /[؀-ۿ]/;
const BRANCH = "BR-MAIN";

interface Res {
  readonly status: number;
  readonly body: any;
}
type Caller = (method: string, path: string, body?: unknown) => Promise<Res>;

let handle: BackendHandle;
let headOffice: Caller;
let branchUser: Caller;

function callerFor(token: string): Caller {
  return async (method, path, body) => {
    const res = await handle.app.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, code: id, nameAr: `صنف ${id}`, type: "service", baseUnitCode: "PCS", ...extra });

const invoice = (id: string, itemId: string) => ({
  id,
  date: "2026-08-22",
  dueDate: "2026-09-21",
  customerId: "CUST-PP",
  customerNameAr: "عميل التسعير",
  warehouseId: "WH-MAIN",
  branchId: BRANCH,
  arAccountId: "1105",
  taxAccountId: "2200",
  lines: [{ lineId: "L1", itemId, itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", taxRatePercent: 0, revenueAccountId: "4100" }],
});

const quote = (id: string, itemId: string) => ({
  id,
  date: "2026-08-22",
  expiryDate: "2026-09-21",
  customerId: "CUST-PP",
  customerNameAr: "عميل التسعير",
  branchId: BRANCH,
  lines: [{ lineId: "L1", itemId, itemNameAr: "خدمة", qty: "1", unitPrice: "100", taxRatePercent: 0 }],
});

beforeAll(async () => {
  handle = await createBackend({ dbPath: ":memory:" });
  const session = (userId: string, branchScope: typeof ALL_SCOPE | string[]) =>
    callerFor(
      handle.sessions.issue({
        userId,
        permissions: ["inventory.item.view", "inventory.item.create", "inventory.item.edit", "sales.invoice.create", "sales.invoice.confirm", "sales.invoice.view", "sales.quote.create", "sales.quote.view", "sales.customer.create", "sales.customer.view"],
        roleCode: null,
        branchScope,
        warehouseScope: ALL_SCOPE,
      }),
    );
  headOffice = session("USER-PP-HO", ALL_SCOPE);
  branchUser = session("USER-PP-BRANCH", [BRANCH]);
  expect((await headOffice("POST", "/customers", { id: "CUST-PP", code: "CUST-PP", nameAr: "عميل التسعير", type: "company" })).status).toBe(201);
});

afterAll(() => handle.close());

describe("an item a branch creates waits for head office to price it", () => {
  it("a branch-granted session creates the item, without a price, in pending_pricing — whatever status it sends", async () => {
    const created = await branchUser("POST", "/items", item("PP-1"));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.status).toBe(ItemStatusCode.PendingPricing);
    expect(created.body.salePrice).toBeNull();
    expect((await headOffice("GET", "/items/PP-1")).body.status).toBe(ItemStatusCode.PendingPricing);
  });

  it("the branch still cannot set the company's price or cost", async () => {
    for (const field of ["salePrice", "costPrice"]) {
      const refused = await branchUser("POST", "/items", item(`PP-PRICED-${field}`, { [field]: "10.00" }));
      expect(refused.status, field).toBe(403);
      expect(refused.body.message, field).toMatch(ARABIC);
    }
  });

  it("an item head office creates is active as before", async () => {
    const created = await headOffice("POST", "/items", item("PP-HO", { salePrice: "50.00" }));
    expect(created.status).toBe(201);
    expect(created.body.status).toBe(ItemStatusCode.Active);
  });

  it.each([
    ["a sales invoice", "/sales-invoices", () => invoice("PP-INV-1", "PP-1")],
    ["a sales quote", "/sales-quotes", () => quote("PP-Q-1", "PP-1")],
  ] as const)("%s naming the pending item is refused in Arabic for the branch and for head office, and nothing is stored", async (_label, path, body) => {
    for (const caller of [branchUser, headOffice]) {
      const refused = await caller("POST", path, body());
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body.error).toBe("ITEM_PENDING_PRICING");
      expect(refused.body.message).toMatch(ARABIC);
      expect(refused.body.message).toContain("بانتظار التسعير");
      expect(refused.body.itemIds).toEqual(["PP-1"]);
      expect(JSON.stringify(refused.body)).not.toContain("صنف PP-1");
    }
    expect((await headOffice("GET", `${path}/${body().id}`)).status).toBe(404);
  });

  it("a document naming only priced items passes the same guard", async () => {
    expect((await headOffice("POST", "/sales-invoices", invoice("PP-INV-OK", "PP-HO"))).status).toBe(201);
  });

  it("head office finds it in the to-price list, with a count", async () => {
    const counts = await headOffice("GET", "/items/counts");
    expect(counts.body[ItemStatusCode.PendingPricing]).toBe(1);
    const list = await headOffice("GET", `/items?status=${ItemStatusCode.PendingPricing}`);
    const rows = Array.isArray(list.body) ? list.body : list.body.rows;
    expect(rows.map((row: any) => row.id)).toEqual(["PP-1"]);
  });

  it("the branch cannot release it, and nobody can release it without a price", async () => {
    const byBranch = await branchUser("PATCH", "/items/PP-1", { status: ItemStatusCode.Active });
    expect(byBranch.status).toBe(403);
    const unpriced = await headOffice("PATCH", "/items/PP-1", { status: ItemStatusCode.Active });
    expect(unpriced.status, JSON.stringify(unpriced.body)).toBe(409);
    expect(unpriced.body.error).toBe("ITEM_PRICE_REQUIRED");
    expect(unpriced.body.message).toMatch(ARABIC);
    expect((await headOffice("GET", "/items/PP-1")).body.status).toBe(ItemStatusCode.PendingPricing);
  });

  it("an edit that sets no price leaves it pending", async () => {
    expect((await headOffice("PATCH", "/items/PP-1", { description: "وصف" })).body.status).toBe(ItemStatusCode.PendingPricing);
    expect((await headOffice("PATCH", "/items/PP-1", { salePrice: "0" })).body.status).toBe(ItemStatusCode.PendingPricing);
  });

  it("no one can put an item back into pending_pricing", async () => {
    const refused = await headOffice("PATCH", "/items/PP-HO", { status: ItemStatusCode.PendingPricing });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(ARABIC);
    expect((await headOffice("GET", "/items/PP-HO")).body.status).toBe(ItemStatusCode.Active);
  });

  it("head office prices it, it turns active, and it sells", async () => {
    const priced = await headOffice("PATCH", "/items/PP-1", { salePrice: "120.00" });
    expect(priced.status, JSON.stringify(priced.body)).toBe(200);
    expect(priced.body.status).toBe(ItemStatusCode.Active);
    expect((await headOffice("GET", "/items/counts")).body[ItemStatusCode.PendingPricing]).toBe(0);
    const sold = await branchUser("POST", "/sales-invoices", invoice("PP-INV-2", "PP-1"));
    expect(sold.status, JSON.stringify(sold.body)).toBe(201);
  });
});
