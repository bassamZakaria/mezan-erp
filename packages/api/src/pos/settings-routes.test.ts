import { describe, it, expect, afterEach } from "vitest";
import { createSqlitePosStore, openSqliteConnection, withSqliteTransaction } from "@mezan/persistence";
import type { AuditSink } from "@mezan/domain";
import { createPosSettingsRoutes, type PosSettingsRoutesDeps } from "./settings-routes.js";
import { insecureHeaderAuthContextResolver } from "../permission-gate.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

const FAILING_AUDIT: AuditSink = {
  async append() {
    throw new Error("audit sink is down");
  },
  async query() {
    return [];
  },
};

function newApp(audit: AuditSink, withTransactor: boolean) {
  const { sqlite } = openSqliteConnection(":memory:");
  const store = createSqlitePosStore(sqlite);
  closers.push(store, { close: () => sqlite.close() });
  const deps: PosSettingsRoutesDeps = {
    settings: store.settings,
    ensureWalkInCustomer: async () => "walk-in",
    audit,
    ...(withTransactor ? { transactor: { run: <T,>(fn: () => Promise<T>) => withSqliteTransaction(sqlite, fn) } } : {}),
  };
  return { app: createPosSettingsRoutes(deps, insecureHeaderAuthContextResolver), settings: store.settings };
}

function put(body: unknown) {
  return new Request("http://local/", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-permissions": "pos.settings.edit" },
    body: JSON.stringify(body),
  });
}

describe("POS settings — the audit row rides in the config write's transaction (D298)", () => {
  it("without a transactor the setting persists even though the audit append failed", async () => {
    const { app, settings } = newApp(FAILING_AUDIT, false);
    expect((await settings.get()).allowArCollection).toBe(true);
    const res = await app.fetch(put({ allowArCollection: false }));
    expect(res.status).toBe(500);
    expect((await settings.get()).allowArCollection).toBe(false);
  });

  it("with a transactor the setting rolls back with the audit row", async () => {
    const { app, settings } = newApp(FAILING_AUDIT, true);
    expect((await settings.get()).allowArCollection).toBe(true);
    const res = await app.fetch(put({ allowArCollection: false }));
    expect(res.status).toBe(500);
    expect((await settings.get()).allowArCollection).toBe(true);
  });

  it("a healthy audit still commits the change", async () => {
    const events: unknown[] = [];
    const audit: AuditSink = {
      async append(event) {
        events.push(event);
      },
      async query() {
        return [];
      },
    };
    const { app, settings } = newApp(audit, true);
    const res = await app.fetch(put({ receiptScreenSeconds: 9 }));
    expect(res.status).toBe(200);
    expect((await settings.get()).receiptScreenSeconds).toBe(9);
    expect(events).toHaveLength(1);
  });
});
