import type Database from "better-sqlite3";

/**
 * The three things every store's `list()` was hand-rolling, in one place.
 *
 * WHY THIS EXISTS. Forty stores each built their own `WHERE` string and then
 * returned the whole filtered table, and each one hydrated its child rows with
 * a prepared-statement call PER PARENT inside a `.map()`. On a desktop build
 * that is one synchronous SQLite round trip per line on every keystroke of a
 * list filter. The missing `LIMIT` was systemic rather than a one-off precisely
 * because there was nowhere shared to put it.
 */

/** One page of a list. Absent means "everything", which is still the default. */
export interface ListPage {
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * SQLite's compiled-in ceiling on bound parameters is 999. `IN (...)` lists are
 * chunked under it rather than trusting a caller's page size.
 */
const MAX_BOUND_PARAMS = 900;

/** Accumulates `WHERE` fragments and the values they bind, skipping absent filters. */
export class FilterClauses {
  private readonly clauses: string[] = [];
  private readonly bound: unknown[] = [];

  eq(column: string, value: unknown): this {
    return this.compare(column, "=", value);
  }

  gte(column: string, value: unknown): this {
    return this.compare(column, ">=", value);
  }

  lte(column: string, value: unknown): this {
    return this.compare(column, "<=", value);
  }

  /** A fragment with its own parameters — `total > allocated`, `status IN (?,?)`. */
  raw(sql: string, ...values: unknown[]): this {
    this.clauses.push(sql);
    this.bound.push(...values);
    return this;
  }

  private compare(column: string, op: string, value: unknown): this {
    if (value === undefined || value === null || value === "") return this;
    this.clauses.push(`${column} ${op} ?`);
    this.bound.push(value);
    return this;
  }

  /** `WHERE a = ? AND b >= ?`, or `""` when nothing was filtered. */
  get sql(): string {
    return this.clauses.length > 0 ? `WHERE ${this.clauses.join(" AND ")}` : "";
  }

  get values(): readonly unknown[] {
    return this.bound;
  }
}

export interface SelectPageOptions {
  readonly table: string;
  readonly where: FilterClauses;
  /** Required: a page without a total order is a different page on every call. */
  readonly orderBy: string;
  readonly page?: ListPage;
  readonly columns?: string;
  /** better-sqlite3 returns INTEGER as bigint only when the statement asks. */
  readonly safeIntegers?: boolean;
}

/**
 * One page of rows. `limit` reaches SQL as `LIMIT ? OFFSET ?` — the browser's
 * `.slice()` after the fact is what this exists to replace.
 */
export function selectPage<Row>(sqlite: Database.Database, opts: SelectPageOptions): Row[] {
  const params = [...opts.where.values];
  let sql = `SELECT ${opts.columns ?? "*"} FROM ${opts.table} ${opts.where.sql} ORDER BY ${opts.orderBy}`;
  const limit = opts.page?.limit;
  if (limit !== undefined) {
    // OFFSET is meaningless to SQLite without a LIMIT, so it is only ever
    // appended alongside one.
    sql += " LIMIT ? OFFSET ?";
    params.push(limit, opts.page?.offset ?? 0);
  }
  const statement = sqlite.prepare(sql);
  if (opts.safeIntegers) statement.safeIntegers();
  return statement.all(...params) as Row[];
}

/** How many rows the same filter matches, so a page can report its total. */
export function countMatching(sqlite: Database.Database, table: string, where: FilterClauses): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where.sql}`).get(...where.values) as
    | { n: number | bigint }
    | undefined;
  return Number(row?.n ?? 0);
}

export interface ChildRowsOptions {
  readonly table: string;
  readonly parentColumn: string;
  readonly parentIds: readonly string[];
  readonly orderBy: string;
  readonly columns?: string;
  readonly safeIntegers?: boolean;
}

/**
 * Every child row for a page of parents, in ONE query per chunk, grouped by
 * parent id — the replacement for `rows.map((r) => selectLines.all(r.id))`.
 *
 * A parent with no children is absent from the map, so callers must default to
 * an empty array rather than assume a hit.
 */
export function childRowsByParent<Row>(
  sqlite: Database.Database,
  opts: ChildRowsOptions,
): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (let start = 0; start < opts.parentIds.length; start += MAX_BOUND_PARAMS) {
    const chunk = opts.parentIds.slice(start, start + MAX_BOUND_PARAMS);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const statement = sqlite.prepare(
      `SELECT ${opts.columns ?? "*"} FROM ${opts.table} WHERE ${opts.parentColumn} IN (${placeholders}) ORDER BY ${opts.orderBy}`,
    );
    if (opts.safeIntegers) statement.safeIntegers();
    for (const row of statement.all(...chunk) as Row[]) {
      const parentId = String((row as Record<string, unknown>)[opts.parentColumn]);
      const bucket = grouped.get(parentId);
      if (bucket) bucket.push(row);
      else grouped.set(parentId, [row]);
    }
  }
  return grouped;
}
