import type Database from "better-sqlite3";
import { greatest } from "./sql/insertion-order.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const OWNER_PIN_FENCE_DDL = `CREATE TABLE IF NOT EXISTS owner_pin_fence (id INTEGER PRIMARY KEY CHECK (id = 1), generation INTEGER NOT NULL)`;

export interface OwnerPinFence {
  current(): Promise<number>;
  raiseTo(generation: number): Promise<void>;
}

export async function ensureOwnerPinFenceSchema(db: SqlDb): Promise<void> {
  await db.applySchema(OWNER_PIN_FENCE_DDL);
}

export function createOwnerPinFence(db: SqlDb): OwnerPinFence {
  return {
    current: async () => Number((await db.get<{ generation: bigint }>(`SELECT generation FROM owner_pin_fence WHERE id = 1`))?.generation ?? 0),
    raiseTo: async (generation) => {
      await db.run(
        `INSERT INTO owner_pin_fence (id, generation) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET generation = ${greatest(db, "owner_pin_fence.generation", "excluded.generation")}`,
        [generation],
      );
    },
  };
}

export function createSqliteOwnerPinFence(sqlite: Database.Database): OwnerPinFence {
  sqlite.exec(OWNER_PIN_FENCE_DDL);
  return createOwnerPinFence(sqliteDb(sqlite));
}
