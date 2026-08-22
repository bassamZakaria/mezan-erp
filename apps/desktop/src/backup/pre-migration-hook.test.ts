import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPreMigrationBackup } from "./pre-migration-hook.js";

const dirs: string[] = [];
const dbs: Database.Database[] = [];

afterEach(async () => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("runPreMigrationBackup", () => {
  it("tags the backup's manifest with reason 'pre-migration'", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mezan-premigration-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "live.sqlite");
    const db = new Database(dbPath);
    dbs.push(db);
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY);");

    const result = await runPreMigrationBackup({
      sqlite: db,
      backupsDir: path.join(dir, "backups"),
      appVersion: "1.0.0",
    });

    expect(result.manifest.reason).toBe("pre-migration");
  });
});
