import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const ITEM = "1280cf9e-6e4f-4d76-948e-712ca811ec79";

let kit: BackendKit;

beforeAll(async () => {
  kit = await bootBackendKit();
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("a stock refusal names the item and warehouse a person knows (#139)", () => {
  it("shows the item code and name, not its id, when an invoice would take more than is held", async () => {
    const item = await kit.call("POST", "/items", { id: ITEM, code: "NAMED-1", nameAr: "صنف مسمّى", type: "stock", baseUnitCode: "PCS", trackInventory: true, costPrice: "10", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    const drafted = await kit.call("POST", "/sales-invoices", {
      id: "NAMED-INV", date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
      arAccountId: "1105", taxAccountId: "2200",
      lines: [{ lineId: "A", itemId: ITEM, itemNameAr: "صنف", isStock: true, qty: "5", unitPrice: "150", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
    });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);

    const refused = await kit.call("POST", "/sales-invoices/NAMED-INV/confirm", {});
    expect([refused.status, refused.body.error], JSON.stringify(refused.body)).toEqual([422, "NEGATIVE_STOCK"]);
    expect(refused.body.message).toContain('الصنف "NAMED-1 - صنف مسمّى"');
    expect(refused.body.message).not.toContain(ITEM);
    const warehouse = ((await kit.call("GET", "/warehouses")).body as { id: string; name: string }[]).find((row) => row.id === "WH-MAIN")!;
    expect(refused.body.message).toContain(`المستودع "${warehouse.name}"`);
    expect(refused.body.message).not.toContain('"WH-MAIN"');
  });
});
