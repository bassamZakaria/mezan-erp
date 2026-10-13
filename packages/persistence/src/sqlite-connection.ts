import { AsyncLocalStorage } from "node:async_hooks";
import Database from "better-sqlite3";
import { ConnectionTurnLostError, ForeignWriteError } from "@mezan/domain";
import { installSchemaSync } from "./schema-sync.js";
import { reportForeignWrite } from "./untransacted-audits.js";

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
 * A `better-sqlite3`-compatible constructor. The only substitution this repo
 * makes is `better-sqlite3-multiple-ciphers` (apps/desktop), a fork of the same
 * major version that adds `PRAGMA key`; nothing else may be passed here,
 * because every store in this package is written against better-sqlite3's exact
 * synchronous API.
 */
export type SqliteDriver = typeof Database;

/** A 32-byte encryption key, lowercase hex. */
const RAW_KEY_RE = /^[0-9a-f]{64}$/;

export interface SqliteOpenOptions {
  /**
   * Overrides the driver this call constructs the connection with. Defaults to
   * `better-sqlite3` — the driver ~800 test files, apps/server, the scenario
   * harness and the web dev build all run on. Swapping it globally would put a
   * native-module load failure between every edition and its own books, so the
   * substitution is per-composition and opt-in.
   */
  readonly driver?: SqliteDriver;
  /**
   * Encrypts the database at rest. 32 bytes of key material, lowercase hex —
   * applied as `PRAGMA key` before any other statement, which is the only point
   * at which SQLite3MultipleCiphers will accept it.
   *
   * Requires a `driver` that actually implements a cipher. Passing a key to
   * plain better-sqlite3 would be a no-op PRAGMA — the database would stay
   * readable by anyone holding the file while the caller believed it was
   * encrypted — so that combination throws instead.
   */
  readonly key?: string;
  /**
   * Opens the database in `locking_mode = EXCLUSIVE`, which is what makes WAL
   * usable on a network filesystem: WAL normally coordinates readers and
   * writers through a shared-memory index file, which NFS cannot provide, and
   * SQLite only skips that index when one connection holds the file
   * exclusively. The cloud edition (apps/server on an EFS data directory,
   * MEZAN_SQLITE_EXCLUSIVE=1) is exactly that shape: one task, one writer.
   *
   * The cost is that no second process can open the file at all while this
   * connection lives — which is why desktop and LAN, where a backup or a
   * second till may want the file, leave it off.
   */
  readonly exclusive?: boolean;
  readonly fileMustExist?: boolean;
}

/**
 * Turns the key into the SQL literal SQLite3MultipleCiphers reads as RAW key
 * material rather than as a passphrase to run through PBKDF2. The regex above
 * is what makes the interpolation safe: the value can only ever be 64 hex
 * characters, and better-sqlite3 has no parameter binding for PRAGMA values.
 */
