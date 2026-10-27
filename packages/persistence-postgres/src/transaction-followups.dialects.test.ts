import pg from "pg";
import { describe, expect } from "vitest";
import { DatabaseBusyError, SqlDialect, createRateWindowStore, ensureRateWindowSchema } from "@mezan/persistence";
import { createTenantPool, dropTenantSchema, postgresDb } from "./postgres-db.js";
import { DIALECTS, PG_URL, provisionTestTenant, runOn, useDialectDbs } from "./test-support.js";

const open = useDialectDbs();
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe.each(DIALECTS)("transactions and follow-ups on $dialect", ({ dialect }) => {
  const it = runOn(dialect);

  it("runs a follow-up queued inside a transaction once that transaction commits", async () => {
    const { db } = await open(dialect);
    const fired: string[] = [];
    await db.transaction(async () => {
      db.afterCommit(() => fired.push("committed"));
      if (dialect === SqlDialect.Postgres) expect(fired).toEqual([]);
    });
    await tick();
    expect(fired).toEqual(["committed"]);
  });

  it("drops the follow-ups of a rolled-back transaction, and of a rolled-back savepoint inside a committed one", async () => {
    if (dialect === SqlDialect.Sqlite) return;
    const { db } = await open(dialect);
    const fired: string[] = [];
    await expect(
      db.transaction(async () => {
        db.afterCommit(() => fired.push("rolled back"));
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    await db.transaction(async () => {
      db.afterCommit(() => fired.push("kept"));
      await db.transaction(async () => {
        db.afterCommit(() => fired.push("inner rolled back"));
        throw new Error("inner refused");
      }).catch(() => undefined);
    });
    await tick();
    expect(fired).toEqual(["kept"]);
  });

  it("keeps the enclosing transaction alive when a read inside it fails", async () => {
    const { db } = await open(dialect);
    await db.exec("CREATE TABLE kept (id TEXT PRIMARY KEY)");
    await db.transaction(async () => {
      await db.run("INSERT INTO kept (id) VALUES (?)", ["a"]);
      await expect(db.read(() => db.all("SELECT * FROM no_such_table"))).rejects.toThrow();
      await db.run("INSERT INTO kept (id) VALUES (?)", ["b"]);
    });
    expect((await db.all<{ id: string }>("SELECT id FROM kept ORDER BY id")).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("sweeps expired rate windows and keeps only the newest over the cap, leaving other scopes alone", async () => {
    const { db } = await open(dialect);
    await ensureRateWindowSchema(db);
    const store = createRateWindowStore(db, "signup");
    const other = createRateWindowStore(db, "other");
    await other.hit("elsewhere", 0, 10);
    await store.hit("expired", 0, 10);
    await store.hit("oldest", 100, 1_000);
    await store.hit("middle", 100, 2_000);
    await store.hit("newest", 100, 3_000);

    await store.sweep(50, 2);

    expect(await store.read("expired", 50)).toBeNull();
    expect(await store.read("oldest", 50)).toBeNull();
    expect(await store.read("middle", 50)).toMatchObject({ hits: 1 });
    expect(await store.read("newest", 50)).toMatchObject({ hits: 1 });
    expect(await other.read("elsewhere", 5)).toMatchObject({ hits: 1 });
  });
});

describe("a Postgres pool with no free connection", () => {
  runOn(SqlDialect.Postgres)("answers DatabaseBusyError rather than waiting forever", async () => {
    const admin = new pg.Pool({ connectionString: PG_URL, max: 1 });
    const { schema, password } = await provisionTestTenant(admin);
    const pool = createTenantPool({ connectionString: PG_URL!, schema, password, max: 1, connectionTimeoutMillis: 200 });
    const held = await pool.connect();
    try {
      await expect(postgresDb(pool, schema).get("SELECT 1 AS one")).rejects.toBeInstanceOf(DatabaseBusyError);
    } finally {
      held.release();
      await pool.end();
      await dropTenantSchema(admin, schema);
      await admin.end();
    }
  });
});
