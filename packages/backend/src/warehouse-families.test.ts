import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BranchRecordKind } from "@mezan/contracts";
import { ALL_PERMISSION_CODES, ALL_SCOPE, createEntitlements, LAN_MULTI_TILL_FEATURE, MODULE_CATALOG } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createSqliteBranchDirectory } from "./branch-directory.js";
import { createBackend, type BackendHandle } from "./create-backend.js";
import { WAREHOUSE_FAMILIES, WAREHOUSE_LEDGER_TABLES, warehouseColumnsOf } from "./warehouse-families.js";
import { createWarehouseUse } from "./warehouse-use.js";

const ARABIC = /[؀-ۿ]/;
const TODAY = new Date().toISOString().slice(0, 10);
const BOOT_TIMEOUT_MS = 240_000;
const MAIN_WAREHOUSE = "WH-MAIN";
const SITE_WAREHOUSE = "WH-SITE-TOWER";
const PROJECT = "PRJ-DEMO-1";
const OTHER_SITE_WAREHOUSE = "WF-WH-SITE-2";
const K = BranchRecordKind;

interface Res {
  readonly status: number;
  readonly body: any;
}
type Caller = (method: string, path: string, body?: unknown) => Promise<Res>;
type Sqlite = ReturnType<typeof openSqliteConnection>["sqlite"];

let handle: BackendHandle;
let sqlite: Sqlite;
let admin: Caller;
let siteKeeperOnly: Caller;
let mainKeeperOnly: Caller;
let otherSiteKeeperOnly: Caller;

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
    try {
      return { status: res.status, body: text ? JSON.parse(text) : null };
    } catch {
      return { status: res.status, body: text };
    }
  };
}

const one = <T = any>(sql: string, ...params: unknown[]) => sqlite.prepare(sql).get(...params) as T | undefined;
const movements = () => one<{ n: number }>("SELECT count(*) AS n FROM stock_movement")!.n;
const tables = () => (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((row) => row.name);

beforeAll(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "mezan-wh-families-")), "books.db");
  const resolveEntitlements = () =>
    createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: { [LAN_MULTI_TILL_FEATURE]: true }, seats: 50, expiresAt: null });
  handle = await createBackend({ dbPath, seedDemoData: true, lan: { resolveEntitlements }, resolveEntitlements });
  sqlite = openSqliteConnection(dbPath).sqlite;
  const session = (userId: string, warehouseScope: typeof ALL_SCOPE | string[]) =>
    callerFor(handle.sessions.issue({ userId, permissions: userId === "USER-ADMIN" ? ["*"] : [...ALL_PERMISSION_CODES], roleCode: null, branchScope: ALL_SCOPE, warehouseScope }));
  admin = session("USER-ADMIN", ALL_SCOPE);
  siteKeeperOnly = session("USER-WF-SITE", [SITE_WAREHOUSE]);
  mainKeeperOnly = session("USER-WF-MAIN", [MAIN_WAREHOUSE]);
  otherSiteKeeperOnly = session("USER-WF-SITE-2", [OTHER_SITE_WAREHOUSE]);
}, BOOT_TIMEOUT_MS);

afterAll(() => {
  sqlite?.close();
  handle?.close();
});

describe("every table that names a warehouse is a known family", () => {
  it("is registered as a document family or declared a stock ledger table", () => {
    const registered = new Set([...WAREHOUSE_FAMILIES.map((family) => family.table), ...Object.keys(WAREHOUSE_LEDGER_TABLES)]);
    const unknown = tables().filter((table) => warehouseColumnsOf(sqlite, table).length > 0 && !registered.has(table));
    expect(unknown).toEqual([]);
  });

  it("registers no table that does not exist", () => {
    const live = new Set(tables());
    expect([...WAREHOUSE_FAMILIES.map((family) => family.table), ...Object.keys(WAREHOUSE_LEDGER_TABLES)].filter((table) => !live.has(table))).toEqual([]);
  });

  it("gives every family a record kind the branch directory resolves to its warehouses", async () => {
    const directory = createSqliteBranchDirectory(sqlite);
    for (const family of WAREHOUSE_FAMILIES) {
      const row = one<{ id: string }>(`SELECT id FROM "${family.table}" ${family.docType ? `WHERE doc_type = '${family.docType}'` : ""} LIMIT 1`);
      if (!row) continue;
      expect(await directory.warehousesOf(family.kind, row.id), `${family.table} ${row.id}`).not.toBeNull();
    }
    expect(await directory.warehousesOf(K.MaterialConsumption, "CON-DEMO-1")).toEqual([SITE_WAREHOUSE]);
    expect(await directory.warehousesOf(K.SiteCustody, "CUST-DEMO-1")).toEqual([SITE_WAREHOUSE]);
    expect(await directory.warehousesOf(K.SiteIssue, "ISS-DEMO-1")).toEqual(expect.arrayContaining([MAIN_WAREHOUSE, SITE_WAREHOUSE]));
    expect(await directory.warehousesOf(K.SiteReceipt, "SRC-DEMO-1")).toEqual(expect.arrayContaining([SITE_WAREHOUSE]));
  });
});

