import { describe, it, expect, afterEach } from "vitest";
import {
  Money,
  Qty,
  createDefaultSettings,
  type AuditEvent,
  type SettingsRepository,
  type TenantSettings,
  type WacSnapshot,
  type WacSnapshotRepository,
} from "@mezan/domain";
import { createSqliteItemStore, type SqliteItemStoreHandle } from "@mezan/persistence";
import { createItemsRouter } from "./items-routes.js";

const handles: SqliteItemStoreHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function snapshot(itemId: string, warehouseId: string, onHand: string, unitCost = "10"): WacSnapshot {
  const qty = Qty.fromMajor(onHand);
  const cost = Money.fromMajor(unitCost);
  return {
    itemId,
    warehouseId,
    onHand: qty,
    totalValue: Money.fromScaled((qty.scaled * cost.scaled) / 1_000_000n),
    averageCost: cost,
  };
}

interface AppOptions {
  readonly positions?: readonly WacSnapshot[];
  readonly withSnapshots?: boolean;
  readonly settings?: Partial<TenantSettings> | null;
  readonly withAudit?: boolean;
}

function newApp(opts: AppOptions = {}) {
  const repo = createSqliteItemStore();
  handles.push(repo);
  const events: AuditEvent[] = [];

  const snapshots: WacSnapshotRepository | undefined =
    opts.withSnapshots || opts.positions
      ? {
          async get() {
            return null;
          },
          async save() {
            /* the router never writes */
          },
          async list() {
            return [...(opts.positions ?? [])];
          },
        }
      : undefined;

  const settings: SettingsRepository | undefined =
    opts.settings === undefined
      ? undefined
      : {
          async get() {
            return opts.settings === null ? null : createDefaultSettings(opts.settings);
          },
          async save() {
            /* the router never writes */
          },
        };

  const app = createItemsRouter(
    repo,
    undefined,
    snapshots,
    settings,
    opts.withAudit
      ? {
          append: async (e) => void events.push(e),
          query: async (stream) => events.filter((e) => e.stream === stream),
        }
      : undefined,
  );
  return { app, repo, events };
}

type App = ReturnType<typeof newApp>["app"];

const ADMIN = "*";

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? ADMIN);
  headers.set("x-user-id", "u1");
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function send(app: App, method: string, path: string, payload?: unknown, permissions?: string) {
  return app.fetch(
    req(path, { method, permissions, body: payload === undefined ? undefined : JSON.stringify(payload) }),
  );
}

