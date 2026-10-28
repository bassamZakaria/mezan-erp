import { rmSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { openSqliteConnection, SignInAttemptScope } from "@mezan/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCloudApp } from "./cloud-app.js";
import { harnessEnv } from "./cloud-harness.js";
import { BookKind, ChainKeySource, LegacySeparatorColumn, MigrationCommand, runMigration, type MigrationEnv } from "./sqlite-to-postgres.js";

const PG_URL = process.env.MEZAN_TEST_PG_URL;
const PG_ADMIN_URL = process.env.MEZAN_TEST_PG_ADMIN_URL;
if (process.env.CI && !PG_URL) throw new Error("MEZAN_TEST_PG_URL must be set in CI: the SQLite to Postgres migration may not skip there.");

const CHAIN_KEY = "c".repeat(64);
const LEGACY_SCOPE = "/api/sales/invoices\u0000legacy-user";
const LEGACY_ATTEMPT = "owner@legacy.test\u0000203.0.113.0";

function onBook<T>(file: string, work: (sqlite: ReturnType<typeof openSqliteConnection>["sqlite"]) => T): T {
  const { sqlite } = openSqliteConnection(file, { fileMustExist: true });
  try {
    return work(sqlite);
  } finally {
    sqlite.close();
  }
}

describe("sqlite → postgres migration", () => {
  const dirs: string[] = [];
  let dataDir = "";
  let tenantFile = "";
  let savedKey: string | undefined;

  beforeAll(async () => {
    savedKey = process.env["MEZAN_AUDIT_CHAIN_KEY"];
    process.env["MEZAN_AUDIT_CHAIN_KEY"] = CHAIN_KEY;
    const env = harnessEnv({}, { seedDemo: true, demoPassword: "demo-password-123456" }, dirs);
    dataDir = env.platformDir;
    await (await createCloudApp(env)).close();
    const platformFile = path.join(dataDir, "platform.db");
    tenantFile = path.join(dataDir, onBook(platformFile, (sqlite) => (sqlite.prepare("SELECT db_file FROM tenant ORDER BY id LIMIT 1").get() as { db_file: string }).db_file));
    onBook(platformFile, (sqlite) =>
      sqlite.prepare("INSERT INTO sign_in_attempt (scope, attempt_key, failures, locked_until, last_failure_at) VALUES (?, ?, '[]', 0, 0)").run(SignInAttemptScope.Ladder, LEGACY_ATTEMPT),
    );
    onBook(tenantFile, (sqlite) =>
      sqlite.prepare("INSERT INTO idempotent_request (scope, key, request_hash, status, body, recorded_at) VALUES (?, 'legacy-key', 'h', 201, '{}', '2026-10-01T00:00:00.000Z')").run(LEGACY_SCOPE),
    );
  }, 180_000);

  afterAll(() => {
    if (savedKey === undefined) delete process.env["MEZAN_AUDIT_CHAIN_KEY"];
    else process.env["MEZAN_AUDIT_CHAIN_KEY"] = savedKey;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("check proves the chain key from the environment and finds nothing Postgres would refuse", async () => {
    const report = await runMigration(MigrationCommand.Check, dataDir, { auditChainKey: CHAIN_KEY });
    expect(report.error).toBeUndefined();
    expect(report.ok).toBe(true);
    const tenant = report.books.find((book) => book.sourceFile === tenantFile)!;
    expect(tenant.chainKeySource).toBe(ChainKeySource.Env);
    expect(tenant.sourceChain.checked).toBeGreaterThan(0);
    expect(tenant.translatedSeparators).toEqual({ [LegacySeparatorColumn.IdempotentRequestScope]: 1 });
    expect(report.books.find((book) => book.kind === BookKind.Platform)!.translatedSeparators).toEqual({ [LegacySeparatorColumn.SignInAttemptKey]: 1 });
    for (const book of report.books) expect(book.droppedColumns).toEqual([]);
  }, 180_000);

  it("check refuses a legacy key that would collide with a current one once its separator is translated", async () => {
    const current = LEGACY_SCOPE.replace("\u0000", "\u001F");
    onBook(tenantFile, (sqlite) =>
      sqlite.prepare("INSERT INTO idempotent_request (scope, key, request_hash, status, body, recorded_at) VALUES (?, 'legacy-key', 'h', 201, '{}', '2026-10-01T00:00:00.000Z')").run(current),
    );
    try {
      const report = await runMigration(MigrationCommand.Check, dataDir, { auditChainKey: CHAIN_KEY });
      expect(report.ok).toBe(false);
      expect(report.error).toMatch(/idempotent_request: 1 rows collide/);
    } finally {
      onBook(tenantFile, (sqlite) => sqlite.prepare("DELETE FROM idempotent_request WHERE scope = ?").run(current));
    }
  }, 180_000);

  it("check refuses a book a running app holds locked instead of copying it inconsistently", async () => {
    const { sqlite } = openSqliteConnection(path.join(dataDir, "platform.db"), { fileMustExist: true, exclusive: true });
    try {
      sqlite.prepare("SELECT count(*) FROM sqlite_master").get();
      const report = await runMigration(MigrationCommand.Check, dataDir, { auditChainKey: CHAIN_KEY });
      expect(report.ok).toBe(false);
      expect(report.error).toMatch(/locked by a running app/);
    } finally {
      sqlite.close();
    }
  }, 180_000);

  it("check refuses books whose chain no candidate key verifies", async () => {
    const report = await runMigration(MigrationCommand.Check, dataDir, { auditChainKey: "e".repeat(64) });
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/no audit chain key verifies/);
  }, 180_000);

  describe.skipIf(!PG_URL)("on Postgres", () => {
    const databases: string[] = [];
    let admin: pg.Client;

    async function freshDatabase(): Promise<MigrationEnv> {
      const database = `mezan_migrate_${Date.now()}_${databases.length}`;
      databases.push(database);
      await admin.query(`CREATE DATABASE ${database} TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
      if (PG_ADMIN_URL) await admin.query(`GRANT CONNECT, CREATE ON DATABASE ${database} TO ${new URL(PG_URL!).username} WITH GRANT OPTION`);
      const on = (url: string) => {
        const target = new URL(url);
        target.pathname = `/${database}`;
        return target.toString();
      };
      return { databaseUrl: on(PG_URL!), ownerUrl: on(PG_ADMIN_URL ?? PG_URL!), tenantDbSecret: "d".repeat(64), auditChainKey: CHAIN_KEY };
    }

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: PG_ADMIN_URL ?? PG_URL });
      await admin.connect();
    });

    afterAll(async () => {
      const { rows } = await admin.query<{ rolname: string }>("SELECT rolname FROM pg_roles WHERE rolname = 'platform' OR rolname ~ '^t_[a-z0-9_]+$'");
      for (const database of databases) await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      for (const { rolname } of rows) {
        await admin.query(`DROP ROLE IF EXISTS ${rolname}`).catch((error: { code?: string }) => {
          if (error.code !== "2BP01") throw error;
        });
      }
      await admin.end();
    });

    it("drops every schema and role it created when a later book fails, and names any it could not drop", async () => {
      const env = await freshDatabase();
      await admin.query("CREATE ROLE platform NOLOGIN CREATEDB");
      try {
        const report = await runMigration(MigrationCommand.Migrate, dataDir, env);
        expect(report.ok).toBe(false);
        expect(report.error).toMatch(/SUPERUSER, CREATEDB/);
        const tenantSchemas = report.books.filter((book) => book.kind === BookKind.Tenant).map((book) => book.schema);
        expect(tenantSchemas.length).toBeGreaterThan(0);
        const owner = new pg.Client({ connectionString: env.ownerUrl });
        await owner.connect();
        try {
          const { rows: schemas } = await owner.query("SELECT nspname FROM pg_namespace WHERE nspname = 'platform' OR nspname ~ '^t_[a-z0-9_]+$'");
          expect(schemas).toEqual([]);
        } finally {
          await owner.end();
        }
        const { rows: roles } = await admin.query<{ rolname: string }>("SELECT rolname FROM pg_roles WHERE rolname = ANY($1)", [tenantSchemas]);
        expect(roles).toEqual([]);
        const { rows: platformRole } = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'platform'");
        if (platformRole.length > 0) expect(report.cleanupFailures).toEqual([expect.stringMatching(/^platform: .*DROP ROLE IF EXISTS platform;$/)]);
      } finally {
        await admin.query("DROP ROLE IF EXISTS platform");
      }
    }, 300_000);

    it("copies every book with matching rows, hashes and per-account totals, chains MIGRATED_FROM_SQLITE, and refuses a second run", async () => {
      const env = await freshDatabase();
      const report = await runMigration(MigrationCommand.Migrate, dataDir, env);
      expect(report.error).toBeUndefined();
      expect(report.ok).toBe(true);
      expect(report.books.map((book) => book.kind)).toEqual([BookKind.Tenant, BookKind.Platform]);

      for (const book of report.books) {
        expect(book.problems).toEqual([]);
        expect(book.droppedColumns).toEqual([]);
        expect(book.tables.every((table) => table.match === true)).toBe(true);
        expect(book.targetAudit?.ok).toBe(true);
      }
      const tenant = report.books.find((book) => book.sourceFile === tenantFile)!;
      expect(tenant.accounts!.accounts).toBeGreaterThan(0);
      expect(tenant.accounts!.mismatches).toEqual([]);
      expect(tenant.accounts!.totalDebit).toBe(tenant.accounts!.totalCredit);

      const client = new pg.Client({ connectionString: env.ownerUrl });
      await client.connect();
      try {
        const lines = tenant.tables.find((table) => table.table === "journal_line")!;
        const { rows: counted } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${tenant.schema}.journal_line`);
        expect(Number(counted[0]!.n)).toBe(lines.sourceRows);
        const { rows: last } = await client.query<{ action: string; row_id: string; id: string }>(
          `SELECT e.action, h.row_id::text AS row_id, e.id::text AS id FROM ${tenant.schema}.audit_event e JOIN ${tenant.schema}.audit_chain_head h ON true ORDER BY e.id DESC LIMIT 1`,
        );
        expect(last[0]!.action).toBe("MIGRATED_FROM_SQLITE");
        expect(last[0]!.row_id).toBe(last[0]!.id);
        expect(Number(last[0]!.id)).toBe(tenant.sourceChain.headRowId! + 1);
        const { rows: scopes } = await client.query<{ scope: string }>(`SELECT scope FROM ${tenant.schema}.idempotent_request WHERE key = 'legacy-key'`);
        expect(scopes.map((row) => row.scope)).toEqual([LEGACY_SCOPE.replace("\u0000", "\u001F")]);
        const { rows: attempts } = await client.query("SELECT 1 FROM platform.sign_in_attempt WHERE attempt_key = $1", [LEGACY_ATTEMPT.replace("\u0000", "\u001F")]);
        expect(attempts).toHaveLength(1);
      } finally {
        await client.end();
      }

      const again = await runMigration(MigrationCommand.Migrate, dataDir, env);
      expect(again.ok).toBe(false);
      expect(again.error).toMatch(/already holds books/);
    }, 300_000);
  });
});