describe("a session granted some warehouses cannot move a contracting-site document standing on another", () => {
  beforeAll(async () => {
    const created = [
      await admin("POST", "/warehouses", { id: OTHER_SITE_WAREHOUSE, code: "WFS2", name: "مستودع موقع ثانٍ", type: "SITE", branchId: "BR-MAIN", projectId: PROJECT, custodianUserId: "USER-ADMIN" }),
      await admin("POST", "/contracting/site/consumptions", {
        id: "WF-CON-MAIN",
        date: TODAY,
        warehouseId: OTHER_SITE_WAREHOUSE,
        boqLineId: one<{ b: string }>("SELECT boq_line_id AS b FROM material_consumption WHERE id = 'CON-DEMO-1'")!.b,
        lines: [{ itemId: "ITEM-DEMO-2", qty: "1" }],
      }),
      await admin("POST", "/contracting/site/issues", { id: "WF-ISS-MAIN", date: TODAY, fromWarehouseId: MAIN_WAREHOUSE, toWarehouseId: OTHER_SITE_WAREHOUSE, lines: [{ itemId: "ITEM-DEMO-3", qty: "2" }] }),
      await admin("POST", "/contracting/site/custody", { id: "WF-CUSTODY-MAIN", warehouseId: OTHER_SITE_WAREHOUSE, descriptionAr: "سقالات", qtyOut: "10", issuedDate: TODAY }),
    ];
    for (const res of created) expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  });

  it.each([
    ["a material consumption", "/contracting/site/consumptions/WF-CON-MAIN/confirm", {}],
    ["a site issue", "/contracting/site/issues/WF-ISS-MAIN/confirm", {}],
    ["a custody return", "/contracting/site/custody/WF-CUSTODY-MAIN/return", { qty: "1", date: TODAY }],
  ])("%s on another store is not there for the tower site's keeper, and no stock moves", async (_label, path, body) => {
    const before = movements();
    const res = await siteKeeperOnly("POST", path, body);
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(404);
    expect(res.body?.error).toBe("NOT_FOUND");
    expect(res.body?.message).toMatch(ARABIC);
    expect(movements()).toBe(before);
  });

  it("the draft documents are still drafts", () => {
    expect(one<{ status: string }>("SELECT status FROM material_consumption WHERE id = 'WF-CON-MAIN'")?.status).toBe("draft");
    expect(one<{ status: string }>("SELECT status FROM site_issue WHERE id = 'WF-ISS-MAIN'")?.status).toBe("draft");
    expect(one<{ q: number }>("SELECT qty_returned AS q FROM site_custody WHERE id = 'WF-CUSTODY-MAIN'")?.q).toBe(0);
  });

  it("the keeper of the store the goods leave issues them; the site's keeper signs for them, and not the other way round", async () => {
    const beforeIssue = movements();
    const receivingEnd = await otherSiteKeeperOnly("POST", "/contracting/site/issues/WF-ISS-MAIN/confirm", {});
    expect(receivingEnd.status, JSON.stringify(receivingEnd.body).slice(0, 200)).toBe(404);
    expect(movements()).toBe(beforeIssue);
    expect((await mainKeeperOnly("POST", "/contracting/site/issues/WF-ISS-MAIN/confirm", {})).status).toBe(200);
    const receipt = await otherSiteKeeperOnly("POST", "/contracting/site/receipts", { id: "WF-SRC-1", issueId: "WF-ISS-MAIN", date: TODAY, lines: [{ itemId: "ITEM-DEMO-3", qtyReceived: "2" }] });
    expect(receipt.status, JSON.stringify(receipt.body).slice(0, 300)).toBe(201);
    const before = movements();
    const wrongEnd = await mainKeeperOnly("POST", "/contracting/site/receipts/WF-SRC-1/confirm", {});
    expect(wrongEnd.status, JSON.stringify(wrongEnd.body).slice(0, 200)).toBe(404);
    expect(movements()).toBe(before);
    expect((await otherSiteKeeperOnly("GET", "/contracting/site/issues/WF-ISS-MAIN")).status).toBe(200);
    expect((await siteKeeperOnly("GET", "/contracting/site/issues/WF-ISS-MAIN")).status).toBe(404);
    const signed = await otherSiteKeeperOnly("POST", "/contracting/site/receipts/WF-SRC-1/confirm", {});
    expect(signed.status, JSON.stringify(signed.body).slice(0, 200)).toBe(200);
  });
});

