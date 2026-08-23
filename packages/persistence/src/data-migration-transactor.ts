import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";

/**
 * The "all-or-nothing per batch" primitive for the data-migration import
 * routes (packages/api/src/data-migration-routes.ts): wraps a sequence of
 * writes against the SAME shared SQLite connection every other store in
 * `createBackend` writes through (see sqlite-connection.ts's
 * `withSqliteTransaction` doc comment) in one transaction — either every row
 * in the batch commits, or a thrown error rolls all of them back. Pass the
 * backend's shared `sqlite` handle (not a path) so this actually shares the
 * connection those repositories write on; passing a path opens a private
 * connection instead, which is fine for standalone/test use but gives no
 * cross-repository atomicity.
 */
export interface DataMigrationTransactor {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export interface DataMigrationTransactorHandle extends DataMigrationTransactor {
  close(): void;
}

export function createDataMigrationTransactor(
  path: SqliteConnectionInput = ":memory:",
): DataMigrationTransactorHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  return {
    run: (fn) => withSqliteTransaction(sqlite, fn),
    close: () => {
      if (owned) sqlite.close();
    },
  };
}
