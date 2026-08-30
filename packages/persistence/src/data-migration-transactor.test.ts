import { describe, it, expect } from "vitest";
import { createDataMigrationTransactor } from "./data-migration-transactor.js";
import { openSqliteConnection } from "./sqlite-connection.js";

describe("createDataMigrationTransactor", () => {
  it("runs a batch of writes atomically: all commit together", async () => {
    const path = ":memory:";
    const { sqlite, owned } = openSqliteConnection(path);
    sqlite.exec(`CREATE TABLE imported_row (id TEXT PRIMARY KEY)`);
    const transactor = createDataMigrationTransactor(sqlite);
    try {
      await transactor.run(async () => {
        sqlite.prepare(`INSERT INTO imported_row VALUES ('r1')`).run();
        sqlite.prepare(`INSERT INTO imported_row VALUES ('r2')`).run();
      });
      const rows = sqlite.prepare(`SELECT id FROM imported_row ORDER BY id`).all();
      expect(rows).toEqual([{ id: "r1" }, { id: "r2" }]);
    } finally {
      transactor.close();
      if (owned) sqlite.close();
    }
  });

  it("rolls back the whole batch when one row's write throws, leaving nothing behind", async () => {
    const { sqlite } = openSqliteConnection(":memory:");
    sqlite.exec(`CREATE TABLE imported_row (id TEXT PRIMARY KEY)`);
    const transactor = createDataMigrationTransactor(sqlite);
    try {
      await expect(
        transactor.run(async () => {
          sqlite.prepare(`INSERT INTO imported_row VALUES ('r1')`).run();
          sqlite.prepare(`INSERT INTO imported_row VALUES ('r2')`).run();
          throw new Error("row 3 invalid");
        }),
      ).rejects.toThrow("row 3 invalid");
      const rows = sqlite.prepare(`SELECT id FROM imported_row ORDER BY id`).all();
      expect(rows).toEqual([]);
    } finally {
      transactor.close();
    }
  });

  it("a numbering draw made inside the batch is not consumed when the batch rolls back", async () => {
    const { sqlite } = openSqliteConnection(":memory:");
    sqlite.exec(`
      CREATE TABLE sequence_counter (
        code   TEXT NOT NULL,
        period TEXT NOT NULL,
        value  INTEGER NOT NULL,
        PRIMARY KEY (code, period)
      );
    `);
    const transactor = createDataMigrationTransactor(sqlite);
    try {
      const drawNumber = () => {
        sqlite
          .prepare(
            `INSERT INTO sequence_counter (code, period, value) VALUES ('IMPORT', '', 1)
             ON CONFLICT(code, period) DO UPDATE SET value = value + 1`,
          )
          .run();
        const row = sqlite.prepare(`SELECT value FROM sequence_counter WHERE code = 'IMPORT' AND period = ''`).get() as {
          value: number;
        };
        return row.value;
      };

      await expect(
        transactor.run(async () => {
          const n = drawNumber();
          expect(n).toBe(1);
          throw new Error("batch failed after drawing a number");
        }),
      ).rejects.toThrow();

      // The whole batch rolled back, including the counter row itself.
      const row = sqlite.prepare(`SELECT value FROM sequence_counter WHERE code = 'IMPORT' AND period = ''`).get();
      expect(row).toBeUndefined();

      // A fresh draw after the rollback starts again at 1 — the failed draw was never consumed.
      const n2 = await transactor.run(async () => drawNumber());
      expect(n2).toBe(1);
    } finally {
      transactor.close();
    }
  });

  it("path form (':memory:') owns and closes its own connection", async () => {
    const transactor = createDataMigrationTransactor(":memory:");
    const result = await transactor.run(async () => 7);
    expect(result).toBe(7);
    expect(() => transactor.close()).not.toThrow();
  });
});
