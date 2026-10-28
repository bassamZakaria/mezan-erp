import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE, MODULE_CATALOG, createEntitlements } from "@mezan/domain";
import { createBackend, type BackendHandle } from "./create-backend.js";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld | undefined;
let restarted: BackendHandle | undefined;

afterEach(() => {
  restarted?.close();
  world?.close();
  restarted = undefined;
  world = undefined;
});

type Request = (method: string, url: string, body?: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;

async function restart(): Promise<Request> {
  restarted?.close();
  restarted = await createBackend({
    dbPath: world!.sqlite.name,
    seedDemoData: true,
    resolveEntitlements: () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null }),
  });
  const backend = restarted;
  const token = await backend.sessions.issue({ userId: "admin", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  return async (method, url, body) => {
    const res = await backend.app.fetch(new Request(`http://local${url}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
}

const ledgerAccount = (id: string) =>
  world!.sqlite.prepare(`SELECT code, name_ar AS nameAr, type, parent_id AS parentId, is_header AS isHeader FROM account WHERE id = ?`).get(id) as
    | { code: string; nameAr: string; type: string; parentId: string; isHeader: number }
    | undefined;

describe("#120 — a treasury account left without a ledger account gets one of its own", () => {
  it("opens a leaf under cash and bank on create, named after the drawer, and the opening balance then posts to it", async () => {
    world = await seededWorld();
    const created = await world.request("POST", "/treasury-accounts", { id: "TR-AUTO", code: "CASH-AUTO", name: "خزينة فرعية", type: "cash", currency: "EGP", branchId: "BR-MAIN" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const glAccountId = created.body.glAccountId as string;
    expect(glAccountId).toMatch(/^1300-\d+$/);
    expect(ledgerAccount(glAccountId)).toMatchObject({ code: glAccountId, nameAr: "خزينة فرعية", type: "asset", parentId: "1300", isHeader: 0 });
    expect(world.count("audit_event", `module = 'accounting' AND entity_type = 'ACCOUNT' AND entity_id = '${glAccountId}' AND action = 'CREATE' AND actor = 'admin'`)).toBe(1);

    const before = (await world.request("GET", "/treasury-accounts/stats")).body as { liveCash: string };
    const posted = await world.request("POST", "/gl/journal-entries", {
      id: "TRO-TR-AUTO-2026-08-15",
      date: "2026-08-15",
      memo: "رصيد افتتاحي للخزنة — خزينة فرعية",
      lines: [
        { accountId: glAccountId, debit: "500.00", credit: "0.00" },
        { accountId: "3210", debit: "0.00", credit: "500.00" },
      ],
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    const after = (await world.request("GET", "/treasury-accounts/stats")).body as { liveCash: string };
    expect(BigInt(after.liveCash.replace(".", "")) - BigInt(before.liveCash.replace(".", ""))).toBe(500_000_000n);
  });

  it("keeps the ledger account the user chose and opens none", async () => {
    world = await seededWorld();
    const accountsBefore = world.count("account");
    const created = await world.request("POST", "/treasury-accounts", { id: "TR-CHOSEN", code: "CASH-CHOSEN", name: "عهدة", type: "cash", currency: "EGP", branchId: "BR-MAIN", glAccountId: "1300-2" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.glAccountId).toBe("1300-2");
    expect(world.count("account")).toBe(accountsBefore);
  });

  it("links an account saved before the fix at the next start, once", async () => {
    world = await seededWorld();
    world.backend.close();
    world.sqlite.prepare(`UPDATE treasury_account SET gl_account_id = NULL WHERE id = 'TR-DEMO-VAN'`).run();
    const accountsBefore = world.count("account");

    const request = await restart();
    const linked = (await request("GET", "/treasury-accounts/TR-DEMO-VAN")).body as { glAccountId: string | null; name: string };
    expect(linked.glAccountId).toMatch(/^1300-\d+$/);
    expect(ledgerAccount(linked.glAccountId!)).toMatchObject({ nameAr: linked.name, parentId: "1300", isHeader: 0 });
    expect(world.count("account")).toBe(accountsBefore + 1);
    expect(world.count("audit_event", `entity_type = 'ACCOUNT' AND entity_id = '${linked.glAccountId}' AND action = 'CREATE' AND actor = 'system'`)).toBe(1);
    expect(world.count("audit_event", `entity_type = 'TREASURY_ACCOUNT' AND entity_id = 'TR-DEMO-VAN' AND action = 'UPDATE' AND actor = 'system'`)).toBe(1);

    const again = await restart();
    expect(((await again("GET", "/treasury-accounts/TR-DEMO-VAN")).body as { glAccountId: string }).glAccountId).toBe(linked.glAccountId);
    expect(world.count("account")).toBe(accountsBefore + 1);
  });

  it("refuses clearing a linked account's ledger account with a 422 in Arabic, and opens no new leaf", async () => {
    world = await seededWorld();
    const created = await world.request("POST", "/treasury-accounts", { id: "TR-KEEP", code: "CASH-KEEP", name: "خزينة ثابتة", type: "cash", currency: "EGP", branchId: "BR-MAIN" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const accountsBefore = world.count("account");

    const refused = await world.request("PATCH", "/treasury-accounts/TR-KEEP", { glAccountId: null });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.error).toBe("TREASURY_LEDGER_ACCOUNT_REQUIRED");
    expect(refused.body.message).toMatch(/لا يمكن فك ربط حساب الخزينة/);
    expect(world.count("account")).toBe(accountsBefore);
    expect((await world.request("GET", "/treasury-accounts/TR-KEEP")).body.glAccountId).toBe(created.body.glAccountId);
  });

  it("links an unlinked account on its next save, audits the new leaf, and opens nothing when the save is refused", async () => {
    world = await seededWorld();
    world.sqlite.prepare(`UPDATE treasury_account SET gl_account_id = NULL WHERE id = 'TR-DEMO-VAN'`).run();
    const accountsBefore = world.count("account");

    const refused = await world.request("PATCH", "/treasury-accounts/TR-DEMO-VAN", { openingBalance: "-1.00" });
    expect(refused.status).toBe(422);
    expect(world.count("account")).toBe(accountsBefore);

    const saved = await world.request("PATCH", "/treasury-accounts/TR-DEMO-VAN", { name: "خزينة الڤان" });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const glAccountId = saved.body.glAccountId as string;
    expect(glAccountId).toMatch(/^1300-\d+$/);
    expect(world.count("account")).toBe(accountsBefore + 1);
    expect(world.count("audit_event", `entity_type = 'ACCOUNT' AND entity_id = '${glAccountId}' AND action = 'CREATE'`)).toBe(1);
  });
});
