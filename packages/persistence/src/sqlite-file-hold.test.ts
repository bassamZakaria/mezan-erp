import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { holdSqliteFile, SqliteFileBusyError } from "./sqlite-file-hold.js";

const dirs: string[] = [];
const open: Database.Database[] = [];
afterEach(() => {
  for (const db of open.splice(0)) if (db.open) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function walFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mezan-hold-"));
  dirs.push(dir);
  return path.join(dir, "books.db");
}

function connect(file: string): Database.Database {
  const db = new Database(file, { timeout: 50 });
  open.push(db);
  db.pragma("journal_mode = WAL");
  db.pragma("wal_autocheckpoint = 0");
  return db;
}

describe("holding a SQLite file for a copy", () => {
  it("folds the write-ahead log into the main file and leaves no sibling behind", () => {
    const file = walFile();
    const writer = connect(file);
    writer.exec("CREATE TABLE inv(n INTEGER); INSERT INTO inv VALUES (1)");
    writer.close();
    const crashed = connect(file);
    crashed.exec("INSERT INTO inv VALUES (2)");
    const leftover = new Database(file, { readonly: true });
    crashed.close();
    leftover.close();

    const held = holdSqliteFile(file, { waitMs: 50 });
    const whileHeld = [existsSync(`${file}-wal`), existsSync(`${file}-shm`)];
    held.release();

    expect(whileHeld).toEqual([false, false]);
    const after = new Database(file);
    open.push(after);
    expect(after.prepare("SELECT n FROM inv ORDER BY n").all()).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("refuses while another connection has the file open, and that connection's later write is kept", () => {
    const file = walFile();
    const other = connect(file);
    other.exec("CREATE TABLE inv(n INTEGER); INSERT INTO inv VALUES (1)");

    expect(() => holdSqliteFile(file, { waitMs: 50 })).toThrow(SqliteFileBusyError);

    other.exec("INSERT INTO inv VALUES (2)");
    expect(other.prepare("SELECT count(*) AS c FROM inv").get()).toEqual({ c: 2 });
  });

  it("refuses while another connection holds a write", () => {
    const file = walFile();
    const other = connect(file);
    other.exec("CREATE TABLE inv(n INTEGER)");
    other.exec("BEGIN IMMEDIATE; INSERT INTO inv VALUES (1)");

    expect(() => holdSqliteFile(file, { waitMs: 50 })).toThrow(SqliteFileBusyError);

    other.exec("COMMIT");
  });

  it("keeps every other connection out until it is released", () => {
    const file = walFile();
    const seed = connect(file);
    seed.exec("CREATE TABLE inv(n INTEGER)");
    seed.close();

    const held = holdSqliteFile(file, { waitMs: 50 });
    const late = new Database(file, { timeout: 50 });
    open.push(late);
    expect(() => late.exec("INSERT INTO inv VALUES (9)")).toThrow(/locked|busy/i);
    held.release();

    late.exec("INSERT INTO inv VALUES (9)");
    expect(late.prepare("SELECT count(*) AS c FROM inv").get()).toEqual({ c: 1 });
  });
});
