import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { grantSuccessorPermissionsOnce } from "./permission-successors.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const SUCCESSORS = new Map<string, readonly string[]>([
  ["hr.payroll.void", ["hr.payroll.reverse", "hr.provision.reverse"]],
  ["cheques.bounce", ["cheques.reverse"]],
]);

function oldBooks(roles: Record<string, string>) {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE role (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, permissions TEXT NOT NULL, is_system INTEGER NOT NULL, created_at TEXT NOT NULL)`);
  const insert = sqlite.prepare(`INSERT INTO role VALUES (?, ?, ?, '', ?, ?, '2026-01-01T00:00:00.000Z')`);
  for (const [id, permissions] of Object.entries(roles)) insert.run(id, id, id, permissions, id.startsWith("sys") ? 1 : 0);
  return sqlite;
}
const held = (sqlite: Database.Database, id: string) => JSON.parse((sqlite.prepare(`SELECT permissions FROM role WHERE id = ?`).get(id) as { permissions: string }).permissions) as string[];

describe("a role that held the permission a reversal used to ride on is given the reversal's own, once", () => {
  it("seeded and custom roles alike gain it, keep everything they had, and roles that never held the old one are untouched", async () => {
    const sqlite = oldBooks({
      "sys-hr": JSON.stringify(["hr.payroll.view", "hr.payroll.void"]),
      "custom-treasurer": JSON.stringify(["cheques.view", "cheques.bounce", "cheques.collect"]),
      "custom-viewer": JSON.stringify(["hr.payroll.view", "cheques.view"]),
      "sys-admin": JSON.stringify(["*"]),
    });

    expect((await grantSuccessorPermissionsOnce(sqliteDb(sqlite), "reversal_permissions", SUCCESSORS))).toBe(2);

    expect(held(sqlite, "sys-hr")).toEqual(["hr.payroll.view", "hr.payroll.void", "hr.payroll.reverse", "hr.provision.reverse"]);
    expect(held(sqlite, "custom-treasurer")).toEqual(["cheques.view", "cheques.bounce", "cheques.collect", "cheques.reverse"]);
    expect(held(sqlite, "custom-viewer")).toEqual(["hr.payroll.view", "cheques.view"]);
    expect(held(sqlite, "sys-admin")).toEqual(["*"]);
  });

  it("runs once: an administrator who then takes the new permission away is not overridden on the next start", async () => {
    const sqlite = oldBooks({ "custom-treasurer": JSON.stringify(["cheques.bounce"]) });
    await grantSuccessorPermissionsOnce(sqliteDb(sqlite), "reversal_permissions", SUCCESSORS);
    sqlite.prepare(`UPDATE role SET permissions = ? WHERE id = 'custom-treasurer'`).run(JSON.stringify(["cheques.bounce"]));

    expect((await grantSuccessorPermissionsOnce(sqliteDb(sqlite), "reversal_permissions", SUCCESSORS))).toBe(0);
    expect(held(sqlite, "custom-treasurer")).toEqual(["cheques.bounce"]);
  });

  it("a role that already holds the new permission is not given it twice, and a role whose permissions cannot be read is left as it is", async () => {
    const sqlite = oldBooks({ "custom-a": JSON.stringify(["cheques.bounce", "cheques.reverse"]), "custom-b": "not json" });
    expect((await grantSuccessorPermissionsOnce(sqliteDb(sqlite), "reversal_permissions", SUCCESSORS))).toBe(0);
    expect(held(sqlite, "custom-a")).toEqual(["cheques.bounce", "cheques.reverse"]);
    expect((sqlite.prepare(`SELECT permissions FROM role WHERE id = 'custom-b'`).get() as { permissions: string }).permissions).toBe("not json");
  });

  it("books with no roles yet are marked as done, so the roles a fresh seed writes are taken as written", async () => {
    const sqlite = new Database(":memory:");
    expect((await grantSuccessorPermissionsOnce(sqliteDb(sqlite), "reversal_permissions", SUCCESSORS))).toBe(0);
    sqlite.exec(`CREATE TABLE role (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, permissions TEXT NOT NULL, is_system INTEGER NOT NULL, created_at TEXT NOT NULL)`);
    sqlite.prepare(`INSERT INTO role VALUES ('later', 'later', 'later', '', ?, 0, '2026-01-01T00:00:00.000Z')`).run(JSON.stringify(["cheques.bounce"]));
    expect((await grantSuccessorPermissionsOnce(sqliteDb(sqlite), "reversal_permissions", SUCCESSORS))).toBe(0);
    expect(held(sqlite, "later")).toEqual(["cheques.bounce"]);
  });
});
