import { describe, it, expect, afterEach } from "vitest";
import { createApp } from "./app.js";
import { createSqliteUnitOfWork, type SqliteUnitOfWorkHandle } from "@mezan/persistence";
import { createAuthContext, ALL_SCOPE } from "@mezan/domain";

const handles: SqliteUnitOfWorkHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp(permissions: string[] = ["*"]) {
  const uow = createSqliteUnitOfWork(":memory:");
  handles.push(uow);
  const ctx = createAuthContext({ userId: "u1", permissions, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  return createApp(uow, { resolveAuthContext: () => ctx });
}

async function json(res: Response) {
  return res.json();
}

describe("roles routes", () => {
  it("creates then lists a role", async () => {
    const app = newApp();
    const createRes = await app.fetch(
      new Request("http://x/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "VAN_SALES",
          name: "مندوب مبيعات",
          description: "",
          // Already dependency-closed, as the role editor's `togglePermission`
          // would produce client-side (server stores the raw set verbatim).
          permissions: ["sales.invoice.view_own", "field.van_trip.view_own", "field.van_trip.open"],
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await json(createRes)) as { id: string; permissions: string[] };
    expect(created.permissions).toContain("field.van_trip.view_own");

    const listRes = await app.fetch(new Request("http://x/roles"));
    const roles = (await json(listRes)) as unknown[];
    expect(roles).toHaveLength(1);

    const getRes = await app.fetch(new Request(`http://x/roles/${created.id}`));
    expect(getRes.status).toBe(200);
  });

  it("rejects an unknown permission with 400", async () => {
    const app = newApp();
    const res = await app.fetch(
      new Request("http://x/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "X", name: "x", permissions: ["not.real"] }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)) as { error: string }).toMatchObject({ error: "UNKNOWN_PERMISSION" });
  });

  it("rejects a permission from an unlicensed module with 400", async () => {
    const uow = createSqliteUnitOfWork(":memory:");
    handles.push(uow);
    const ctx = createAuthContext({ userId: "u1", permissions: ["*"], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const app = createApp(uow, {
      resolveAuthContext: () => ctx,
      resolveEntitlements: () => ({ plan: "STANDARD", activeModules: ["sales"], features: {}, seats: 1, expiresAt: null }),
    });
    const res = await app.fetch(
      new Request("http://x/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // A paid HR part; the free staff list (hr.employee.view) is grantable on every plan.
        body: JSON.stringify({ code: "X", name: "x", permissions: ["hr.payroll.view"] }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)) as { error: string }).toMatchObject({ error: "UNLICENSED_PERMISSION" });
  });

  it("rejects a duplicate role code with 409", async () => {
    const app = newApp();
    const body = JSON.stringify({ code: "VAN_SALES", name: "أ", permissions: [] });
    await app.fetch(new Request("http://x/roles", { method: "POST", headers: { "content-type": "application/json" }, body }));
    const res = await app.fetch(new Request("http://x/roles", { method: "POST", headers: { "content-type": "application/json" }, body }));
    expect(res.status).toBe(409);
  });

  it("denies role creation without admin.roles.manage", async () => {
    const app = newApp(["admin.roles.view"]);
    const res = await app.fetch(
      new Request("http://x/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "X", name: "x", permissions: [] }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("deletes a role", async () => {
    const app = newApp();
    const createRes = await app.fetch(
      new Request("http://x/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "X", name: "x", permissions: [] }),
      }),
    );
    const created = (await json(createRes)) as { id: string };
    const delRes = await app.fetch(new Request(`http://x/roles/${created.id}`, { method: "DELETE" }));
    expect(delRes.status).toBe(204);
    const getRes = await app.fetch(new Request(`http://x/roles/${created.id}`));
    expect(getRes.status).toBe(404);
  });
});