describe("a warehouse an unposted document stands on cannot be moved to another branch", () => {
  const WAREHOUSE = "WF-WH-USE";
  const use = () => createWarehouseUse(sqlite)(WAREHOUSE);
  const count = (id: string, status: string) =>
    sqlite
      .prepare("INSERT INTO physical_count (id, count_no, warehouse_id, date, memo, status, blind, lines_json, created_at) VALUES (?, ?, ?, ?, '', ?, 0, '[]', ?)")
      .run(id, id, WAREHOUSE, TODAY, status, TODAY);
  const clear = () => {
    for (const table of ["physical_count", "material_consumption", "site_issue", "site_custody"]) sqlite.prepare(`DELETE FROM "${table}" WHERE id LIKE 'WF-USE-%'`).run();
  };

  beforeAll(async () => {
    const warehouse = await admin("POST", "/warehouses", { id: WAREHOUSE, code: "WFU", name: "مستودع الاختبار", type: "MAIN", branchId: "BR-ALEX" });
    expect(warehouse.status, JSON.stringify(warehouse.body)).toBe(201);
  });

  it("an empty warehouse reads as unused", () => {
    expect(use()).toEqual({ holdsStock: false, openDocuments: 0 });
  });

  it.each([
    ["a count in progress", () => count("WF-USE-PC-1", "IN_PROGRESS")],
    ["a completed count whose adjustment is not yet generated", () => count("WF-USE-PC-2", "COMPLETED")],
    [
      "a draft material consumption",
      () =>
        sqlite
          .prepare("INSERT INTO material_consumption (id, date, warehouse_id, project_id, status, lines_json, total_cost, created_at) VALUES ('WF-USE-CON', ?, ?, ?, 'draft', '[]', 0, ?)")
          .run(TODAY, WAREHOUSE, PROJECT, TODAY),
    ],
    [
      "a site issue still in transit to it",
      () =>
        sqlite
          .prepare(
            "INSERT INTO site_issue (id, date, from_warehouse_id, to_warehouse_id, project_id, issued_by_user_id, status, lines_json, created_at) VALUES ('WF-USE-ISS', ?, ?, ?, ?, 'USER-ADMIN', 'issued', '[]', ?)",
          )
          .run(TODAY, MAIN_WAREHOUSE, WAREHOUSE, PROJECT, TODAY),
    ],
    [
      "custody not yet returned",
      () =>
        sqlite
          .prepare("INSERT INTO site_custody (id, project_id, warehouse_id, custodian_user_id, description_ar, qty_out, qty_returned, issued_date) VALUES ('WF-USE-CUS', ?, ?, 'USER-ADMIN', 'شدة', 5000000, 0, ?)")
          .run(PROJECT, WAREHOUSE, TODAY),
    ],
  ])("%s holds it", async (_label, plant) => {
    clear();
    plant();
    expect(use().openDocuments).toBe(1);
    const current = (await admin("GET", `/warehouses/${WAREHOUSE}`)).body;
    const res = await admin("PUT", `/warehouses/${WAREHOUSE}`, { ...current, branchId: "BR-MAIN" });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(409);
    expect(res.body?.error).toBe("WAREHOUSE_IN_USE");
    expect(res.body?.message).toMatch(ARABIC);
    expect(one<{ b: string }>("SELECT branch_id AS b FROM warehouse WHERE id = ?", WAREHOUSE)?.b).toBe("BR-ALEX");
  });

  it.each([
    ["a count whose adjustment was generated", () => count("WF-USE-PC-3", "ADJUSTMENT_GENERATED")],
    ["a cancelled count", () => count("WF-USE-PC-4", "CANCELLED")],
  ])("%s does not", (_label, plant) => {
    clear();
    plant();
    expect(use().openDocuments).toBe(0);
  });

  it("a status nobody has classified counts as open", () => {
    clear();
    count("WF-USE-PC-5", "SOME_FUTURE_STATUS");
    expect(use().openDocuments).toBe(1);
    clear();
  });
});