async function get(app: App, path: string, permissions?: string) {
  return app.fetch(req(path, { permissions }));
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function item(overrides: Record<string, unknown> = {}) {
  return { id: "itm-1", code: "ITM-0001", nameAr: "طقم شاي", type: "stock", baseUnitCode: "PCS", ...overrides };
}

describe("items-routes — the catalogue list, its chips and its strip", () => {
  const positions = [snapshot("itm-1", "W1", "8"), snapshot("itm-1", "W2", "2"), snapshot("itm-low", "W1", "1")];

  async function seeded(app: App) {
    await send(app, "POST", "/", item({ id: "itm-1", code: "ITM-1", nameAr: "طقم شاي", categoryId: "cat-1", brandId: "br-1", seasonId: "se-1", barcodes: ["6221033"] }));
    await send(app, "POST", "/", item({ id: "itm-low", code: "ITM-2", nameAr: "أكواب", reorderPoint: 5 }));
    await send(app, "POST", "/", item({ id: "itm-out", code: "ITM-3", nameAr: "صحون", reorderPoint: 2 }));
    await send(app, "POST", "/", item({ id: "itm-svc", code: "ITM-4", nameAr: "تركيب", type: "service", baseUnitCode: "HR" }));
    await send(app, "PATCH", "/itm-svc", { status: "inactive" });
  }

  async function idsOf(app: App, query: string) {
    const rows = await json<Array<{ id: string }>>(await get(app, `/${query}`));
    return rows.map((r) => r.id);
  }

  it("carries each row's on-hand quantity and its stock state", async () => {
    const { app } = newApp({ positions });
    await seeded(app);

    const rows = await json<Array<{ id: string; onHand: string | null; stockState: string | null }>>(await get(app, "/"));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("itm-1")).toMatchObject({ onHand: "10.000000", stockState: "ok" });
    expect(byId.get("itm-low")).toMatchObject({ onHand: "1.000000", stockState: "low" });
    expect(byId.get("itm-out")).toMatchObject({ onHand: "0.000000", stockState: "out" });
    // A service holds no stock, so it reports no quantity rather than a zero
    // that would land it in the out-of-stock chip.
    expect(byId.get("itm-svc")).toMatchObject({ onHand: null, stockState: null });
  });

  it("reports no position at all when the edition mounts no inventory ledger", async () => {
    const { app } = newApp();
    await seeded(app);
    const rows = await json<Array<{ onHand: string | null; stockState: string | null }>>(await get(app, "/"));
    expect(rows.every((r) => r.onHand === null && r.stockState === null)).toBe(true);
  });

  it("filters by category, brand, season, unit and free text over name, code and barcode", async () => {
    const { app } = newApp({ positions });
    await seeded(app);

    expect(await idsOf(app, "?categoryId=cat-1")).toEqual(["itm-1"]);
    expect(await idsOf(app, "?brandId=br-1")).toEqual(["itm-1"]);
    expect(await idsOf(app, "?seasonId=se-1")).toEqual(["itm-1"]);
    expect(await idsOf(app, "?unitCode=HR")).toEqual(["itm-svc"]);
    expect(await idsOf(app, "?search=6221033")).toEqual(["itm-1"]);
    expect(await idsOf(app, "?q=ITM-2")).toEqual(["itm-low"]);
    expect(await idsOf(app, "?q=اكواب")).toEqual(["itm-low"]);
  });

  it("narrows by every chip key the row of chips offers", async () => {
    const { app } = newApp({ positions });
    await seeded(app);

    expect(await idsOf(app, "?status=all")).toHaveLength(4);
    expect(await idsOf(app, "?status=active")).toHaveLength(3);
    expect(await idsOf(app, "?status=inactive")).toEqual(["itm-svc"]);
    expect(await idsOf(app, "?status=low_stock")).toEqual(["itm-low"]);
    expect(await idsOf(app, "?status=out_of_stock")).toEqual(["itm-out"]);
    expect(await idsOf(app, "?status=type:service")).toEqual(["itm-svc"]);
    expect(await idsOf(app, "?status=service")).toEqual(["itm-svc"]);
    // A chip key that names no type at all narrows nothing rather than erroring.
    expect(await idsOf(app, "?status=nonsense")).toHaveLength(4);
  });

  it("counts every chip, including the types nobody has used", async () => {
    const { app } = newApp({ positions });
    await seeded(app);

    const counts = await json<Record<string, number>>(await get(app, "/counts?status=inactive"));
    expect(counts).toMatchObject({
      all: 4,
      active: 3,
      inactive: 1,
      low_stock: 1,
      out_of_stock: 1,
      "type:stock": 3,
      "type:service": 1,
      "type:recipe": 0,
      "type:raw_material": 0,
    });

    const forOneCategory = await json<Record<string, number>>(await get(app, "/counts?categoryId=cat-1"));
    expect(forOneCategory.all).toBe(1);
  });

  it("counts stock-holding by capability, not by the literal type (R5.1)", async () => {
    const { app } = newApp({ positions });
    await seeded(app);
    await send(app, "POST", "/", item({ id: "itm-raw", code: "ITM-5", nameAr: "خامة", type: "raw_material" }));

    const stats = await json<{ count: number; active: number; stockTracked: number; nonStock: number }>(
      await get(app, "/stats"),
    );
    expect(stats.count).toBe(5);
    // stock ×3 + raw_material ×1 all hold stock; only the service does not.
    expect(stats.stockTracked).toBe(4);
    expect(stats.nonStock).toBe(1);

    // Unlike /counts, the strip honours the chip.
    const serviceOnly = await json<{ count: number; stockTracked: number }>(await get(app, "/stats?status=type:service"));
    expect(serviceOnly).toMatchObject({ count: 1, stockTracked: 0 });
  });
});

