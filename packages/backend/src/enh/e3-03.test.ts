import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "@mezan/api";
import { ALL_SCOPE, MODULE_CATALOG, createEntitlements } from "@mezan/domain";
import type { NotificationDTO, SessionDTO } from "@mezan/contracts";
import type { CreateReorderOrdersResultDTO, ReorderPolicyDTO, ReorderWorklistDTO } from "@mezan/contracts";
import { createBackend, type BackendHandle } from "../create-backend.js";

const WAREHOUSE = "WH-MAIN";
const SUPPLIER = "SUPP-DEMO-1";
const ITEM = "REO-1";
const TODAY = "2026-10-17";

let backend: BackendHandle;
let app: App;
let session: SessionDTO;

interface Reply {
  readonly status: number;
  readonly body: any;
}

async function call(method: string, path: string, body?: unknown, token = session.token): Promise<Reply> {
  const res = await app.fetch(
    new Request(`http://local${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function adjust(id: string, direction: "IN" | "OUT", qty: string): Promise<void> {
  const line = direction === "IN" ? { reason: "INITIAL_STOCK", unitCost: "5" } : { reason: "DAMAGE" };
  const created = await call("POST", "/inventory/stock-adjustments/draft", { id, date: TODAY, lines: [{ itemId: ITEM, warehouseId: WAREHOUSE, direction, qty, ...line }] });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const confirmed = await call("POST", `/inventory/stock-adjustments/${id}/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
}

async function lowStockNotifications(): Promise<NotificationDTO[]> {
  const list = await call("GET", "/notifications");
  return (list.body as NotificationDTO[]).filter((n) => n.eventCode === "LOW_STOCK_DETECTED");
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 2_500));
}

beforeAll(async () => {
  backend = await createBackend({
    dbPath: ":memory:",
    seedDemoData: true,
    resolveEntitlements: () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null }),
  });
  app = backend.app;
  const login = await app.fetch(new Request("http://local/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin@cyag.example", pin: "123456" }) }));
  expect(login.status).toBe(200);
  session = (await login.json()) as SessionDTO;
  const item = await call("POST", "/items", {
    id: ITEM,
    code: ITEM,
    nameAr: "صنف إعادة الطلب",
    type: "stock",
    baseUnitCode: "PCS",
    trackInventory: true,
    reorderPoint: 10,
    reorderQty: 40,
    defaultSupplierId: SUPPLIER,
    revenueAccountId: "4100",
    cogsAccountId: "5100",
    inventoryAccountId: "1200",
  });
  expect(item.status, JSON.stringify(item.body)).toBe(201);
  const rule = await call("POST", "/notification-rules", {
    id: "rule-low-stock",
    name: "انخفاض المخزون",
    eventCode: "LOW_STOCK_DETECTED",
    recipientType: "permission",
    recipientValue: "inventory.stock.view",
    priority: "normal",
    channels: ["in_app"],
  });
  expect(rule.status, JSON.stringify(rule.body)).toBe(201);
});

afterAll(() => backend.close());

