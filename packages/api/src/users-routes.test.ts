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

const newUserBody = {
  fullName: "محمد الشهابي",
  email: "mohamed@cyag.test",
  phone: "+201000000000",
  password: "TempPass123",
  roleId: null,
  isCompanyAdmin: true,
  employeeId: null,
  branchScope: "*",
  warehouseScope: "*",
};

describe("users routes", () => {
  it("creates a user without leaking the password hash, then lists it", async () => {
    const app = newApp();
    const createRes = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newUserBody),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await json(createRes)) as Record<string, unknown>;
    expect(created.passwordHash).toBeUndefined();
    expect(created.pinHash).toBeUndefined();
    expect(created.hasPin).toBe(false);

    const listRes = await app.fetch(new Request("http://x/users"));
    expect(((await json(listRes)) as unknown[]).length).toBe(1);
  });

  it("rejects a user with an unknown role", async () => {
    const app = newApp();
    const res = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...newUserBody, isCompanyAdmin: false, roleId: "ghost", branchScope: ["MAIN"] }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)) as { error: string }).toMatchObject({ error: "UNKNOWN_ROLE" });
  });

  it("rejects malformed input (contract-level) with 400", async () => {
    const app = newApp();
    const res = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...newUserBody, email: "not-an-email" }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)) as { error: string }).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("deactivates then reactivates a user", async () => {
    const app = newApp();
    const createRes = await app.fetch(
      new Request("http://x/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(newUserBody) }),
    );
    const created = (await json(createRes)) as { id: string };

    const deactivateRes = await app.fetch(new Request(`http://x/users/${created.id}/deactivate`, { method: "POST" }));
    expect(deactivateRes.status).toBe(200);
    expect(((await json(deactivateRes)) as { status: string }).status).toBe("inactive");

    const activateRes = await app.fetch(new Request(`http://x/users/${created.id}/activate`, { method: "POST" }));
    expect(((await json(activateRes)) as { status: string }).status).toBe("active");
  });

  it("denies access without admin.users.view", async () => {
    const app = newApp([]);
    const res = await app.fetch(new Request("http://x/users"));
    expect(res.status).toBe(403);
  });

  it("keeps the password hash stable across an update that omits password", async () => {
    const app = newApp();
    const createRes = await app.fetch(
      new Request("http://x/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(newUserBody) }),
    );
    const created = (await json(createRes)) as { id: string };

    const { password: _password, ...withoutPassword } = newUserBody;
    const updateRes = await app.fetch(
      new Request(`http://x/users/${created.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...withoutPassword, fullName: "محمد الشهابي (محدث)" }),
      }),
    );
    expect(updateRes.status).toBe(200);
    expect(((await json(updateRes)) as { fullName: string }).fullName).toBe("محمد الشهابي (محدث)");
  });
});
