import { AsyncLocalStorage } from "node:async_hooks";
import Database from "better-sqlite3";
import { installSchemaSync } from "./schema-sync.js";

/**
 * What a `createSqliteXStore(...)` factory accepts in place of a bare path:
 * either a string (":memory:" for tests, a file path for real storage — the
 * factory opens and owns its own connection), or an already-open connection
 * to reuse (the factory does not own it and never closes it).
 */
export type SqliteConnectionInput = string | Database.Database;

export interface OpenedSqliteConnection {
  readonly sqlite: Database.Database;
  /** True when this call opened the connection and is responsible for closing it. */
  readonly owned: boolean;
}

/**
 * Opens (or reuses) a better-sqlite3 connection for a persistence store.
 *
 * Every store in this package used to call `new Database(path)` on its own,
 * which is fine when each store's `path` is a distinct file (or its own
 * private ":memory:" instance, as in most unit tests) — but
 * packages/backend/src/create-backend.ts wires ~35 of these stores at the
 * SAME on-disk file path, so in that shape every store was opening its OWN
 * writer connection to ONE physical file. better-sqlite3/SQLite allows only
 * one writer at a time even in WAL mode, and several of these stores call
 * into each other from inside an open `BEGIN`/`BEGIN IMMEDIATE` (e.g. sales-
 * invoice confirm: the sales-invoice-store's transaction calls the stock
 * engine and the GL engine, each backed by their own connection) — so the
 * outer connection's write lock blocked the inner one's write, which is a
 * same-call-stack deadlock no `busy_timeout` can wait out (the outer
 * connection can't release the lock until the inner call returns). See
 * packages/backend/src/create-backend.test.ts's concurrency regression test.
 *
 * The fix: a caller that wants several stores to actually share ONE writer
 * (i.e. `createBackend`) opens ONE `Database` connection itself and passes
 * it — instead of a path — to every store factory. Passing a string still
 * opens (and pragma-configures) a fresh, store-owned connection exactly as
 * before, so every existing `createSqliteXStore(":memory:")` / `(path)` call
 * site (tests, and any standalone usage) is unaffected.
 */
export function openSqliteConnection(input: SqliteConnectionInput): OpenedSqliteConnection {
  if (typeof input !== "string") {
    installSchemaSync(input);
    return { sqlite: input, owned: false };
  }
  const sqlite = new Database(input);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  installSchemaSync(sqlite);
  return { sqlite, owned: true };
}

let savepointCounter = 0;

interface ConnectionState {
  /**
   * Marks "this async call chain is already running inside this connection's
   * outermost transaction()". Deliberately NOT `sqlite.inTransaction` — that
   * flag is true for the WHOLE connection the instant any caller's BEGIN
   * lands, so it can't tell "I am a nested call of the transaction that's
   * currently open" apart from "some unrelated concurrent operation on this
   * shared connection happens to have a transaction open right now, and I
   * should wait my turn instead of piggy-backing a SAVEPOINT onto it".
   * AsyncLocalStorage threads correctly through this call's own await chain
   * (including Promise.all-style concurrent callers, each with their own
   * chain), which a plain module/connection-level boolean cannot.
   */
  readonly nesting: AsyncLocalStorage<true>;
  /** Tail of the serialization queue — see `withSqliteTransaction` below. */
  queue: Promise<void>;
}

const connectionStates = new WeakMap<Database.Database, ConnectionState>();

function stateFor(sqlite: Database.Database): ConnectionState {
  let state = connectionStates.get(sqlite);
  if (!state) {
    state = { nesting: new AsyncLocalStorage<true>(), queue: Promise.resolve() };
    connectionStates.set(sqlite, state);
  }
  return state;
}

/**
 * Runs `fn` inside a transaction on `sqlite`, safe for both re-entrancy AND
 * real concurrency on a connection several stores now share (see
 * `openSqliteConnection` above / packages/backend's `createBackend`):
 *
 * - Re-entrancy: a single logical operation often nests one store's
 *   `transaction()` inside another's — e.g. sales-invoice confirm: the
 *   sales-invoice store's transaction calls the stock engine's transaction
 *   and the ledger's numbering increment, all on the same shared connection.
 *   SQLite refuses a second top-level `BEGIN` on one connection ("cannot
 *   start a transaction within a transaction"), so a nested call (detected
 *   via the AsyncLocalStorage flag above) opens a `SAVEPOINT` instead — it
 *   commits/rolls back together with the outer transaction.
 * - Concurrency: two UNRELATED operations (e.g. two HTTP requests confirming
 *   different invoices) can overlap on this same connection. Only one
 *   top-level transaction may be open at a time, so outermost calls queue
 *   on a per-connection async mutex and run strictly one after another —
 *   otherwise their BEGINs/SAVEPOINTs would interleave and corrupt each
 *   other's savepoint stack (observed as "no such savepoint: sp_N" under
 *   concurrent confirms before this queue existed). This never surfaces as
 *   SQLITE_BUSY: each waits its turn instead of contending for the write
 *   lock, so nothing times out or throws.
 */
export async function withSqliteTransaction<T>(
  sqlite: Database.Database,
  fn: () => Promise<T>,
  beginStatement: "BEGIN" | "BEGIN IMMEDIATE" = "BEGIN",
): Promise<T> {
  const state = stateFor(sqlite);

  if (state.nesting.getStore()) {
    const savepoint = `sp_${++savepointCounter}`;
    sqlite.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = await fn();
      sqlite.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (err) {
      sqlite.exec(`ROLLBACK TO ${savepoint}`);
      sqlite.exec(`RELEASE ${savepoint}`);
      throw err;
    }
  }

  // Outermost call: claim this connection's mutex — wait for whatever
  // outermost transaction (if any) is currently running to finish first.
  const previous = state.queue;
  let release!: () => void;
  state.queue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;

  try {
    return await state.nesting.run(true, async () => {
      sqlite.exec(beginStatement);
      try {
        const result = await fn();
        sqlite.exec("COMMIT");
        return result;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    });
  } finally {
    release();
  }
}
