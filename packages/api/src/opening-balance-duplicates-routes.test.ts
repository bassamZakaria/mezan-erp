import { describe, it, expect, afterEach } from "vitest";
import { openSqliteConnection, withSqliteTransaction } from "@mezan/persistence";
import type { AuditSink, OpeningBalanceDuplicatesContext } from "@mezan/domain";
import {
  createOpeningBalanceDuplicatesRoutes,
  type OpeningBalanceDuplicatesRoutesDeps,
} from "./opening-balance-duplicates-routes.js";
import { insecureHeaderAuthContextResolver } from "./permission-gate.js";

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

/**
 * Stands in for `repairOpeningBalanceDuplicate`, whose reversing journal entry
 * is a write on this same connection. What matters here is only that the
 * repair's writes and the audit row share one boundary.
 */
function newApp(audit: AuditSink, withTransactor: boolean) {
  const { sqlite } = openSqliteConnection(":memory:");
  sqlite.exec(`CREATE TABLE reversal (party_id TEXT PRIMARY KEY)`);
  closers.push({ close: () => sqlite.close() });
  const deps: OpeningBalanceDuplicatesRoutesDeps = {
    resolveContext: async () => ({}) as OpeningBalanceDuplicatesContext,
    repair: async (_kind, partyId) => {
      if (partyId === "missing") return null;
      sqlite.prepare(`INSERT INTO reversal (party_id) VALUES (?)`).run(partyId);
      return true;
    },
    audit,
    ...(withTransactor ? { transactor: { run: <T,>(fn: () => Promise<T>) => withSqliteTransaction(sqlite, fn) } } : {}),
  };
  const app = createOpeningBalanceDuplicatesRoutes(deps, insecureHeaderAuthContextResolver);
  const reversals = () => (sqlite.prepare(`SELECT COUNT(*) AS c FROM reversal`).get() as { c: number }).c;
  return { app, reversals };
}

function repairRequest(partyId = "cust-1") {
  return new Request(`http://local/customer/${partyId}/repair`, {
    method: "POST",
    headers: { "x-permissions": "accounting.journal.post" },
  });
}

describe("opening-balance duplicates repair — the audit row rides in the reversal's transaction (D298)", () => {
  it("without a transactor the reversal persists even though the audit append failed", async () => {
    const { app, reversals } = newApp(FAILING_AUDIT, false);
    const res = await app.fetch(repairRequest());
    expect(res.status).toBe(500);
    expect(reversals()).toBe(1);
  });

  it("with a transactor the reversal rolls back with the audit row", async () => {
    const { app, reversals } = newApp(FAILING_AUDIT, true);
    const res = await app.fetch(repairRequest());
    expect(res.status).toBe(500);
    expect(reversals()).toBe(0);
  });

  it("a healthy audit still commits the reversal, and an unknown party is still a 404 that writes nothing", async () => {
    const events: unknown[] = [];
    const audit: AuditSink = {
      async append(event) {
        events.push(event);
      },
      async query() {
        return [];
      },
    };
    const { app, reversals } = newApp(audit, true);
    expect((await app.fetch(repairRequest())).status).toBe(200);
    expect(reversals()).toBe(1);
    expect(events).toHaveLength(1);

    expect((await app.fetch(repairRequest("missing"))).status).toBe(404);
    expect(reversals()).toBe(1);
    expect(events).toHaveLength(1);
  });
});
