import { afterEach, describe, expect, it } from "vitest";
import { PasswordChangeRefusal } from "@mezan/contracts";
import { ALL_SCOPE } from "@mezan/domain";
import { createSqliteUnitOfWork, type SqliteUnitOfWorkHandle } from "@mezan/persistence";
import { createApp } from "./app.js";
import { createSessionAuthContextResolver, createSessionRegistry } from "./session-auth.js";

const handles: SqliteUnitOfWorkHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function composed() {
  const uow = createSqliteUnitOfWork(":memory:");
  handles.push(uow);
  const sessions = createSessionRegistry();
  const app = createApp(uow, { resolveAuthContext: createSessionAuthContextResolver(sessions), security: { sessions } });
  return { app, sessions };
}

const grant = { userId: "u-1", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE };
const get = (app: ReturnType<typeof createApp>, path: string, token: string) =>
  app.fetch(new Request(`http://local${path}`, { headers: { authorization: `Bearer ${token}` } }));

describe("the temporary-password gate as createApp mounts it", () => {
  it("refuses a flagged session on a real route even when its grant would allow it", async () => {
    const { app, sessions } = composed();
    const token = await sessions.issue({ ...grant, mustChangePassword: true });

    for (const path of ["/users", "/roles"]) {
      const res = await get(app, path, token);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe(PasswordChangeRefusal.Required);
    }
    expect((await get(app, "/profile", token)).status).not.toBe(403);
  });

  it("serves the same routes to an unflagged session", async () => {
    const { app, sessions } = composed();
    const token = await sessions.issue(grant);

    for (const path of ["/users", "/roles"]) expect((await get(app, path, token)).status).toBe(200);
  });
});
