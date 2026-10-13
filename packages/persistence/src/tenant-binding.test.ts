import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteConnection } from "./sqlite-connection.js";
import { SqliteFileBusyError } from "./sqlite-file-hold.js";
import {
  bindTenantDatabase,
  emptyBooksScratch,
  NotASqliteDatabaseError,
  readTenantBooksIdentity,
  sqliteFileStamp,
  TenantBindingMismatchError,
  writeTenantBinding,
  type TenantBooksIdentity,
} from "./tenant-binding.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fileIn(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mezan-binding-"));
  dirs.push(dir);
  return path.join(dir, name);
}

function scratchBeside(file: string): string {
  return path.join(path.dirname(file), "scratch");
}

const identityOf = (file: string, options: Parameters<typeof readTenantBooksIdentity>[2] = {}): Promise<TenantBooksIdentity> => readTenantBooksIdentity(file, scratchBeside(file), options);

const modeOf = (file: string): number => statSync(file).mode & 0o777;

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
  ])("is read %s without changing a byte of the file or leaving a log beside it", async (_label, options) => {
    const file = fileIn("books.db");
    bound(file, "t-1", "2026-10-12T10:00:00.000Z");
    const before = readFileSync(file);

    const identity = await identityOf(file, options);

    expect(identity).toEqual({ boundTenantId: "t-1", claimedAt: null, companyName: null, users: [] });
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(["-wal", "-shm"].filter((suffix) => existsSync(`${file}${suffix}`))).toEqual([]);
  });

  it.each([
    ["this tenant's", "t-1"],
    ["another tenant's", "t-other"],
  ])("is read out of the log a killed writer left behind when the binding is %s, and the database, its log and its index are left byte for byte", async (_label, tenantId) => {
    const file = fileIn("books.db");
    openSqliteConnection(file).sqlite.close();
    writtenByAWriterKilledBeforeItClosed(
      file,
      `CREATE TABLE tenant_binding (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, bound_at TEXT NOT NULL); INSERT INTO tenant_binding VALUES (1, '${tenantId}', '2026-10-12T10:00:00.000Z');`,
    );
    const before = fingerprintOf(file);

    const identity = await identityOf(file);

    expect(Object.keys(before)).toEqual(["books.db", "books.db-shm", "books.db-wal"]);
    expect(identity.boundTenantId).toBe(tenantId);
    expect(fingerprintOf(file)).toEqual(before);
  });

  describe("read from a private copy, because a log sits beside the database", () => {
    const BINDING = "CREATE TABLE tenant_binding (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, bound_at TEXT NOT NULL); INSERT INTO tenant_binding VALUES (1, 't-1', '2026-10-12T10:00:00.000Z');";

    function withALogBeside(): string {
      const file = fileIn("books.db");
      openSqliteConnection(file).sqlite.close();
      writtenByAWriterKilledBeforeItClosed(file, BINDING);
      return file;
    }

    it("keeps the copy where only the server's own user can reach it, and removes it once it is read", async () => {
      const file = withALogBeside();
      const seen: { copy: string; file: number; log: number; dir: number; scratch: number }[] = [];
      const lookingAtTheCopy = function (...args: ConstructorParameters<typeof Database>) {
        const copy = String(args[0]);
        seen.push({ copy, file: modeOf(copy), log: modeOf(`${copy}-wal`), dir: modeOf(path.dirname(copy)), scratch: modeOf(scratchBeside(file)) });
        return new Database(...args);
      } as unknown as typeof Database;

      await identityOf(file, { driver: lookingAtTheCopy });

      expect(seen).toEqual([{ copy: expect.stringContaining(`${scratchBeside(file)}${path.sep}`), file: 0o600, log: 0o600, dir: 0o700, scratch: 0o700 }]);
      expect(readdirSync(scratchBeside(file))).toEqual([]);
    });

    it("removes the copy when the read fails", async () => {
      const file = withALogBeside();
      const failing = function () {
        throw new Error("the read failed");
      } as unknown as typeof Database;

      await expect(identityOf(file, { driver: failing })).rejects.toThrow("the read failed");

      expect(readdirSync(scratchBeside(file))).toEqual([]);
    });

    it("is not judged from a database and a log copied at different moments: while the files keep changing it reports the file busy, and leaves no copy", async () => {
      const file = withALogBeside();
      let reading = true;
      let tick = 0;
      const keepChanging = (): void => {
        if (!reading) return;
        tick += 1;
        utimesSync(`${file}-wal`, new Date(), new Date(Date.UTC(2026, 9, 12) + tick * 1000));
        setImmediate(keepChanging);
      };
      const opened: string[] = [];
      const counting = function (...args: ConstructorParameters<typeof Database>) {
        opened.push(String(args[0]));
        return new Database(...args);
      } as unknown as typeof Database;

      keepChanging();
      const refused = await identityOf(file, { driver: counting }).catch((err: unknown) => err);
      reading = false;

      expect(refused).toBeInstanceOf(SqliteFileBusyError);
      expect(opened).toEqual([]);
      expect(readdirSync(scratchBeside(file))).toEqual([]);
    });
  });

  it("empties the scratch directory of whatever a killed process left in it, and keeps it the owner's alone", () => {
    const scratch = scratchBeside(fileIn("books.db"));
    mkdirSync(path.join(scratch, "identity-left"), { recursive: true, mode: 0o755 });
    writeFileSync(path.join(scratch, "identity-left", "books.db"), "a customer's books");

    emptyBooksScratch(scratch);

    expect(readdirSync(scratch)).toEqual([]);
    expect(modeOf(scratch)).toBe(0o700);
  });

  it("has a stamp that changes when the database, its log or its journal is written, replaced or removed, and not otherwise", () => {
    const file = fileIn("books.db");
    bound(file, "t-1", "2026-10-12T10:00:00.000Z");
    const first = sqliteFileStamp(file);
    const unchanged = sqliteFileStamp(file);
    writeFileSync(`${file}-wal`, "");
    const withLog = sqliteFileStamp(file);
    rmSync(`${file}-wal`);
    const logGone = sqliteFileStamp(file);
    const copy = readFileSync(file);
    rmSync(file);
    writeFileSync(file, copy);
    const replaced = sqliteFileStamp(file);

    expect(unchanged).toBe(first);
    expect(withLog).not.toBe(first);
    expect(logGone).toBe(first);
    expect(replaced).not.toBe(first);
  });

  describe("written by the console's confirmation", () => {
    it("hands the books as they are inside the write to whoever decides, and binds them when they are accepted", () => {
      const file = fileIn("books.db");
      openSqliteConnection(file).sqlite.close();
      const shown: TenantBooksIdentity[] = [];

      writeTenantBinding(file, "t-1", { now: () => new Date("2026-10-12T10:00:00.000Z"), accept: (books) => void shown.push(books) });

      expect(shown).toEqual([{ boundTenantId: null, claimedAt: null, companyName: null, users: [] }]);
      expect(rowsOf(file)).toEqual([{ tenant_id: "t-1", bound_at: "2026-10-12T10:00:00.000Z" }]);
    });

    it("writes nothing when the books are not accepted", () => {
      const file = fileIn("books.db");
      openSqliteConnection(file).sqlite.close();
      const before = readFileSync(file);

      expect(() =>
        writeTenantBinding(file, "t-1", {
          accept: () => {
            throw new Error("not the books that were shown");
          },
        }),
      ).toThrow("not the books that were shown");

      expect(readFileSync(file).equals(before)).toBe(true);
    });
  });

  it("is read on a connection that refuses every write, so nothing run while it is being read can change the database", async () => {
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

    await identityOf(file, { driver: writingWhileRead });

    expect(refusals.length).toBeGreaterThan(0);
    expect(new Set(refusals)).toEqual(new Set(["SQLITE_READONLY"]));
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("is not read from a database whose settings are not the settings this product writes", async () => {
    const file = fileIn("books.db");
    const { sqlite } = openSqliteConnection(file);
    sqlite.exec("CREATE TABLE tenant_settings (id TEXT PRIMARY KEY, data TEXT NOT NULL); INSERT INTO tenant_settings VALUES ('default', 'not json');");
    sqlite.pragma("journal_mode = DELETE");
    sqlite.close();

    await expect(identityOf(file)).rejects.toThrow(NotASqliteDatabaseError);
  });

  it("is read as nobody's, with nobody in it, from a database that holds no books", async () => {
    const file = fileIn("empty.db");
    openSqliteConnection(file).sqlite.close();

    expect(await identityOf(file)).toEqual({ boundTenantId: null, claimedAt: null, companyName: null, users: [] });
  });

  it("is not read from a file that only starts like a database, and the file is left as it was", async () => {
    const file = fileIn("torn.db");
    const bytes = Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(4080)]);
    writeFileSync(file, bytes);

    await expect(identityOf(file)).rejects.toThrow(NotASqliteDatabaseError);

    expect(readFileSync(file).equals(bytes)).toBe(true);
  });
});
