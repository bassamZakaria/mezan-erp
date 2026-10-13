import Database from "better-sqlite3";

export class SqliteFileBusyError extends Error {
  readonly code = "SQLITE_FILE_BUSY";

  constructor(readonly file: string) {
    super(`"${file}" is open elsewhere and cannot be held exclusively`);
    this.name = "SqliteFileBusyError";
  }
}

export interface HeldSqliteFile {
  release(): void;
}

const DEFAULT_WAIT_MS = 2_000;

function isBusy(err: unknown): boolean {
  const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "";
  return code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED");
}

// REQUIRED ORDERING: exclusive locking first, then out of WAL, then the write
// lock. Leaving WAL succeeds only when no other connection has the file open,
// and it folds the log into the main file; from then until `release` the main
// file alone is the whole database and nothing else can read or write it.
export function holdSqliteFile(file: string, options: { readonly waitMs?: number } = {}): HeldSqliteFile {
  const sqlite = new Database(file, { fileMustExist: true, timeout: options.waitMs ?? DEFAULT_WAIT_MS });
  try {
    sqlite.pragma("locking_mode = EXCLUSIVE");
    if (sqlite.pragma("journal_mode = DELETE", { simple: true }) !== "delete") throw new SqliteFileBusyError(file);
    sqlite.exec("BEGIN EXCLUSIVE");
  } catch (err) {
    sqlite.close();
    throw isBusy(err) ? new SqliteFileBusyError(file) : err;
  }
  return {
    release() {
      if (!sqlite.open) return;
      sqlite.exec("ROLLBACK");
      sqlite.close();
    },
  };
}
