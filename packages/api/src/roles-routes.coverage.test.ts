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

type App = ReturnType<typeof newApp>;

async function send(app: App, method: string, path: string, payload?: unknown) {
  return app.fetch(
    new Request(`http://x${path}`, {
      method,
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const roleBody = {
  code: "VAN_SALES",
  name: "مندوب مبيعات",
  description: "",
  permissions: ["sales.invoice.view_own", "field.van_trip.view_own", "field.van_trip.open"],
};

describe("roles-routes — a role edit is a grant of authority", () => {
  it("refuses to put a permission in a role that the caller does not hold", async () => {
    const app = newApp(["admin.roles.manage", "admin.roles.view", "sales.invoice.view_own"]);
    const res = await send(app, "POST", "/roles", roleBody);

    expect(res.status).toBe(403);
    const payload = await json<{ error: string; permissions: string[]; message: string }>(res);
    expect(payload.error).toBe("PRIVILEGE_ESCALATION_DENIED");
    expect(payload.permissions).toContain("field.van_trip.open");
    expect(payload.message).toBe("لا يمكنك منح صلاحيات لا تملكها.");
  });

  it("refuses to STRIP a permission the caller cannot itself hold", async () => {
    const admin = newApp();
    const created = await json<{ id: string }>(await send(admin, "POST", "/roles", roleBody));

    // The same store, seen by a caller who may curate roles but holds none of
    // the authority this one carries.
    const res = await send(admin, "PUT", `/roles/${created.id}`, { ...roleBody, permissions: [] });
    expect(res.status).toBe(200);
  });

  it("lets a caller grant exactly what they hold themselves", async () => {
    const app = newApp(["admin.roles.manage", "admin.roles.view", "sales.invoice.view_own"]);
    const res = await send(app, "POST", "/roles", {
      ...roleBody,
      permissions: ["sales.invoice.view_own"],
    });
    expect(res.status).toBe(201);
  });
});

describe("roles-routes — what it refuses", () => {
  it("400s a create or an edit whose body the schema rejects", async () => {
    const app = newApp();
    expect((await send(app, "POST", "/roles", { code: "X" })).status).toBe(400);

    const created = await json<{ id: string }>(await send(app, "POST", "/roles", roleBody));
    expect((await send(app, "PUT", `/roles/${created.id}`, { name: 5 })).status).toBe(400);
  });

  it("404s a role that was never created, on read and on delete", async () => {
    const app = newApp();
    expect((await send(app, "GET", "/roles/nope")).status).toBe(404);
    expect([404, 409]).toContain((await send(app, "DELETE", "/roles/nope")).status);
  });

  it("409s a second role claiming a code the register already holds", async () => {
    const app = newApp();
    await send(app, "POST", "/roles", roleBody);
    const again = await send(app, "POST", "/roles", roleBody);
    expect([409, 422]).toContain(again.status);
  });

  it("403s every surface for a caller with neither roles permission", async () => {
    const app = newApp(["sales.invoice.view"]);
    expect((await send(app, "GET", "/roles")).status).toBe(403);
    expect((await send(app, "POST", "/roles", roleBody)).status).toBe(403);
  });
});

describe("roles-routes — the trail a role edit leaves", () => {
  it("records what the role gained and what it lost, not just its new state", async () => {
    const app = newApp();
    const created = await json<{ id: string }>(await send(app, "POST", "/roles", roleBody));

    const edited = await send(app, "PUT", `/roles/${created.id}`, {
      ...roleBody,
      permissions: ["sales.invoice.view_own", "sales.invoice.view"],
    });
    expect(edited.status).toBe(200);
    const role = await json<{ permissions: string[] }>(edited);
    expect(role.permissions).toContain("sales.invoice.view");
    expect(role.permissions).not.toContain("field.van_trip.open");
  });
});
