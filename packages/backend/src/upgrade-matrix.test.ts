import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, MODULE_CATALOG, createEntitlements } from "@mezan/domain";
import { bindTenantDatabase, CURRENT_SCHEMA_VERSION, SchemaUpgradeFailedError, TenantBindingMismatchError, openSqliteConnection } from "@mezan/persistence";
import { createBackend, type BackendHandle } from "./create-backend.js";

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test-fixtures/upgrade-matrix");
const FIXTURES = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith(".db.gz"))
  .map((name) => name.slice(0, -".db.gz".length))
  .sort();

const STAMPED_WITH_THE_CONFIRM_CLOCK = ["LC-DEMO-1", "PRET-DEMO-1", "PRT-DEMO-1", "SRET-DEMO-1", "SRET-DEMO-2", "SRT-DEMO-1"];
// INVARIANT: the stock ledger is append-only, so a movement an earlier build dated by the confirm clock keeps that date for good; the upgrade may add none and the list may only ever shrink to what that build wrote.
const MISDATED_BY_THE_BUILD_THAT_WROTE_IT: Record<string, string[]> = {
  "2026-09-14-dd151ec1": STAMPED_WITH_THE_CONFIRM_CLOCK,
  "2026-09-24-bff272ac": STAMPED_WITH_THE_CONFIRM_CLOCK,
};

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function unpack(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), `mezan-upgrade-${fixture}-`));
  scratch.push(dir);
  const dbPath = join(dir, "mezan.db");
  writeFileSync(dbPath, gunzipSync(readFileSync(join(FIXTURE_DIR, `${fixture}.db.gz`))));
  const chainKey = join(FIXTURE_DIR, `${fixture}.audit-chain.key`);
  if (existsSync(chainKey)) copyFileSync(chainKey, join(dir, "audit-chain.key"));
  return dbPath;
}

type Sqlite = ReturnType<typeof openSqliteConnection>["sqlite"];

function inspect<T>(dbPath: string, read: (sqlite: Sqlite) => T): T {
  const { sqlite } = openSqliteConnection(dbPath, { fileMustExist: true });
  try {
    return read(sqlite);
  } finally {
    sqlite.close();
  }
}

const versionOf = (dbPath: string): number => inspect(dbPath, (sqlite) => sqlite.pragma("user_version", { simple: true }) as number);

const upgradeStepsOf = (dbPath: string): { id: string; applied_at: string }[] =>
  inspect(dbPath, (sqlite) => sqlite.prepare("SELECT id, applied_at FROM upgrade_step ORDER BY id").all() as { id: string; applied_at: string }[]);

const schemaOf = (dbPath: string): string[] =>
  inspect(dbPath, (sqlite) =>
    (sqlite.prepare("SELECT type || ' ' || name || ' ' || COALESCE(sql, '') AS line FROM sqlite_master ORDER BY type, name").all() as { line: string }[]).map((row) => row.line),
  );

const contentsOf = (dbPath: string): string =>
  inspect(dbPath, (sqlite) => {
    const hash = createHash("sha256");
    const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
    for (const table of tables) {
      hash.update(`\n#${table}\n`);
      for (const row of sqlite.prepare(`SELECT * FROM "${table}"`).raw().iterate() as IterableIterator<unknown[]>) {
        hash.update(JSON.stringify(row.map((value) => (typeof value === "bigint" ? value.toString() : Buffer.isBuffer(value) ? value.toString("hex") : value))));
      }
    }
    return hash.digest("hex");
  });

const refuseTheNetwork = {
  request: async () => {
    throw new Error("the upgrade matrix never reaches a network");
  },
} as never;

async function open(dbPath: string, tenantBinding?: string): Promise<BackendHandle> {
  return await createBackend({
    dbPath,
    tenantBinding,
    etaHttpClient: refuseTheNetwork,
    resolveEntitlements: () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 60, expiresAt: null }),
  });
}

