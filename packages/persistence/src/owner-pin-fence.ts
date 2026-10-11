import type Database from "better-sqlite3";

export interface OwnerPinFence {
  /** The highest generation that has written the owner's PIN. Zero when none has. */
  current(): number;
  raiseTo(generation: number): void;
}

export function createSqliteOwnerPinFence(sqlite: Database.Database): OwnerPinFence {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS owner_pin_fence (id INTEGER PRIMARY KEY CHECK (id = 1), generation INTEGER NOT NULL)`);
  const read = sqlite.prepare(`SELECT generation FROM owner_pin_fence WHERE id = 1`);
  const write = sqlite.prepare(
    `INSERT INTO owner_pin_fence (id, generation) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET generation = MAX(generation, excluded.generation)`,
  );
  return {
    current: () => (read.get() as { generation: number } | undefined)?.generation ?? 0,
    raiseTo: (generation) => {
      write.run(generation);
    },
  };
}
