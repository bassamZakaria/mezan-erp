import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteDriver } from "./sqlite-connection.js";

describe("openSqliteConnection", () => {
  it("opens and owns a fresh connection for a string path, with WAL + busy_timeout set", () => {
    const { sqlite, owned } = openSqliteConnection(":memory:");
    try {
      expect(owned).toBe(true);
      expect(sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
    } finally {
      sqlite.close();
    }
  });

  it("leaves locking_mode alone unless asked — desktop and LAN must keep sharing the file", () => {
    const { sqlite } = openSqliteConnection(":memory:");
    try {
      expect(sqlite.pragma("locking_mode", { simple: true })).toBe("normal");
    } finally {
      sqlite.close();
    }
  });

  it("sets locking_mode = EXCLUSIVE when asked, which is what lets WAL live on EFS", () => {
    const { sqlite } = openSqliteConnection(":memory:", { exclusive: true });
    try {
      expect(sqlite.pragma("locking_mode", { simple: true })).toBe("exclusive");
    } finally {
      sqlite.close();
    }
  });

  it("sets locking_mode BEFORE journal_mode — after WAL it is accepted but does nothing", () => {
    const pragmas: string[] = [];
    const recordingDriver = function (path: string) {
      const db = new Database(path);
      const original = db.pragma.bind(db);
      db.pragma = (source: string, options?: Database.PragmaOptions) => {
        pragmas.push(source);
        return original(source, options);
      };
      return db;
    } as unknown as SqliteDriver;

    const { sqlite } = openSqliteConnection(":memory:", { exclusive: true, driver: recordingDriver });
    try {
      const locking = pragmas.findIndex((p) => p.startsWith("locking_mode"));
      const journal = pragmas.findIndex((p) => p.startsWith("journal_mode"));
      expect(locking).toBeGreaterThanOrEqual(0);
      expect(journal).toBeGreaterThanOrEqual(0);
      expect(locking).toBeLessThan(journal);
    } finally {
      sqlite.close();
    }
  });

  it("refuses a key on a driver with no cipher, instead of writing plaintext and reporting success", () => {
    // The whole point of the seam: a composition that supplies a key but
    // forgets the driver must fail, not silently produce a readable database
    // that everything downstream believes is encrypted.
    expect(() => openSqliteConnection(":memory:", { key: "a".repeat(64) })).toThrow(
      /no cipher support/,
    );
  });

  it("rejects a key that is not 32 bytes of hex — it is interpolated into a PRAGMA", () => {
    expect(() => openSqliteConnection(":memory:", { key: "'; DROP TABLE t; --" })).toThrow(
      /32 bytes of lowercase hex/,
    );
  });

  it("reuses an existing connection without owning it", () => {
    const shared = new Database(":memory:");
    try {
      const { sqlite, owned } = openSqliteConnection(shared);
      expect(owned).toBe(false);
      expect(sqlite).toBe(shared);
    } finally {
      shared.close();
    }
  });

  it("is safe to call twice on the same shared connection (schema-sync hook installs once)", () => {
    const shared = new Database(":memory:");
    try {
      openSqliteConnection(shared);
      openSqliteConnection(shared);
      shared.exec(`
        CREATE TABLE IF NOT EXISTS t (
          id TEXT PRIMARY KEY,
          a TEXT
        );
      `);
      shared.exec(`
        CREATE TABLE IF NOT EXISTS t (
          id TEXT PRIMARY KEY,
          a TEXT,
          b TEXT
        );
      `);
      const columns = (shared.prepare(`PRAGMA table_info(t)`).all() as { name: string }[]).map((c) => c.name);
      expect(columns).toEqual(["id", "a", "b"]);
    } finally {
      shared.close();
    }
  });
});

describe("withSqliteTransaction", () => {
  function freshDb(): Database.Database {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY)`);
    return db;
  }

  it("commits every write made inside a successful fn", async () => {
    const db = freshDb();
    try {
      await withSqliteTransaction(db, async () => {
        db.prepare("INSERT INTO t VALUES ('a')").run();
        db.prepare("INSERT INTO t VALUES ('b')").run();
      });
      const rows = db.prepare("SELECT id FROM t ORDER BY id").all();
      expect(rows).toEqual([{ id: "a" }, { id: "b" }]);
    } finally {
      db.close();
    }
  });

  it("rolls back every write when fn throws, leaving nothing behind", async () => {
    const db = freshDb();
    try {
      db.prepare("INSERT INTO t VALUES ('pre-existing')").run();
      await expect(
        withSqliteTransaction(db, async () => {
          db.prepare("INSERT INTO t VALUES ('doomed')").run();
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      const rows = db.prepare("SELECT id FROM t ORDER BY id").all();
      expect(rows).toEqual([{ id: "pre-existing" }]);
    } finally {
      db.close();
    }
  });

  it("returns fn's resolved value", async () => {
    const db = freshDb();
    try {
      const result = await withSqliteTransaction(db, async () => {
        db.prepare("INSERT INTO t VALUES ('a')").run();
        return 42;
      });
      expect(result).toBe(42);
    } finally {
      db.close();
    }
  });

  it("uses BEGIN IMMEDIATE when requested", async () => {
    const db = freshDb();
    try {
      const execSpy: string[] = [];
      const originalExec = db.exec.bind(db);
      db.exec = (sql: string) => {
        execSpy.push(sql);
        return originalExec(sql);
      };
      await withSqliteTransaction(db, async () => {}, "BEGIN IMMEDIATE");
      expect(execSpy).toContain("BEGIN IMMEDIATE");
    } finally {
      db.close();
    }
  });

  it("nests as a SAVEPOINT: a caught inner failure rolls back only the inner writes", async () => {
    const db = freshDb();
    try {
      await withSqliteTransaction(db, async () => {
        db.prepare("INSERT INTO t VALUES ('outer')").run();
        await expect(
          withSqliteTransaction(db, async () => {
            db.prepare("INSERT INTO t VALUES ('inner')").run();
            throw new Error("inner boom");
          }),
        ).rejects.toThrow("inner boom");
      });
      const rows = db.prepare("SELECT id FROM t ORDER BY id").all();
      expect(rows).toEqual([{ id: "outer" }]);
    } finally {
      db.close();
    }
  });

  it("nests as a SAVEPOINT: a successful inner commits together with the outer", async () => {
    const db = freshDb();
    try {
      await withSqliteTransaction(db, async () => {
        db.prepare("INSERT INTO t VALUES ('outer')").run();
        await withSqliteTransaction(db, async () => {
          db.prepare("INSERT INTO t VALUES ('inner')").run();
        });
      });
      const rows = db.prepare("SELECT id FROM t ORDER BY id").all();
      expect(rows).toEqual([{ id: "inner" }, { id: "outer" }]);
    } finally {
      db.close();
    }
  });

  it("an uncaught inner failure rolls back the whole outer transaction too", async () => {
    const db = freshDb();
    try {
      await expect(
        withSqliteTransaction(db, async () => {
          db.prepare("INSERT INTO t VALUES ('outer')").run();
          await withSqliteTransaction(db, async () => {
            db.prepare("INSERT INTO t VALUES ('inner')").run();
            throw new Error("boom");
          });
        }),
      ).rejects.toThrow("boom");
      const rows = db.prepare("SELECT id FROM t ORDER BY id").all();
      expect(rows).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("queues concurrent outermost calls on the same connection so they never interleave", async () => {
    const db = freshDb();
    try {
      let active = 0;
      let sawOverlap = false;
      async function op(id: string): Promise<void> {
        await withSqliteTransaction(db, async () => {
          active++;
          if (active > 1) sawOverlap = true;
          await new Promise((resolve) => setTimeout(resolve, 5));
          db.prepare("INSERT INTO t VALUES (?)").run(id);
          active--;
        });
      }
      await Promise.all([op("a"), op("b"), op("c")]);
      expect(sawOverlap).toBe(false);
      const rows = db.prepare("SELECT id FROM t ORDER BY id").all();
      expect(rows).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    } finally {
      db.close();
    }
  });

  it("a failed concurrent outermost call rolls back only its own writes, not its queue-mates'", async () => {
    const db = freshDb();
    try {
      async function op(id: string, fail: boolean): Promise<void> {
        await withSqliteTransaction(db, async () => {
          db.prepare("INSERT INTO t VALUES (?)").run(id);
          if (fail) throw new Error(`${id} boom`);
        });
      }
      const results = await Promise.allSettled([op("a", false), op("b", true), op("c", false)]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
      const rows = db.prepare("SELECT id FROM t ORDER BY id").all();
      expect(rows).toEqual([{ id: "a" }, { id: "c" }]);
    } finally {
      db.close();
    }
  });
});
