# Porting a persistence store to the shared SQL layer

The cloud edition runs on Postgres (one schema and one role per tenant); the desktop
edition stays on encrypted SQLite. Every store in `packages/persistence` is written
once, against `SqlDb` (`packages/persistence/src/sql/sql-db.ts`), and runs on both.

- `packages/persistence` — shared stores + the SQLite adapter. Never imports `pg`.
- `packages/persistence-postgres` — the Postgres adapter, tenant pools, provisioning.
  Only `apps/server` (the cloud) depends on it. The desktop app must never import it.

**The worked example is `packages/persistence/src/ledger-store.ts`.** Read it first.

## Shape of a ported store

```ts
const X_DDL = `CREATE TABLE IF NOT EXISTS ... ;`;          // SQLite dialect, one copy

class SqlXStore implements XPort { constructor(private readonly db: SqlDb) {} ... }

export async function ensureXSchema(db: SqlDb): Promise<void> {
  await db.applySchema(X_DDL);                              // Postgres translates it
}

export function createXStore(db: SqlDb, ...deps): XStoreHandle { return new SqlXStore(db); }

// Desktop + every existing caller: signature and behaviour unchanged.
export function createSqliteXStore(path: SqliteConnectionInput = ":memory:", ...deps): SqliteXStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(X_DDL);                    // + any legacy SQLite-only upgrade steps, unchanged
  return Object.assign(createXStore(sqliteDb(sqlite), ...deps), { close: () => { if (owned) sqlite.close(); } });
}
```

- `createSqliteXStore` keeps its exact signature and stays synchronous. Old-file
  migrations (`PRAGMA table_info`, backfills) stay in it — a Postgres tenant is
  always created at the current shape.
- Export `createXStore` and `ensureXSchema` from `packages/persistence/src/index.ts`.

## Queries

- Only `db.all / db.get / db.run / db.exec`. No `.prepare`, no `better-sqlite3` import
  outside the `createSqliteXStore` factory.
- `?` placeholders only. Named params (`@id`) become positional.
- Integer columns, `COUNT`, `SUM` come back as **bigint** on both dialects. Use
  `Number(x)` for counts and small ints, `Money.fromScaled(x)` / `Qty.fromScaled(x)`
  for money and quantities. Write money as `money.scaled` (bigint), never
  `toScaledNumber()`.
- Never select `AVG(...)`, a fractional NUMERIC, or a BOOLEAN: they read back
  differently on the two dialects. Booleans are INTEGER 0/1, compared with `= 1`.
- Never write `? IS NULL` or any placeholder whose type Postgres cannot infer.
  Build the optional clause in JS instead (see `treasuryAccountBalance`).
- String literals in single quotes only. `"x"` is an identifier on Postgres.
- `GROUP BY` must list every selected non-aggregate column (Postgres is strict).
- `HAVING` and `WHERE` cannot reference a select alias on Postgres.
- `CAST(x AS BIGINT)`, never `AS INTEGER` (32-bit on Postgres).
- An empty `IN ()` is invalid on both: guard it (`0 = 1`).
- User text in `LIKE`: `escapeLike(term)` and `LIKE ? ESCAPE '\'`.
- `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`.
- `INSERT OR REPLACE` → `INSERT ... ON CONFLICT (pk) DO UPDATE SET c = excluded.c`.
- In `DO UPDATE SET`, qualify the current row: `value = table_name.value + 1`.
- `lastInsertRowid` / `rowid` → an explicit id column, `RETURNING id`.
- `IFNULL` → `COALESCE`. Scalar `MAX(a, b)` / `MIN(a, b)` → branch on
  `db.dialect` (`GREATEST` / `LEAST` on Postgres). `instr`, `glob` → `LIKE` or a
  dialect branch. `json_extract` / `json_each` → branch on `db.dialect`
  (Postgres: `(col::jsonb ->> 'k')`, `jsonb_array_elements_text(col::jsonb)`).
- `IS` / `IS NOT` comparing two values that may be NULL → `IS NOT DISTINCT FROM`
  (both dialects support it).
- No SQL comments, `E''` strings or `$` tokens in statements that take
  parameters: `numberedPlaceholders` refuses them.

## Writes, transactions, ids

- `withSqliteTransaction(sqlite, fn, "BEGIN IMMEDIATE")` → `db.transaction(fn, TransactionMode.Immediate)`;
  plain `BEGIN` → `db.transaction(fn)`. `withSqliteRead(sqlite, fn)` → `db.read(fn)`.
- **On Postgres one failed statement aborts the whole transaction**, even when the
  code catches it. Never rely on catching a constraint violation inside a
  transaction. For a create path:
  - `prepareInsertOnly(sqlite, UPSERT)` + `insertingNew(id, ...)` →
    `await insertNew(db, id, UPSERT, params)` (from `insert-new.ts`).
  - `refusingTakenId(sqlite, table, id)` → `await refuseTakenIdAsync(db, table, id)`.
  - Any other `try { insert } catch (constraint)` → `ON CONFLICT ... DO NOTHING` and
    check `changes`.
- `withSqliteTurn` / `outsideSqliteTurn` / `insideSqliteTransaction`: leave the call
  in place if it is in a store and list it in your report (backend phase).
- `childRowsByParent` → `childRowsByParentAsync`; `selectPage` → `selectPageAsync`;
  `countMatching` → `countMatchingAsync` (all in `list-query.ts`).

## DDL

- Keep one SQLite-dialect DDL string. `applySchema` widens every `INTEGER` to
  `BIGINT`, `REAL` to `DOUBLE PRECISION`, `BLOB` to `BYTEA`, `AUTOINCREMENT` to an
  identity column, and adds declared-but-missing columns.
- **Triggers** cannot be translated (`applySchema` refuses them). Keep the SQLite
  trigger DDL for the SQLite factory, and add a Postgres version in
  `ensureXSchema` under `if (db.dialect === SqlDialect.Postgres)`:
  `CREATE OR REPLACE FUNCTION ... LANGUAGE plpgsql` +
  `CREATE OR REPLACE TRIGGER ...`, raising **the same message text** as the
  SQLite `RAISE(ABORT, '...')` so callers that match on it keep working. Run it
  with `db.exec` after `applySchema`.

## Callers

A method that was synchronous becomes `async`. Update **every** caller
(`packages/backend`, `packages/api`, `apps/*`, `scripts/*`, and test files) to
`await` it, so `npx tsc -p tsconfig.json --noEmit` passes. Do not otherwise
restructure callers. An event handler that writes (e.g. `inventoryEvents.subscribe`)
becomes async and its publisher awaits it inside the same transaction.

## Rules of the house

- Behaviour on SQLite must not change: desktop customers run this code.
- No comments except a load-bearing invariant or contract. Closed value sets use
  string enums. Money is never a float.
- Commits: no `Co-Authored-By` trailer.