describe("a van rep granted only the van's own store works the trip", () => {
  const VAN_WAREHOUSE = "WH-DEMO-VAN";
  let vanRep: Caller;
  let stranger: Caller;
  let tripId: string;

  beforeAll(() => {
    const session = (userId: string, warehouseScope: string[]) =>
      callerFor(handle.sessions.issue({ userId, permissions: [...ALL_PERMISSION_CODES], roleCode: null, branchScope: ALL_SCOPE, warehouseScope }));
    vanRep = session("USER-WF-VAN-REP", [VAN_WAREHOUSE]);
    stranger = session("USER-WF-STRANGER", ["WH-ALEX"]);
    tripId = one<{ id: string }>("SELECT id FROM van_trip WHERE status = 'ongoing' AND van_warehouse_id = ? LIMIT 1", VAN_WAREHOUSE)!.id;
    expect(one<{ w: string }>("SELECT source_warehouse_id AS w FROM van_trip WHERE id = ?", tripId)!.w).toBe(MAIN_WAREHOUSE);
  });

  it("reads its trip and records a cash sale on it", async () => {
    expect((await vanRep("GET", `/field/van-trips/${tripId}`)).status).toBe(200);
    const res = await vanRep("POST", `/field/van-trips/${tripId}/cash-movements`, { id: "WF-VAN-CASH-1", kind: "sale", amount: "75.00", occurredAt: new Date().toISOString() });
    expect([200, 201], JSON.stringify(res.body).slice(0, 300)).toContain(res.status);
  });

  it("cannot open a trip that loads from a store outside its grant", async () => {
    const before = one<{ n: number }>("SELECT count(*) AS n FROM van_trip")!.n;
    const moved = movements();
    const res = await vanRep("POST", "/field/van-trips", {
      id: "WF-VAN-TRIP-NEW",
      date: TODAY,
      vanId: "VAN-DEMO-1",
      sourceWarehouseId: MAIN_WAREHOUSE,
      sourceTreasuryAccountId: "TR-DEMO-CASH",
      crew: [{ employeeId: "EMP-DEMO-2", role: "rep" }],
      loadedStock: [{ itemId: "ITEM-DEMO-4", qty: "1" }],
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(403);
    expect(res.body?.error).toBe("WAREHOUSE_OUT_OF_SCOPE");
    expect(res.body?.message).toMatch(ARABIC);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM van_trip")!.n).toBe(before);
    expect(movements()).toBe(moved);
  });

  it("a session holding neither of the trip's stores finds no trip there", async () => {
    expect((await stranger("GET", `/field/van-trips/${tripId}`)).status).toBe(404);
    const res = await stranger("POST", `/field/van-trips/${tripId}/cash-movements`, { id: "WF-VAN-CASH-X", kind: "sale", amount: "1.00", occurredAt: new Date().toISOString() });
    expect(res.status).toBe(404);
  });

  it("the keeper of the store it loaded from cannot settle the van's trip for it", async () => {
    const res = await mainKeeperOnly("POST", `/field/van-trips/${tripId}/settle`, { countedCash: "0", stockCounts: [] });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(404);
    expect(one<{ status: string }>("SELECT status FROM van_trip WHERE id = ?", tripId)!.status).toBe("ongoing");
  });

  it("settles its trip", async () => {
    const loaded = (JSON.parse(one<{ l: string }>("SELECT loaded_stock AS l FROM van_trip WHERE id = ?", tripId)?.l ?? "[]") as { itemId: string; qty: string }[]) ?? [];
    const res = await vanRep("POST", `/field/van-trips/${tripId}/settle`, { countedCash: "1575.00", stockCounts: loaded.map((line) => ({ itemId: line.itemId, countedQty: String(line.qty) })) });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(one<{ status: string }>("SELECT status FROM van_trip WHERE id = ?", tripId)!.status).toBe("settled");
  });
});
