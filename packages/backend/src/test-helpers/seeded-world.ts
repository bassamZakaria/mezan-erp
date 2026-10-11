import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ALL_SCOPE, MODULE_CATALOG, createEntitlements } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createBackend, type BackendHandle, type CreateBackendOptions } from "../create-backend.js";

type Sqlite = ReturnType<typeof openSqliteConnection>["sqlite"];

export interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface SeededWorld {
  readonly backend: BackendHandle;
  readonly sqlite: Sqlite;
  request(method: string, url: string, body?: unknown): Promise<Answer>;
  invariants(): Promise<Record<"tb" | "inventory" | "ar" | "ap", string>>;
  balance(accountId: string, asOfDate?: string): bigint;
  count(table: string, where?: string): number;
  close(): void;
}

export const INVARIANTS_ZERO = { tb: "0", inventory: "0.000000", ar: "0.000000", ap: "0.000000" } as const;

export async function seededWorld(options: Partial<CreateBackendOptions> = {}): Promise<SeededWorld> {
  const dir = mkdtempSync(path.join(tmpdir(), "mezan-world-"));
  const dbPath = path.join(dir, "books.db");
  const backend = await createBackend({
    dbPath,
    seedDemoData: true,
    resolveEntitlements: () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null }),
    ...options,
  });
  const sqlite = openSqliteConnection(dbPath).sqlite;
  const token = backend.sessions.issue({ userId: "admin", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  async function request(method: string, url: string, body?: unknown): Promise<Answer> {
    const res = await backend.app.fetch(new Request(`http://local${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) as Record<string, unknown> };
    } catch {
      return { status: res.status, body: { text } };
    }
  }

  return {
    backend,
    sqlite,
    request,
    async invariants() {
      const recon = (await request("GET", "/reconciliation")).body as { rows: { key: string; difference: string }[] };
      const diff = (key: string): string => recon.rows.find((r) => r.key === key)?.difference ?? "missing";
      const tb = sqlite
        .prepare(`SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS net FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id WHERE je.status IN ('posted', 'reversed')`)
        .safeIntegers()
        .get() as { net: bigint };
      return { tb: tb.net.toString(), inventory: diff("inventory"), ar: diff("ar"), ap: diff("ap") };
    },
    balance(accountId, asOfDate = "9999-12-31") {
      const row = sqlite
        .prepare(
          `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS net FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id
            WHERE jl.account_id = ? AND je.status IN ('posted', 'reversed') AND substr(je.date, 1, 10) <= ?`,
        )
        .safeIntegers()
        .get(accountId, asOfDate) as { net: bigint };
      return row.net;
    },
    count(table, where = "1 = 1") {
      return (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
    },
    close() {
      sqlite.close();
      backend.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
