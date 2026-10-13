import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

    expect(identity).toEqual({ boundTenantId: "t-1", claimed: false, users: [] });
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(["-wal", "-shm"].filter((suffix) => existsSync(`${file}${suffix}`))).toEqual([]);
  });

  it("is read as nobody's, with nobody in it, from a database that holds no books", () => {
    const file = fileIn("empty.db");
    openSqliteConnection(file).sqlite.close();

    expect(readTenantBooksIdentity(file)).toEqual({ boundTenantId: null, claimed: false, users: [] });
  });

  it("is not read from a file that only starts like a database, and the file is left as it was", () => {
    const file = fileIn("torn.db");
    const bytes = Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(4080)]);
    writeFileSync(file, bytes);

    expect(() => readTenantBooksIdentity(file)).toThrow(NotASqliteDatabaseError);

    expect(readFileSync(file).equals(bytes)).toBe(true);
  });
});
