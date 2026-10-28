import { rmSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCloudApp } from "./cloud-app.js";
import { harnessEnv } from "./cloud-harness.js";
import { BookKind, ChainKeySource, MigrationCommand, runMigration, type MigrationEnv } from "./sqlite-to-postgres.js";

const PG_URL = process.env.MEZAN_TEST_PG_URL;
const PG_ADMIN_URL = process.env.MEZAN_TEST_PG_ADMIN_URL;
if (process.env.CI && !PG_URL) throw new Error("MEZAN_TEST_PG_URL must be set in CI: the SQLite to Postgres migration may not skip there.");

const CHAIN_KEY = "c".repeat(64);

describe("sqlite → postgres migration", () => {
  const dirs: string[] = [];
  let dataDir = "";
  let savedKey: string | undefined;

  beforeAll(async () => {
    savedKey = process.env["MEZAN_AUDIT_CHAIN_KEY"];
    process.env["MEZAN_AUDIT_CHAIN_KEY"] = CHAIN_KEY;
    const env = harnessEnv({}, { seedDemo: true, demoPassword: "demo-password-123456" }, dirs);
    dataDir = env.platformDir;
    await (await createCloudApp(env)).close();
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
    const tenant = report.books.find((book) => book.kind === BookKind.Tenant)!;
    expect(tenant.chainKeySource).toBe(ChainKeySource.Env);
    expect(tenant.sourceChain.checked).toBeGreaterThan(0);
  }, 180_000);

  it("check refuses books whose chain no candidate key verifies", async () => {
    const report = await runMigration(MigrationCommand.Check, dataDir, { auditChainKey: "e".repeat(64) });
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/no audit chain key verifies/);
  }, 180_000);

  describe.skipIf(!PG_URL)("on Postgres", () => {
    const database = `mezan_migrate_${Date.now()}`;
    let admin: pg.Client;
    let env: MigrationEnv;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: PG_ADMIN_URL ?? PG_URL });
      await admin.connect();
      await admin.query(`CREATE DATABASE ${database} TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
      if (PG_ADMIN_URL) await admin.query(`GRANT CONNECT, CREATE ON DATABASE ${database} TO ${new URL(PG_URL!).username} WITH GRANT OPTION`);
      const on = (url: string) => {
        const target = new URL(url);
        target.pathname = `/${database}`;
        return target.toString();
      };
      env = { databaseUrl: on(PG_URL!), ownerUrl: on(PG_ADMIN_URL ?? PG_URL!), tenantDbSecret: "d".repeat(64), auditChainKey: CHAIN_KEY };
    });

    afterAll(async () => {
      const { rows } = await admin.query<{ rolname: string }>("SELECT rolname FROM pg_roles WHERE rolname = 'platform' OR rolname ~ '^t_[a-z0-9_]+$'");
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      for (const { rolname } of rows) {
        await admin.query(`DROP ROLE IF EXISTS ${rolname}`).catch((error: { code?: string }) => {
          if (error.code !== "2BP01") throw error;
        });
      }
      await admin.end();
    });

    it("copies every book with matching rows, hashes and per-account totals, chains MIGRATED_FROM_SQLITE, and refuses a second run", async () => {
      const report = await runMigration(MigrationCommand.Migrate, dataDir, env);
      expect(report.error).toBeUndefined();
      expect(report.ok).toBe(true);
      expect(report.books.map((book) => book.kind)).toEqual([BookKind.Tenant, BookKind.Platform]);

      for (const book of report.books) {
        expect(book.problems).toEqual([]);
        expect(book.tables.every((table) => table.match === true)).toBe(true);
        expect(book.targetAudit?.ok).toBe(true);
      }
      const tenant = report.books.find((book) => book.kind === BookKind.Tenant)!;
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
      } finally {
        await client.end();
      }

      const again = await runMigration(MigrationCommand.Migrate, dataDir, env);
      expect(again.ok).toBe(false);
      expect(again.error).toMatch(/already holds books/);
    }, 300_000);
  });
});