describe("items-routes — one item and where its stock sits", () => {
  it("reports the item's position warehouse by warehouse", async () => {
    const positions = [snapshot("itm-1", "W1", "8", "10"), snapshot("itm-1", "W2", "2", "12")];
    const { app } = newApp({ positions });
    await send(app, "POST", "/", item());

    const detail = await json<{
      stock: { onHand: string; byWarehouse: Array<{ warehouseId: string; onHand: string; totalValue: string }> };
    }>(await get(app, "/itm-1"));

    expect(detail.stock.onHand).toBe("10.000000");
    expect(detail.stock.byWarehouse).toEqual([
      { warehouseId: "W1", onHand: "8.000000", totalValue: "80.000000" },
      { warehouseId: "W2", onHand: "2.000000", totalValue: "24.000000" },
    ]);
  });

  it("reports a null position rather than a fabricated zero when no ledger is mounted", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", item());
    expect((await json<{ stock: unknown }>(await get(app, "/itm-1"))).stock).toBeNull();
  });

  it("reports an empty position for an item nothing has ever moved", async () => {
    const { app } = newApp({ withSnapshots: true });
    await send(app, "POST", "/", item());
    const detail = await json<{ stock: { onHand: string; byWarehouse: unknown[] } }>(await get(app, "/itm-1"));
    expect(detail.stock.onHand).toBe("0.000000");
    expect(detail.stock.byWarehouse).toEqual([]);
  });
});

describe("items-routes — the tenant's own default VAT rate", () => {
  it("inherits the tenant's rate when the item names none", async () => {
    const { app } = newApp({ settings: { taxEnabled: true, defaultTaxRate: 14 } });
    const created = await json<{ taxRatePercent: number }>(await send(app, "POST", "/", item()));
    expect(created.taxRatePercent).toBe(14);
  });

  it("charges nothing when the tenant has tax switched off", async () => {
    const { app } = newApp({ settings: { taxEnabled: false } });
    const created = await json<{ taxRatePercent: number }>(await send(app, "POST", "/", item()));
    expect(created.taxRatePercent).toBe(0);
  });

  it("falls back to the default settings when the tenant has saved none", async () => {
    const { app } = newApp({ settings: null });
    const created = await json<{ taxRatePercent: number }>(await send(app, "POST", "/", item()));
    expect(typeof created.taxRatePercent).toBe("number");
  });

  it("lets the item's own rate win over the tenant's", async () => {
    const { app } = newApp({ settings: { taxEnabled: true, defaultTaxRate: 14 } });
    const created = await json<{ taxRatePercent: number }>(
      await send(app, "POST", "/", item({ taxRatePercent: 5 })),
    );
    expect(created.taxRatePercent).toBe(5);
  });
});

describe("items-routes — the audit trail behind a price change", () => {
  it("records a create as INFO and a price edit as WARNING, with the previous prices", async () => {
    const { app, events } = newApp({ withAudit: true });
    await send(app, "POST", "/", item({ salePrice: "100.00", costPrice: "60.00" }));
    expect(events.at(-1)).toMatchObject({ action: "CREATE", severity: "INFO", entityType: "ITEM" });

    await send(app, "PATCH", "/itm-1", { salePrice: "150.00" });
    const update = events.at(-1)!;
    expect(update).toMatchObject({ action: "UPDATE", severity: "WARNING" });
    expect(update.details).toMatchObject({
      salePrice: "150.000000",
      previousSalePrice: "100.000000",
      previousCostPrice: "60.000000",
    });
  });

  it("records an edit that leaves both prices alone as INFO", async () => {
    const { app, events } = newApp({ withAudit: true });
    await send(app, "POST", "/", item({ salePrice: "100.00" }));
    await send(app, "PATCH", "/itm-1", { nameAr: "طقم شاي فاخر" });
    expect(events.at(-1)).toMatchObject({ action: "UPDATE", severity: "INFO" });
  });

  it("writes nothing when no audit sink is wired", async () => {
    const { app, events } = newApp();
    await send(app, "POST", "/", item());
    expect(events).toEqual([]);
  });
});
