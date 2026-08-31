import { describe, it, expect, afterEach } from "vitest";
import { createSqliteNotificationStore, type SqliteNotificationStoreHandle } from "@mezan/persistence";
import { createNotificationsRoutes } from "./notifications-routes.js";

const handles: SqliteNotificationStoreHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteNotificationStore();
  handles.push(repo);
  const app = createNotificationsRoutes(repo);
  return { app, repo };
}

function req(path: string, userId: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-user-id", userId);
  return new Request(`http://local${path}`, { ...init, headers });
}

describe("GET / rejects a query the wire contract does not allow", () => {
  it("400s on a status value outside unread/read", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/?status=archived", "u-1"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("400s on a limit above the wire contract's ceiling of 200", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/?limit=201", "u-1"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("400s on a non-positive limit", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/?limit=0", "u-1"));
    expect(res.status).toBe(400);
  });

  it("400s on a limit that is not an integer", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/?limit=abc", "u-1"));
    expect(res.status).toBe(400);
  });
});
