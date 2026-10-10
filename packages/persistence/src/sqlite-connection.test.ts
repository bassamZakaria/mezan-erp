import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import {
  openSqliteConnection,
  sqliteTransactionsSettled,
  withSqliteRead,
  withSqliteTransaction,
  withSqliteTurn,
  type SqliteDriver,
} from "./sqlite-connection.js";

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

/**
 * The latent dirty-read hazard on the shared connection, pinned both ways.
 *
 * Every store shares ONE connection and SQLite shows a connection its own
 * uncommitted rows, so isolation today rests entirely on better-sqlite3 being
 * synchronous — a transaction that never yields cannot be interleaved with.
 * These two tests are what stops that from being an accident nobody notices.
 */
describe("withSqliteTransaction — the dirty-read invariant", () => {
  function table(): Database.Database {
    const sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE t (id TEXT PRIMARY KEY, amount INTEGER NOT NULL)`);
    return sqlite;
  }
  const rows = (sqlite: Database.Database) =>
    (sqlite.prepare(`SELECT id FROM t ORDER BY id`).all() as { id: string }[]).map((r) => r.id);

  it("A TRANSACTION THAT NEVER YIELDS CANNOT BE READ INTO — the property every store relies on", async () => {
    const sqlite = table();
    const seen: string[][] = [];
    await Promise.all([
      withSqliteTransaction(sqlite, async () => {
        sqlite.prepare(`INSERT INTO t (id, amount) VALUES ('a', 1)`).run();
        // No await on anything real: better-sqlite3 is synchronous, so the
        // concurrent reader below cannot run before COMMIT.
        sqlite.prepare(`INSERT INTO t (id, amount) VALUES ('b', 2)`).run();
        throw new Error("rolled back");
      }).catch(() => {}),
      (async () => {
        seen.push(rows(sqlite));
      })(),
    ]);
    expect(seen.every((snapshot) => snapshot.length === 0)).toBe(true);
    expect(rows(sqlite)).toEqual([]);
  });

  it("LIMITATION: a transaction that awaits real I/O DOES leak its uncommitted rows to a plain read", async () => {
    const sqlite = table();
    let leaked: string[] = [];
    await withSqliteTransaction(sqlite, async () => {
      sqlite.prepare(`INSERT INTO t (id, amount) VALUES ('a', 1)`).run();
      // Stands in for the `await fetch()` / attachment write the audit warns
      // about: the moment a transaction yields, another request's read runs.
      await new Promise((resolve) => setTimeout(resolve, 0));
      leaked = rows(sqlite);
      throw new Error("rolled back");
    }).catch(() => {});
    // The row was never committed, and a plain read saw it anyway.
    expect(leaked).toEqual(["a"]);
    expect(rows(sqlite)).toEqual([]);
  });

  it("withSqliteRead takes the mutex, so it observes only committed rows", async () => {
    const sqlite = table();
    let observed: string[] = [];
    const write = withSqliteTransaction(sqlite, async () => {
      sqlite.prepare(`INSERT INTO t (id, amount) VALUES ('a', 1)`).run();
      await new Promise((resolve) => setTimeout(resolve, 5));
      sqlite.prepare(`INSERT INTO t (id, amount) VALUES ('b', 2)`).run();
    });
    const read = withSqliteRead(sqlite, () => {
      observed = rows(sqlite);
    });
    await Promise.all([write, read]);
    // The read waited for the COMMIT rather than catching the half-written set.
    expect(observed).toEqual(["a", "b"]);
  });

  it("a read nested INSIDE its own transaction runs straight through rather than deadlocking", async () => {
    const sqlite = table();
    const inside = await withSqliteTransaction(sqlite, async () => {
      sqlite.prepare(`INSERT INTO t (id, amount) VALUES ('a', 1)`).run();
      return withSqliteRead(sqlite, () => rows(sqlite));
    });
    expect(inside).toEqual(["a"]);
  });
});

describe("withSqliteTurn", () => {
  const open = () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE t (v TEXT)");
    return sqlite;
  };
  const values = (sqlite: Database.Database) => (sqlite.prepare("SELECT v FROM t ORDER BY rowid").all() as { v: string }[]).map((r) => r.v);
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const insert = (sqlite: Database.Database, v: string) => sqlite.prepare("INSERT INTO t VALUES (?)").run(v);

  it("keeps another chain's transaction from opening until the holder is done, even across a wait", async () => {
    const sqlite = open();
    const order: string[] = [];
    const holder = withSqliteTurn(sqlite, async () => {
      await tick();
      insert(sqlite, "holder");
      order.push("holder wrote");
    });
    const other = withSqliteTransaction(sqlite, async () => {
      order.push("other began");
      insert(sqlite, "other");
      throw new Error("rolled back");
    }).catch(() => undefined);

    await Promise.all([holder, other]);

    expect(order).toEqual(["holder wrote", "other began"]);
    expect(values(sqlite)).toEqual(["holder"]);
    sqlite.close();
  });

  it("lets the holder open transactions without waiting on the queue it holds, one at a time", async () => {
    const sqlite = open();
    await withSqliteTurn(sqlite, async () => {
      await Promise.all(
        ["a", "b"].map((v) =>
          withSqliteTransaction(sqlite, async () => {
            await tick();
            insert(sqlite, v);
          }),
        ),
      );
      await withSqliteRead(sqlite, () => undefined);
      await withSqliteTurn(sqlite, async () => insert(sqlite, "c"));
    });

    expect(values(sqlite)).toEqual(["a", "b", "c"]);
    expect(sqlite.inTransaction).toBe(false);
    sqlite.close();
  });

  it("sends a task the holder left running back to the shared queue once the turn is over", async () => {
    const sqlite = open();
    let detached!: Promise<void>;
    let letGo!: () => void;
    const lingering = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    await withSqliteTurn(sqlite, async () => {
      detached = (async () => {
        await lingering;
        await withSqliteTransaction(sqlite, async () => insert(sqlite, "detached"));
      })();
    });

    let finishNext!: () => void;
    const nextHolder = withSqliteTransaction(sqlite, async () => {
      insert(sqlite, "next");
      await new Promise<void>((resolve) => {
        finishNext = resolve;
      });
    });
    await tick();
    letGo();
    await tick();
    expect(values(sqlite)).toEqual(["next"]);

    finishNext();
    await Promise.all([nextHolder, detached]);
    expect(values(sqlite)).toEqual(["next", "detached"]);
    sqlite.close();
  });

  it("does not hand the connection on while a transaction the holder started is still open", async () => {
    const sqlite = open();
    let finishInner!: () => void;
    let inner!: Promise<void>;
    const holder = withSqliteTurn(sqlite, async () => {
      inner = withSqliteTransaction(sqlite, async () => {
        insert(sqlite, "inner");
        await new Promise<void>((resolve) => {
          finishInner = resolve;
        });
      });
      await tick();
    });
    const next = withSqliteTransaction(sqlite, async () => insert(sqlite, "next"));

    await tick();
    await tick();
    expect(values(sqlite)).toEqual(["inner"]);

    finishInner();
    await Promise.all([holder, inner, next]);
    expect(values(sqlite)).toEqual(["inner", "next"]);
    sqlite.close();
  });
});

describe("sqliteTransactionsSettled", () => {
  it("waits for an open transaction, and not for a turn that has none open", async () => {
    const sqlite = new Database(":memory:");
    let finish!: () => void;
    const turn = withSqliteTurn(sqlite, async () => {
      await sqliteTransactionsSettled(sqlite);
      await withSqliteTransaction(sqlite, async () => {
        await sqliteTransactionsSettled(sqlite);
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      });
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(sqlite.inTransaction).toBe(true);

    let settled = false;
    const waiting = sqliteTransactionsSettled(sqlite).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    finish();
    await Promise.all([turn, waiting]);
    expect(settled).toBe(true);
    expect(sqlite.inTransaction).toBe(false);
    sqlite.close();
  });
});
