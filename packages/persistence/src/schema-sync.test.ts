import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  CURRENT_SCHEMA_VERSION,
  SchemaTooNewError,
  installSchemaSync,
  readSchemaVersion,
  stampSchemaVersion,
} from "./schema-sync.js";

describe("installSchemaSync", () => {
  it("adds a column a store's CREATE TABLE declares that an existing table is missing, keeping existing rows", () => {
    const db = new Database(":memory:");
    try {
      // Simulate a database written by a previous build: only two of the
      // three columns the current CREATE TABLE declares.
      db.exec(`CREATE TABLE widget (id TEXT PRIMARY KEY, name TEXT NOT NULL)`);
      db.prepare(`INSERT INTO widget (id, name) VALUES ('w1', 'Widget One')`).run();

      installSchemaSync(db);
      db.exec(`
        CREATE TABLE IF NOT EXISTS widget (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          color TEXT
        );
      `);

      const columns = (db.prepare(`PRAGMA table_info(widget)`).all() as { name: string }[]).map((c) => c.name);
      expect(columns).toEqual(["id", "name", "color"]);

      const row = db.prepare(`SELECT * FROM widget WHERE id = 'w1'`).get() as Record<string, unknown>;
      expect(row.name).toBe("Widget One");
      expect(row.color).toBeNull();
    } finally {
      db.close();
    }
  });

  it("adds a NOT NULL column without a DEFAULT as nullable, since an existing table may already hold rows", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE widget (id TEXT PRIMARY KEY)`);
      db.prepare(`INSERT INTO widget (id) VALUES ('w1')`).run();

      installSchemaSync(db);
      db.exec(`
        CREATE TABLE IF NOT EXISTS widget (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL
        );
      `);

      // Would throw "NOT NULL constraint failed" if the ALTER kept NOT NULL.
      const row = db.prepare(`SELECT * FROM widget WHERE id = 'w1'`).get() as Record<string, unknown>;
      expect(row.status).toBeNull();
    } finally {
      db.close();
    }
  });

  it("keeps a DEFAULT clause on the ALTER when the declared column has one", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE widget (id TEXT PRIMARY KEY)`);
      db.prepare(`INSERT INTO widget (id) VALUES ('w1')`).run();

      installSchemaSync(db);
      db.exec(`
        CREATE TABLE IF NOT EXISTS widget (
          id TEXT PRIMARY KEY,
          active INTEGER NOT NULL DEFAULT 0
        );
      `);

      const row = db.prepare(`SELECT * FROM widget WHERE id = 'w1'`).get() as Record<string, unknown>;
      expect(row.active).toBe(0);
    } finally {
      db.close();
    }
  });

  it("skips table-level constraint lines (UNIQUE/PRIMARY/FOREIGN/CHECK/CONSTRAINT) rather than treating them as columns", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE attendance (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, date TEXT NOT NULL)`);

      installSchemaSync(db);
      expect(() => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS attendance (
            id TEXT PRIMARY KEY,
            employee_id TEXT NOT NULL,
            date TEXT NOT NULL,
            worked_minutes INTEGER,
            UNIQUE (employee_id, date)
          );
        `);
      }).not.toThrow();

      const columns = (db.prepare(`PRAGMA table_info(attendance)`).all() as { name: string }[]).map((c) => c.name);
      expect(columns).toEqual(["id", "employee_id", "date", "worked_minutes"]);
    } finally {
      db.close();
    }
  });

  it("never adds a column declared inline PRIMARY KEY or UNIQUE, even if the existing table lacks it", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE code_table (name TEXT NOT NULL)`);

      installSchemaSync(db);
      db.exec(`
        CREATE TABLE IF NOT EXISTS code_table (
          code TEXT PRIMARY KEY,
          name TEXT NOT NULL
        );
      `);

      const columns = (db.prepare(`PRAGMA table_info(code_table)`).all() as { name: string }[]).map((c) => c.name);
      expect(columns).toEqual(["name"]);
    } finally {
      db.close();
    }
  });

  it("is idempotent per connection: hooking twice does not double-run the migration and error on a duplicate column", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE widget (id TEXT PRIMARY KEY)`);
      installSchemaSync(db);
      installSchemaSync(db);
      expect(() => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS widget (
            id TEXT PRIMARY KEY,
            color TEXT
          );
        `);
      }).not.toThrow();
      const columns = (db.prepare(`PRAGMA table_info(widget)`).all() as { name: string }[]).map((c) => c.name);
      expect(columns).toEqual(["id", "color"]);
    } finally {
      db.close();
    }
  });

  it("is a no-op for a brand-new table (CREATE TABLE already declares every column)", () => {
    const db = new Database(":memory:");
    try {
      installSchemaSync(db);
      db.exec(`CREATE TABLE IF NOT EXISTS widget (id TEXT PRIMARY KEY, name TEXT NOT NULL)`);
      const columns = (db.prepare(`PRAGMA table_info(widget)`).all() as { name: string }[]).map((c) => c.name);
      expect(columns).toEqual(["id", "name"]);
    } finally {
      db.close();
    }
  });

  it("leaves non-CREATE-TABLE exec calls untouched", () => {
    const db = new Database(":memory:");
    try {
      installSchemaSync(db);
      db.exec(`CREATE TABLE widget (id TEXT PRIMARY KEY)`);
      expect(() => db.exec(`INSERT INTO widget (id) VALUES ('w1')`)).not.toThrow();
      expect(db.prepare(`SELECT COUNT(*) AS n FROM widget`).get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("adds a missing column BEFORE the script runs, so an index in the same script can name it", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE widget (id TEXT PRIMARY KEY, name TEXT NOT NULL)`);
      db.prepare(`INSERT INTO widget (id, name) VALUES ('w1', 'Widget One')`).run();
      installSchemaSync(db);
      db.exec(`
        CREATE TABLE IF NOT EXISTS widget (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          branch_id TEXT,
          fingerprint TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_widget_branch ON widget(branch_id);
        CREATE UNIQUE INDEX IF NOT EXISTS ux_widget_fingerprint ON widget(name, fingerprint) WHERE fingerprint IS NOT NULL;
      `);
      const indexes = (db.prepare(`PRAGMA index_list(widget)`).all() as { name: string }[]).map((index) => index.name);
      expect(indexes).toEqual(expect.arrayContaining(["idx_widget_branch", "ux_widget_fingerprint"]));
      expect(db.prepare(`SELECT name FROM widget WHERE id = 'w1'`).get()).toEqual({ name: "Widget One" });
    } finally {
      db.close();
    }
  });

  it("migrates a real database file at a previous schema on open, keeping its rows (the actual reopen path)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mezan-schema-sync-"));
    dirs.push(dir);
    const file = join(dir, "old.db");

    // Write the database with an old-shape table and close it, as a previous
    // build of the app would have left it on disk.
    const writer = new Database(file);
    writer.exec(`CREATE TABLE widget (id TEXT PRIMARY KEY, name TEXT NOT NULL)`);
    writer.prepare(`INSERT INTO widget (id, name) VALUES ('w1', 'Widget One')`).run();
    writer.close();

    // Reopen exactly as a store factory would: install the hook, then run the
    // CURRENT (wider) CREATE TABLE against the pre-existing file.
    const reader = new Database(file);
    try {
      installSchemaSync(reader);
      reader.exec(`
        CREATE TABLE IF NOT EXISTS widget (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          color TEXT,
          weight INTEGER NOT NULL DEFAULT 0
        );
      `);
      const columns = (reader.prepare(`PRAGMA table_info(widget)`).all() as { name: string }[]).map((c) => c.name);
      expect(columns).toEqual(["id", "name", "color", "weight"]);

      const row = reader.prepare(`SELECT * FROM widget WHERE id = 'w1'`).get() as Record<string, unknown>;
      expect(row.name).toBe("Widget One");
      expect(row.color).toBeNull();
      expect(row.weight).toBe(0);
    } finally {
      reader.close();
    }
  });
});

