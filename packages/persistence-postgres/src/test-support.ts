import { randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import pg from "pg";
import { afterAll, beforeAll, it } from "vitest";
import { sqliteDb, SqlDialect, type SqlDb } from "@mezan/persistence";
import { assertCollation, createTenantPool, dropTenantSchema, postgresDb, provisionTenantSchema } from "./postgres-db.js";

export const PG_URL = process.env.MEZAN_TEST_PG_URL;
if (process.env.CI && !PG_URL) throw new Error("MEZAN_TEST_PG_URL must be set in CI: the Postgres half of a dialect suite may not skip there.");

export const DIALECTS = [{ dialect: SqlDialect.Sqlite }, { dialect: SqlDialect.Postgres }];

export interface DialectDb {
  readonly db: SqlDb;
  readonly sqlite?: Database.Database;
}

export function runOn(dialect: SqlDialect): typeof it | typeof it.skip {
  return dialect === SqlDialect.Postgres && !PG_URL ? it.skip : it;
}

export async function provisionTestTenant(admin: pg.Pool): Promise<{ schema: string; password: string }> {
  const schema = `t_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const password = randomBytes(18).toString("base64url");
  await provisionTenantSchema(admin, schema, password);
  return { schema, password };
}

export function useDialectDbs(): (dialect: SqlDialect) => Promise<DialectDb> {
  let admin: pg.Pool | undefined;
  const schemas: string[] = [];
  const pools: pg.Pool[] = [];
  const files: Database.Database[] = [];

  beforeAll(async () => {
    if (!PG_URL) return;
    admin = new pg.Pool({ connectionString: PG_URL, max: 2 });
    await assertCollation(admin);
  });

  afterAll(async () => {
    for (const file of files) file.close();
    for (const pool of pools) await pool.end();
    if (admin) {
      for (const schema of schemas) await dropTenantSchema(admin, schema);
      await admin.end();
    }
  });

  return async (dialect) => {
    if (dialect === SqlDialect.Sqlite) {
      const sqlite = new Database(":memory:");
      files.push(sqlite);
      return { db: sqliteDb(sqlite), sqlite };
    }
    const { schema, password } = await provisionTestTenant(admin!);
    schemas.push(schema);
    const pool = createTenantPool({ connectionString: PG_URL!, schema, password, max: 4 });
    pools.push(pool);
    return { db: postgresDb(pool, schema) };
  };
}
