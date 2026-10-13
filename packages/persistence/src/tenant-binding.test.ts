import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteConnection } from "./sqlite-connection.js";
import { bindTenantDatabase, NotASqliteDatabaseError, readTenantBooksIdentity, TenantBindingMismatchError } from "./tenant-binding.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fileIn(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mezan-binding-"));
  dirs.push(dir);
  return path.join(dir, name);
}

function bound(file: string, tenantId: string, at: string): void {
  const { sqlite } = openSqliteConnection(file);
  bindTenantDatabase(sqlite, tenantId, () => new Date(at));
  sqlite.close();
}

const KILLED_WRITER = `
const Database = require(process.argv[2]);
const sqlite = new Database(process.argv[3]);
sqlite.pragma("journal_mode = WAL");
sqlite.exec(process.argv[4]);
process.kill(process.pid, "SIGKILL");
`;

function writtenByAWriterKilledBeforeItClosed(file: string, sql: string): void {
  const script = fileIn("killed-writer.cjs");
  writeFileSync(script, KILLED_WRITER);
  spawnSync(process.execPath, [script, createRequire(import.meta.url).resolve("better-sqlite3"), file, sql]);
}

function fingerprintOf(file: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(path.dirname(file))
      .filter((name) => name.startsWith(path.basename(file)))
      .sort()
      .map((name) => [name, createHash("sha256").update(readFileSync(path.join(path.dirname(file), name))).digest("hex")]),
  );
}

function rowsOf(file: string): unknown[] {
  const { sqlite } = openSqliteConnection(file);
  const rows = sqlite.prepare("SELECT tenant_id, bound_at FROM tenant_binding").all();
  sqlite.close();
  return rows;
}

describe("the tenant a database is bound to", () => {
  it("is written once: binding it again to the same tenant changes nothing", () => {
    const file = fileIn("books.db");
    bound(file, "t-1", "2026-10-12T10:00:00.000Z");

    bound(file, "t-1", "2026-11-01T10:00:00.000Z");

    expect(rowsOf(file)).toEqual([{ tenant_id: "t-1", bound_at: "2026-10-12T10:00:00.000Z" }]);
  });

  it("is never moved: binding it to another tenant is refused and the first binding stands", () => {
    const file = fileIn("books.db");
    bound(file, "t-1", "2026-10-12T10:00:00.000Z");

    expect(() => bound(file, "t-2", "2026-11-01T10:00:00.000Z")).toThrow(TenantBindingMismatchError);

    expect(rowsOf(file)).toEqual([{ tenant_id: "t-1", bound_at: "2026-10-12T10:00:00.000Z" }]);
  });

  it.each([
    ["as any connection would open it", {}],
    ["holding it exclusively, as it is opened on a network filesystem", { exclusive: true }],
  ])("is read %s without changing a byte of the file or leaving a log beside it", (_label, options) => {
    const file = fileIn("books.db");
    bound(file, "t-1", "2026-10-12T10:00:00.000Z");
    const before = readFileSync(file);

    const identity = readTenantBooksIdentity(file, options);

    expect(identity).toEqual({ boundTenantId: "t-1", claimed: false, companyName: null, users: [] });
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(["-wal", "-shm"].filter((suffix) => existsSync(`${file}${suffix}`))).toEqual([]);
  });

  it.each([
    ["this tenant's", "t-1"],
    ["another tenant's", "t-other"],
  ])("is read out of the log a killed writer left behind when the binding is %s, and the database, its log and its index are left byte for byte", (_label, tenantId) => {
    const file = fileIn("books.db");
    openSqliteConnection(file).sqlite.close();
    writtenByAWriterKilledBeforeItClosed(
      file,
      `CREATE TABLE tenant_binding (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, bound_at TEXT NOT NULL); INSERT INTO tenant_binding VALUES (1, '${tenantId}', '2026-10-12T10:00:00.000Z');`,
    );
    const before = fingerprintOf(file);

    const identity = readTenantBooksIdentity(file);

    expect(Object.keys(before)).toEqual(["books.db", "books.db-shm", "books.db-wal"]);
    expect(identity.boundTenantId).toBe(tenantId);
    expect(fingerprintOf(file)).toEqual(before);
  });

  it("is read on a connection that refuses every write, so nothing run while it is being read can change the database", () => {
    const file = fileIn("books.db");
    bound(file, "t-1", "2026-10-12T10:00:00.000Z");
    const before = readFileSync(file);
    const refusals: unknown[] = [];
    const writingWhileRead = function (...args: ConstructorParameters<typeof Database>) {
      const sqlite = new Database(...args);
      const prepare = sqlite.prepare.bind(sqlite);
      sqlite.prepare = ((sql: string) => {
        try {
          sqlite.exec("CREATE TABLE planted (x)");
          refusals.push("written");
        } catch (err) {
          refusals.push((err as { code?: unknown }).code);
        }
        return prepare(sql);
      }) as typeof sqlite.prepare;
      return sqlite;
    } as unknown as typeof Database;

    readTenantBooksIdentity(file, { driver: writingWhileRead });

    expect(refusals.length).toBeGreaterThan(0);
    expect(new Set(refusals)).toEqual(new Set(["SQLITE_READONLY"]));
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("is not read from a database whose settings are not the settings this product writes", () => {
    const file = fileIn("books.db");
    const { sqlite } = openSqliteConnection(file);
    sqlite.exec("CREATE TABLE tenant_settings (id TEXT PRIMARY KEY, data TEXT NOT NULL); INSERT INTO tenant_settings VALUES ('default', 'not json');");
    sqlite.pragma("journal_mode = DELETE");
    sqlite.close();

    expect(() => readTenantBooksIdentity(file)).toThrow(NotASqliteDatabaseError);
  });

  it("is read as nobody's, with nobody in it, from a database that holds no books", () => {
    const file = fileIn("empty.db");
    openSqliteConnection(file).sqlite.close();

    expect(readTenantBooksIdentity(file)).toEqual({ boundTenantId: null, claimed: false, companyName: null, users: [] });
  });

  it("is not read from a file that only starts like a database, and the file is left as it was", () => {
    const file = fileIn("torn.db");
    const bytes = Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(4080)]);
    writeFileSync(file, bytes);

    expect(() => readTenantBooksIdentity(file)).toThrow(NotASqliteDatabaseError);

    expect(readFileSync(file).equals(bytes)).toBe(true);
  });
});
