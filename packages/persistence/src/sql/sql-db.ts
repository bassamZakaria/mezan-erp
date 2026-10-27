export enum SqlDialect {
  Sqlite = "sqlite",
  Postgres = "postgres",
}

export enum TransactionMode {
  Deferred = "deferred",
  Immediate = "immediate",
}

export type SqlValue = string | number | bigint | boolean | null | Uint8Array;

export interface RunResult {
  readonly changes: number;
}

// CONTRACT: statements use `?` placeholders only — the Postgres adapter numbers
// them. INTEGER/BIGINT columns, COUNT and SUM of integers come back as bigint on
// both dialects; REAL/DOUBLE PRECISION as number. AVG, NUMERIC with a fraction
// and BOOLEAN do NOT read back alike, so no shared statement may select them.
export interface SqlDb {
  readonly dialect: SqlDialect;
  all<Row>(sql: string, params?: readonly SqlValue[]): Promise<Row[]>;
  get<Row>(sql: string, params?: readonly SqlValue[]): Promise<Row | undefined>;
  run(sql: string, params?: readonly SqlValue[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
  // `ddl` is written in SQLite's dialect; Postgres translates it. Existing
  // tables gain any column the DDL declares and they lack, before the script runs.
  applySchema(ddl: string): Promise<void>;
  // A read that must not observe another transaction's uncommitted rows.
  read<T>(fn: () => Promise<T>): Promise<T>;
  transaction<T>(fn: () => Promise<T>, mode?: TransactionMode): Promise<T>;
  // Fire-and-forget follow-ups (notifications, webhooks) start here: with a pooled
  // transaction open they run once it commits, on their own connection, and are
  // dropped if it rolls back; otherwise at once.
  afterCommit(fn: () => void): void;
}

export class DatabaseBusyError extends Error {
  constructor(readonly cause: unknown) {
    super("The company's database had no free connection in time.");
  }
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export class UnsupportedSqlSyntaxError extends Error {
  constructor(readonly sql: string, token: string) {
    super(`Shared SQL may not contain ${token}: placeholders could not be numbered reliably.`);
  }
}

const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;

export function numberedPlaceholders(sql: string): string {
  let out = "";
  let index = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]!;
    const next = sql[i + 1];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      if (char === "'" && (sql[i - 1] === "E" || sql[i - 1] === "e") && !IDENTIFIER_CHAR.test(sql[i - 2] ?? " ")) {
        throw new UnsupportedSqlSyntaxError(sql, "an E'' string");
      }
      quote = char;
    } else if ((char === "-" && next === "-") || (char === "/" && next === "*")) {
      throw new UnsupportedSqlSyntaxError(sql, "a comment");
    } else if (char === "$") {
      throw new UnsupportedSqlSyntaxError(sql, "a $ token");
    } else if (char === "?") {
      out += `$${++index}`;
      continue;
    }
    out += char;
  }
  return out;
}

export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const SQLITE_PRIMARY_KEY_VIOLATION = "SQLITE_CONSTRAINT_PRIMARYKEY";
const PG_UNIQUE_VIOLATION = "23505";

export function isPrimaryKeyViolation(error: unknown): boolean {
  const { code, constraint } = (error ?? {}) as { code?: string; constraint?: string };
  if (code === SQLITE_PRIMARY_KEY_VIOLATION) return true;
  return code === PG_UNIQUE_VIOLATION && typeof constraint === "string" && constraint.endsWith("_pkey");
}
