import { describe, expect } from "vitest";
import { createUnitOfWork, ensureUnitOfWorkSchema, openSqliteConnection, sqliteDb, SqlDialect, type SqlDb } from "@mezan/persistence";
import { DIALECTS, runOn, useDialectDbs } from "./test-support.js";

const open = useDialectDbs();

const PRE_RETIREMENT_DDL = `
CREATE TABLE "user" (
  id TEXT PRIMARY KEY, name_ar TEXT NOT NULL, name_en TEXT, email TEXT NOT NULL, phone TEXT,
  password_hash TEXT NOT NULL, pin_hash TEXT, role_id TEXT, is_company_admin INTEGER NOT NULL,
  employee_id TEXT, branch_scope TEXT NOT NULL, warehouse_scope TEXT NOT NULL, status TEXT NOT NULL,
  photo_url TEXT, last_login_at TEXT, created_at TEXT NOT NULL, erased_at TEXT, access_expires_at TEXT
);
CREATE TABLE auth_session (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL);`;

async function preRetirementBook(dialect: SqlDialect): Promise<SqlDb> {
  const opened = await open(dialect);
  const db = opened.sqlite ? sqliteDb(openSqliteConnection(opened.sqlite).sqlite) : opened.db;
  await db.exec(PRE_RETIREMENT_DDL);
  const insert = `INSERT INTO "user" (id, name_ar, email, password_hash, pin_hash, is_company_admin, branch_scope, warehouse_scope, status, created_at) VALUES (?, ?, ?, ?, ?, 1, '"*"', '"*"', 'active', '2026-01-01')`;
  await db.run(insert, ["with-pin", "أ", "a@cyag.test", "scrypt$pw", "scrypt$pin"]);
  await db.run(insert, ["no-pin", "ب", "b@cyag.test", "scrypt$pw", null]);
  await db.run(`INSERT INTO auth_session (token_hash, user_id) VALUES (?, ?)`, ["pre-upgrade", "no-pin"]);
  return db;
}

async function hasPinColumn(db: SqlDb): Promise<boolean> {
  const row =
    db.dialect === SqlDialect.Postgres
      ? await db.get(`SELECT 1 AS x FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'user' AND column_name = 'pin_hash'`)
      : await db.get(`SELECT 1 AS x FROM pragma_table_info('user') WHERE name = 'pin_hash'`);
  return row !== undefined && row !== null;
}

describe.each(DIALECTS)("retiring the PIN column on $dialect", ({ dialect }) => {
  const run = runOn(dialect);

  run("makes each PIN hash the password, flags every user, ends every session and drops the column", async () => {
    const db = await preRetirementBook(dialect);

    await ensureUnitOfWorkSchema(db);

    expect(await hasPinColumn(db)).toBe(false);
    const users = createUnitOfWork(db).users;
    expect(await users.findById("with-pin")).toMatchObject({ passwordHash: "scrypt$pin", mustChangePassword: true });
    expect(await users.findById("no-pin")).toMatchObject({ passwordHash: "scrypt$pw", mustChangePassword: true });
    expect(Number((await db.get<{ n: bigint | number }>(`SELECT COUNT(*) AS n FROM auth_session`))?.n)).toBe(0);
  });

  run("is a no-op the second time", async () => {
    const db = await preRetirementBook(dialect);
    await ensureUnitOfWorkSchema(db);
    await db.run(`UPDATE "user" SET must_change_password = 0 WHERE id = ?`, ["no-pin"]);

    await ensureUnitOfWorkSchema(db);

    expect((await createUnitOfWork(db).users.findById("no-pin"))?.mustChangePassword).toBe(false);
  });
});