/**
 * GUARDS U-9. Nothing wrote `PRAGMA user_version`, so an older build opened a
 * database a newer build had written, read the columns it knew, ignored the
 * rest, and posted into it. The books looked fine the whole time.
 */
describe("the schema version stamp", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("does NOT stamp on open: the stamp is the last act of an upgrade, never the first", () => {
    const db = new Database(":memory:");
    try {
      expect(readSchemaVersion(db)).toBe(0);
      installSchemaSync(db);
      expect(readSchemaVersion(db)).toBe(0);
      stampSchemaVersion(db);
      expect(readSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it("the stamp rolls back with the transaction it was written in", () => {
    const db = new Database(":memory:");
    try {
      db.exec("BEGIN");
      stampSchemaVersion(db, "1.4.0");
      db.exec("ROLLBACK");
      expect(readSchemaVersion(db)).toBe(0);
      expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'schema_meta'`).get()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("records the app version beside it, so a refusal can name the build that wrote the file", () => {
    const db = new Database(":memory:");
    try {
      stampSchemaVersion(db, "1.4.0");
      const row = db
        .prepare(`SELECT value FROM schema_meta WHERE key = 'app_version'`)
        .get() as { value: string } | undefined;
      expect(row?.value).toBe("1.4.0");
    } finally {
      db.close();
    }
  });

  it("REFUSES a database written by a newer schema, in Arabic, before touching it", () => {
    const db = new Database(":memory:");
    try {
      db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 1}`);
      db.exec(`CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('app_version', '9.9.9')`).run();

      expect(() => installSchemaSync(db)).toThrow(SchemaTooNewError);
      try {
        stampSchemaVersion(db);
      } catch (err) {
        // The person reading this is a shop owner, not a developer.
        expect((err as Error).message).toContain("قاعدة البيانات هذه كُتبت بإصدار أحدث");
        expect((err as Error).message).toContain("9.9.9");
      }
      // And it did not quietly downgrade the stamp on the way out.
      expect(readSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION + 1);
    } finally {
      db.close();
    }
  });

  it("opens a database written by an OLDER schema — that is the additive path", () => {
    const dir = mkdtempSync(join(tmpdir(), "mezan-schema-stamp-"));
    dirs.push(dir);
    const file = join(dir, "old.db");
    const writer = new Database(file);
    writer.pragma("user_version = 0");
    writer.exec(`CREATE TABLE widget (id TEXT PRIMARY KEY)`);
    writer.close();

    const reader = new Database(file);
    try {
      expect(() => installSchemaSync(reader)).not.toThrow();
      expect(readSchemaVersion(reader)).toBe(0);
    } finally {
      reader.close();
    }
  });
});