describe("ENH-E3-03 reorder", () => {
  it("emits LOW_STOCK_DETECTED once per crossing and again after the stock recovers", async () => {
    await adjust("ADJ-1", "IN", "30");
    await settle();
    expect(await lowStockNotifications()).toHaveLength(0);

    await adjust("ADJ-2", "OUT", "25");
    await adjust("ADJ-3", "OUT", "2");
    await settle();
    const first = await lowStockNotifications();
    expect(first).toHaveLength(1);
    expect(first[0]?.payload.itemId).toBe(ITEM);
    expect(first[0]?.payload.warehouseId).toBe(WAREHOUSE);

    await adjust("ADJ-4", "IN", "20");
    await adjust("ADJ-5", "OUT", "15");
    await settle();
    expect(await lowStockNotifications()).toHaveLength(2);
  }, 30_000);

  it("ranks the item on the worklist from its own reorder point and quantity", async () => {
    const res = await call("GET", "/reorder/worklist");
    expect(res.status).toBe(200);
    const worklist = res.body as ReorderWorklistDTO;
    const row = worklist.rows.find((r) => r.itemId === ITEM && r.warehouseId === WAREHOUSE);
    expect(row).toBeDefined();
    expect(row?.onHand).toBe("8.000000");
    expect(row?.suggestedQty).toBe("42.000000");
    expect(row?.supplierId).toBe(SUPPLIER);
    expect(row?.source).toBe("item_default");
  });

  it("refuses to create orders without the create permission", async () => {
    const limited = backend.sessions.issue({ userId: "LIMITED", permissions: ["inventory.reorder.view", "inventory.stock.view"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    expect((await call("GET", "/reorder/worklist", undefined, limited)).status).toBe(200);
    expect((await call("POST", "/reorder/orders", { lines: [{ itemId: ITEM, warehouseId: WAREHOUSE, qty: "42" }] }, limited)).status).toBe(403);
    const noPurchasing = backend.sessions.issue({ userId: "LIMITED-2", permissions: ["inventory.reorder.view", "inventory.reorder.create", "inventory.stock.view"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    expect((await call("POST", "/reorder/orders", { lines: [{ itemId: ITEM, warehouseId: WAREHOUSE, qty: "42" }] }, noPurchasing)).status).toBe(403);
  });

  it("creates a draft purchase order for the supplier and stops suggesting what is already ordered", async () => {
    const res = await call("POST", "/reorder/orders", { lines: [{ itemId: ITEM, warehouseId: WAREHOUSE, qty: "42" }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const result = res.body as CreateReorderOrdersResultDTO;
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.supplierId).toBe(SUPPLIER);
    expect(result.created[0]?.warehouseId).toBe(WAREHOUSE);
    const order = await call("GET", `/purchases/orders/${result.created[0]?.orderId}`);
    expect(order.status).toBe(200);
    expect(order.body.status).toBe("draft");
    expect(order.body.lines).toHaveLength(1);
    expect(order.body.lines[0].qty).toBe("42.000000");

    const again = (await call("GET", "/reorder/worklist")).body as ReorderWorklistDTO;
    expect(again.rows.find((r) => r.itemId === ITEM)).toBeUndefined();

    const repeat = await call("POST", "/reorder/orders", { lines: [{ itemId: ITEM, warehouseId: WAREHOUSE, qty: "42" }] });
    expect((repeat.body as CreateReorderOrdersResultDTO).created).toHaveLength(0);
    expect((repeat.body as CreateReorderOrdersResultDTO).skipped[0]?.reason).toBe("not_on_worklist");
  });

  it("applies a warehouse policy, rounds to its pack and lists a line without a supplier as needing one", async () => {
    const other = await call("POST", "/items", {
      id: "REO-2",
      code: "REO-2",
      nameAr: "صنف بلا مورد",
      type: "stock",
      baseUnitCode: "PCS",
      trackInventory: true,
      revenueAccountId: "4100",
      cogsAccountId: "5100",
      inventoryAccountId: "1200",
    });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    const saved = await call("PUT", "/reorder/policies", { itemId: "REO-2", warehouseId: WAREHOUSE, minQty: "20", maxQty: "100", leadDays: 7, packQty: "12" });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((saved.body as ReorderPolicyDTO).packQty).toBe("12.000000");

    const badPolicy = await call("PUT", "/reorder/policies", { itemId: "REO-2", warehouseId: WAREHOUSE, minQty: "50", maxQty: "10", leadDays: 7 });
    expect(badPolicy.status).toBe(422);

    const worklist = (await call("GET", "/reorder/worklist")).body as ReorderWorklistDTO;
    const row = worklist.rows.find((r) => r.itemId === "REO-2");
    expect(row?.suggestedQty).toBe("108.000000");
    expect(row?.problems).toContain("no_supplier");

    const orders = await call("POST", "/reorder/orders", { lines: [{ itemId: "REO-2", warehouseId: WAREHOUSE, qty: "108" }] });
    expect(orders.status).toBe(200);
    expect((orders.body as CreateReorderOrdersResultDTO).needsSupplier).toHaveLength(1);
    expect((orders.body as CreateReorderOrdersResultDTO).created).toHaveLength(0);

    const withSupplier = await call("POST", "/reorder/orders", { lines: [{ itemId: "REO-2", warehouseId: WAREHOUSE, qty: "108", supplierId: SUPPLIER }] });
    expect(withSupplier.status).toBe(201);

    expect((await call("DELETE", `/reorder/policies/REO-2/${WAREHOUSE}`)).status).toBe(204);
    expect((await call("DELETE", `/reorder/policies/REO-2/${WAREHOUSE}`)).status).toBe(404);
  });

  it("keeps a restricted caller to their own warehouses", async () => {
    const scoped = backend.sessions.issue({
      userId: "SCOPED",
      permissions: ["inventory.reorder.view", "inventory.reorder.manage", "inventory.stock.view"],
      roleCode: null,
      branchScope: ALL_SCOPE,
      warehouseScope: ["WH-ELSEWHERE"],
    });
    const worklist = await call("GET", "/reorder/worklist", undefined, scoped);
    expect(worklist.status).toBe(200);
    expect((worklist.body as ReorderWorklistDTO).rows).toHaveLength(0);
    const policy = await call("PUT", "/reorder/policies", { itemId: ITEM, warehouseId: WAREHOUSE, minQty: "1", maxQty: "5", leadDays: 1 }, scoped);
    expect(policy.status).toBe(403);
  });
});
