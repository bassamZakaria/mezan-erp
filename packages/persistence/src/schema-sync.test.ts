import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { installSchemaSync } from "./schema-sync.js";

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