function applyKey(sqlite: Database.Database, key: string): void {
  if (!RAW_KEY_RE.test(key)) {
    throw new Error("SQLite encryption key must be 32 bytes of lowercase hex.");
  }
  sqlite.pragma(`key = "x'${key}'"`);
  // `PRAGMA cipher` is unknown to plain better-sqlite3 and returns nothing,
  // where SQLite3MultipleCiphers answers with the active cipher. Without this
  // check a wrong-driver composition degrades silently to a plaintext file.
  const cipher = sqlite.pragma("cipher") as unknown[];
  if (!Array.isArray(cipher) || cipher.length === 0) {
    sqlite.close();
    throw new Error(
      "SQLite driver has no cipher support — an encryption key was supplied but the database would be written in plaintext.",
    );
  }
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
 *
 * `options` is the encryption-at-rest seam. Omitted — which is every call site
 * except the desktop composition — this opens plain `better-sqlite3` with no
 * key, byte for byte what it did before the seam existed.
 */
export function openSqliteConnection(
  input: SqliteConnectionInput,
  options: SqliteOpenOptions = {},
): OpenedSqliteConnection {
  if (typeof input !== "string") {
    installSchemaSync(input);
    watchForForeignWrites(input);
    return { sqlite: input, owned: false };
  }
  const sqlite = new (options.driver ?? Database)(input, { fileMustExist: options.fileMustExist === true });
  // Before every other statement, WAL included: SQLite3MultipleCiphers only
  // honours `PRAGMA key` while the database header is still unread.
  if (options.key !== undefined) applyKey(sqlite, options.key);
  // ORDER MATTERS: locking_mode must be EXCLUSIVE before the database enters
  // WAL. Set afterwards it is accepted but does not take effect until the next
  // time WAL is re-entered, so the shared-memory index NFS cannot serve is
  // created anyway and the first write fails on the network filesystem.
  if (options.exclusive === true) sqlite.pragma("locking_mode = EXCLUSIVE");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  installSchemaSync(sqlite);
  watchForForeignWrites(sqlite);
  return { sqlite, owned: true };
}

const watched = new WeakSet<Database.Database>();

// A WRITE THAT LANDS INSIDE ANOTHER CHAIN'S OPEN TRANSACTION IS LOST IF THAT
// TRANSACTION ROLLS BACK, and nothing says so: the statement succeeds. Every
// writer is meant to be unable to get there — a request holds the turn, a
// background task takes it, and no transaction is left open across a wait —
// so one that does is REFUSED before it runs and reported by its statement.
// The suites and the seed drives assert none ever is.
function refuseForeignWrite(statement: string): never {
  reportForeignWrite(statement);
  throw new ForeignWriteError(statement);
}

function watchForForeignWrites(sqlite: Database.Database): void {
  if (watched.has(sqlite)) return;
  watched.add(sqlite);
  const foreign = (): boolean => {
    const state = connectionStates.get(sqlite);
    return state !== undefined && state.transaction !== null && !state.nesting.getStore();
  };
  const named = (source: string): string => source.trim().replace(/\s+/g, " ").slice(0, 80);

  const prepare = sqlite.prepare.bind(sqlite);
  sqlite.prepare = ((source: string) => {
    const statement = prepare(source);
    if (statement.readonly) return statement;
    for (const method of WRITING_STATEMENT_METHODS) {
      const original = statement[method].bind(statement) as (...params: unknown[]) => unknown;
      (statement as unknown as Record<string, unknown>)[method] = (...params: unknown[]) => {
        if (foreign()) refuseForeignWrite(named(source));
        return original(...params);
      };
    }
    return statement;
  }) as typeof sqlite.prepare;

  const exec = sqlite.exec.bind(sqlite);
  sqlite.exec = ((source: string) => {
    if (foreign() && !READ_ONLY_EXEC.test(source)) refuseForeignWrite(named(source));
    return exec(source);
  }) as typeof sqlite.exec;

  // The driver's own `transaction()` opens a SAVEPOINT when a transaction is
  // already open, so its whole body would land inside another chain's.
  const transaction = sqlite.transaction.bind(sqlite) as (fn: (...args: unknown[]) => unknown) => unknown;
  sqlite.transaction = ((fn: (...args: unknown[]) => unknown) =>
    transaction((...args: unknown[]) => {
      if (foreign()) refuseForeignWrite(DRIVER_TRANSACTION);
      return fn(...args);
    })) as typeof sqlite.transaction;
}

const WRITING_STATEMENT_METHODS = ["run", "get", "all", "iterate"] as const;
const READ_ONLY_EXEC = /^\s*(PRAGMA|SELECT)\b/i;
const DRIVER_TRANSACTION = "db.transaction";

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
  readonly turn: AsyncLocalStorage<TurnScope>;
  // REQUIRED: marks a chain that is already inside a handed-back section of
  // this scope. A second section on the same chain must run straight through:
  // it would otherwise wait for the turn its own outer section returns only
  // after it finishes.
  readonly handedBack: AsyncLocalStorage<TurnScope>;
  transaction: Promise<void> | null;
}

interface Lane {
  queue: Promise<void>;
}

export interface SqliteTurnObserver {
  onYield?(): void;
  onSuspend?(): void;
  onResume?(): void;
  readonly retakeTimeoutMs?: number;
  readonly completedRetakeTimeoutMs?: number;
}

const RETAKE_TIMEOUT_MS = 10_000;
// REQUIRED: longer than the deadline of every call made with the turn handed
// back (OUTSIDE_WORK_DEADLINES_MS), so work that completed is never abandoned
// while a neighbour's own outside call is still inside its deadline.
export const COMPLETED_RETAKE_TIMEOUT_MS = 120_000;

type OutsideOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

interface TurnScope extends Lane {
  active: boolean;
  ended: boolean;
  abandoned: boolean;
  outside: number;
  steps: Promise<void>;
  retaken: Promise<void>;
  announceRetaken: () => void;
  release: () => void;
  readonly leftRunning: Set<Promise<unknown>>;
  probe: ReturnType<typeof setImmediate> | undefined;
  readonly observer: SqliteTurnObserver;
}

const connectionStates = new WeakMap<Database.Database, ConnectionState>();

function heldTurn(state: ConnectionState): TurnScope | undefined {
  const scope = state.turn.getStore();
  return scope?.active ? scope : undefined;
}

async function enter(lane: Lane): Promise<() => void> {
  const previous = lane.queue;
  let release!: () => void;
  lane.queue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  return release;
}