async function read(backend: BackendHandle, path: string): Promise<{ status: number; body: any }> {
  const token = backend.sessions.issue({ userId: "USER-ADMIN", permissions: ["*"], roleCode: "*", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const res = await backend.app.fetch(new Request(`http://local${path}`, { headers: { authorization: `Bearer ${token}`, "x-branch-scope": "*", "x-warehouse-scope": "*" } }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

interface Books {
  readonly controls: [string, string][];
  readonly foreignResidue: string;
  readonly misdatedStock: string[];
  readonly stockFaults: number;
  readonly debit: string;
  readonly credit: string;
  readonly audit: { ok: boolean; reason: string };
}

async function booksOf(backend: BackendHandle): Promise<Books> {
  const reconciliation = await read(backend, "/reconciliation");
  const trialBalance = await read(backend, "/financial-reports/trial-balance");
  const audit = await read(backend, "/audit/verify");
  expect([reconciliation.status, trialBalance.status, audit.status]).toEqual([200, 200, 200]);
  return {
    controls: (reconciliation.body.rows as { key: string; difference: string }[]).map((row) => [row.key, row.difference]),
    foreignResidue: reconciliation.body.foreignResidue.total,
    misdatedStock: (reconciliation.body.stockLedgerDates.rows as { docId: string }[]).map((row) => row.docId).sort(),
    stockFaults: reconciliation.body.stockPositions.count,
    debit: trialBalance.body.grandTotals.debit,
    credit: trialBalance.body.grandTotals.credit,
    audit: { ok: audit.body.ok, reason: audit.body.reason },
  };
}

describe("upgrade matrix — books an earlier build wrote", () => {
  it("has fixtures to open", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(3);
  });

  describe.each(FIXTURES)("%s", (fixture) => {
    it("opens, runs every upgrade step once, is idempotent on a second open, and leaves every invariant at exactly zero", async () => {
      const dbPath = unpack(fixture);
      expect(versionOf(dbPath)).toBeLessThan(CURRENT_SCHEMA_VERSION);

      const first = await open(dbPath);
      const booksAfterFirst = await booksOf(first);
      first.close();

      expect(versionOf(dbPath)).toBe(CURRENT_SCHEMA_VERSION);
      const stepsAfterFirst = upgradeStepsOf(dbPath);
      const schemaAfterFirst = schemaOf(dbPath);
      expect(stepsAfterFirst.length).toBeGreaterThan(0);

      const second = await open(dbPath);
      const booksAfterSecond = await booksOf(second);
      second.close();

      expect(upgradeStepsOf(dbPath)).toEqual(stepsAfterFirst);
      expect(schemaOf(dbPath)).toEqual(schemaAfterFirst);
      expect(versionOf(dbPath)).toBe(CURRENT_SCHEMA_VERSION);

      for (const books of [booksAfterFirst, booksAfterSecond]) {
        expect(books.controls.length).toBeGreaterThanOrEqual(10);
        expect(books.controls.filter(([, difference]) => difference !== "0.000000")).toEqual([]);
        expect(books.foreignResidue).toBe("0.000000");
        expect(books.misdatedStock).toEqual(MISDATED_BY_THE_BUILD_THAT_WROTE_IT[fixture] ?? []);
        expect(books.stockFaults).toBe(0);
        expect(books.debit).toBe(books.credit);
        expect(books.audit).toEqual({ ok: true, reason: "OK" });
      }
      expect(booksAfterSecond).toEqual(booksAfterFirst);
      expect(inspect(dbPath, (sqlite) => sqlite.pragma("integrity_check", { simple: true }))).toBe("ok");
    }, 240_000);

    it("a bounce the September build parked on 1360 is put back on the customer once, by an entry of its own", async () => {
      const dbPath = unpack(fixture);
      const parked = (): string[] =>
        inspect(dbPath, (sqlite) =>
          (sqlite
            .prepare(
              `SELECT c.id AS id FROM cheque c WHERE c.direction = 'incoming' AND c.status = 'bounced' AND c.bounce_journal_entry_id IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM journal_line l WHERE l.account_id = c.counterparty_gl_account_id AND l.entry_id IN (c.bounce_journal_entry_id, 'cheque-bounce-onto-party:' || c.id))`,
            )
            .all() as { id: string }[]).map((row) => row.id),
        );
      const parkedBefore = parked();
      (await open(dbPath)).close();
      (await open(dbPath)).close();

      expect(parked()).toEqual([]);
      const reclassified = inspect(dbPath, (sqlite) =>
        sqlite.prepare(`SELECT e.source_doc_id AS chequeId, l.account_id AS accountId, l.debit AS debit, l.credit AS credit FROM journal_entry e JOIN journal_line l ON l.entry_id = e.id WHERE e.id LIKE 'cheque-bounce-onto-party:%' ORDER BY e.id, l.debit DESC`).all(),
      );
      expect(reclassified.length).toBe(parkedBefore.length * 2);
      if (fixture === "2026-09-14-dd151ec1") {
        expect(parkedBefore).toEqual(["CHQ-DEMO-3"]);
        expect(reclassified).toEqual([
          { chequeId: "CHQ-DEMO-3", accountId: "1105", debit: 1_750_000_000, credit: 0 },
          { chequeId: "CHQ-DEMO-3", accountId: "1360", debit: 0, credit: 1_750_000_000 },
        ]);
      }
    }, 240_000);

    it("a failed upgrade leaves every table, the schema and the version stamp exactly as they were", async () => {
      const dbPath = unpack(fixture);
      inspect(dbPath, (sqlite) =>
        sqlite.exec(
          "CREATE TABLE IF NOT EXISTS upgrade_step (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);" +
            "CREATE TRIGGER upgrade_must_fail BEFORE INSERT ON upgrade_step BEGIN SELECT RAISE(ABORT, 'upgrade interrupted'); END;",
        ),
      );
      const before = { version: versionOf(dbPath), schema: schemaOf(dbPath), contents: contentsOf(dbPath) };
      expect(before.version).toBeLessThan(CURRENT_SCHEMA_VERSION);

      const failure = await open(dbPath).catch((err: unknown) => err);
      expect(failure).toBeInstanceOf(SchemaUpgradeFailedError);
      expect(String((failure as SchemaUpgradeFailedError).cause)).toContain("upgrade interrupted");
      expect((failure as SchemaUpgradeFailedError).message).toContain("بياناتك لم تُمَسّ");

      expect(versionOf(dbPath)).toBe(before.version);
      expect(schemaOf(dbPath)).toEqual(before.schema);
      expect(contentsOf(dbPath)).toBe(before.contents);
    }, 240_000);

    it("a failed upgrade of books opened for a cloud tenant leaves them without that tenant's binding, as they were", async () => {
      const dbPath = unpack(fixture);
      inspect(dbPath, (sqlite) =>
        sqlite.exec(
          "CREATE TABLE IF NOT EXISTS upgrade_step (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);" +
            "CREATE TRIGGER upgrade_must_fail BEFORE INSERT ON upgrade_step BEGIN SELECT RAISE(ABORT, 'upgrade interrupted'); END;",
        ),
      );
      const before = { version: versionOf(dbPath), schema: schemaOf(dbPath), contents: contentsOf(dbPath) };

      const failure = await open(dbPath, "tenant-1").catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(SchemaUpgradeFailedError);
      expect(versionOf(dbPath)).toBe(before.version);
      expect(schemaOf(dbPath)).toEqual(before.schema);
      expect(contentsOf(dbPath)).toBe(before.contents);
    }, 240_000);

    it("books bound to another cloud tenant are refused as another's before the upgrade writes anything", async () => {
      const dbPath = unpack(fixture);
      inspect(dbPath, (sqlite) => bindTenantDatabase(sqlite, "tenant-other"));
      const before = { version: versionOf(dbPath), schema: schemaOf(dbPath), contents: contentsOf(dbPath) };
      expect(before.version).toBeLessThan(CURRENT_SCHEMA_VERSION);

      const failure = await open(dbPath, "tenant-1").catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(TenantBindingMismatchError);
      expect(versionOf(dbPath)).toBe(before.version);
      expect(schemaOf(dbPath)).toEqual(before.schema);
      expect(contentsOf(dbPath)).toBe(before.contents);
    }, 240_000);

    it("books already bound to the cloud tenant they are opened for upgrade and keep that binding", async () => {
      const dbPath = unpack(fixture);
      inspect(dbPath, (sqlite) => bindTenantDatabase(sqlite, "tenant-1"));

      (await open(dbPath, "tenant-1")).close();

      expect(versionOf(dbPath)).toBe(CURRENT_SCHEMA_VERSION);
      expect(inspect(dbPath, (sqlite) => sqlite.prepare("SELECT tenant_id FROM tenant_binding").all())).toEqual([{ tenant_id: "tenant-1" }]);
    }, 240_000);
  });
});