function stateFor(sqlite: Database.Database): ConnectionState {
  let state = connectionStates.get(sqlite);
  if (!state) {
    state = { nesting: new AsyncLocalStorage<true>(), queue: Promise.resolve(), turn: new AsyncLocalStorage<TurnScope>(), handedBack: new AsyncLocalStorage<TurnScope>(), transaction: null };
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
 *
 * READS DO NOT TAKE THIS MUTEX, AND THAT IS A LATENT DIRTY-READ HAZARD.
 * Every store in this package shares ONE connection, and SQLite shows a
 * connection its own uncommitted rows. A read issued on this connection while
 * a transaction is open therefore observes rows that may still roll back.
 *
 * It is safe ONLY for a `fn` that never yields the event loop: `better-sqlite3`
 * is fully synchronous, so a body that only touches the database lets no other
 * request interleave between the BEGIN and the COMMIT. That is a property of
 * what each transaction body contains, not of this function, and it has been
 * broken before — a password hashed with scrypt inside `uow.transaction` gave
 * the loop away for the length of the hash. The same gap also takes WRITES: a
 * store that writes by plain autocommit, or through better-sqlite3's own
 * `transaction()`, lands inside the open transaction and is lost if it rolls
 * back. ONE `await fetch()`, one attachment write, one `await` on
 * a timer inside a confirm — e.g. sales-invoices/service.ts's confirm path —
 * opens the window, and every till on the LAN can then read a half-posted
 * invoice.
 *
 * The mechanism for a read that must not see uncommitted rows is
 * {@link withSqliteRead}: it queues on the same per-connection mutex, so it
 * runs strictly between transactions. It is deliberately NOT applied to every
 * store read — that would serialize the whole application behind the write
 * lock — so a caller opts in where the isolation matters.
 * `sqlite-connection.test.ts` pins both halves of this: the hazard, and the
 * isolation `withSqliteRead` restores.
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
  const release = await enter(heldTurn(state) ?? state);
  let ended!: () => void;

  try {
    return await state.nesting.run(true, async () => {
      sqlite.exec(beginStatement);
      state.transaction = new Promise<void>((resolve) => {
        ended = resolve;
      });
      try {
        const result = await fn();
        sqlite.exec("COMMIT");
        return result;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      } finally {
        state.transaction = null;
        ended();
      }
    });
  } finally {
    release();
  }
}

export function insideSqliteTransaction(sqlite: Database.Database): boolean {
  return stateFor(sqlite).nesting.getStore() === true;
}

/**
 * Runs `fn` with this connection's transaction mutex held, so it cannot observe
 * a transaction's uncommitted rows — see the dirty-read note on
 * {@link withSqliteTransaction}.
 *
 * A nested call (already inside this connection's transaction) runs straight
 * through: it is that transaction's OWN read, and queueing on a mutex the
 * caller already holds would deadlock.
 */
export async function withSqliteRead<T>(sqlite: Database.Database, fn: () => T | Promise<T>): Promise<T> {
  const state = stateFor(sqlite);
  if (state.nesting.getStore()) return fn();

  const release = await enter(heldTurn(state) ?? state);
  try {
    return await fn();
  } finally {
    release();
  }
}

// THE DATABASE WORK OF A MUTATING REQUEST RUNS UNDER ONE TURN. Every store
// shares this connection and most of them write by plain autocommit, so a write
// issued while another chain's BEGIN is open lands inside that transaction and
// is lost if it rolls back. Waiting only at the door does not close that: a
// request that got in before the BEGIN and then awaited would still write into
// it. Holding the queue from the first statement to the last does.
// The scope goes inactive BEFORE the queue is released, and the lane is drained
// first: a task the request left running keeps this async context, and must
// neither skip the shared queue once the turn is over nor still be mid-
// transaction when the next holder issues its BEGIN.
function arm(scope: TurnScope): void {
  scope.probe = setImmediate(() => {
    scope.probe = undefined;
    scope.observer.onYield?.();
  });
}

function handBack(scope: TurnScope): Promise<void> {
  scope.active = false;
  if (scope.probe) clearImmediate(scope.probe);
  scope.probe = undefined;
  scope.retaken = new Promise<void>((resolve) => {
    scope.announceRetaken = resolve;
  });
  return drained(scope).then(scope.release);
}

async function drained(scope: TurnScope): Promise<void> {
  let seen: Promise<void> | undefined;
  while (seen !== scope.queue) {
    seen = scope.queue;
    await seen;
  }
}

function inOrder(scope: TurnScope, step: () => Promise<void>): Promise<void> {
  const done = scope.steps.then(step);
  scope.steps = done.catch(() => undefined);
  return done;
}

export async function withSqliteTurn<T>(sqlite: Database.Database, fn: () => Promise<T>, observer: SqliteTurnObserver = {}): Promise<T> {
  const state = stateFor(sqlite);
  if (state.nesting.getStore()) return fn();
  const holder = heldTurn(state);
  if (holder) return within(holder, fn);

  const scope: TurnScope = {
    queue: Promise.resolve(),
    active: true,
    ended: false,
    abandoned: false,
    outside: 0,
    steps: Promise.resolve(),
    retaken: Promise.resolve(),
    announceRetaken: () => undefined,
    release: await enter(state),
    leftRunning: new Set(),
    probe: undefined,
    observer,
  };
  arm(scope);
  try {
    return await state.turn.run(scope, fn);
  } finally {
    while (scope.leftRunning.size > 0) await Promise.allSettled([...scope.leftRunning]);
    scope.ended = true;
    const closed = inOrder(scope, async () => {
      if (scope.active) await handBack(scope);
      scope.announceRetaken();
    });
    if (scope.abandoned) void closed.catch(() => undefined);
    else await closed;
  }
}

// THE WAIT TO TAKE THE TURN AGAIN IS BOUNDED. A holder that never finishes
// would otherwise keep every chain that handed the turn back waiting for good —
// and with it whatever that chain holds for the length of its request. Work
// that COMPLETED outside waits the longer bound: its effect has happened and
// has still to be recorded, and when even that passes its answer travels on
// the error so the caller can record it under a turn of its own.
async function retakenInTime<T>(scope: TurnScope, outcome: OutsideOutcome<T>): Promise<void> {
  const waitMs = outcome.ok
    ? (scope.observer.completedRetakeTimeoutMs ?? COMPLETED_RETAKE_TIMEOUT_MS)
    : (scope.observer.retakeTimeoutMs ?? RETAKE_TIMEOUT_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<true>((resolve) => {
    timer = setTimeout(() => resolve(true), waitMs);
    timer.unref?.();
  });
  const lost = await Promise.race([scope.retaken.then(() => false as const), gaveUp]);
  clearTimeout(timer);
  if (!lost || scope.active) return;
  scope.abandoned = true;
  scope.ended = true;
  throw new ConnectionTurnLostError(waitMs, outcome.ok ? { completed: { value: outcome.value } } : { cause: outcome.error });
}

// Database work a holder starts and does not wait for — an event subscriber, a
// bridge — asks for the turn too. It already has it, and the turn is not
// handed on until that work is done: otherwise it would still be writing when
// the next holder opens its BEGIN.
function within<T>(holder: TurnScope, fn: () => Promise<T>): Promise<T> {
  const running = fn();
  holder.leftRunning.add(running);
  const done = (): void => void holder.leftRunning.delete(running);
  running.then(done, done);
  return running;
}

// WORK THAT IS NOT THE DATABASE IS DONE WITH THE TURN HANDED BACK. A hash on the
// thread pool, a child process, a socket: awaited under the turn, each keeps
// every other write of the tenant queued for as long as the outside world takes
// to answer. The turn is taken again before `fn`'s caller continues, so what it
// writes next is still the only write on the connection. Sections that overlap
// all continue together, once the last of them is back.
// Inside a transaction the turn cannot be handed back — the BEGIN is open on the
// shared connection — so `fn` runs as it is and the turn's probe reports it.
export async function outsideSqliteTurn<T>(sqlite: Database.Database, fn: () => Promise<T>): Promise<T> {
  const state = stateFor(sqlite);
  const scope = state.turn.getStore();
  if (!scope || scope.ended || state.nesting.getStore() || state.handedBack.getStore() === scope) return fn();

  scope.outside += 1;
  await inOrder(scope, async () => {
    if (!scope.active || scope.ended) return;
    await handBack(scope);
    scope.observer.onSuspend?.();
  });
  let outcome: OutsideOutcome<T>;
  try {
    outcome = { ok: true, value: await state.handedBack.run(scope, fn) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  {
    scope.outside -= 1;
    void inOrder(scope, async () => {
      if (scope.outside > 0 || scope.active || scope.ended) return;
      const release = await enter(state);
      if (scope.outside > 0 || scope.ended) {
        release();
        return;
      }
      scope.release = release;
      scope.queue = Promise.resolve();
      scope.active = true;
      arm(scope);
      scope.observer.onResume?.();
      scope.announceRetaken();
    });
    await retakenInTime(scope, outcome);
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

export function holdsSqliteTurn(sqlite: Database.Database): boolean {
  return heldTurn(stateFor(sqlite)) !== undefined;
}

export async function sqliteTransactionsSettled(sqlite: Database.Database): Promise<void> {
  const state = stateFor(sqlite);
  if (state.nesting.getStore()) return;
  while (state.transaction) await state.transaction;
}
